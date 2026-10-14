-- =============================================================================
-- Checks for migration 0020: the team sees every booking; a business taken down can't be newly booked (D-46).
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

create function pg_temp.expect_code(label text, stmt text, code text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate <> code then
      raise exception 'FAIL  %: rejected with % (%), want %', label, sqlstate, sqlerrm, code;
    end if;
    raise notice 'PASS  %  (refused: %)', label, code;
    return;
  end;
  raise exception 'FAIL  %: was accepted, want %', label, code;
end $$;

create function pg_temp.act(p_side text, p_user uuid, p_vendor uuid default null) returns void
language plpgsql as $$
begin
  perform set_config('localites.side', coalesce(p_side, ''), true),
          set_config('localites.user_id', coalesce(p_user::text, ''), true),
          set_config('localites.vendor_id', coalesce(p_vendor::text, ''), true);
end $$;

create function pg_temp.today() returns date
language sql stable as $$ select (now() at time zone 'America/Toronto')::date $$;

-- Host H plans four events with business T (to be taken down): next month (booked), last
-- week (booked), cancelled (booked), and one where T is only considered. Host K (later
-- deleted) booked T too. Business L stays listed and is booked next month. A is the team;
-- O owns T.
insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000020a1', 'Host H', 'host-h-20@example.com'),
  ('00000000-0000-7000-8000-0000000020a2', 'Host K', 'host-k-20@example.com'),
  ('00000000-0000-7000-8000-0000000020a3', 'Admin A', 'admin-a-20@example.com'),
  ('00000000-0000-7000-8000-0000000020a4', 'Owner O', 'owner-o-20@example.com');
insert into platform_role (user_id, role) values ('00000000-0000-7000-8000-0000000020a3', 'admin');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000020b1', 'test-town-20', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000020c1', 'test-twenty-t', 'Twenty T', '00000000-0000-7000-8000-0000000020b1',
   'admin_entered', 'published', 'claimed', now()),
  ('00000000-0000-7000-8000-0000000020c2', 'test-twenty-l', 'Twenty L', '00000000-0000-7000-8000-0000000020b1',
   'admin_entered', 'published', 'unclaimed', now());
insert into vendor_member (vendor_id, user_id, role) values
  ('00000000-0000-7000-8000-0000000020c1', '00000000-0000-7000-8000-0000000020a4', 'owner');
insert into event (id, host_user_id, event_date, municipality_id, guest_count_estimate) values
  ('00000000-0000-7000-8000-0000000020f1', '00000000-0000-7000-8000-0000000020a1', pg_temp.today() + 30, '00000000-0000-7000-8000-0000000020b1', 40),
  ('00000000-0000-7000-8000-0000000020f2', '00000000-0000-7000-8000-0000000020a1', pg_temp.today() - 7, '00000000-0000-7000-8000-0000000020b1', null),
  ('00000000-0000-7000-8000-0000000020f3', '00000000-0000-7000-8000-0000000020a1', pg_temp.today() + 40, '00000000-0000-7000-8000-0000000020b1', null),
  ('00000000-0000-7000-8000-0000000020f4', '00000000-0000-7000-8000-0000000020a1', pg_temp.today() + 50, '00000000-0000-7000-8000-0000000020b1', null),
  ('00000000-0000-7000-8000-0000000020f5', '00000000-0000-7000-8000-0000000020a2', pg_temp.today() + 20, '00000000-0000-7000-8000-0000000020b1', null);
insert into event_private (event_id, host_user_id, title) values
  ('00000000-0000-7000-8000-0000000020f1', '00000000-0000-7000-8000-0000000020a1', 'Next month'),
  ('00000000-0000-7000-8000-0000000020f2', '00000000-0000-7000-8000-0000000020a1', 'Last week'),
  ('00000000-0000-7000-8000-0000000020f3', '00000000-0000-7000-8000-0000000020a1', 'Called off'),
  ('00000000-0000-7000-8000-0000000020f4', '00000000-0000-7000-8000-0000000020a1', 'Still deciding'),
  ('00000000-0000-7000-8000-0000000020f5', '00000000-0000-7000-8000-0000000020a2', 'K''s party');
insert into event_vendor (id, event_id, host_user_id, vendor_id, status, booked_at) values
  ('00000000-0000-7000-8000-000000002061', '00000000-0000-7000-8000-0000000020f1', '00000000-0000-7000-8000-0000000020a1',
   '00000000-0000-7000-8000-0000000020c1', 'booked', now()),
  ('00000000-0000-7000-8000-000000002062', '00000000-0000-7000-8000-0000000020f2', '00000000-0000-7000-8000-0000000020a1',
   '00000000-0000-7000-8000-0000000020c1', 'booked', now() - interval '20 days'),
  ('00000000-0000-7000-8000-000000002063', '00000000-0000-7000-8000-0000000020f3', '00000000-0000-7000-8000-0000000020a1',
   '00000000-0000-7000-8000-0000000020c1', 'booked', now()),
  ('00000000-0000-7000-8000-000000002064', '00000000-0000-7000-8000-0000000020f4', '00000000-0000-7000-8000-0000000020a1',
   '00000000-0000-7000-8000-0000000020c1', 'considering', null),
  ('00000000-0000-7000-8000-000000002065', '00000000-0000-7000-8000-0000000020f5', '00000000-0000-7000-8000-0000000020a2',
   '00000000-0000-7000-8000-0000000020c1', 'booked', now()),
  ('00000000-0000-7000-8000-000000002066', '00000000-0000-7000-8000-0000000020f1', '00000000-0000-7000-8000-0000000020a1',
   '00000000-0000-7000-8000-0000000020c2', 'booked', now());
update event set status = 'cancelled', cancelled_at = now() where id = '00000000-0000-7000-8000-0000000020f3';

-- The team sees every booking, listed or not: coming up first (soonest first), then the rest.
set local role app_server;
select pg_temp.act('team', '00000000-0000-7000-8000-0000000020a3');
select pg_temp.expect_equal('the team sees every booking: coming up soonest first, then past and cancelled', (
  select string_agg(right(row_id::text, 2) || ':' || upcoming::text || ':' || cancelled::text, ',' order by n)
  from bookings_for_team() with ordinality as b(row_id, vendor_id, business, listing_status, person, person_email,
       event_date, town, guests, booked_at, cancelled, upcoming, n)),
  '65:true:false,66:true:false,61:true:false,63:false:true,62:false:false');
select pg_temp.expect_equal('…with who, the business and what it needs to get in touch', (
  select concat_ws('|', person, person_email, (event_date = pg_temp.today() + 30)::text, town, guests::text, business, listing_status)
  from bookings_for_team() where row_id = '00000000-0000-7000-8000-000000002061'),
  'Host H|host-h-20@example.com|true|Test Town|40|Twenty T|published');
select pg_temp.expect_equal('never what a person is only considering', (
  select count(*)::text from bookings_for_team() where row_id = '00000000-0000-7000-8000-000000002064'), '0');
select pg_temp.expect_equal('one business only', (
  select string_agg(right(row_id::text, 2), ',') from bookings_for_team('00000000-0000-7000-8000-0000000020c2')), '66');
select pg_temp.expect_equal('while every business is listed, none needs a check-in', taken_down_booking_count()::text, '0');
select pg_temp.expect_equal('a listed business''s count: its bookings still to come (not past, cancelled or considered)',
  taken_down_booking_count('00000000-0000-7000-8000-0000000020c1')::text, '2');

-- The team takes T down: nothing is lost from the team's view.
reset role;
update vendor set listing_status = 'unpublished' where id = '00000000-0000-7000-8000-0000000020c1';
set local role app_server;
select pg_temp.act('team', '00000000-0000-7000-8000-0000000020a3');
select pg_temp.expect_equal('taken down, its bookings are all still there for the team', (
  select count(*)::text || ' ' || min(listing_status) from bookings_for_team('00000000-0000-7000-8000-0000000020c1')), '4 unpublished');
select pg_temp.expect_equal('its bookings still to come are counted for a check-in', taken_down_booking_count()::text, '2');
select pg_temp.expect_equal('the team still can''t read the plans themselves',
  (select count(*)::text from event_vendor where vendor_id = '00000000-0000-7000-8000-0000000020c1'), '0');

-- A deleted account drops out.
reset role;
update app_user set deleted_at = now() where id = '00000000-0000-7000-8000-0000000020a2';
set local role app_server;
select pg_temp.act('team', '00000000-0000-7000-8000-0000000020a3');
select pg_temp.expect_equal('a deleted account''s booking isn''t shown or counted', (
  select count(*)::text || '/' || taken_down_booking_count()::text from bookings_for_team('00000000-0000-7000-8000-0000000020c1')), '3/1');

-- Nobody else may ask.
select pg_temp.act('person', '00000000-0000-7000-8000-0000000020a1');
select pg_temp.expect_code('a person can''t see the team''s list', 'select * from bookings_for_team()', 'LP101');
select pg_temp.expect_code('…or its count', 'select taken_down_booking_count()', 'LP101');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000020a4', '00000000-0000-7000-8000-0000000020c1');
select pg_temp.expect_code('the business itself can''t see it', $q$select * from bookings_for_team('00000000-0000-7000-8000-0000000020c1')$q$, 'LP101');
select pg_temp.expect_code('…or count it', $q$select taken_down_booking_count('00000000-0000-7000-8000-0000000020c1')$q$, 'LP101');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000020a1');
select pg_temp.expect_code('saying "team" without being on it doesn''t work', 'select * from bookings_for_team()', 'LP101');

-- The person: can't newly mark the taken-down business booked; can still un-mark or remove it.
select pg_temp.act('person', '00000000-0000-7000-8000-0000000020a1');
select pg_temp.expect_code('a business that isn''t listed can''t be marked booked', $q$
  update event_vendor set status = 'booked' where id = '00000000-0000-7000-8000-000000002064'$q$, 'LP107');
update event_vendor set status = 'considering' where id = '00000000-0000-7000-8000-000000002061';
select pg_temp.expect_equal('…but one already booked can be un-marked', (
  select status from event_vendor where id = '00000000-0000-7000-8000-000000002061'), 'considering');
select pg_temp.expect_code('…and not marked booked again while it isn''t listed', $q$
  update event_vendor set status = 'booked' where id = '00000000-0000-7000-8000-000000002061'$q$, 'LP107');
update event_vendor set status = 'removed' where id = '00000000-0000-7000-8000-000000002064';
select pg_temp.expect_equal('…and removed', (
  select status from event_vendor where id = '00000000-0000-7000-8000-000000002064'), 'removed');
update event_vendor set status = 'considering' where id = '00000000-0000-7000-8000-000000002066';
update event_vendor set status = 'booked' where id = '00000000-0000-7000-8000-000000002066';
select pg_temp.expect_equal('a listed business can still be marked booked', (
  select status from event_vendor where id = '00000000-0000-7000-8000-000000002066'), 'booked');

-- Put back up: it can be booked again.
reset role;
update vendor set listing_status = 'published' where id = '00000000-0000-7000-8000-0000000020c1';
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000020a1');
update event_vendor set status = 'booked' where id = '00000000-0000-7000-8000-000000002061';
select pg_temp.expect_equal('once it''s listed again, it can be marked booked again', (
  select status from event_vendor where id = '00000000-0000-7000-8000-000000002061'), 'booked');

reset role;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;
set local role anon;
do $$
begin
  perform bookings_for_team();
  raise exception 'FAIL  the browser-facing role can run bookings_for_team';
exception when insufficient_privilege then
  raise notice 'PASS  the browser-facing role can''t run the team''s functions';
end $$;

rollback;
