-- =============================================================================
-- Localites — migration 0045: fixes from the whole-site security review (18 October 2026)
-- =============================================================================
-- 1. Reports of conversations and messages: at most 10 a day per person, and not the same
--    thing twice while the first report is open (reviews' reports already had both). Before,
--    one person could send a hundred, each emailing the team, using up the day's email.
--    report_emails_today(): how many report emails went to the team in the last day, so the site
--    stops emailing after 20 (the reports still wait on the team's list; sign-in codes keep
--    their share of the 100 emails a day).
-- 2. files_bytes_sent_today(): how much a person sent in files today, so the site can cap it
--    (25 MB a day; the count alone allowed 80 MB).
-- 3. release_report_files(): a file kept because a report covered it is let go 90 days after
--    the team closed every report on that conversation, so the nightly clean-up deletes it.
--    Before, nothing ever let it go, so reported files could fill the storage for good.
-- 4. unlink_person() is no longer callable by the server directly (only delete_my_account uses
--    it, as the database owner).
--
-- Not destructive: two rules on new reports, two functions, one right taken back. Files are
-- let go only 90 days after a decision (the privacy policy draft says so).
-- =============================================================================

set search_path = public, extensions;

-- 1. Report limits --------------------------------------------------------------------------
create function moderation_report_limits() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  -- One person's reports one at a time, so two sent at once can't both slip under the limits.
  perform pg_advisory_xact_lock(hashtextextended('localites.report:' || new.reporter_user_id::text, 0));
  if (select count(*) from moderation_report r
      where r.reporter_user_id = new.reporter_user_id and r.created_at > now() - interval '1 day') >= 10 then
    raise exception 'you''ve sent the most reports allowed in a day' using errcode = 'LP182';
  end if;
  if exists (select 1 from moderation_report r
             where r.reporter_user_id = new.reporter_user_id and r.conversation_id = new.conversation_id
               and r.message_id is not distinct from new.message_id and r.status = 'open') then
    raise exception 'you''ve already reported this' using errcode = 'LP183';
  end if;
  return new;
end $$;
create trigger moderation_report_limits before insert on moderation_report
  for each row execute function moderation_report_limits();

create function report_emails_today() returns int
language sql stable security definer set search_path = public, extensions as $$
  select count(*)::int from moderation_report where team_email_status = 'sent' and created_at > now() - interval '1 day'
$$;

-- 2. Bytes of files sent today ----------------------------------------------------------------
create function files_bytes_sent_today(p_user uuid) returns bigint
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(sum(byte_size), 0)::bigint from conversation_file
  where uploaded_by = p_user and p_user = acting_user() and created_at > now() - interval '1 day'
$$;

-- 3. Letting reported files go -----------------------------------------------------------------
create function release_report_files() returns int
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  n int;
begin
  update conversation_file f set kept_for_report = false
  where f.kept_for_report
    and not exists (select 1 from moderation_report r where r.conversation_id = f.conversation_id
                    and (r.status = 'open' or r.reviewed_at > now() - interval '90 days'));
  get diagnostics n = row_count;
  return n;
end $$;

-- 4. Rights -------------------------------------------------------------------------------------
revoke execute on function unlink_person(uuid) from app_server;
revoke all on function moderation_report_limits(), report_emails_today(), files_bytes_sent_today(uuid), release_report_files() from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function report_emails_today(), files_bytes_sent_today(uuid), release_report_files() from %I', r);
    end if;
  end loop;
end $$;
grant execute on function report_emails_today(), files_bytes_sent_today(uuid), release_report_files() to app_server;
