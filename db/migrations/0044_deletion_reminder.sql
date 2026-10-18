-- =============================================================================
-- Localites — migration 0044: a reminder for the hand-done step of account deletion
-- =============================================================================
-- The product owner, 18 October 2026 ("add all of them"): when someone deletes their account,
-- the team still removes their Supabase sign-in record by hand within 30 days (E §8). The team's
-- daily note now says how many are waiting and when the oldest is due, so it isn't forgotten.
--   deletions_to_finish(): how many, and the oldest request's time. Counts only, no names or
--   emails; for the morning run, which acts as nobody (the table itself stays team-only).
--
-- Not destructive: one read-only function.
-- =============================================================================

set search_path = public, extensions;

create function deletions_to_finish() returns table (waiting int, oldest timestamptz)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select count(*)::int, min(requested_at) from account_deletion where auth_removed_at is null
$$;

revoke all on function deletions_to_finish() from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function deletions_to_finish() from %I', r);
    end if;
  end loop;
end $$;
grant execute on function deletions_to_finish() to app_server;
