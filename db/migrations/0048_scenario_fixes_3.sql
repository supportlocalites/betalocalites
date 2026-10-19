-- =============================================================================
-- Localites — migration 0048: fixes from the scenario tests, round 3 (D-54)
-- =============================================================================
-- Messages, as the product owner chose on 19 October 2026:
--   M1  the person deletes a conversation (delete_my_conversation()): it's gone from their
--       messages and from the business's, nobody can write in it again, and 30 days later it's
--       deleted with its messages and files, unless it was reported (then it stays with the
--       report, as before). For those 30 days the business can still report it (without
--       reading it: report_deleted_conversation()), so deleting can't hide abuse from the team.
--       The person can message the business afresh. conversation.person_deleted_at;
--       ended_reason 'person_deleted'.
--   M2  the author edits a message at any time (edit_my_message()), and it shows "Edited"; both
--       sides can see the earlier versions (the owner: "I want you to be able to press a button to
--       see the previous note"), and so can the team through a report. message.edited_at;
--       message_edit keeps each earlier version. Removing a message removes its earlier versions
--       too, unless a report covers it.
--
-- Not destructive except as M1 says, 30 days after the person deletes a conversation.
-- =============================================================================

set search_path = public, extensions;

-- M1 --------------------------------------------------------------------------------------
alter table conversation add column person_deleted_at timestamptz;
comment on column conversation.person_deleted_at is
  'The person deleted it (0048): hidden from both sides; deleted with its messages 30 days later unless reported.';
alter table conversation drop constraint conversation_ended_reason_check;
alter table conversation add constraint conversation_ended_reason_check
  check (ended_reason in ('business_left', 'person_left', 'person_deleted'));

create function delete_my_conversation(p_conversation uuid) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  c record;
begin
  if acting_side() is distinct from 'person' then
    raise exception 'only the person in this conversation can delete it' using errcode = 'LP101';
  end if;
  select id, ended_at into c from conversation
  where id = p_conversation and consumer_user_id = acting_user() and person_deleted_at is null
  for update;
  if not found then
    raise exception 'only the person in this conversation can delete it' using errcode = 'LP101';
  end if;
  -- Its files stay (seen by nobody) until the 30 days are up, in case the business reports it.
  update conversation set person_deleted_at = now(),
                          ended_at = coalesce(ended_at, now()), ended_reason = coalesce(ended_reason, 'person_deleted')
  where id = p_conversation;
end $$;

-- For the business, for 30 days: that a person deleted a conversation, and a way to report it
-- to the team without reading it (independent review: otherwise deleting could hide abuse).
create function deleted_conversations_for_business()
returns table (conversation_id uuid, person text, deleted_at timestamptz, reported boolean)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
begin
  if not acting_in_business() then
    raise exception 'only the business''s team can do this' using errcode = 'LP101';
  end if;
  return query
  select c.id, u.display_name, c.person_deleted_at,
         exists (select 1 from moderation_report r where r.conversation_id = c.id and r.reporter_user_id = acting_user())
  from conversation c join app_user u on u.id = c.consumer_user_id
  where c.vendor_id = acting_vendor() and c.consumer_user_id <> acting_user()
    and c.person_deleted_at > now() - interval '30 days' and c.ended_reason is distinct from 'business_left'
  order by c.person_deleted_at desc limit 50;
end $$;

create function report_deleted_conversation(p_conversation uuid, p_reason text, p_details text)
returns table (report_id uuid, person text, business text)
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  c record;
  v_id uuid := gen_random_uuid();
begin
  if not acting_in_business() then
    raise exception 'only the business''s team can do this' using errcode = 'LP101';
  end if;
  select cv.id, u.display_name as pname, v.display_name as bname into c
  from conversation cv join app_user u on u.id = cv.consumer_user_id join vendor v on v.id = cv.vendor_id
  where cv.id = p_conversation and cv.vendor_id = acting_vendor() and cv.consumer_user_id <> acting_user()
    and cv.person_deleted_at > now() - interval '30 days' and cv.ended_reason is distinct from 'business_left';
  if not found then
    raise exception 'only the people in this conversation can report it' using errcode = 'LP101';
  end if;
  -- The usual limits apply (moderation_report_limits, 0045).
  insert into moderation_report (id, reporter_user_id, reporter_side, conversation_id, message_id, reason, details)
  values (v_id, acting_user(), 'vendor', p_conversation, null, p_reason, nullif(btrim(coalesce(p_details, '')), ''));
  return query select v_id, c.pname, c.bname;
end $$;

-- A message about to be emailed in a conversation the person has just deleted: nobody is told
-- (as 0046 otherwise).
create or replace function new_message_notices(p_message uuid)
returns table (notification_id uuid, user_id uuid, email text, name text, for_business boolean)
language plpgsql security definer set search_path = public, extensions as $$
declare
  m record;
  v_site_today int;
begin
  select msg.id, msg.author_user_id, msg.author_side, msg.created_at, msg.removed_at, c.id as conversation_id,
         c.consumer_user_id, c.vendor_id, c.ended_at
  into m from message msg join conversation c on c.id = msg.conversation_id where msg.id = p_message;
  if exists (select 1 from conversation c where c.id = m.conversation_id and c.person_deleted_at is not null) then
    return;
  end if;
  if not found or m.author_user_id is distinct from acting_user() then
    raise exception 'only the author can do this' using errcode = 'LP101';
  end if;
  -- Taken back before the email went (scenario tests): nobody is emailed about it.
  if m.removed_at is not null then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('localites.message-email', 0));
  select count(*) into v_site_today from notification n
  where n.kind = 'new_message' and n.created_at > now() - interval '1 day'
    and (n.status = 'sent' or (n.status = 'queued' and n.created_at > now() - interval '10 minutes'));
  return query
  with who as (
    select u.id as uid, u.email::text as uemail, u.display_name as uname, false as biz
    from app_user u where m.author_side = 'vendor' and u.id = m.consumer_user_id and u.deleted_at is null
    union all
    select u.id, u.email::text, u.display_name, true
    from vendor_member vm join app_user u on u.id = vm.user_id
    where m.author_side = 'consumer' and m.ended_at is null and vm.vendor_id = m.vendor_id and vm.ended_at is null
      and vm.created_at <= m.created_at          -- on the team when it was written: never a later team
      and u.deleted_at is null and u.id <> m.author_user_id
  ),
  due as (
    select w.*, row_number() over (order by w.uid) as nth from who w
    where not exists (
            select 1 from notification n
            where n.user_id = w.uid and n.kind = 'new_message' and n.subject_type = 'conversation'
              and n.subject_id = m.conversation_id
              and (n.status = 'sent' or (n.status = 'queued' and n.created_at > now() - interval '10 minutes'))
              -- emailed since the first message from this side they haven't read: this stretch
              and n.created_at >= (select min(x.created_at) from message x
                                   where x.conversation_id = m.conversation_id and x.author_side = m.author_side
                                     and x.created_at > coalesce((select r.last_read_at from conversation_read r
                                                                  where r.conversation_id = m.conversation_id
                                                                    and r.user_id = w.uid), '-infinity')))
      and not exists (
            select 1 from conversation_read r
            where r.conversation_id = m.conversation_id and r.user_id = w.uid and r.last_read_at >= m.created_at)
      and (select count(*) from notification n where n.user_id = w.uid and n.kind = 'new_message'
           and n.created_at > now() - interval '1 day'
           and (n.status = 'sent' or (n.status = 'queued' and n.created_at > now() - interval '10 minutes'))) < 30
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

-- Neither side sees a conversation the person deleted (as 0023 and 0025 otherwise).
drop policy conversation_person on conversation;
create policy conversation_person on conversation for all to app_server
  using (acting_side() = 'person' and consumer_user_id = acting_user() and person_deleted_at is null)
  with check (acting_side() = 'person' and consumer_user_id = acting_user() and person_deleted_at is null);
drop policy conversation_business_read on conversation;
create policy conversation_business_read on conversation for select to app_server
  using (acting_in_business() and vendor_id = acting_vendor() and consumer_user_id <> acting_user()
         and ended_reason is distinct from 'business_left' and person_deleted_at is null);
drop policy conversation_business_block on conversation;
create policy conversation_business_block on conversation for update to app_server
  using (acting_for_business() and vendor_id = acting_vendor() and consumer_user_id <> acting_user()
         and ended_reason is distinct from 'business_left' and person_deleted_at is null)
  with check (acting_for_business() and vendor_id = acting_vendor() and consumer_user_id <> acting_user()
              and ended_reason is distinct from 'business_left' and person_deleted_at is null);
drop policy message_person on message;
create policy message_person on message for all to app_server
  using (acting_side() = 'person' and exists (
    select 1 from conversation c where c.id = message.conversation_id and c.consumer_user_id = acting_user()
      and c.person_deleted_at is null))
  with check (acting_side() = 'person' and exists (
    select 1 from conversation c where c.id = message.conversation_id and c.consumer_user_id = acting_user()
      and c.person_deleted_at is null));
drop policy message_business on message;
create policy message_business on message for all to app_server
  using (acting_in_business() and exists (
    select 1 from conversation c where c.id = message.conversation_id and c.vendor_id = acting_vendor()
      and c.consumer_user_id <> acting_user() and c.ended_reason is distinct from 'business_left'
      and c.person_deleted_at is null))
  with check (acting_in_business() and exists (
    select 1 from conversation c where c.id = message.conversation_id and c.vendor_id = acting_vendor()
      and c.consumer_user_id <> acting_user() and c.ended_reason is distinct from 'business_left'
      and c.person_deleted_at is null));
drop policy conversation_file_person on conversation_file;
create policy conversation_file_person on conversation_file for all to app_server
  using (acting_side() = 'person' and exists (
    select 1 from conversation c where c.id = conversation_file.conversation_id and c.consumer_user_id = acting_user()
      and c.person_deleted_at is null))
  with check (acting_side() = 'person' and exists (
    select 1 from conversation c where c.id = conversation_file.conversation_id and c.consumer_user_id = acting_user()
      and c.person_deleted_at is null));
drop policy conversation_file_business on conversation_file;
create policy conversation_file_business on conversation_file for all to app_server
  using (acting_in_business() and exists (
    select 1 from conversation c where c.id = conversation_file.conversation_id and c.vendor_id = acting_vendor()
      and c.consumer_user_id <> acting_user() and c.ended_reason is distinct from 'business_left'
      and c.person_deleted_at is null))
  with check (acting_in_business() and exists (
    select 1 from conversation c where c.id = conversation_file.conversation_id and c.vendor_id = acting_vendor()
      and c.consumer_user_id <> acting_user() and c.ended_reason is distinct from 'business_left'
      and c.person_deleted_at is null));

-- 30 days after the person deletes it (as 0041 otherwise).
create or replace function run_scheduled_deletions()
returns table (emails int, audit int, conversations int, suggestions int)
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_batch constant int := 2000;
  v_convs uuid[];
begin
  perform set_config('localites.retention', 'on', true);

  -- Each kind on its own: one that fails (-1, logged by the morning run) doesn't stop the rest.
  begin
    with gone as (
      delete from notification where id in (
        select id from notification where created_at < now() - interval '1 year'
        order by created_at limit v_batch)
      returning 1)
    select count(*)::int into emails from gone;
  exception when others then
    emails := -1;
    raise warning 'scheduled deletions: email records: %', sqlerrm;
  end;

  begin
    with gone as (
      delete from audit_log a where a.id in (
        select l.id from audit_log l
        where l.created_at < now() - interval '2 years'
          and not exists (select 1 from owner_change o where o.audit_id = l.id or o.undo_audit_id = l.id)
          and not exists (select 1 from vendor_analytics c where c.audit_id = l.id)
        order by l.created_at limit v_batch)
      returning 1)
    select count(*)::int into audit from gone;
  exception when others then
    audit := -1;
    raise warning 'scheduled deletions: change log: %', sqlerrm;
  end;

  begin
    -- A conversation the person deleted, 30 days on and unreported: its files go first (the
    -- nightly clean-up removes them from storage), then it goes with its messages (0048).
    update conversation_file f set deleted_at = now(), kept_for_report = false
    from conversation c
    where c.id = f.conversation_id and f.deleted_at is null and c.person_deleted_at < now() - interval '30 days'
      and not exists (select 1 from moderation_report r where r.conversation_id = c.id);
    select coalesce(array_agg(c.id), '{}') into v_convs from (
      select c.id from conversation c
      where (coalesce(c.last_message_at, c.created_at) < now() - interval '3 years'
             or c.person_deleted_at < now() - interval '30 days')   -- deleted by the person (0048)
        and not exists (select 1 from moderation_report r where r.conversation_id = c.id)
        and not exists (select 1 from conversation_file f where f.conversation_id = c.id and f.storage_removed_at is null)
      order by coalesce(c.last_message_at, c.created_at) limit v_batch
      for update of c skip locked) c;
    delete from conversation_file where conversation_id = any(v_convs);
    delete from reported_message_text t using message m where m.id = t.message_id and m.conversation_id = any(v_convs);
    delete from message_edit e using message m where m.id = e.message_id and m.conversation_id = any(v_convs);
    delete from conversation_read where conversation_id = any(v_convs);
    delete from message where conversation_id = any(v_convs);
    delete from conversation where id = any(v_convs);
    conversations := cardinality(v_convs);
  exception when others then
    conversations := -1;
    raise warning 'scheduled deletions: conversations: %', sqlerrm;
  end;

  begin
    with erased as (
      update vendor_suggestion set contact = null where id in (
        select id from vendor_suggestion
        where status = 'declined' and contact is not null and reviewed_at < now() - interval '1 year'
        limit v_batch)
      returning 1)
    select count(*)::int into suggestions from erased;
  exception when others then
    suggestions := -1;
    raise warning 'scheduled deletions: suggestions: %', sqlerrm;
  end;

  perform set_config('localites.retention', 'off', true);
  return next;
end $$;

-- M2 --------------------------------------------------------------------------------------
alter table message add column edited_at timestamptz;
comment on column message.edited_at is 'When its author last changed its words (0048); the earlier versions are in message_edit.';

create table message_edit (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references message(id),
  body         text not null check (char_length(body) <= 5000),
  replaced_at  timestamptz not null default now()
);
create index message_edit_for_message on message_edit (message_id, replaced_at);
comment on table message_edit is
  'A message''s earlier words, each kept when its author changed them (0048). Both sides of the conversation read them.';
alter table message_edit enable row level security;
alter table message_edit force row level security;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on message_edit from %I', r);
    end if;
  end loop;
end $$;
-- Read as the message is: by the two sides, and only while the message shows (not removed, not hidden by the team).
create policy message_edit_read on message_edit for select to app_server
  using (exists (select 1 from message m where m.id = message_edit.message_id
                   and m.removed_at is null and m.hidden_by_team_at is null));
grant select on message_edit to app_server;

-- As 0025, except that the database's own edit_my_message() may change the words.
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
    -- Editing is only edit_my_message() (0048), which keeps the earlier words.
    if new.removed_at is null and new.body is distinct from old.body
       and coalesce(current_setting('localites.editing', true), '') <> 'on' then
      raise exception 'messages can''t be edited, only removed' using errcode = 'LP100';
    end if;
    if new.edited_at is distinct from old.edited_at and current_user = 'app_server' then
      raise exception 'that can''t be changed' using errcode = 'LP100';
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

create function edit_my_message(p_message uuid, p_body text) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  m record;
  v_body text := btrim(coalesce(p_body, ''));
begin
  select msg.id, msg.body, msg.author_user_id, msg.author_side, msg.removed_at, msg.hidden_by_team_at,
         c.id as cid, c.status, c.consumer_user_id, c.vendor_id, c.ended_at, c.person_deleted_at, v.listing_status, v.claim_status,
         exists (select 1 from conversation_file f where f.message_id = msg.id and f.deleted_at is null) as has_file
  into m
  from message msg join conversation c on c.id = msg.conversation_id join vendor v on v.id = c.vendor_id
  where msg.id = p_message
  for update of msg;
  -- Only its author, on their own side.
  if not found or m.author_user_id is distinct from acting_user() or m.person_deleted_at is not null
     or (m.author_side = 'consumer' and (acting_side() is distinct from 'person' or m.consumer_user_id <> acting_user()))
     or (m.author_side = 'vendor' and (not acting_in_business() or acting_vendor() is distinct from m.vendor_id)) then
    raise exception 'only its author can change a message' using errcode = 'LP101';
  end if;
  if m.removed_at is not null or m.hidden_by_team_at is not null then
    raise exception 'that message is removed' using errcode = 'LP109';
  end if;
  -- While messages can be sent (the same words as sending, 0025).
  if m.status <> 'open' then
    raise exception 'this conversation is blocked, so no new messages can be sent' using errcode = 'LP143';
  end if;
  if m.ended_at is not null or m.claim_status <> 'claimed' or m.listing_status = 'archived' then
    raise exception 'this conversation has ended' using errcode = case when m.author_side = 'consumer' then 'LP140' else 'LP146' end;
  end if;
  if m.listing_status <> 'published' then
    raise exception 'messages are paused' using errcode = case when m.author_side = 'consumer' then 'LP144' else 'LP145' end;
  end if;
  if v_body = '' and not m.has_file then
    raise exception 'a message needs words or a file' using errcode = 'LP147';
  end if;
  if char_length(v_body) > 5000 then
    raise exception 'that message is too long' using errcode = 'LP187';
  end if;
  if v_body = m.body then return; end if;                          -- nothing changed
  if (select count(*) from message_edit e where e.message_id = p_message) >= 20 then
    raise exception 'that message has been changed as many times as it can be' using errcode = 'LP188';
  end if;
  insert into message_edit (message_id, body) values (p_message, m.body);
  perform set_config('localites.editing', 'on', true);
  update message set body = v_body, edited_at = now() where id = p_message;
  perform set_config('localites.editing', 'off', true);
end $$;

-- A message its author removes takes its earlier versions with it, unless a report covers it
-- (the team then reads them with the report, below).
create function edits_go_with_message() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if old.removed_at is null and new.removed_at is not null
     and not exists (select 1 from moderation_report r where r.conversation_id = new.conversation_id and r.created_at >= new.created_at) then
    delete from message_edit where message_id = new.id;
  end if;
  return null;
end $$;
create trigger message_edits_go after update of removed_at on message
  for each row execute function edits_go_with_message();

-- For the team, through a report: every earlier version in the reported conversation (read with
-- reported_conversation_for_team(), which records the look).
create function reported_message_versions_for_team(p_report uuid)
returns table (message_id uuid, body text, replaced_at timestamptz)
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_conversation uuid;
begin
  if not acting_as_team() then
    raise exception 'only the Localites team can do this' using errcode = 'LP101';
  end if;
  select conversation_id into v_conversation from moderation_report where id = p_report;
  if not found then
    raise exception 'no such report' using errcode = 'LP101';
  end if;
  return query
  select e.message_id, e.body, e.replaced_at
  from message_edit e join message m on m.id = e.message_id
  where m.conversation_id = v_conversation
  order by e.message_id, e.replaced_at;
end $$;

revoke all on function delete_my_conversation(uuid), edit_my_message(uuid, text), edits_go_with_message(),
  reported_message_versions_for_team(uuid), deleted_conversations_for_business(), report_deleted_conversation(uuid, text, text) from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function delete_my_conversation(uuid), edit_my_message(uuid, text), '
                     'edits_go_with_message(), reported_message_versions_for_team(uuid), deleted_conversations_for_business(), '
                     'report_deleted_conversation(uuid, text, text) from %I', r);
    end if;
  end loop;
end $$;
grant execute on function delete_my_conversation(uuid), edit_my_message(uuid, text), reported_message_versions_for_team(uuid),
  deleted_conversations_for_business(), report_deleted_conversation(uuid, text, text) to app_server;
