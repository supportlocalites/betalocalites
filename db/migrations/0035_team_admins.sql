-- =============================================================================
-- Localites — migration 0035: the team adds and removes admins (X10, Users & roles)
-- =============================================================================
-- Until now another admin was added by hand in the database console (runbook). From now on
-- an admin does it on the team's Users & roles page, and only through two functions:
--   grant_team_admin(email, reason)   an existing Localites account becomes an admin;
--   revoke_team_admin(user, reason)   an admin stops being one.
-- Both run only as the team (acting_as_team(), ADR-031), write audit_log in the same
-- transaction, and take one lock so two admins can't remove each other at the same moment.
-- Nobody removes themselves (another admin does), so the team is never left with nobody.
-- The app can no longer write platform_role directly. grant_first_admin (0003) is unchanged.
-- Also indexes for the team's Audit log page (X11): newest first, and one record's history.
--
-- Not destructive: takes back two rights from the app, adds two functions and two indexes.
-- =============================================================================

set search_path = public, extensions;

create index audit_log_newest on audit_log (created_at desc, id desc);
create index audit_log_record on audit_log (subject_id, created_at desc, id desc) where subject_id is not null;

revoke insert, update, delete on platform_role from app_server;

create function grant_team_admin(p_email text, p_reason text) returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_user uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform pg_advisory_xact_lock(hashtextextended('localites.platform-role', 0));
  if not acting_as_team() then
    raise exception 'only the Localites team can add admins' using errcode = 'LP101';
  end if;
  if char_length(v_reason) not between 1 and 300 then
    raise exception 'say why, in up to 300 characters' using errcode = 'LP166';
  end if;
  select id into v_user from app_user
  where email = btrim(coalesce(p_email, ''))::citext and deleted_at is null;
  if v_user is null then
    raise exception 'no Localites account uses that email: they sign in once first' using errcode = 'LP167';
  end if;
  if exists (select 1 from platform_role where user_id = v_user and role = 'admin' and revoked_at is null) then
    raise exception 'that person is already on the team' using errcode = 'LP168';
  end if;
  insert into platform_role (user_id, role, granted_by) values (v_user, 'admin', acting_user());
  insert into audit_log (actor_user_id, action, subject_type, subject_id, reason)
  values (acting_user(), 'platform_role.grant', 'app_user', v_user, v_reason);
  return v_user;
end $$;

create function revoke_team_admin(p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  -- After the lock, so an admin removed a moment ago by someone else can't remove anyone.
  perform pg_advisory_xact_lock(hashtextextended('localites.platform-role', 0));
  if not acting_as_team() then
    raise exception 'only the Localites team can remove admins' using errcode = 'LP101';
  end if;
  if p_user = acting_user() then
    raise exception 'you can''t remove yourself: ask another admin' using errcode = 'LP169';
  end if;
  if char_length(v_reason) not between 1 and 300 then
    raise exception 'say why, in up to 300 characters' using errcode = 'LP166';
  end if;
  update platform_role set revoked_at = now()
  where user_id = p_user and role = 'admin' and revoked_at is null;
  if not found then
    raise exception 'that person isn''t on the team' using errcode = 'LP170';
  end if;
  insert into audit_log (actor_user_id, action, subject_type, subject_id, reason)
  values (acting_user(), 'platform_role.revoke', 'app_user', p_user, v_reason);
end $$;

revoke all on function grant_team_admin(text, text), revoke_team_admin(uuid, text) from public;
do $$
declare r text;
begin
  -- Supabase grants new functions to these roles by default; take that back (as 0003).
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function grant_team_admin(text, text), revoke_team_admin(uuid, text) from %I', r);
    end if;
  end loop;
end $$;
grant execute on function grant_team_admin(text, text), revoke_team_admin(uuid, text) to app_server;
