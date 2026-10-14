-- =============================================================================
-- Localites — migration 0026: messages, after a second review (Stage 2B)
-- =============================================================================
-- Fixes to migration 0025 (and one older gap from 0023/0024), found in review:
--
-- 1. Conversations a business's new team had already inherited before 0025 are ended now:
--    any still-current conversation that, after it started, saw its business with no owner
--    (its last owner left) or no longer claimed. And when a new team forms (an owner joins a
--    business that has none), any conversation still current is ended, so one started at the
--    very moment the last owner was removed can't pass to the next team either.
-- 2. Emails about a person's message go only to people who were on the business's team when
--    it was written, and never about a conversation that has ended. An email still being sent
--    counts for 10 minutes (as plan emails do); after that it no longer blocks the next one.
-- 3. "Read up to" can be the newest message the page showed (never later than now, never
--    going back), so a message that wasn't shown is never counted as read.
-- 4. Changing an ended conversation is refused in each side's own words.
-- 5. A message removed by its author after its conversation was reported: the team keeps a
--    copy of its words with the report (only the team can read it, through the report), so
--    reporting a scam can't be undone by deleting the evidence. Nobody else sees it.
--
-- Not destructive: one new table (empty), one new trigger rule, functions replaced, and
-- conversations that should already have ended marked ended (none expected). To undo: a
-- later migration restores 0025's functions and drops the table.
-- =============================================================================

set search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- 1. NO TEAM INHERITS THE LAST ONE'S CONVERSATIONS
-- -----------------------------------------------------------------------------
-- Already inherited (before 0025): ended now, and kept as a function the checks can run.
create function end_inherited_conversations() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  n int;
begin
  update conversation c set ended_at = now(), ended_reason = 'business_left'
  where c.ended_at is null and (
    -- an owner left after it started, leaving the business with no owner at that moment
    exists (select 1 from vendor_member gone
            where gone.vendor_id = c.vendor_id and gone.role = 'owner' and gone.ended_at > c.created_at
              and not exists (select 1 from vendor_member o
                              where o.vendor_id = c.vendor_id and o.role = 'owner' and o.id <> gone.id
                                and o.created_at <= gone.ended_at and (o.ended_at is null or o.ended_at > gone.ended_at)))
    -- or it was started while the business had no owner
    or not exists (select 1 from vendor_member o
                   where o.vendor_id = c.vendor_id and o.role = 'owner'
                     and o.created_at <= c.created_at and (o.ended_at is null or o.ended_at > c.created_at))
    -- or the business stopped being claimed after it started
    or exists (select 1 from status_change sc
               where sc.subject_type = 'vendor' and sc.subject_id = c.vendor_id and sc.field = 'claim_status'
                 and sc.from_status = 'claimed' and sc.created_at > c.created_at));
  get diagnostics n = row_count;
  return n;
end $$;
select end_inherited_conversations();

-- A new team forms (an owner joins a business that has no other): nothing still current
-- passes to it.
create function end_conversations_when_team_forms() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.role = 'owner' and new.ended_at is null
     and not exists (select 1 from vendor_member o where o.vendor_id = new.vendor_id and o.role = 'owner'
                     and o.ended_at is null and o.id <> new.id) then
    update conversation set ended_at = now(), ended_reason = 'business_left'
    where vendor_id = new.vendor_id and ended_at is null;
  end if;
  return null;
end $$;
create trigger vendor_member_new_team after insert on vendor_member
  for each row execute function end_conversations_when_team_forms();

-- -----------------------------------------------------------------------------
-- 2. EMAILS ABOUT NEW MESSAGES (0025's, with the changes above)
-- -----------------------------------------------------------------------------
create or replace function new_message_notices(p_message uuid)
returns table (notification_id uuid, user_id uuid, email text, name text, for_business boolean)
language plpgsql security definer set search_path = public, extensions as $$
declare
  m record;
  v_site_today int;
begin
  select msg.id, msg.author_user_id, msg.author_side, msg.created_at, c.id as conversation_id, c.consumer_user_id, c.vendor_id,
         c.ended_at
  into m from message msg join conversation c on c.id = msg.conversation_id where msg.id = p_message;
  if not found or m.author_user_id is distinct from acting_user() then
    raise exception 'only the author can do this' using errcode = 'LP101';
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
              and n.created_at >= coalesce((select r.last_read_at from conversation_read r
                                           where r.conversation_id = m.conversation_id and r.user_id = w.uid), '-infinity'))
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

-- -----------------------------------------------------------------------------
-- 3. "READ UP TO": the newest message the page showed
-- -----------------------------------------------------------------------------
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
  -- The time given (the newest message shown), or now; never later than now, never back.
  new.last_read_at := least(coalesce(new.last_read_at, clock_timestamp()), clock_timestamp());
  if tg_op = 'UPDATE' then
    new.last_read_at := greatest(old.last_read_at, new.last_read_at);
  end if;
  return new;
end $$;
-- Not given means now (the rule above), so the column's own default (the step's start) goes.
alter table conversation_read alter column last_read_at drop default;
grant insert (last_read_at) on conversation_read to app_server;

-- -----------------------------------------------------------------------------
-- 4. CHANGING AN ENDED CONVERSATION: each side's own words (0025's rules otherwise)
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

  if tg_op = 'UPDATE' and old.ended_at is not null then     -- in each side's own words
    raise exception 'this conversation has ended'
      using errcode = case when v_side = 'person' then 'LP140' else 'LP146' end;
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

-- -----------------------------------------------------------------------------
-- 5. A REPORTED CONVERSATION'S REMOVED MESSAGES: a copy for the team
-- -----------------------------------------------------------------------------
create table reported_message_text (
  message_id  uuid primary key references message(id),
  body        text not null,
  kept_at     timestamptz not null default now()
);
comment on table reported_message_text is
  'The words of a message its author removed after its conversation was reported. Read only by the team, through reported_conversation_for_team().';
alter table reported_message_text enable row level security;
alter table reported_message_text force row level security;
-- Deliberately no policy and no grant: only the functions below touch it.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on reported_message_text from %I', r);
    end if;
  end loop;
end $$;

create function keep_reported_message_text() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if old.removed_at is null and new.removed_at is not null
     and exists (select 1 from moderation_report r where r.conversation_id = old.conversation_id) then
    insert into reported_message_text (message_id, body) values (old.id, old.body) on conflict do nothing;
  end if;
  return new;
end $$;
-- Before message_rules (triggers run in name order), which blanks the words.
create trigger message_keep_reported before update of removed_at on message
  for each row execute function keep_reported_message_text();

-- 0024's, now showing a removed message's kept words to the team.
create or replace function reported_conversation_for_team(p_report uuid)
returns table (message_id uuid, author_side text, author_name text, body text, created_at timestamptz,
               removed boolean, hidden boolean, reported boolean)
language plpgsql security definer set search_path = public, extensions as $$
declare
  r record;
begin
  if not acting_as_team() then
    raise exception 'only the Localites team can do this' using errcode = 'LP101';
  end if;
  select mr.id, mr.conversation_id, mr.message_id into r from moderation_report mr where mr.id = p_report;
  if not found then
    raise exception 'no such report' using errcode = 'LP101';
  end if;
  insert into audit_log (actor_user_id, action, subject_type, subject_id, changes)
  values (acting_user(), 'conversation.report_view', 'moderation_report', p_report,
          jsonb_build_object('conversation', jsonb_build_object('from', null, 'to', r.conversation_id)));
  return query
  select m.id, m.author_side, u.display_name, coalesce(k.body, m.body), m.created_at, m.removed_at is not null,
         m.hidden_by_team_at is not null, m.id = r.message_id
  from message m join app_user u on u.id = m.author_user_id
  left join reported_message_text k on k.message_id = m.id
  where m.conversation_id = r.conversation_id
  order by m.created_at, m.id;
end $$;

revoke all on function end_inherited_conversations(), end_conversations_when_team_forms(), keep_reported_message_text() from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function end_inherited_conversations(), end_conversations_when_team_forms(), '
                     'keep_reported_message_text() from %I', r);
    end if;
  end loop;
end $$;
