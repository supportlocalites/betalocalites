-- =============================================================================
-- Localites — migration 0025: messages, after review (Stage 2B)
-- =============================================================================
-- Fixes to migrations 0023 and 0024, found in review:
--
-- 1. A new team never reads the last one's conversations (ADR-029's rule: "a new owner never
--    sees what the team told the last one"). When a business stops being claimed (its last
--    owner removed by the team, or deleting their account), or its last owner leaves, its
--    conversations END: the person
--    keeps their copy, shown as "isn't on Localites any more"; nobody can write in them; no
--    team of the business reads them again. If the business is claimed again, a person can
--    start a new conversation with it. When a person deletes their account, their
--    conversations end too (the business keeps its copy, from "Former Localites member").
-- 2. A business that isn't listed (taken down by the team, D-46) can't send or receive
--    messages until it's listed again: both sides read, neither writes.
-- 3. Someone who later joins a business's team doesn't see their own conversation with it
--    from the business's side (they'd otherwise be able to reply as the business).
-- 4. Emails about new messages: at most 30 a day across the site (the email service's free
--    plan is 100 a day, and sign-in codes go through the same account), recorded as
--    'suppressed' with the reason beyond that; and never to someone who has already seen the
--    message (the site asks about 20 seconds after it's written, so two people chatting with
--    the conversation open aren't emailed about every message).
-- 5. Times: a message's time and a "read up to" time are taken when written (clock time),
--    not when the step began, so a message shown on a page is never counted unread and the
--    conversation's last-message time never goes backwards.
--
-- Not destructive: two new columns (empty until a conversation ends), a unique rule narrowed
-- to conversations that haven't ended (no rows change), functions replaced, rules added.
-- Conversations whose business has already left, or whose person has deleted their
-- account, are marked ended (none expected: messages went live today). To undo: a later
-- migration restores 0023's functions and policies and the unique rule (after removing any
-- second conversation between the same two).
-- =============================================================================

set search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- 1. ENDED CONVERSATIONS
-- -----------------------------------------------------------------------------
alter table conversation
  add column ended_at timestamptz,
  add column ended_reason text check (ended_reason in ('business_left', 'person_left')),
  add constraint conversation_ended_check check ((ended_at is null) = (ended_reason is null));
comment on column conversation.ended_reason is
  'business_left: the business stopped being claimed (its team ended), so no team of it reads this again; person_left: the person deleted their account.';

-- One current conversation per person and business; an ended one doesn't count.
alter table conversation drop constraint conversation_consumer_user_id_vendor_id_key;
create unique index conversation_one_current on conversation (consumer_user_id, vendor_id) where ended_at is null;

-- The business's team ends (claimed → anything else): its conversations end with it.
create function end_conversations_when_business_leaves() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if old.claim_status = 'claimed' and new.claim_status <> 'claimed' then
    update conversation set ended_at = now(), ended_reason = 'business_left'
    where vendor_id = new.id and ended_at is null;
  end if;
  return null;
end $$;
create trigger vendor_end_conversations after update of claim_status on vendor
  for each row execute function end_conversations_when_business_leaves();

-- The same when its last owner leaves (0015 then ends the rest of the team), whatever the
-- claim status says: belt and braces, so no later team can ever inherit them.
create function end_conversations_when_team_ends() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if old.role = 'owner' and old.ended_at is null and new.ended_at is not null
     and not exists (select 1 from vendor_member m where m.vendor_id = new.vendor_id and m.role = 'owner' and m.ended_at is null) then
    update conversation set ended_at = now(), ended_reason = 'business_left'
    where vendor_id = new.vendor_id and ended_at is null;
  end if;
  return null;
end $$;
create trigger vendor_member_end_conversations after update of ended_at on vendor_member
  for each row execute function end_conversations_when_team_ends();

-- A person deletes their account (0014): their conversations end.
create function end_conversations_when_person_leaves() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    update conversation set ended_at = now(), ended_reason = 'person_left'
    where consumer_user_id = new.id and ended_at is null;
  end if;
  return null;
end $$;
create trigger app_user_end_conversations after update of deleted_at on app_user
  for each row execute function end_conversations_when_person_leaves();

update conversation c set ended_at = now(), ended_reason = 'business_left'
from vendor v where v.id = c.vendor_id and v.claim_status <> 'claimed' and c.ended_at is null;
update conversation c set ended_at = now(), ended_reason = 'person_left'
from app_user u where u.id = c.consumer_user_id and u.deleted_at is not null and c.ended_at is null;

-- -----------------------------------------------------------------------------
-- 2. THE RULES, REPLACED (0023's, with the changes above)
-- -----------------------------------------------------------------------------
create or replace function enforce_conversation_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
declare
  v_side text := acting_side();
begin
  if tg_op = 'UPDATE' and (new.id <> old.id or new.consumer_user_id <> old.consumer_user_id
                           or new.vendor_id <> old.vendor_id or new.created_at <> old.created_at) then
    raise exception 'the people in a conversation can''t be changed' using errcode = 'LP100';
  end if;
  if tg_op = 'UPDATE' and old.ended_at is not null
     and (new.ended_at is distinct from old.ended_at or new.ended_reason is distinct from old.ended_reason) then
    raise exception 'an ended conversation stays ended' using errcode = 'LP100';
  end if;
  if current_user <> 'app_server' then return new; end if;        -- owner path (functions)

  if tg_op = 'UPDATE' and old.ended_at is not null then
    raise exception 'this conversation has ended' using errcode = 'LP146';
  end if;

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
      new.ended_at := null; new.ended_reason := null;
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
    if not acting_for_business() or new.vendor_id is distinct from acting_vendor()
       or new.consumer_user_id = acting_user() then
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

create or replace function enforce_message_rules() returns trigger
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
  select cv.id, cv.status, cv.consumer_user_id, cv.vendor_id, cv.ended_at, v.claim_status, v.listing_status into c
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
    if c.ended_at is not null or c.claim_status <> 'claimed' or c.listing_status = 'archived' then
      raise exception 'this business isn''t on Localites any more, so it can''t receive messages' using errcode = 'LP140';
    end if;
    if c.listing_status <> 'published' then
      raise exception 'this business isn''t listed at the moment, so messages are paused' using errcode = 'LP144';
    end if;
  else
    if not acting_in_business() or acting_vendor() is distinct from c.vendor_id
       or new.author_user_id is distinct from acting_user() or new.author_user_id = c.consumer_user_id then
      raise exception 'only the business''s team can write as the business' using errcode = 'LP101';
    end if;
    if c.ended_at is not null then
      raise exception 'this person has left Localites, so the conversation has ended' using errcode = 'LP146';
    end if;
    if c.listing_status <> 'published' then
      raise exception 'your business isn''t listed at the moment, so messages are paused' using errcode = 'LP145';
    end if;
    if not exists (select 1 from message m where m.conversation_id = c.id and m.author_side = 'consumer') then
      raise exception 'businesses reply to conversations but can''t start one' using errcode = 'LP142';
    end if;
  end if;
  new.created_at := clock_timestamp(); new.removed_at := null;
  return new;
end $$;

create or replace function note_last_message() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  update conversation set last_message_at = greatest(last_message_at, new.created_at) where id = new.conversation_id;
  return new;
end $$;

-- "Read up to" is the moment it's written: after the page has read the messages it shows.
create or replace function enforce_read_rules() returns trigger
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
  new.last_read_at := clock_timestamp();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- 3. WHO READS WHAT: no team of a business reads a conversation from before its team
--    ended, and nobody reads their own conversation from the business's side
-- -----------------------------------------------------------------------------
drop policy conversation_business_read on conversation;
create policy conversation_business_read on conversation for select to app_server
  using (acting_in_business() and vendor_id = acting_vendor() and consumer_user_id <> acting_user()
         and ended_reason is distinct from 'business_left');
drop policy conversation_business_block on conversation;
create policy conversation_business_block on conversation for update to app_server
  using (acting_for_business() and vendor_id = acting_vendor() and consumer_user_id <> acting_user()
         and ended_reason is distinct from 'business_left')
  with check (acting_for_business() and vendor_id = acting_vendor() and consumer_user_id <> acting_user()
              and ended_reason is distinct from 'business_left');
drop policy message_business on message;
create policy message_business on message for all to app_server
  using (acting_in_business() and exists (
    select 1 from conversation c where c.id = message.conversation_id and c.vendor_id = acting_vendor()
      and c.consumer_user_id <> acting_user() and c.ended_reason is distinct from 'business_left'))
  with check (acting_in_business() and exists (
    select 1 from conversation c where c.id = message.conversation_id and c.vendor_id = acting_vendor()
      and c.consumer_user_id <> acting_user() and c.ended_reason is distinct from 'business_left'));

create or replace function conversation_event_for_business(p_conversation uuid)
returns table (event_date date, town text, guests int, cancelled boolean)
language sql stable security definer set search_path = public, extensions as $$
  select e.event_date, mu.name, e.guest_count_estimate, e.status = 'cancelled'
  from conversation c
  join event e on e.id = c.event_id
  join municipality mu on mu.id = e.municipality_id
  where c.id = p_conversation and acting_in_business() and c.vendor_id = acting_vendor()
    and c.consumer_user_id <> acting_user() and c.ended_reason is distinct from 'business_left'
$$;

-- -----------------------------------------------------------------------------
-- 4. EMAILS ABOUT NEW MESSAGES
-- -----------------------------------------------------------------------------
create index notification_kind_recent on notification (kind, created_at);

-- As 0023, plus: nobody who has read the conversation since the message was written (they've
-- seen it); at most 30 a day across the site (the rest are recorded as 'suppressed', with the
-- reason). Decided one at a time across the site, so the site's limit holds.
create or replace function new_message_notices(p_message uuid)
returns table (notification_id uuid, user_id uuid, email text, name text, for_business boolean)
language plpgsql security definer set search_path = public, extensions as $$
declare
  m record;
  v_site_today int;
begin
  select msg.id, msg.author_user_id, msg.author_side, msg.created_at, c.id as conversation_id, c.consumer_user_id, c.vendor_id
  into m from message msg join conversation c on c.id = msg.conversation_id where msg.id = p_message;
  if not found or m.author_user_id is distinct from acting_user() then
    raise exception 'only the author can do this' using errcode = 'LP101';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('localites.message-email', 0));
  select count(*) into v_site_today from notification n
  where n.kind = 'new_message' and n.status in ('queued', 'sent') and n.created_at > now() - interval '1 day';
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
    select w.*, row_number() over (order by w.uid) as nth from who w
    where not exists (
            select 1 from notification n
            where n.user_id = w.uid and n.kind = 'new_message' and n.subject_type = 'conversation'
              and n.subject_id = m.conversation_id and n.status in ('queued', 'sent')
              and n.created_at >= coalesce((select r.last_read_at from conversation_read r
                                           where r.conversation_id = m.conversation_id and r.user_id = w.uid), '-infinity'))
      and not exists (
            select 1 from conversation_read r
            where r.conversation_id = m.conversation_id and r.user_id = w.uid and r.last_read_at >= m.created_at)
      and (select count(*) from notification n where n.user_id = w.uid and n.kind = 'new_message'
           and n.status in ('queued', 'sent') and n.created_at > now() - interval '1 day') < 30
  ),
  queued as (
    insert into notification (user_id, kind, subject_type, subject_id, status, failure_reason, created_at)
    select d.uid, 'new_message', 'conversation', m.conversation_id,
           case when v_site_today + d.nth <= 30 then 'queued' else 'suppressed' end,
           case when v_site_today + d.nth <= 30 then null else 'the site''s daily limit for message emails' end,
           clock_timestamp()                       -- comparable with "read up to" (clock time)
    from due d
    returning id, notification.user_id, notification.status
  )
  select q.id, d.uid, d.uemail, d.uname, d.biz from queued q join due d on d.uid = q.user_id
  where q.status = 'queued';
end $$;

revoke all on function end_conversations_when_business_leaves(), end_conversations_when_team_ends(),
  end_conversations_when_person_leaves() from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function end_conversations_when_business_leaves(), end_conversations_when_team_ends(), '
                     'end_conversations_when_person_leaves() from %I', r);
    end if;
  end loop;
end $$;
