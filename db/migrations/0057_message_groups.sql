-- =============================================================================
-- Localites — migration 0057: groups in Messages (D-62)
-- =============================================================================
-- The product owner chose Messages Style A on 25 October 2026 ("I want them to be able to be
-- bucketed but also be read individually"):
--   message_group         a person's own named group of conversations, made by Message all
--                         ("there needs to be a way to 'name' the group before we send or
--                         after"; not required: "date is fine"). Private: only the person
--                         acting as themselves reads or changes theirs (ADR-031). A business
--                         never sees a group, its name, or who else was asked.
--   message_group_member  which of the person's own conversations are in it. A conversation
--                         can be in more than one group (one conversation per business, D-13).
--   message_group_send    which of the person's own messages were sent with the group, so the
--                         conversation can say "Sent with the group …" (to the person only).
--   Past Message alls     grouped by the day they were sent ("yes"): the same words (20
--                         letters or more) from a person to 2 to 10 businesses within 2 minutes
--                         become a group called "Message all · 20 Oct" (with the time when there
--                         are two that day). group_past_message_alls(), owner only.
--   my_data()             Download your data also has the groups (my_data_0053 kept, renamed).
--   An account deleted: its groups go with it. A conversation or message deleted (by the
--   scheduled deletions) takes its group rows with it.
--
-- Not destructive: three tables, triggers, a function renamed and two added, and rows added
-- for past Message alls (nothing existing is changed).
-- =============================================================================

set search_path = public, extensions;

create table message_group (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references app_user(id),
  name        text not null check (char_length(btrim(name)) between 1 and 60 and name = btrim(name)),
  created_at  timestamptz not null default now()
);
create index message_group_by_person on message_group (user_id, created_at);
comment on table message_group is
  'A person''s own named group of conversations (0057, D-62), made by Message all. Only they see it.';

create table message_group_member (
  group_id         uuid not null references message_group(id) on delete cascade,
  conversation_id  uuid not null references conversation(id) on delete cascade,
  added_at         timestamptz not null default now(),
  primary key (group_id, conversation_id)
);
create index message_group_member_by_conversation on message_group_member (conversation_id);
comment on table message_group_member is
  'Which of the person''s conversations are in their group (0057). One conversation can be in several.';

create table message_group_send (
  message_id  uuid primary key references message(id) on delete cascade,
  group_id    uuid not null references message_group(id) on delete cascade
);
create index message_group_send_by_group on message_group_send (group_id);
comment on table message_group_send is
  'The person''s messages sent with a group (0057), so their conversation can say so. Never shown to the business.';

-- Rules: only the person acting as themselves, and only their own conversations and messages.
create function enforce_message_group_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
begin
  if current_user <> 'app_server' then return new; end if;
  if acting_side() is distinct from 'person' or new.user_id is distinct from acting_user() then
    raise exception 'only you can make or change your groups' using errcode = 'LP101';
  end if;
  if tg_op = 'UPDATE' and (new.id <> old.id or new.user_id <> old.user_id or new.created_at <> old.created_at) then
    raise exception 'only a group''s name can change' using errcode = 'LP100';
  end if;
  return new;
end $$;
create trigger message_group_rules before insert or update on message_group
  for each row execute function enforce_message_group_rules();

create function enforce_message_group_member_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
begin
  if current_user <> 'app_server' then return new; end if;
  if acting_side() is distinct from 'person'
     or not exists (select 1 from message_group g where g.id = new.group_id and g.user_id = acting_user())
     or not exists (select 1 from conversation c where c.id = new.conversation_id and c.consumer_user_id = acting_user()
                    and c.person_deleted_at is null) then
    raise exception 'only your own conversations can go in your groups' using errcode = 'LP101';
  end if;
  return new;
end $$;
create trigger message_group_member_rules before insert on message_group_member
  for each row execute function enforce_message_group_member_rules();

create function enforce_message_group_send_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
begin
  if current_user <> 'app_server' then return new; end if;
  if acting_side() is distinct from 'person'
     or not exists (select 1 from message m join message_group_member gm on gm.conversation_id = m.conversation_id
                    join message_group g on g.id = gm.group_id
                    where m.id = new.message_id and gm.group_id = new.group_id and g.user_id = acting_user()
                      and m.author_user_id = acting_user() and m.author_side = 'consumer') then
    raise exception 'only your own messages, in that group''s conversations' using errcode = 'LP101';
  end if;
  return new;
end $$;
create trigger message_group_send_rules before insert on message_group_send
  for each row execute function enforce_message_group_send_rules();

alter table message_group enable row level security;
alter table message_group force row level security;
alter table message_group_member enable row level security;
alter table message_group_member force row level security;
alter table message_group_send enable row level security;
alter table message_group_send force row level security;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on message_group, message_group_member, message_group_send from %I', r);
    end if;
  end loop;
end $$;
create policy message_group_own on message_group for all to app_server
  using (acting_side() = 'person' and user_id = acting_user())
  with check (acting_side() = 'person' and user_id = acting_user());
create policy message_group_member_own on message_group_member for all to app_server
  using (acting_side() = 'person' and exists (select 1 from message_group g where g.id = group_id and g.user_id = acting_user()))
  with check (acting_side() = 'person' and exists (select 1 from message_group g where g.id = group_id and g.user_id = acting_user()));
create policy message_group_send_own on message_group_send for all to app_server
  using (acting_side() = 'person' and exists (select 1 from message_group g where g.id = group_id and g.user_id = acting_user()))
  with check (acting_side() = 'person' and exists (select 1 from message_group g where g.id = group_id and g.user_id = acting_user()));
revoke all on message_group, message_group_member, message_group_send from app_server;
grant select, insert (id, user_id, name), update (name) on message_group to app_server;
grant select, insert (group_id, conversation_id) on message_group_member to app_server;
grant select, insert (message_id, group_id) on message_group_send to app_server;

-- Past Message alls, by the day they were sent (the owner: "yes"). A Message all sends the same
-- words to each business within a moment, so: the same words (20 letters or more) from one
-- person (an account still open) to 2 to 10 conversations, within 2 minutes. Their own messages
-- only, not removed, in conversations they haven't deleted, not already in a group. Two on one
-- day are told apart by the time. Kept as a function so the database checks can try it; only
-- the database's owner can run it.
create function group_past_message_alls() returns integer
language plpgsql security invoker set search_path = public, extensions as $$
declare
  made integer;
begin
  with sends as (
    select m.id as message_id, m.conversation_id, c.consumer_user_id as user_id, m.body, m.created_at,
           (m.created_at at time zone 'America/Toronto')::date as day
    from message m join conversation c on c.id = m.conversation_id join app_user u on u.id = c.consumer_user_id
    where m.author_side = 'consumer' and m.author_user_id = c.consumer_user_id and m.removed_at is null
      and c.person_deleted_at is null and u.deleted_at is null and char_length(btrim(m.body)) >= 20
      and not exists (select 1 from message_group_send s where s.message_id = m.id)
  ), firsts as (
    select user_id, body, day, min(created_at) as first_at from sends group by user_id, body, day
  ), together as (
    select s.*, f.first_at from sends s
    join firsts f on f.user_id = s.user_id and f.body = s.body and f.day = s.day and s.created_at < f.first_at + interval '2 minutes'
  ), groups as (
    select gen_random_uuid() as id, user_id, body, day, first_at,
           count(*) over (partition by user_id, day) as that_day
    from together group by user_id, body, day, first_at
    having count(distinct conversation_id) between 2 and 10
  ), made_groups as (
    insert into message_group (id, user_id, name, created_at)
    select id, user_id,
           'Message all · ' || to_char(day, 'FMDD Mon')
             || case when that_day > 1 then ', ' || to_char(first_at at time zone 'America/Toronto', 'FMHH12:MI am') else '' end,
           first_at
    from groups
    returning id
  ), made_members as (
    insert into message_group_member (group_id, conversation_id, added_at)
    select distinct g.id, t.conversation_id, g.first_at
    from groups g join together t on t.user_id = g.user_id and t.body = g.body and t.day = g.day
    returning 1
  ), made_sends as (
    insert into message_group_send (message_id, group_id)
    select distinct on (t.message_id) t.message_id, g.id
    from groups g join together t on t.user_id = g.user_id and t.body = g.body and t.day = g.day
    order by t.message_id, g.first_at
    returning 1
  )
  select (select count(*) from made_groups) + 0 * (select count(*) from made_members) + 0 * (select count(*) from made_sends)
  into made;
  return made;
end $$;
select group_past_message_alls();

-- An account deleted: its groups go (as the other app_user_* clean-ups, 0021 to 0053).
create function message_groups_go_with_account() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  delete from message_group where user_id = new.id;
  return new;
end $$;
create trigger app_user_message_groups_go after update of deleted_at on app_user
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function message_groups_go_with_account();

-- Download your data: as 0053, plus the groups.
alter function my_data() rename to my_data_0053;
revoke all on function my_data_0053() from app_server;

create function my_data() returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  me uuid := acting_user();
  base jsonb := my_data_0053();   -- checks it's the person acting as themselves (LP101)
begin
  return base || jsonb_build_object(
    'message_groups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', g.name, 'made', g.created_at,
               'businesses', coalesce((select jsonb_agg(v.display_name order by v.display_name)
                                       from message_group_member gm join conversation c on c.id = gm.conversation_id
                                       join vendor v on v.id = c.vendor_id where gm.group_id = g.id), '[]'))
             order by g.created_at)
      from message_group g where g.user_id = me), '[]'));
end $$;

revoke all on function my_data(), my_data_0053(), message_groups_go_with_account(), enforce_message_group_rules(),
  enforce_message_group_member_rules(), enforce_message_group_send_rules(), group_past_message_alls() from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function my_data(), my_data_0053(), message_groups_go_with_account(), enforce_message_group_rules(), enforce_message_group_member_rules(), enforce_message_group_send_rules(), group_past_message_alls() from %I', r);
    end if;
  end loop;
end $$;
grant execute on function my_data() to app_server;
