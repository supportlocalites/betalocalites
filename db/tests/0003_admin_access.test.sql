-- =============================================================================
-- Checks for migration 0003 (admin access). One transaction, rolled back.
-- =============================================================================

begin;

create function pg_temp.expect_reject(label text, stmt text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'PASS  %  (rejected: %)', label, sqlerrm;
    return;
  end;
  raise exception 'FAIL  %: statement was accepted but must be rejected', label;
end $$;

create function pg_temp.expect_accept(label text, stmt text) returns void
language plpgsql as $$
begin
  execute stmt;
  raise notice 'PASS  %  (accepted)', label;
end $$;

-- ---------------------------------------------------------------- fixtures ---
insert into municipality (id, slug, name, region) values
  ('00000000-0000-7000-8000-0000000003a1', 'test-town-3', 'Test Town', 'Test County');
insert into vendor (id, slug, display_name, primary_municipality_id, source) values
  ('00000000-0000-7000-8000-0000000003b1', 'test-vendor-3', 'Test Vendor 3',
   '00000000-0000-7000-8000-0000000003a1', 'admin_entered');
insert into category (id, slug, name) values
  ('00000000-0000-7000-8000-0000000003c1', 'test-category-3', 'Test Category');
insert into vendor_category (vendor_id, category_id, is_primary) values
  ('00000000-0000-7000-8000-0000000003b1', '00000000-0000-7000-8000-0000000003c1', true);
insert into vendor_service (vendor_id, name, pricing_model) values
  ('00000000-0000-7000-8000-0000000003b1', 'Test service', 'on_request');

-- ------------------------------------------- what the app role may delete ---
set local role app_server;
select pg_temp.expect_accept('app role unticks a category on a listing',
  $q$delete from vendor_category where vendor_id = '00000000-0000-7000-8000-0000000003b1'$q$);
select pg_temp.expect_reject('app role still cannot delete a listing',
  $q$delete from vendor where id = '00000000-0000-7000-8000-0000000003b1'$q$);
select pg_temp.expect_reject('app role still cannot delete a service',
  $q$delete from vendor_service where vendor_id = '00000000-0000-7000-8000-0000000003b1'$q$);
select pg_temp.expect_reject('app role still cannot delete a person',
  $q$delete from app_user$q$);
select pg_temp.expect_reject('app role still cannot delete an admin role',
  $q$delete from platform_role$q$);
select pg_temp.expect_reject('app role cannot make itself an admin with the first-admin command',
  $q$select grant_first_admin('someone@example.com')$q$);
reset role;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end $$;
set local role anon;
select pg_temp.expect_reject('browser-facing role cannot run the first-admin command',
  $q$select grant_first_admin('someone@example.com')$q$);
reset role;

-- --------------------------------------------------------- first admin ---
-- A stand-in for Supabase's sign-in records, as on the real project.
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key, email text, raw_user_meta_data jsonb, deleted_at timestamptz
);
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-7000-8000-0000000003d1', 'owner@example.com', '{"display_name": "Test Owner"}');
insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000003d2', 'Signed In Before', 'early@example.com');

select pg_temp.expect_reject('first-admin command refuses an email with no account',
  $q$select grant_first_admin('nobody@example.com')$q$);

select pg_temp.expect_accept('first admin: someone who has already signed in to Localites',
  $q$select grant_first_admin('early@example.com')$q$);
select pg_temp.expect_reject('first-admin command refuses once an admin exists',
  $q$select grant_first_admin('owner@example.com')$q$);

-- With that admin's role ended, the console path from Supabase's records works too.
update platform_role set revoked_at = now() where user_id = '00000000-0000-7000-8000-0000000003d2';
select pg_temp.expect_accept('first admin: an account made in Supabase that has not signed in yet',
  $q$select grant_first_admin('OWNER@example.com')$q$);

do $$
declare n int;
begin
  select count(*) into n from app_user where id = '00000000-0000-7000-8000-0000000003d1' and display_name = 'Test Owner';
  if n <> 1 then raise exception 'FAIL  first admin has no Localites record with their name'; end if;
  select count(*) into n from platform_role where role = 'admin' and revoked_at is null;
  if n <> 1 then raise exception 'FAIL  expected exactly one active admin, found %', n; end if;
  select count(*) into n from audit_log where action = 'platform_role.grant';
  if n <> 2 then raise exception 'FAIL  each first-admin grant must be in the audit log (found %)', n; end if;
  raise notice 'PASS  first admin recorded: Localites record, one active admin, both grants in the audit log';
end $$;

rollback;
