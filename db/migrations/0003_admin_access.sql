-- =============================================================================
-- Localites — migration 0003: admin access (D-28)
-- =============================================================================
-- 1. The app may remove LINK rows (which categories, towns served, filters, photos
--    and collection entries a listing has), so the admin page can untick them. It
--    still can't delete a listing, a service, a person, a claim or any history:
--    those end with a status or timestamp, and every change is in audit_log.
-- 2. grant_first_admin(email): the one-time way to make the first Localites admin,
--    run by the product owner in Supabase's SQL editor. It refuses once any admin
--    exists (from then on, admins are added from the admin page), and only the
--    database owner can run it: not the app, and not Supabase's browser-facing roles.
-- Not destructive: adds a permission and a function.
-- =============================================================================

set search_path = public, extensions;

grant delete on vendor_category, vendor_service_area, vendor_attribute_value,
                vendor_media, vendor_link, collection_item, attribute_definition_category
  to app_server;

create function grant_first_admin(p_email text) returns text
language plpgsql
set search_path = public, extensions
as $$
declare
  uid   uuid;
  uname text;
begin
  if exists (select 1 from platform_role where role = 'admin' and revoked_at is null) then
    raise exception 'Localites already has an admin. Ask them to add you from the admin page.';
  end if;

  select id into uid from app_user where email = p_email::citext and deleted_at is null;
  if uid is null then
    -- Not signed in to Localites yet: take the account from Supabase's sign-in records.
    if to_regclass('auth.users') is null then
      raise exception 'No Localites account uses %.', p_email;
    end if;
    execute $q$select id, coalesce(nullif(raw_user_meta_data->>'display_name', ''), split_part(email, '@', 1))
               from auth.users where lower(email) = lower($1) and deleted_at is null$q$
      into uid, uname using p_email;
    if uid is null then
      raise exception 'No account uses %. Create it first: Supabase, Authentication, Users, Add user.', p_email;
    end if;
    insert into app_user (id, display_name, email) values (uid, uname, p_email);
  end if;

  insert into platform_role (user_id, role) values (uid, 'admin');
  insert into audit_log (actor_user_id, action, subject_type, subject_id, reason)
  values (null, 'platform_role.grant', 'app_user', uid, 'First admin, granted in the database console');
  return format('Done: %s is now a Localites admin.', p_email);
end $$;

revoke all on function grant_first_admin(text) from public;
do $$
declare r text;
begin
  -- Supabase grants new functions to these roles by default; take that back.
  foreach r in array array['app_server', 'anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function grant_first_admin(text) from %I', r);
    end if;
  end loop;
end $$;
