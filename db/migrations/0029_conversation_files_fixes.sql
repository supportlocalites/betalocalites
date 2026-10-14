-- =============================================================================
-- Localites — migration 0029: files in conversations, after review (Stage 2B)
-- =============================================================================
-- "20 files a day per person" counted only the files a person could see from the side they
-- were acting as, so someone on several business teams could send more. This counts every
-- file they sent, whichever side.
--
-- Not destructive: one function added. To undo: a later migration drops it.
-- =============================================================================

set search_path = public, extensions;

create function files_sent_today(p_user uuid) returns int
language sql stable security definer set search_path = public, extensions as $$
  select count(*)::int from conversation_file
  where uploaded_by = p_user and p_user = acting_user() and created_at > now() - interval '1 day'
$$;

revoke all on function files_sent_today(uuid) from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function files_sent_today(uuid) from %I', r);
    end if;
  end loop;
end $$;
grant execute on function files_sent_today(uuid) to app_server;
