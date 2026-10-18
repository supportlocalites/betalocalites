-- =============================================================================
-- Localites — migration 0037: guests, part 2 (Stage 4; D-08, E §4.6 and §5)
-- =============================================================================
--   1. The group link (D-08): one per event, for a group chat, a social post or a printed QR
--      code. Anyone holding it can reply, giving their name; nothing about other guests is
--      shown. Made from INVITE_KEY like a guest's link; only its hash is stored. The host can
--      switch it off or replace it (the old one stops at once). Same 30 days after the event.
--   2. Group replies: each reply through the group link, with a name. Whoever replied can
--      change their own reply from the same browser (a random key in a cookie; only its hash is
--      stored). The host matches a reply to a guest on their list with one tap (the guest then
--      shows that reply) or removes it. At most 300 an event.
--   3. The host's questions (up to 5 an event, a short answer each, optional to answer): asked
--      on every invitation; answers are kept with the guest or the group reply.
--   4. Updates to guests: short notes the host posts ("We've moved to 3 pm"), shown on every
--      invitation, newest first. Localites doesn't send them anywhere (D-08): the host shares
--      them from their own phone if they like.
-- As in part 1: only the host reads or changes any of it (as the person, ADR-031); a guest
-- reaches only their own invitation, through the functions below.
--
-- Not destructive: new tables and functions. To undo: a later migration drops them.
-- =============================================================================

set search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- 1. THE GROUP LINK
-- -----------------------------------------------------------------------------
create table event_group_link (
  event_id      uuid primary key,
  host_user_id  uuid not null,
  version       int not null default 1 check (version >= 1),
  token_hash    bytea unique check (octet_length(token_hash) = 32),   -- null: switched off
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (event_id, host_user_id) references event (id, host_user_id) on delete cascade
);
comment on table event_group_link is
  'An event''s group link (D-08). Only the host reads it; anyone with the link reaches the invitation through group_invitation_for().';

-- -----------------------------------------------------------------------------
-- 2. GROUP REPLIES
-- -----------------------------------------------------------------------------
create table group_reply (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null,
  host_user_id      uuid not null,
  browser_hash      bytea not null check (octet_length(browser_hash) = 32),   -- sha256 of the replier's cookie key
  name              text not null check (char_length(btrim(name)) between 1 and 80),
  response          text not null check (response in ('yes', 'no', 'maybe')),
  party_size        smallint check (party_size between 1 and 20),
  reply_note        text check (char_length(btrim(reply_note)) between 1 and 500),
  matched_guest_id  uuid references guest(id) on delete set null,
  matched_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (event_id, host_user_id) references event (id, host_user_id) on delete cascade,
  unique (event_id, browser_hash),
  check (case when response in ('yes', 'maybe') then party_size is not null else party_size is null end)
);
create index group_reply_event on group_reply (event_id, created_at);
comment on table group_reply is
  'A reply through an event''s group link (D-08): a name, not an account. Only the host reads it.';

-- -----------------------------------------------------------------------------
-- 3. QUESTIONS AND ANSWERS
-- -----------------------------------------------------------------------------
create table event_question (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null,
  host_user_id  uuid not null,
  question      text not null check (char_length(btrim(question)) between 1 and 200),
  created_at    timestamptz not null default now(),
  foreign key (event_id, host_user_id) references event (id, host_user_id) on delete cascade
);
create index event_question_event on event_question (event_id, created_at);

create table guest_answer (
  id              uuid primary key default gen_random_uuid(),
  question_id     uuid not null references event_question(id) on delete cascade,
  host_user_id    uuid not null,
  guest_id        uuid references guest(id) on delete cascade,
  group_reply_id  uuid references group_reply(id) on delete cascade,
  answer          text not null check (char_length(btrim(answer)) between 1 and 500),
  created_at      timestamptz not null default now(),
  check ((guest_id is null) <> (group_reply_id is null))
);
create unique index guest_answer_guest on guest_answer (question_id, guest_id) where guest_id is not null;
create unique index guest_answer_group on guest_answer (question_id, group_reply_id) where group_reply_id is not null;
comment on table guest_answer is 'A guest''s answer to the host''s question. Only the host reads it.';

-- -----------------------------------------------------------------------------
-- 4. UPDATES TO GUESTS
-- -----------------------------------------------------------------------------
create table event_update (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null,
  host_user_id  uuid not null,
  body          text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at    timestamptz not null default now(),
  foreign key (event_id, host_user_id) references event (id, host_user_id) on delete cascade
);
create index event_update_event on event_update (event_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 5. THE HOST'S RULES
-- -----------------------------------------------------------------------------
-- Writes by the app are the host's own (as the person), on an event still being planned;
-- the functions below (the database owner) write guests' replies and answers.
create function enforce_guest_extra_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions, pg_temp as $$
declare
  v_host uuid := case when tg_op = 'DELETE' then old.host_user_id else new.host_user_id end;
  v_event uuid;
  ev record;
begin
  if current_user <> 'app_server' then
    return case when tg_op = 'DELETE' then old else new end;          -- owner path (functions)
  end if;
  if acting_side() is distinct from 'person' or v_host is distinct from acting_user() then
    raise exception 'only the person planning this event can change its guests' using errcode = 'LP101';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_table_name = 'guest_answer' then
    raise exception 'answers are the guests'' own' using errcode = 'LP100';
  end if;
  v_event := new.event_id;
  if tg_op = 'UPDATE' and (new.event_id <> old.event_id or new.host_user_id <> old.host_user_id) then
    raise exception 'that can''t be moved to another event' using errcode = 'LP100';
  end if;
  select e.status, event_ends_at(e) as ends into ev from event e where e.id = v_event;
  if not found then
    raise exception 'only the person planning this event can change its guests' using errcode = 'LP101';
  end if;
  if ev.status <> 'planning' then
    raise exception 'a cancelled event can''t be changed' using errcode = 'LP102';
  end if;

  if tg_table_name = 'event_group_link' then
    if tg_op = 'INSERT' then
      new.version := 1; new.created_at := now();
    elsif new.token_hash is distinct from old.token_hash then
      -- A new link is the next version; switching it off keeps the version (so the next one differs).
      if new.token_hash is not null and new.version <> old.version + 1 then
        raise exception 'that can''t be changed' using errcode = 'LP100';
      end if;
      if new.token_hash is null and new.version <> old.version then
        raise exception 'that can''t be changed' using errcode = 'LP100';
      end if;
    elsif new.version <> old.version then
      raise exception 'that can''t be changed' using errcode = 'LP100';
    end if;
    new.updated_at := now();
  elsif tg_table_name = 'group_reply' then
    -- The host only removes a group reply (DELETE above) or matches it (match_group_reply).
    raise exception 'a guest''s reply is their own' using errcode = 'LP100';
  elsif tg_table_name = 'event_question' then
    if tg_op = 'UPDATE' then
      raise exception 'remove the question and ask a new one' using errcode = 'LP100';
    end if;
    if (select count(*) from event_question q where q.event_id = v_event) >= 5 then
      raise exception 'an invitation can ask up to 5 questions' using errcode = 'LP172';
    end if;
    new.created_at := now();
  elsif tg_table_name = 'event_update' then
    if tg_op = 'UPDATE' then
      raise exception 'remove the update and post a new one' using errcode = 'LP100';
    end if;
    if ev.ends < now() then
      raise exception 'the event is over' using errcode = 'LP161';
    end if;
    if (select count(*) from event_update u where u.event_id = v_event) >= 20 then
      raise exception 'an event can have up to 20 updates' using errcode = 'LP173';
    end if;
    new.created_at := now();
  end if;
  return new;
end $$;
create trigger event_group_link_rules before insert or update or delete on event_group_link
  for each row execute function enforce_guest_extra_rules();
create trigger group_reply_rules before insert or update or delete on group_reply
  for each row execute function enforce_guest_extra_rules();
create trigger event_question_rules before insert or update or delete on event_question
  for each row execute function enforce_guest_extra_rules();
create trigger guest_answer_rules before insert or update or delete on guest_answer
  for each row execute function enforce_guest_extra_rules();
create trigger event_update_rules before insert or update or delete on event_update
  for each row execute function enforce_guest_extra_rules();

do $$
declare t text;
begin
  foreach t in array array['event_group_link', 'group_reply', 'event_question', 'guest_answer', 'event_update'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I for all to app_server
                      using (acting_side() = ''person'' and host_user_id = acting_user())
                      with check (acting_side() = ''person'' and host_user_id = acting_user())', t || '_host', t);
  end loop;
end $$;
grant select, insert (event_id, host_user_id, token_hash), update (token_hash, version) on event_group_link to app_server;
grant select, delete on group_reply to app_server;
grant select, insert (id, event_id, host_user_id, question), delete on event_question to app_server;
grant select on guest_answer to app_server;
grant select, insert (id, event_id, host_user_id, body), delete on event_update to app_server;

-- The host matches a group reply to a guest on their list: the guest shows that reply (and its
-- answers), as the guest's own. One reply per guest; a guest's earlier reply is replaced.
create function match_group_reply(p_reply uuid, p_guest uuid) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  r record;
begin
  if acting_side() is distinct from 'person' then
    raise exception 'only the person planning this event can change its guests' using errcode = 'LP101';
  end if;
  select gr.* into r from group_reply gr
    join guest g on g.id = p_guest and g.event_id = gr.event_id and g.host_user_id = acting_user()
    join event e on e.id = gr.event_id and e.status = 'planning'
  where gr.id = p_reply and gr.host_user_id = acting_user()
  for update of gr;
  if not found then
    raise exception 'only the person planning this event can change its guests' using errcode = 'LP101';
  end if;
  if r.matched_guest_id is not null then
    raise exception 'that reply is already matched' using errcode = 'LP174';
  end if;
  update guest set response = r.response, party_size = r.party_size, reply_note = r.reply_note,
                   replied_at = r.updated_at, reply_by = 'guest',
                   first_opened_at = coalesce(first_opened_at, r.created_at)
  where id = p_guest;
  delete from guest_answer where guest_id = p_guest;
  update guest_answer set guest_id = p_guest, group_reply_id = null where group_reply_id = p_reply;
  update group_reply set matched_guest_id = p_guest, matched_at = now() where id = p_reply;
end $$;

-- -----------------------------------------------------------------------------
-- 6. WHAT GUESTS SEE AND SEND (no account)
-- -----------------------------------------------------------------------------
-- The event behind a group link, if it still opens (30 days after the event, as personal links).
create function group_event(p_token_hash bytea) returns uuid
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select l.event_id from event_group_link l join event e on e.id = l.event_id
    join app_user u on u.id = e.host_user_id and u.deleted_at is null
  where l.token_hash = p_token_hash and e.event_date + 30 >= (now() at time zone 'America/Toronto')::date
$$;

-- A group link's invitation: as a personal one, without a guest's name; and this browser's own
-- reply, if it sent one. Nothing about anyone else.
create function group_invitation_for(p_token_hash bytea, p_browser_hash bytea)
returns table (title text, event_date date, start_time time, end_time time, town text, venue_note text, message text,
               host_name text, status text, reply_name text, response text, party_size smallint, reply_note text,
               timezone text)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select p.title, e.event_date, e.start_time, e.end_time, m.name, p.venue_note, p.guest_message, u.given_name,
         case when e.status = 'cancelled' then 'cancelled' when event_ends_at(e) < now() then 'closed' else 'open' end,
         gr.name, gr.response, gr.party_size, gr.reply_note, e.timezone
  from event e
    join event_private p on p.event_id = e.id
    join municipality m on m.id = e.municipality_id
    join app_user u on u.id = e.host_user_id
    left join group_reply gr on gr.event_id = e.id and gr.browser_hash = p_browser_hash
  where e.id = group_event(p_token_hash)
$$;

-- A reply through the group link: a new one, or this browser's own changed. Answers replace
-- this reply's earlier ones (an empty answer removes it). Returns the reply's id.
create function group_invitation_reply(p_token_hash bytea, p_browser_hash bytea, p_name text, p_response text,
                                       p_party_size smallint, p_note text, p_answers jsonb)
returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  ev record;
  v_id uuid;
begin
  select e.id, e.host_user_id, e.status, event_ends_at(e) as ends into ev
  from event e where e.id = group_event(p_token_hash) for share;
  if not found then
    raise exception 'this invitation link isn''t valid' using errcode = 'LP101';
  end if;
  if ev.status = 'cancelled' then
    raise exception 'this event was cancelled' using errcode = 'LP102';
  end if;
  if ev.ends < now() then
    raise exception 'replies are closed: the event is over' using errcode = 'LP164';
  end if;
  if p_response not in ('yes', 'no', 'maybe') then
    raise exception 'choose yes, no or maybe' using errcode = 'LP100';
  end if;
  if p_response <> 'no' and (p_party_size is null or p_party_size not between 1 and 20) then
    raise exception 'how many: from 1 to 20' using errcode = 'LP165';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'your name, please' using errcode = 'LP175';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('localites.group-reply:' || ev.id::text, 0));
  select id into v_id from group_reply where event_id = ev.id and browser_hash = p_browser_hash;
  if v_id is null then
    if (select count(*) from group_reply where event_id = ev.id) >= 300 then
      raise exception 'this invitation has had all the replies it can take: ask your host' using errcode = 'LP176';
    end if;
    insert into group_reply (event_id, host_user_id, browser_hash, name, response, party_size, reply_note)
    values (ev.id, ev.host_user_id, p_browser_hash, btrim(p_name), p_response,
            case when p_response = 'no' then null else p_party_size end, nullif(btrim(p_note), ''))
    returning id into v_id;
  else
    update group_reply set name = btrim(p_name), response = p_response,
                           party_size = case when p_response = 'no' then null else p_party_size end,
                           reply_note = nullif(btrim(p_note), ''), updated_at = now()
    where id = v_id;
    -- Already matched to a guest: their reply follows.
    update guest g set response = p_response, party_size = case when p_response = 'no' then null else p_party_size end,
                       reply_note = nullif(btrim(p_note), ''), replied_at = now(), reply_by = 'guest'
    from group_reply gr where gr.id = v_id and g.id = gr.matched_guest_id;
  end if;
  perform save_answers(ev.id, ev.host_user_id, null, v_id, p_answers);
  return v_id;
end $$;

-- A guest's (or a group reply's) answers: {"<question id>": "answer", ...}; empty removes one.
create function save_answers(p_event uuid, p_host uuid, p_guest uuid, p_reply uuid, p_answers jsonb) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  q record;
  v_answer text;
  v_matched uuid;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    return;
  end if;
  -- A matched group reply's answers belong to its guest.
  if p_reply is not null then
    select matched_guest_id into v_matched from group_reply where id = p_reply;
    if v_matched is not null then
      p_guest := v_matched; p_reply := null;
    end if;
  end if;
  for q in select id from event_question where event_id = p_event loop
    if not (p_answers ? q.id::text) then
      continue;
    end if;
    v_answer := nullif(btrim(left(p_answers ->> q.id::text, 500)), '');
    if p_guest is not null then
      delete from guest_answer where question_id = q.id and guest_id = p_guest;
    else
      delete from guest_answer where question_id = q.id and group_reply_id = p_reply;
    end if;
    if v_answer is not null then
      insert into guest_answer (question_id, host_user_id, guest_id, group_reply_id, answer)
      values (q.id, p_host, p_guest, p_reply, v_answer);
    end if;
  end loop;
end $$;

-- A guest's answers by their own link (after invitation_reply).
create function invitation_answers(p_token_hash bytea, p_answers jsonb) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  g record;
begin
  select gu.id, gu.event_id, gu.host_user_id, e.status, event_ends_at(e) as ends into g
  from guest gu join event e on e.id = gu.event_id join app_user u on u.id = e.host_user_id and u.deleted_at is null
  where gu.token_hash = p_token_hash and e.event_date + 30 >= (now() at time zone 'America/Toronto')::date;
  if not found then
    raise exception 'this invitation link isn''t valid' using errcode = 'LP101';
  end if;
  if g.status = 'cancelled' or g.ends < now() then
    raise exception 'replies are closed: the event is over' using errcode = 'LP164';
  end if;
  perform save_answers(g.event_id, g.host_user_id, g.id, null, p_answers);
end $$;

-- The questions and updates an invitation shows, by a personal link or the group link (with
-- this browser's own answers). Nothing else.
create function invitation_extras(p_token_hash bytea, p_browser_hash bytea)
returns table (kind text, id uuid, body text, answer text, at timestamptz)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  with who as (
    select gu.event_id, gu.id as guest_id, null::uuid as reply_id
    from guest gu join event e on e.id = gu.event_id join app_user u on u.id = e.host_user_id and u.deleted_at is null
    where gu.token_hash = p_token_hash and e.event_date + 30 >= (now() at time zone 'America/Toronto')::date
    union all
    select group_event(p_token_hash), gr.matched_guest_id, gr.id
    from (select 1) one left join group_reply gr
      on gr.event_id = group_event(p_token_hash) and gr.browser_hash = p_browser_hash
    where group_event(p_token_hash) is not null
  )
  select 'question', q.id, q.question,
         (select a.answer from guest_answer a
          where a.question_id = q.id and (a.guest_id = w.guest_id or a.group_reply_id = w.reply_id)
          limit 1),
         q.created_at
  from who w join event_question q on q.event_id = w.event_id
  union all
  select 'update', up.id, up.body, null, up.created_at
  from who w join event_update up on up.event_id = w.event_id
  order by 1, 5
$$;

-- -----------------------------------------------------------------------------
-- 7. PERMISSIONS
-- -----------------------------------------------------------------------------
revoke all on function enforce_guest_extra_rules(), match_group_reply(uuid, uuid), group_event(bytea),
  group_invitation_for(bytea, bytea), group_invitation_reply(bytea, bytea, text, text, smallint, text, jsonb),
  save_answers(uuid, uuid, uuid, uuid, jsonb), invitation_answers(bytea, jsonb), invitation_extras(bytea, bytea) from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on event_group_link, group_reply, event_question, guest_answer, event_update from %I', r);
      execute format('revoke all on function match_group_reply(uuid, uuid), group_event(bytea), '
                     'group_invitation_for(bytea, bytea), group_invitation_reply(bytea, bytea, text, text, smallint, text, jsonb), '
                     'save_answers(uuid, uuid, uuid, uuid, jsonb), invitation_answers(bytea, jsonb), '
                     'invitation_extras(bytea, bytea) from %I', r);
    end if;
  end loop;
end $$;
grant execute on function match_group_reply(uuid, uuid), group_invitation_for(bytea, bytea),
  group_invitation_reply(bytea, bytea, text, text, smallint, text, jsonb), invitation_answers(bytea, jsonb),
  invitation_extras(bytea, bytea) to app_server;
