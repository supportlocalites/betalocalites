-- =============================================================================
-- Checks for migration 0015: a business owner adds their own team (V4, E §3).
-- One transaction, rolled back. Obviously fake data.
-- =============================================================================

begin;

create function pg_temp.expect_equal(label text, got text, want text) returns void
language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL  %: got %, want %', label, coalesce(got, 'null'), coalesce(want, 'null');
  end if;
  raise notice 'PASS  %  (%)', label, want;
end $$;

create function pg_temp.expect_reject(label text, stmt text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'PASS  %  (refused: %)', label, sqlstate;
    return;
  end;
  raise exception 'FAIL  %: was accepted', label;
end $$;

insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000015a1', 'Owner O', 'owner-o-15@example.com'),
  ('00000000-0000-7000-8000-0000000015a2', 'Manager M', 'manager-m-15@example.com'),
  ('00000000-0000-7000-8000-0000000015a3', 'Staff S', 'staff-s-15@example.com');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000015b1', 'test-town-15', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000015c1', 'test-fifteen-v', 'Fifteen V', '00000000-0000-7000-8000-0000000015b1', 'admin_entered', 'published', 'claimed', now()),
  ('00000000-0000-7000-8000-0000000015c2', 'test-fifteen-w', 'Fifteen W', '00000000-0000-7000-8000-0000000015b1', 'admin_entered', 'published', 'claimed', now());
insert into vendor_member (id, vendor_id, user_id, role) values
  ('00000000-0000-7000-8000-000000001561', '00000000-0000-7000-8000-0000000015c1', '00000000-0000-7000-8000-0000000015a1', 'owner'),
  ('00000000-0000-7000-8000-000000001562', '00000000-0000-7000-8000-0000000015c1', '00000000-0000-7000-8000-0000000015a2', 'manager'),
  ('00000000-0000-7000-8000-000000001563', '00000000-0000-7000-8000-0000000015c1', '00000000-0000-7000-8000-0000000015a3', 'staff'),
  ('00000000-0000-7000-8000-000000001564', '00000000-0000-7000-8000-0000000015c2', '00000000-0000-7000-8000-0000000015a2', 'manager');

set local role app_server;
insert into vendor_invite (vendor_id, email, role, token_hash, invited_by) values
  ('00000000-0000-7000-8000-0000000015c1', 'New.Person-15@Example.com', 'staff', repeat('a', 64), '00000000-0000-7000-8000-0000000015a1');
select pg_temp.expect_reject('a second open invitation to the same address (any capitals) is refused',
  $q$insert into vendor_invite (vendor_id, email, role, token_hash, invited_by)
     values ('00000000-0000-7000-8000-0000000015c1', 'new.person-15@example.com', 'manager', repeat('b', 64), '00000000-0000-7000-8000-0000000015a1')$q$);
select pg_temp.expect_reject('an invitation can''t make someone an owner',
  $q$insert into vendor_invite (vendor_id, email, role, token_hash, invited_by)
     values ('00000000-0000-7000-8000-0000000015c1', 'x-15@example.com', 'owner', repeat('c', 64), '00000000-0000-7000-8000-0000000015a1')$q$);
select pg_temp.expect_reject('the app can''t change who an invitation is for',
  $q$update vendor_invite set email = 'other-15@example.com' where token_hash = repeat('a', 64)$q$);
select pg_temp.expect_reject('the app can''t delete an invitation (it is cancelled instead)',
  $q$delete from vendor_invite where token_hash = repeat('a', 64)$q$);

-- A manager leaving changes nothing else.
update vendor_member set ended_at = now() where id = '00000000-0000-7000-8000-000000001562';
select pg_temp.expect_equal('a manager leaving: the owner and staff stay', (
  select string_agg(role, ',' order by role) from vendor_member
  where vendor_id = '00000000-0000-7000-8000-0000000015c1' and ended_at is null), 'owner,staff');

-- The owner leaving ends the rest of the team and cancels open invitations.
update vendor_member set ended_at = now() where id = '00000000-0000-7000-8000-000000001561';
select pg_temp.expect_equal('the owner leaving: nobody is left on the team', (
  select count(*)::text from vendor_member where vendor_id = '00000000-0000-7000-8000-0000000015c1' and ended_at is null), '0');
select pg_temp.expect_equal('…and the open invitation is cancelled', (
  select (revoked_at is not null)::text from vendor_invite where token_hash = repeat('a', 64)), 'true');
select pg_temp.expect_equal('…while M stays manager of the other business', (
  select count(*)::text from vendor_member where id = '00000000-0000-7000-8000-000000001564' and ended_at is null), '1');

reset role;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;
set local role anon;
do $$
begin
  perform count(*) from vendor_invite;
  raise exception 'FAIL  the browser-facing role can read invitations';
exception when insufficient_privilege then
  raise notice 'PASS  the browser-facing role can''t read invitations';
end $$;

rollback;
