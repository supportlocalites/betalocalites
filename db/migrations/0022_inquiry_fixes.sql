-- =============================================================================
-- Localites — migration 0022: Inquire, made honest about its emails (ADR-024; review fixes)
-- =============================================================================
-- An independent review of 0021 (14 October 2026) found:
--   1. take_joined_notices() marked people as told before any email was sent, so a failed or
--      interrupted email still showed "told it joined" and was never retried or recorded.
--      Now each person's email is recorded as a queued notification in the same step (the
--      team page shows its real outcome), and team members of the business are left out.
--   2. An inquiry whose team email was interrupted stayed "pending" forever, and the person
--      could never send it again. Now "pending" for over 10 minutes counts as failed for
--      sending again, and the nightly run records it as failed (close_stale_inquiry_emails).
--   3. After a failed email, "send again" worked even once the business had joined.
--   4. The database allowed any change of the email's status. Now only pending → sent,
--      pending → failed, and failed (or stale pending) → pending, which is sending again.
--   5. Nothing capped inquiry emails across the whole site (Resend's free plan: 100 a day for
--      everything, sign-in codes included): inquiry_emails_today() lets the site stop at 40.
--   6. A business that stops being claimed (its owner leaves) keeps its "told it joined"
--      marks: now cleared, so people are told again if it joins again.
--
-- Not destructive: two functions are replaced (one with a new result, so dropped and made
-- again with the same rights); three functions and one trigger are added; no table or row
-- changes. To undo: a later migration puts back the 0021 versions.
-- =============================================================================

set search_path = public, extensions;

-- 1 and 3–4: the rules for an inquiry, stricter about the email's status.
create or replace function enforce_vendor_interest_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
declare
  v_stale boolean;
begin
  if tg_op = 'UPDATE' and (new.id <> old.id or new.vendor_id <> old.vendor_id or new.user_id <> old.user_id
                           or new.created_at <> old.created_at) then
    raise exception 'an inquiry can''t be moved to another business or person' using errcode = 'LP100';
  end if;
  if current_user <> 'app_server' then return new; end if;        -- owner path (functions)

  if acting_side() is distinct from 'person' or new.user_id is distinct from acting_user() then
    raise exception 'only the person asking can send this' using errcode = 'LP101';
  end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from vendor where id = new.vendor_id and listing_status = 'published') then
      raise exception 'that business isn''t listed on Localites' using errcode = 'LP107';
    end if;
    if exists (select 1 from vendor where id = new.vendor_id and claim_status = 'claimed') then
      raise exception 'that business is on Localites: contact it directly' using errcode = 'LP130';
    end if;
    if exists (select 1 from vendor_member m where m.vendor_id = new.vendor_id
               and m.user_id = new.user_id and m.ended_at is null) then
      raise exception 'that''s your own business' using errcode = 'LP108';
    end if;
    new.created_at := now();
    new.team_email_status := 'pending'; new.team_email_sent_at := null; new.team_email_error := null;
    new.notified_joined_at := null;
  else
    if new.notified_joined_at is distinct from old.notified_joined_at then
      raise exception 'that can''t be changed' using errcode = 'LP100';
    end if;
    v_stale := old.team_email_status = 'pending' and old.updated_at < now() - interval '10 minutes';
    if old.team_email_status = 'pending' and new.team_email_status in ('sent', 'failed') then
      -- The email's outcome: nothing else changes with it.
      if new.note is distinct from old.note or new.shared_event is distinct from old.shared_event then
        raise exception 'you''ve already told us about this business' using errcode = 'LP131';
      end if;
    elsif new.team_email_status = 'pending' and (old.team_email_status = 'failed' or v_stale) then
      -- Sending again, only while the business hasn't joined (it may change the note and event).
      if exists (select 1 from vendor where id = new.vendor_id and claim_status = 'claimed') then
        raise exception 'that business is on Localites: contact it directly' using errcode = 'LP130';
      end if;
    else
      raise exception 'you''ve already told us about this business' using errcode = 'LP131';
    end if;
    new.team_email_sent_at := case when new.team_email_status = 'sent' then now() end;
    if new.team_email_status <> 'failed' then new.team_email_error := null; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- 1: telling people the business joined, with each email recorded before it's sent.
drop function take_joined_notices(uuid);
create function take_joined_notices(p_vendor uuid)
returns table (notification_id uuid, interest_id uuid, user_id uuid, email text, name text)
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not acting_as_team() then
    raise exception 'only the Localites team can do this' using errcode = 'LP101';
  end if;
  if not exists (select 1 from vendor where id = p_vendor and claim_status = 'claimed') then
    return;
  end if;
  return query
  with told as (
    update vendor_interest vi set notified_joined_at = now()
    from app_user u
    where vi.vendor_id = p_vendor and vi.notified_joined_at is null and u.id = vi.user_id and u.deleted_at is null
      and not exists (select 1 from vendor_member m where m.vendor_id = p_vendor and m.user_id = vi.user_id and m.ended_at is null)
    returning vi.id, vi.user_id
  ),
  queued as (
    insert into notification (user_id, kind, subject_type, subject_id)
    select t.user_id, 'vendor_joined', 'vendor_interest', t.id from told t
    returning notification.id as nid, notification.subject_id as iid
  )
  select q.nid, t.id, t.user_id, u.email::text, u.display_name
  from queued q join told t on t.id = q.iid join app_user u on u.id = t.user_id;
end $$;

-- 5: inquiry emails to the team in the last day, across the whole site (a count only).
create function inquiry_emails_today() returns int
language sql stable security definer set search_path = public, extensions as $$
  select count(*)::int from vendor_interest where team_email_sent_at > now() - interval '1 day'
$$;

-- 2: inquiry emails left "pending" by an interrupted request, recorded as failed (nightly).
create function close_stale_inquiry_emails() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  n int;
begin
  update vendor_interest set team_email_status = 'failed',
         team_email_error = 'Not known whether it was sent: the sending was interrupted.', updated_at = now()
  where team_email_status = 'pending' and updated_at < now() - interval '1 hour';
  get diagnostics n = row_count;
  return n;
end $$;

-- 6: a business that stops being claimed: the people who asked will be told again if it rejoins.
create function forget_joined_marks() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  update vendor_interest set notified_joined_at = null where vendor_id = new.id and notified_joined_at is not null;
  return new;
end $$;
create trigger vendor_forget_joined_marks after update of claim_status on vendor
  for each row when (old.claim_status = 'claimed' and new.claim_status <> 'claimed')
  execute function forget_joined_marks();

-- Rights: only the app role runs them (as 0021).
revoke all on function take_joined_notices(uuid), inquiry_emails_today(), close_stale_inquiry_emails(),
  forget_joined_marks() from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function take_joined_notices(uuid), inquiry_emails_today(), '
                     'close_stale_inquiry_emails(), forget_joined_marks() from %I', r);
    end if;
  end loop;
end $$;
grant execute on function take_joined_notices(uuid), inquiry_emails_today(), close_stale_inquiry_emails() to app_server;
