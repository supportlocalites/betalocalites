-- =============================================================================
-- Localites — migration 0046: fixes from the scenario tests, round 1 (D-54)
-- =============================================================================
-- The product owner approved these on 19 October 2026 after 27 pretend people were run
-- through the site:
--   B2  a message taken back before its email went isn't emailed about (new_message_notices);
--   B5  a business's "this wasn't booked" note stays on a booking that's un-marked and marked
--       again, until the team decides (before, re-marking quietly cleared it);
--   B4  a waiting review withdrawn because its booking was un-marked comes back when the booking
--       is marked again, exactly as written and locked (the owner: "bring the review back - do
--       not let them alter it"); review.locked;
--   M6  a declined review's words are erased 30 days after the team declined it
--       (erase_declined_review_words(), run each morning).
--
-- Not destructive except M6, which erases what it says, 30 days after a decision.
-- =============================================================================

set search_path = public, extensions;

-- B2 --------------------------------------------------------------------------------------
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


-- B5 --------------------------------------------------------------------------------------
-- Runs after event_vendor_rules (which sets booked_at when a booking is marked): a note the team
-- hasn't settled as "booking stands" moves forward with the new booking, so every rule that
-- compares it to booked_at (LP153: no review) still sees it. Not logged as a new flag (below).
create function event_vendor_keep_flag() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
begin
  if new.status = 'booked' and old.status is distinct from 'booked'
     and old.vendor_flagged_at is not null and old.flag_outcome is distinct from 'booking_stands'
     and new.booked_at is not null then
    new.vendor_flagged_at := greatest(old.vendor_flagged_at, new.booked_at);
  end if;
  return new;
end $$;
create trigger event_vendor_zz_keep_flag before update on event_vendor
  for each row execute function event_vendor_keep_flag();

-- As 0012, except that carrying a note forward isn't recorded as the business flagging again.
create or replace function record_plan_change() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
declare
  v_kind text := case acting_side() when 'person' then 'consumer' when 'business' then 'vendor'
                                    when 'team' then 'admin' else 'system' end;
  v_who  uuid := acting_user();
begin
  if tg_table_name = 'event' then
    if new.status <> old.status then
      insert into status_change (subject_type, subject_id, field, from_status, to_status, actor_user_id, actor_kind)
      values ('event', new.id, 'status', old.status, new.status, v_who, v_kind);
    end if;
  elsif tg_op = 'INSERT' then
    insert into status_change (subject_type, subject_id, field, from_status, to_status, actor_user_id, actor_kind)
    values ('event_vendor', new.id, 'status', null, new.status, v_who, v_kind);
  else
    if new.status <> old.status then
      insert into status_change (subject_type, subject_id, field, from_status, to_status, actor_user_id, actor_kind)
      values ('event_vendor', new.id, 'status', old.status, new.status, v_who, v_kind);
    end if;
    -- A note carried forward by event_vendor_keep_flag (0046) isn't a new flag.
    if new.vendor_flagged_at is not null and new.vendor_flagged_at is distinct from old.vendor_flagged_at
       and not (old.vendor_flagged_at is not null and new.vendor_flagged_by is not distinct from old.vendor_flagged_by
                and new.status = 'booked' and old.status is distinct from 'booked') then
      insert into status_change (subject_type, subject_id, field, from_status, to_status, actor_user_id, actor_kind)
      values ('event_vendor', new.id, 'vendor_flag', null, 'flagged', v_who, v_kind);
    end if;
    if new.flag_outcome is distinct from old.flag_outcome then
      insert into status_change (subject_type, subject_id, field, from_status, to_status, actor_user_id, actor_kind)
      values ('event_vendor', new.id, 'flag_outcome', old.flag_outcome, coalesce(new.flag_outcome, 'cleared'), v_who, v_kind);
    end if;
  end if;
  return null;
end $$;

-- B4 --------------------------------------------------------------------------------------
alter table review add column locked boolean not null default false;
comment on column review.locked is
  'Came back when its booking was marked again (0046): kept exactly as written; the author can''t change it.';

create function restore_withdrawn_review() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  -- Not while the business's note counts: a new review would be refused then too (LP153).
  if old.status is distinct from 'booked' and new.status = 'booked'
     and not (new.vendor_flagged_at is not null and new.vendor_flagged_at >= new.booked_at
              and new.flag_outcome is distinct from 'booking_stands') then
    update review set status = 'pending', locked = true
    where event_vendor_id = new.id and status = 'withdrawn' and decided_at is null;
  end if;
  return null;
end $$;
create trigger event_vendor_restore_review after update of status on event_vendor
  for each row execute function restore_withdrawn_review();

create function review_locked_rules() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
begin
  if current_user = 'app_server' and old.locked
     and (new.body is distinct from old.body or new.rating is distinct from old.rating) then
    raise exception 'this review came back as you wrote it and can''t be changed' using errcode = 'LP184';
  end if;
  if new.locked is distinct from old.locked and current_user = 'app_server' then
    raise exception 'that can''t be changed' using errcode = 'LP100';
  end if;
  return new;
end $$;
create trigger review_locked_rules before update on review
  for each row execute function review_locked_rules();

-- M6 --------------------------------------------------------------------------------------
-- As 0036, plus the owner path the other rules have: the database's own jobs (the erase below)
-- may clear the language check's finding. The site (app_server) is held to the same rules.
create or replace function review_language_rules() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
declare
  v_side text := acting_side();
begin
  if tg_op = 'INSERT' then
    new.reply_held_reason := null; new.reply_held_at := null;
    return new;
  end if;
  if current_user <> 'app_server' then return new; end if;        -- owner path
  -- The check's finding on a review: the author's words, so only with them, while it waits.
  if new.language_flag is distinct from old.language_flag
     and (v_side is distinct from 'person' or old.status <> 'pending' or old.author_user_id is distinct from acting_user()) then
    raise exception 'that can''t be changed' using errcode = 'LP100';
  end if;
  if (new.reply_held_reason, new.reply_held_at) is distinct from (old.reply_held_reason, old.reply_held_at) then
    if v_side = 'business' and old.vendor_reply is null and new.vendor_reply is not null and old.reply_held_at is null then
      -- Held as the reply is written: the database sets when.
      new.reply_held_at := case when new.reply_held_reason is null then null else now() end;
    elsif acting_as_team() and old.reply_held_at is not null and new.reply_held_reason is null then
      -- The team puts it live.
      new.reply_held_at := null;
    else
      raise exception 'that can''t be changed' using errcode = 'LP100';
    end if;
  end if;
  return new;
end $$;

create function erase_declined_review_words() returns int
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  n int;
begin
  -- The words, and what the language check found in them.
  update review set body = 'Erased 30 days after the team declined it.', language_flag = null
  where status = 'declined' and decided_at < now() - interval '30 days'
    and (body <> 'Erased 30 days after the team declined it.' or language_flag is not null);
  get diagnostics n = row_count;
  return n;
exception when others then
  -- -1, logged by the morning run, as 0041's deletions: it doesn't stop the rest.
  return -1;
end $$;
revoke all on function erase_declined_review_words(), restore_withdrawn_review() from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function erase_declined_review_words() from %I', r);
    end if;
  end loop;
end $$;
grant execute on function erase_declined_review_words() to app_server;

-- C12 -------------------------------------------------------------------------------------
-- The initial of the last name is its first whole character as a person sees it: a flag (two
-- regional-indicator letters), or a letter or emoji with its modifiers and joined parts, not
-- half of one. Otherwise as 0031.
create or replace function reviewer_name(p_user uuid) returns text
language sql stable security definer set search_path = public, extensions as $$
  select case
           when u.deleted_at is not null then 'A Localites member'
           else coalesce(nullif(btrim(u.given_name), ''), split_part(btrim(u.display_name), ' ', 1))
                || coalesce(' ' || upper(substring(nullif(btrim(u.family_name), '')
                     from '^([\U0001F1E6-\U0001F1FF]{2}|.(?:[️\U0001F3FB-\U0001F3FF]|‍.)*)')) || '.', '')
         end
  from app_user u where u.id = p_user
$$;

-- Which of a listed business's published reviews carry the Living Local badge, for its own
-- reviews page (the badge shows on its public page anyway, as published_reviews). The list of reviewers stays in the database.
create function living_local_reviews(p_vendor uuid) returns setof uuid
language sql stable security definer set search_path = public, extensions as $$
  select r.id from review r join vendor v on v.id = r.vendor_id
  where r.vendor_id = p_vendor and r.status = 'published' and v.listing_status = 'published'
    and r.author_user_id in (select user_id from living_local_reviewers())
$$;
revoke all on function living_local_reviews(uuid) from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function living_local_reviews(uuid) from %I', r);
    end if;
  end loop;
end $$;
grant execute on function living_local_reviews(uuid) to app_server;
