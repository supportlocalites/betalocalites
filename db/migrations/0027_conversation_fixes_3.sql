-- =============================================================================
-- Localites — migration 0027: messages, after a third review (Stage 2B)
-- =============================================================================
-- Fixes to migration 0026, found in review:
--
-- 1. Emails about new messages, "once per unread stretch": since 0026 "read up to" is the
--    newest message shown, so an email sent after that message looked newer than the read,
--    and someone who read without replying was never emailed again. A stretch now starts
--    at the first message from the other side they haven't read: they're emailed if no
--    email about the conversation has gone to them since then.
-- 2. The words of a removed message are kept for the team only if the message was already
--    there when the conversation was reported (the evidence the report is about), not for
--    anything written after a report.
--
-- Not destructive: two functions replaced. To undo: a later migration restores 0026's.
-- =============================================================================

set search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- 1. EMAILS ABOUT NEW MESSAGES (0026's, with the unread stretch above)
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

-- -----------------------------------------------------------------------------
-- 2. A REPORTED CONVERSATION'S REMOVED MESSAGES: only those there when it was reported
-- -----------------------------------------------------------------------------
create or replace function keep_reported_message_text() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if old.removed_at is null and new.removed_at is not null
     and exists (select 1 from moderation_report r
                 where r.conversation_id = old.conversation_id and r.created_at >= old.created_at) then
    insert into reported_message_text (message_id, body) values (old.id, old.body) on conflict do nothing;
  end if;
  return new;
end $$;
