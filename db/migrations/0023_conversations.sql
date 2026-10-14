-- =============================================================================
-- Localites — migration 0023: messages between people and businesses (Stage 2B, part 1)
-- =============================================================================
-- D-13, D-17, ADR-031, E §4.3 and §6: a person starts a conversation with a business that
-- has joined Localites; the business's team replies (never starts one); either side can
-- block; each person's unread position is private to them. Text only in this part: files,
-- reports and the team's reports queue come next.
--
-- Who may do what, enforced here by the side the request acts as (ADR-031):
--   person side    their own conversations: start one (with a business that has joined, not
--                  their own), mention one of their own events, write, remove their own
--                  messages, block and unblock;
--   business side  any current member of the business's team (owner, manager or staff, the
--                  business not archived) reads and replies, after the person's first
--                  message; owners and managers block and unblock;
--   team           nothing: staff read a conversation only through a report (next part).
-- Messages are never rewritten; removing one blanks it and keeps that it was there.
-- One conversation per person and business.
--
-- Not destructive: new tables, functions and triggers; nothing existing changes. To undo: a
-- later migration drops them.
-- =============================================================================

set search_path = public, extensions;

-- Any current member of the business's team (owner, manager or staff), not archived.
-- (acting_for_business(), 0012, is owners and managers only: bookings and blocking.)
create function acting_in_business() returns boolean
language sql stable security invoker set search_path = public, extensions as $$
  select coalesce(acting_side() = 'business' and exists (
    select 1 from vendor_member m join vendor v on v.id = m.vendor_id
    where m.vendor_id = acting_vendor() and m.user_id = acting_user() and m.ended_at is null
      and v.listing_status <> 'archived'), false)
$$;

-- -----------------------------------------------------------------------------
-- 1. CONVERSATIONS
-- -----------------------------------------------------------------------------
create table conversation (
  id                uuid primary key default gen_random_uuid(),
  consumer_user_id  uuid not null references app_user(id),
  vendor_id         uuid not null references vendor(id),
  event_id          uuid references event(id) on delete set null,   -- optional; the person's own
  status            text not null default 'open'
                    check (status in ('open', 'blocked_by_consumer', 'blocked_by_vendor')),
  blocked_at        timestamptz,
  blocked_by        uuid references app_user(id),
  last_message_at   timestamptz,
  created_at        timestamptz not null default now(),
  unique (consumer_user_id, vendor_id),
  check ((status = 'open') = (blocked_at is null)),
  check ((status = 'open') = (blocked_by is null))
);
create index conversation_for_vendor on conversation (vendor_id, last_message_at desc nulls last);
create index conversation_for_person on conversation (consumer_user_id, last_message_at desc nulls last);
comment on table conversation is
  'A person and a business that has joined (D-13). Only the person and the business''s team read it; staff only through a report.';

create function enforce_conversation_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
declare
  v_side text := acting_side();
begin
  if tg_op = 'UPDATE' and (new.id <> old.id or new.consumer_user_id <> old.consumer_user_id
                           or new.vendor_id <> old.vendor_id or new.created_at <> old.created_at) then
    raise exception 'the people in a conversation can''t be changed' using errcode = 'LP100';
  end if;
  if current_user <> 'app_server' then return new; end if;        -- owner path (functions)

  if v_side = 'person' then
    if new.consumer_user_id is distinct from acting_user() then
      raise exception 'only the person in this conversation can do this' using errcode = 'LP101';
    end if;
    if tg_op = 'INSERT' then
      if not exists (select 1 from vendor where id = new.vendor_id and claim_status = 'claimed'
                     and listing_status = 'published') then
        raise exception 'this business hasn''t joined Localites, so it can''t receive messages' using errcode = 'LP140';
      end if;
      if exists (select 1 from vendor_member m where m.vendor_id = new.vendor_id
                 and m.user_id = new.consumer_user_id and m.ended_at is null) then
        raise exception 'you can''t message your own business' using errcode = 'LP108';
      end if;
      new.status := 'open'; new.blocked_at := null; new.blocked_by := null;
      new.last_message_at := null; new.created_at := now();
    elsif new.status is distinct from old.status then
      if (old.status, new.status) not in (('open', 'blocked_by_consumer'), ('blocked_by_consumer', 'open')) then
        raise exception 'that change isn''t possible' using errcode = 'LP109';
      end if;
    end if;
    if new.event_id is not null and (tg_op = 'INSERT' or new.event_id is distinct from old.event_id)
       and not exists (select 1 from event e where e.id = new.event_id and e.host_user_id = new.consumer_user_id) then
      raise exception 'a conversation can only mention your own event' using errcode = 'LP101';
    end if;

  elsif v_side = 'business' then
    if tg_op = 'INSERT' then
      raise exception 'businesses reply to conversations but can''t start one' using errcode = 'LP142';
    end if;
    if new.event_id is distinct from old.event_id or new.last_message_at is distinct from old.last_message_at then
      raise exception 'that can''t be changed' using errcode = 'LP100';
    end if;
    if not acting_for_business() or new.vendor_id is distinct from acting_vendor() then
      raise exception 'only the business''s owner or a manager can do this' using errcode = 'LP101';
    end if;
    if (old.status, new.status) not in (('open', 'blocked_by_vendor'), ('blocked_by_vendor', 'open')) then
      raise exception 'that change isn''t possible' using errcode = 'LP109';
    end if;

  else
    raise exception 'no one is acting for a person or a business' using errcode = 'LP101';
  end if;

  -- The database records who blocked, and when.
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.blocked_at := case when new.status <> 'open' then now() end;
    new.blocked_by := case when new.status <> 'open' then acting_user() end;
  elsif tg_op = 'UPDATE' then
    new.blocked_at := old.blocked_at; new.blocked_by := old.blocked_by;
  end if;
  if tg_op = 'UPDATE' and v_side = 'person' then
    new.last_message_at := old.last_message_at;
  end if;
  return new;
end $$;
create trigger conversation_rules before insert or update on conversation
  for each row execute function enforce_conversation_rules();

-- -----------------------------------------------------------------------------
-- 2. MESSAGES
-- -----------------------------------------------------------------------------
create table message (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversation(id),
  author_user_id   uuid not null references app_user(id),
  author_side      text not null check (author_side in ('consumer', 'vendor')),
  body             text not null,
  created_at       timestamptz not null default now(),
  removed_at       timestamptz,          -- the author removed it: blanked, shown as "Message removed"
  check (char_length(body) <= 5000),
  check ((removed_at is null) = (char_length(btrim(body)) > 0))
);
create index message_in_conversation on message (conversation_id, created_at);
create index message_by_author on message (author_user_id, created_at);

create function enforce_message_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
declare
  c record;
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.conversation_id <> old.conversation_id or new.author_user_id <> old.author_user_id
       or new.author_side <> old.author_side or new.created_at <> old.created_at then
      raise exception 'messages can''t be edited, only removed' using errcode = 'LP100';
    end if;
    if current_user = 'app_server' and new.author_user_id is distinct from acting_user() then
      raise exception 'only the author can remove a message' using errcode = 'LP101';
    end if;
    if old.removed_at is not null then
      raise exception 'that message is already removed' using errcode = 'LP109';
    end if;
    if new.removed_at is null and new.body is distinct from old.body then
      raise exception 'messages can''t be edited, only removed' using errcode = 'LP100';
    end if;
    if new.removed_at is not null then
      new.removed_at := now(); new.body := '';
    end if;
    return new;
  end if;

  if current_user <> 'app_server' then return new; end if;        -- owner path
  -- The conversation, as the acting side may see it (its own rules apply here).
  select cv.id, cv.status, cv.consumer_user_id, cv.vendor_id, v.claim_status, v.listing_status into c
  from conversation cv join vendor v on v.id = cv.vendor_id where cv.id = new.conversation_id;
  if not found then
    raise exception 'only the people in this conversation can write in it' using errcode = 'LP101';
  end if;
  if c.status <> 'open' then
    raise exception 'this conversation is blocked, so no new messages can be sent' using errcode = 'LP143';
  end if;
  if new.author_side = 'consumer' then
    if acting_side() is distinct from 'person' or new.author_user_id is distinct from acting_user()
       or new.author_user_id is distinct from c.consumer_user_id then
      raise exception 'only the person in this conversation can write as themselves' using errcode = 'LP101';
    end if;
    if c.claim_status <> 'claimed' or c.listing_status = 'archived' then
      raise exception 'this business isn''t on Localites any more, so it can''t receive messages' using errcode = 'LP140';
    end if;
  else
    if not acting_in_business() or acting_vendor() is distinct from c.vendor_id
       or new.author_user_id is distinct from acting_user() then
      raise exception 'only the business''s team can write as the business' using errcode = 'LP101';
    end if;
    if not exists (select 1 from message m where m.conversation_id = c.id and m.author_side = 'consumer') then
      raise exception 'businesses reply to conversations but can''t start one' using errcode = 'LP142';
    end if;
  end if;
  new.created_at := now(); new.removed_at := null;
  return new;
end $$;
create trigger message_rules before insert or update on message
  for each row execute function enforce_message_rules();

-- The conversation's last message time, kept by the database (neither side may write it).
create function note_last_message() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  update conversation set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end $$;
create trigger message_last_at after insert on message
  for each row execute function note_last_message();

-- -----------------------------------------------------------------------------
-- 3. EACH PERSON'S OWN UNREAD POSITION (private: an unread count, never a read receipt)
-- -----------------------------------------------------------------------------
create table conversation_read (
  conversation_id  uuid not null references conversation(id),
  user_id          uuid not null references app_user(id),
  last_read_at     timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create function enforce_read_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
begin
  if current_user <> 'app_server' then return new; end if;
  if new.user_id is distinct from acting_user() then
    raise exception 'only your own place can be marked' using errcode = 'LP101';
  end if;
  if tg_op = 'UPDATE' and new.conversation_id <> old.conversation_id then
    raise exception 'that can''t be changed' using errcode = 'LP100';
  end if;
  -- Visible to the acting side (the conversation's rules), or it isn't theirs.
  if not exists (select 1 from conversation c where c.id = new.conversation_id) then
    raise exception 'only the people in this conversation can mark it read' using errcode = 'LP101';
  end if;
  new.last_read_at := now();
  return new;
end $$;
create trigger conversation_read_rules before insert or update on conversation_read
  for each row execute function enforce_read_rules();

-- -----------------------------------------------------------------------------
-- 4. EMAILS ABOUT NEW MESSAGES (one per unread stretch, per person)
-- -----------------------------------------------------------------------------
-- Run by the author right after writing. Returns who to email about this message: the
-- person (when the business wrote) or each current member of the business's team (when the
-- person wrote), skipping anyone already emailed about this conversation since they last
-- read it, deleted accounts, and anyone emailed about messages 30 times in the last day.
-- Each one returned is recorded as a queued notification in the same step, so two quick
-- messages can't both email them; the caller then marks each sent or failed.
create function new_message_notices(p_message uuid)
returns table (notification_id uuid, user_id uuid, email text, name text, for_business boolean)
language plpgsql security definer set search_path = public, extensions as $$
declare
  m record;
begin
  select msg.id, msg.author_user_id, msg.author_side, c.id as conversation_id, c.consumer_user_id, c.vendor_id
  into m from message msg join conversation c on c.id = msg.conversation_id where msg.id = p_message;
  if not found or m.author_user_id is distinct from acting_user() then
    raise exception 'only the author can do this' using errcode = 'LP101';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('localites.message-email:' || m.conversation_id::text, 0));
  return query
  with who as (
    select u.id as uid, u.email::text as uemail, u.display_name as uname, false as biz
    from app_user u where m.author_side = 'vendor' and u.id = m.consumer_user_id and u.deleted_at is null
    union all
    select u.id, u.email::text, u.display_name, true
    from vendor_member vm join app_user u on u.id = vm.user_id
    where m.author_side = 'consumer' and vm.vendor_id = m.vendor_id and vm.ended_at is null
      and u.deleted_at is null and u.id <> m.author_user_id
  ),
  due as (
    select w.* from who w
    where not exists (
            select 1 from notification n
            where n.user_id = w.uid and n.kind = 'new_message' and n.subject_type = 'conversation'
              and n.subject_id = m.conversation_id and n.status in ('queued', 'sent')
              and n.created_at >= coalesce((select r.last_read_at from conversation_read r
                                           where r.conversation_id = m.conversation_id and r.user_id = w.uid), '-infinity'))
      and (select count(*) from notification n where n.user_id = w.uid and n.kind = 'new_message'
           and n.created_at > now() - interval '1 day') < 30
  ),
  queued as (
    insert into notification (user_id, kind, subject_type, subject_id)
    select d.uid, 'new_message', 'conversation', m.conversation_id from due d
    returning id, notification.user_id
  )
  select q.id, d.uid, d.uemail, d.uname, d.biz from queued q join due d on d.uid = q.user_id;
end $$;

-- -----------------------------------------------------------------------------
-- 5. WHAT THE BUSINESS SEES OF A MENTIONED EVENT (D-40's summary, nothing more)
-- -----------------------------------------------------------------------------
-- The business has no rules on the planning tables (ADR-031). For a conversation that
-- mentions one of the person's events, its team sees only the date, the town, about how many
-- guests and whether it's cancelled: never its name, kind, times, where, ages, budget or notes.
create function conversation_event_for_business(p_conversation uuid)
returns table (event_date date, town text, guests int, cancelled boolean)
language sql stable security definer set search_path = public, extensions as $$
  select e.event_date, mu.name, e.guest_count_estimate, e.status = 'cancelled'
  from conversation c
  join event e on e.id = c.event_id
  join municipality mu on mu.id = e.municipality_id
  where c.id = p_conversation and acting_in_business() and c.vendor_id = acting_vendor()
$$;

-- -----------------------------------------------------------------------------
-- 6. ROW-LEVEL SECURITY, POLICIES, GRANTS
-- -----------------------------------------------------------------------------
do $$
declare t text; r text;
begin
  foreach t in array array['conversation', 'message', 'conversation_read'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on %I from %I', t, r);
      end if;
    end loop;
  end loop;
end $$;
-- Deliberately no app_server_all policy, and nothing for the team (reports come next).

create policy conversation_person on conversation for all to app_server
  using (acting_side() = 'person' and consumer_user_id = acting_user())
  with check (acting_side() = 'person' and consumer_user_id = acting_user());
create policy conversation_business_read on conversation for select to app_server
  using (acting_in_business() and vendor_id = acting_vendor());
create policy conversation_business_block on conversation for update to app_server
  using (acting_for_business() and vendor_id = acting_vendor())
  with check (acting_for_business() and vendor_id = acting_vendor());

create policy message_person on message for all to app_server
  using (acting_side() = 'person' and exists (
    select 1 from conversation c where c.id = message.conversation_id and c.consumer_user_id = acting_user()))
  with check (acting_side() = 'person' and exists (
    select 1 from conversation c where c.id = message.conversation_id and c.consumer_user_id = acting_user()));
create policy message_business on message for all to app_server
  using (acting_in_business() and exists (
    select 1 from conversation c where c.id = message.conversation_id and c.vendor_id = acting_vendor()))
  with check (acting_in_business() and exists (
    select 1 from conversation c where c.id = message.conversation_id and c.vendor_id = acting_vendor()));

create policy conversation_read_own on conversation_read for all to app_server
  using (user_id = acting_user() and acting_side() in ('person', 'business'))
  with check (user_id = acting_user() and acting_side() in ('person', 'business'));

grant select, insert (id, consumer_user_id, vendor_id, event_id) on conversation to app_server;
grant update (event_id, status) on conversation to app_server;
grant select, insert (id, conversation_id, author_user_id, author_side, body) on message to app_server;
grant update (removed_at) on message to app_server;
grant select, insert (conversation_id, user_id), update (last_read_at) on conversation_read to app_server;

revoke all on function acting_in_business(), new_message_notices(uuid), note_last_message(),
  conversation_event_for_business(uuid) from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function acting_in_business(), new_message_notices(uuid), note_last_message(), '
                     'conversation_event_for_business(uuid) from %I', r);
    end if;
  end loop;
end $$;
grant execute on function acting_in_business(), new_message_notices(uuid), conversation_event_for_business(uuid) to app_server;
