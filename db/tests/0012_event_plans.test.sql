-- =============================================================================
-- Checks for migration 0012 (plan an event; who is acting, in the database: ADR-031).
-- One transaction, rolled back. Obviously fake data.
--
-- Cast (all fake):
--   A, B          people planning events
--   O             owner of business V (claimed, published); S is V's staff, X a manager who left
--   W             owner of business Y (published)
--   M             a Localites admin; N someone who isn't
--   U unclaimed and published · D a draft · Z archived · Q1–Q5 published (featured checks)
--   T1 an active town, T0 an inactive one · K a test event type, H a hidden one
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

-- Rejected with exactly this error code (LPnnn from the rules, 42501 no permission, ...).
create function pg_temp.expect_code(label text, stmt text, code text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate <> code then
      raise exception 'FAIL  %: rejected with % (%), want %', label, sqlstate, sqlerrm, code;
    end if;
    raise notice 'PASS  %  (rejected %: %)', label, code, sqlerrm;
    return;
  end;
  raise exception 'FAIL  %: statement was accepted but must be rejected with %', label, code;
end $$;

create function pg_temp.expect_accept(label text, stmt text) returns void
language plpgsql as $$
begin
  execute stmt;
  raise notice 'PASS  %  (accepted)', label;
end $$;

create function pg_temp.expect_rows(label text, stmt text, want int) returns void
language plpgsql as $$
declare n int;
begin
  execute stmt;
  get diagnostics n = row_count;
  if n <> want then
    raise exception 'FAIL  %: changed % rows, want %', label, n, want;
  end if;
  raise notice 'PASS  %  (% rows)', label, want;
end $$;

create function pg_temp.expect_equal(label text, got text, want text) returns void
language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL  %: got %, want %', label, coalesce(got, 'null'), coalesce(want, 'null');
  end if;
  raise notice 'PASS  %  (%)', label, want;
end $$;

-- Who is acting, as src/server/acting.server.ts tells the database.
create function pg_temp.act(p_side text, p_user uuid, p_vendor uuid default null) returns void
language plpgsql as $$
begin
  perform set_config('localites.side', coalesce(p_side, ''), true),
          set_config('localites.user_id', coalesce(p_user::text, ''), true),
          set_config('localites.vendor_id', coalesce(p_vendor::text, ''), true);
end $$;

-- Runs the "every event has a name" check now, as it would run when the transaction ends.
create function pg_temp.check_names() returns void
language plpgsql as $$
begin
  set constraints event_has_name immediate;
  set constraints event_has_name deferred;
end $$;

create function pg_temp.today() returns date
language sql stable as $$ select (now() at time zone 'America/Toronto')::date $$;

-- ---------------------------------------------------------------- fixtures ---
insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000012a1', 'Host A',  'host-a-12@example.com'),
  ('00000000-0000-7000-8000-0000000012a2', 'Host B',  'host-b-12@example.com'),
  ('00000000-0000-7000-8000-0000000012a3', 'Owner O', 'owner-o-12@example.com'),
  ('00000000-0000-7000-8000-0000000012a4', 'Staff S', 'staff-s-12@example.com'),
  ('00000000-0000-7000-8000-0000000012a5', 'Former X', 'former-x-12@example.com'),
  ('00000000-0000-7000-8000-0000000012a6', 'Owner W', 'owner-w-12@example.com'),
  ('00000000-0000-7000-8000-0000000012a7', 'Admin M', 'admin-m-12@example.com'),
  ('00000000-0000-7000-8000-0000000012a8', 'Person N', 'person-n-12@example.com');
insert into platform_role (user_id, role) values ('00000000-0000-7000-8000-0000000012a7', 'admin');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000012b1', 'test-town-12', 'Test Town', 'Test County', true),
  ('00000000-0000-7000-8000-0000000012b2', 'test-gone-12', 'Test Gone', 'Test County', false);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at, archived_at)
select v.id::uuid, v.slug, v.name, '00000000-0000-7000-8000-0000000012b1', 'admin_entered', v.status, v.claim,
       case when v.status in ('published', 'archived') then now() end, case when v.status = 'archived' then now() end
from (values
  ('00000000-0000-7000-8000-0000000012c1', 'test-twelve-v', 'Twelve V', 'published', 'claimed'),
  ('00000000-0000-7000-8000-0000000012c2', 'test-twelve-y', 'Twelve Y', 'published', 'claimed'),
  ('00000000-0000-7000-8000-0000000012c3', 'test-twelve-u', 'Twelve U', 'published', 'unclaimed'),
  ('00000000-0000-7000-8000-0000000012c4', 'test-twelve-d', 'Twelve D', 'draft', 'unclaimed'),
  ('00000000-0000-7000-8000-0000000012c5', 'test-twelve-z', 'Twelve Z', 'archived', 'unclaimed'),
  ('00000000-0000-7000-8000-0000000012c6', 'test-twelve-q1', 'Twelve Q1', 'published', 'unclaimed'),
  ('00000000-0000-7000-8000-0000000012c7', 'test-twelve-q2', 'Twelve Q2', 'published', 'unclaimed'),
  ('00000000-0000-7000-8000-0000000012c8', 'test-twelve-q3', 'Twelve Q3', 'published', 'unclaimed'),
  ('00000000-0000-7000-8000-0000000012c9', 'test-twelve-q4', 'Twelve Q4', 'published', 'unclaimed'),
  ('00000000-0000-7000-8000-0000000012ca', 'test-twelve-q5', 'Twelve Q5', 'published', 'unclaimed')
) as v(id, slug, name, status, claim);
insert into vendor_member (vendor_id, user_id, role, ended_at) values
  ('00000000-0000-7000-8000-0000000012c1', '00000000-0000-7000-8000-0000000012a3', 'owner', null),
  ('00000000-0000-7000-8000-0000000012c1', '00000000-0000-7000-8000-0000000012a4', 'staff', null),
  ('00000000-0000-7000-8000-0000000012c1', '00000000-0000-7000-8000-0000000012a5', 'manager', now() - interval '1 day'),
  ('00000000-0000-7000-8000-0000000012c2', '00000000-0000-7000-8000-0000000012a6', 'owner', null);
insert into event_type (id, key, name, is_active, sort_order) values
  ('00000000-0000-7000-8000-0000000012d1', 'test_hidden', 'Test hidden kind', false, 5000),
  ('00000000-0000-7000-8000-0000000012d2', 'test_kind',   'Test kind',        true,  5001);
insert into category (id, slug, name) values ('00000000-0000-7000-8000-0000000012e1', 'test-cat-12', 'Test Category');

set local role app_server;

-- ------------------------------------------------------- setup and seed ---
select pg_temp.expect_equal('seed: eleven event types, all shown, Children''s birthday party first', (
  select count(*) filter (where is_active)::text || ' ' || min(name) filter (where sort_order = 10)
  from event_type where key in ('kids_birthday', 'birthday', 'baby_shower', 'wedding', 'wedding_shower', 'graduation',
                                'anniversary', 'retirement', 'work_event', 'fundraiser', 'other')), '11 Children''s birthday party');
select pg_temp.expect_equal('seed: "Something else" is last', (
  select key from event_type where key not like 'test_%' order by sort_order desc limit 1), 'other');
select pg_temp.expect_equal('seed: every type suggests kinds of business, from the existing categories only', (
  select count(distinct t.key)::text || ' types, ' || count(*)::text || ' suggestions'
  from event_type_category tc join event_type t on t.id = tc.event_type_id join category c on c.id = tc.category_id
  where c.slug <> 'test-cat-12'), '11 types, 77 suggestions');
select pg_temp.expect_reject('app_server cannot create a table', $q$create table test_twelve (id int)$q$);
select pg_temp.expect_code('app_server cannot delete an event', $q$delete from event$q$, '42501');
select pg_temp.expect_code('app_server cannot delete a plan row', $q$delete from event_vendor$q$, '42501');
select pg_temp.expect_code('app_server cannot delete private details', $q$delete from event_private$q$, '42501');
select pg_temp.expect_code('app_server cannot delete an event type', $q$delete from event_type$q$, '42501');
select pg_temp.expect_code('app_server cannot delete a featured placement', $q$delete from featured_placement$q$, '42501');
select pg_temp.expect_code('app_server cannot rewrite status_change', $q$update status_change set to_status = 'x'$q$, '42501');

-- ------------------------------------------------------- nobody acting ---
select pg_temp.expect_equal('no actor: no events, private details, plan rows, saves or placements', (
  select ((select count(*) from event) + (select count(*) from event_private) + (select count(*) from event_vendor)
        + (select count(*) from saved_vendor) + (select count(*) from featured_placement))::text), '0');
select pg_temp.expect_code('no actor: creating an event is refused',
  $q$insert into event (host_user_id, event_date, municipality_id)
     values ('00000000-0000-7000-8000-0000000012a1', pg_temp.today() + 30, '00000000-0000-7000-8000-0000000012b1')$q$, 'LP101');
select pg_temp.expect_equal('no actor: event types and their suggestions are still readable (reference data)', (
  select ((select count(*) from event_type) > 0 and (select count(*) from event_type_category) > 0)::text), 'true');

-- ------------------------------------------------------------ person A ---
select pg_temp.act('person', '00000000-0000-7000-8000-0000000012a1');
select pg_temp.expect_accept('A creates an event (type, date, town)',
  $q$insert into event (id, host_user_id, event_type_id, event_date, municipality_id, guest_count_estimate)
     values ('00000000-0000-7000-8000-0000000012f1', '00000000-0000-7000-8000-0000000012a1', '00000000-0000-7000-8000-0000000012d2',
             pg_temp.today() + 30, '00000000-0000-7000-8000-0000000012b1', 15)$q$);
select pg_temp.expect_accept('A names it, privately',
  $q$insert into event_private (event_id, host_user_id, title, venue_note, age_range_min, age_range_max, budget_cents, notes)
     values ('00000000-0000-7000-8000-0000000012f1', '00000000-0000-7000-8000-0000000012a1', 'Sam''s party', 'Our backyard', 4, 7, 432100, 'Unicorns')$q$);
select pg_temp.expect_accept('a named event passes the name check when the transaction ends', $q$select pg_temp.check_names()$q$);
select pg_temp.expect_accept('A creates an event with no type (optional, D-39)',
  $q$insert into event (id, host_user_id, event_date, municipality_id)
     values ('00000000-0000-7000-8000-0000000012f2', '00000000-0000-7000-8000-0000000012a1', pg_temp.today() + 40, '00000000-0000-7000-8000-0000000012b1')$q$);
insert into event_private (event_id, host_user_id, title) values
  ('00000000-0000-7000-8000-0000000012f2', '00000000-0000-7000-8000-0000000012a1', 'Picnic');
select pg_temp.check_names();
do $$
begin
  insert into event (host_user_id, event_date, municipality_id)
  values ('00000000-0000-7000-8000-0000000012a1', pg_temp.today() + 50, '00000000-0000-7000-8000-0000000012b1');
  perform pg_temp.check_names();
  raise exception 'FAIL  an event with no name was kept';
exception when sqlstate 'LP109' then
  raise notice 'PASS  an event with no name is refused when the transaction ends  (rejected LP109: %)', sqlerrm;
end $$;
select pg_temp.expect_code('a blank name is refused', $q$update event_private set title = '   ' where event_id = '00000000-0000-7000-8000-0000000012f1'$q$, '23514');
select pg_temp.expect_code('a name of 121 characters is refused', $q$update event_private set title = repeat('x', 121) where event_id = '00000000-0000-7000-8000-0000000012f1'$q$, '23514');
select pg_temp.expect_code('a name can''t be removed', $q$update event_private set title = null where event_id = '00000000-0000-7000-8000-0000000012f1'$q$, '23502');
select pg_temp.expect_code('A cannot create an event for B',
  $q$insert into event (host_user_id, event_date, municipality_id)
     values ('00000000-0000-7000-8000-0000000012a2', pg_temp.today() + 30, '00000000-0000-7000-8000-0000000012b1')$q$, 'LP101');
select pg_temp.expect_code('a hidden kind of event is refused',
  $q$insert into event (host_user_id, event_type_id, event_date, municipality_id)
     values ('00000000-0000-7000-8000-0000000012a1', '00000000-0000-7000-8000-0000000012d1', pg_temp.today() + 30, '00000000-0000-7000-8000-0000000012b1')$q$, 'LP103');
select pg_temp.expect_code('a town Localites doesn''t cover is refused',
  $q$insert into event (host_user_id, event_date, municipality_id)
     values ('00000000-0000-7000-8000-0000000012a1', pg_temp.today() + 30, '00000000-0000-7000-8000-0000000012b2')$q$, 'LP104');
select pg_temp.expect_code('a date 61 days ago is refused',
  $q$insert into event (host_user_id, event_date, municipality_id)
     values ('00000000-0000-7000-8000-0000000012a1', pg_temp.today() - 61, '00000000-0000-7000-8000-0000000012b1')$q$, 'LP105');
select pg_temp.expect_code('a date 3 years and a day ahead is refused',
  $q$insert into event (host_user_id, event_date, municipality_id)
     values ('00000000-0000-7000-8000-0000000012a1', (pg_temp.today() + interval '3 years')::date + 1, '00000000-0000-7000-8000-0000000012b1')$q$, 'LP105');
select pg_temp.expect_accept('a date 60 days ago is accepted',
  $q$insert into event (id, host_user_id, event_date, municipality_id)
     values ('00000000-0000-7000-8000-0000000012f5', '00000000-0000-7000-8000-0000000012a1', pg_temp.today() - 60, '00000000-0000-7000-8000-0000000012b1')$q$);
insert into event_private (event_id, host_user_id, title) values
  ('00000000-0000-7000-8000-0000000012f5', '00000000-0000-7000-8000-0000000012a1', 'Earlier');
select pg_temp.check_names();
select pg_temp.expect_code('an end time without a start time is refused',
  $q$update event set end_time = '16:00' where id = '00000000-0000-7000-8000-0000000012f2'$q$, '23514');
select pg_temp.expect_code('0 guests is refused',
  $q$update event set guest_count_estimate = 0 where id = '00000000-0000-7000-8000-0000000012f2'$q$, '23514');
select pg_temp.expect_code('ages 9 to 4 are refused (private details)',
  $q$update event_private set age_range_min = 9, age_range_max = 4 where event_id = '00000000-0000-7000-8000-0000000012f2'$q$, '23514');
select pg_temp.expect_code('A cannot change who is hosting',
  $q$update event set host_user_id = '00000000-0000-7000-8000-0000000012a2' where id = '00000000-0000-7000-8000-0000000012f2'$q$, '42501');
select pg_temp.expect_code('A cannot set cancelled_at herself',
  $q$update event set cancelled_at = now() where id = '00000000-0000-7000-8000-0000000012f2'$q$, '42501');
select pg_temp.expect_code('A cannot change to a hidden kind of event',
  $q$update event set event_type_id = '00000000-0000-7000-8000-0000000012d1' where id = '00000000-0000-7000-8000-0000000012f5'$q$, 'LP103');
select pg_temp.expect_rows('A chooses a kind of event later',
  $q$update event set event_type_id = '00000000-0000-7000-8000-0000000012d2' where id = '00000000-0000-7000-8000-0000000012f5'$q$, 1);
select pg_temp.expect_rows('…and clears it again',
  $q$update event set event_type_id = null where id = '00000000-0000-7000-8000-0000000012f5'$q$, 1);

-- Plans.
select pg_temp.expect_accept('A adds V as considering',
  $q$insert into event_vendor (id, event_id, host_user_id, vendor_id)
     values ('00000000-0000-7000-8000-000000001261', '00000000-0000-7000-8000-0000000012f1', '00000000-0000-7000-8000-0000000012a1', '00000000-0000-7000-8000-0000000012c1')$q$);
select pg_temp.expect_equal('status_change: nothing → considering, by A, as a consumer', (
  select coalesce(from_status, '-') || '>' || to_status || ' ' || actor_kind || ' ' || (actor_user_id = '00000000-0000-7000-8000-0000000012a1')
  from status_change where subject_type = 'event_vendor' and subject_id = '00000000-0000-7000-8000-000000001261'), '->considering consumer true');
select pg_temp.expect_code('A cannot add a business as booked straight away',
  $q$insert into event_vendor (event_id, host_user_id, vendor_id, status)
     values ('00000000-0000-7000-8000-0000000012f2', '00000000-0000-7000-8000-0000000012a1', '00000000-0000-7000-8000-0000000012c1', 'booked')$q$, '42501');
select pg_temp.expect_code('A adds the same business twice: refused',
  $q$insert into event_vendor (event_id, host_user_id, vendor_id)
     values ('00000000-0000-7000-8000-0000000012f1', '00000000-0000-7000-8000-0000000012a1', '00000000-0000-7000-8000-0000000012c1')$q$, '23505');
select pg_temp.expect_code('A adds a draft business: refused',
  $q$insert into event_vendor (event_id, host_user_id, vendor_id)
     values ('00000000-0000-7000-8000-0000000012f1', '00000000-0000-7000-8000-0000000012a1', '00000000-0000-7000-8000-0000000012c4')$q$, 'LP107');
select pg_temp.expect_code('A adds an archived business: refused',
  $q$insert into event_vendor (event_id, host_user_id, vendor_id)
     values ('00000000-0000-7000-8000-0000000012f1', '00000000-0000-7000-8000-0000000012a1', '00000000-0000-7000-8000-0000000012c5')$q$, 'LP107');
select pg_temp.expect_accept('A adds an unclaimed business (allowed: she may have phoned them)',
  $q$insert into event_vendor (id, event_id, host_user_id, vendor_id)
     values ('00000000-0000-7000-8000-000000001262', '00000000-0000-7000-8000-0000000012f1', '00000000-0000-7000-8000-0000000012a1', '00000000-0000-7000-8000-0000000012c3')$q$);
update event_vendor set status = 'booked' where id = '00000000-0000-7000-8000-000000001261';
select pg_temp.expect_equal('considering → booked: the database sets booked_at', (
  select status || ' ' || (booked_at = now()) from event_vendor where id = '00000000-0000-7000-8000-000000001261'), 'booked true');
select pg_temp.expect_code('A cannot send booked_at',
  $q$update event_vendor set booked_at = now() - interval '1 year' where id = '00000000-0000-7000-8000-000000001261'$q$, '42501');
update event_vendor set status = 'considering' where id = '00000000-0000-7000-8000-000000001261';
select pg_temp.expect_equal('booked → considering clears booked_at', (
  select status || ' ' || coalesce(booked_at::text, 'none') from event_vendor where id = '00000000-0000-7000-8000-000000001261'), 'considering none');
update event_vendor set status = 'removed' where id = '00000000-0000-7000-8000-000000001261';
select pg_temp.expect_equal('considering → removed sets removed_at', (
  select status || ' ' || (removed_at = now()) from event_vendor where id = '00000000-0000-7000-8000-000000001261'), 'removed true');
select pg_temp.expect_code('removed → booked is refused',
  $q$update event_vendor set status = 'booked' where id = '00000000-0000-7000-8000-000000001261'$q$, 'LP109');
select pg_temp.expect_accept('removed → considering puts the same row back',
  $q$insert into event_vendor (id, event_id, host_user_id, vendor_id)
     values ('00000000-0000-7000-8000-0000000012ff', '00000000-0000-7000-8000-0000000012f1', '00000000-0000-7000-8000-0000000012a1', '00000000-0000-7000-8000-0000000012c1')
     on conflict (event_id, vendor_id) do update set status = 'considering' where event_vendor.status = 'removed'$q$);
select pg_temp.expect_equal('…one row, same id, no removed_at', (
  select count(*)::text || ' ' || min(id::text) || ' ' || coalesce(min(removed_at)::text, 'none') from event_vendor
  where event_id = '00000000-0000-7000-8000-0000000012f1' and vendor_id = '00000000-0000-7000-8000-0000000012c1'),
  '1 00000000-0000-7000-8000-000000001261 none');
-- (One transaction: every row has the same time, so they're listed alphabetically.)
select pg_temp.expect_equal('each change wrote exactly one status_change row: add, book, un-book, remove, put back', (
  select count(*)::text || ': ' || string_agg(coalesce(from_status, '-') || '>' || to_status, ' '
                                              order by coalesce(from_status, '-'), to_status)
  from status_change where subject_type = 'event_vendor' and subject_id = '00000000-0000-7000-8000-000000001261'),
  '5: ->considering booked>considering considering>booked considering>removed removed>considering');
select pg_temp.expect_code('A cannot say a booking isn''t right (only the business can, through flag_booking)',
  $q$update event_vendor set vendor_flagged_at = now() where id = '00000000-0000-7000-8000-000000001261'$q$, '42501');
select pg_temp.expect_code('A cannot flag through the function either (she isn''t acting for a business)',
  $q$select * from flag_booking('00000000-0000-7000-8000-000000001261', 'x')$q$, 'LP101');
select pg_temp.expect_code('A cannot decide on a flag',
  $q$update event_vendor set flag_outcome = 'booking_stands' where id = '00000000-0000-7000-8000-000000001261'$q$, '42501');
select pg_temp.expect_code('A cannot move a plan row to another event',
  $q$update event_vendor set event_id = '00000000-0000-7000-8000-0000000012f2' where id = '00000000-0000-7000-8000-000000001261'$q$, '42501');

-- Saves.
select pg_temp.expect_accept('A saves V', $q$insert into saved_vendor (user_id, vendor_id) values ('00000000-0000-7000-8000-0000000012a1', '00000000-0000-7000-8000-0000000012c1')$q$);
select pg_temp.expect_rows('A un-saves V', $q$delete from saved_vendor where user_id = '00000000-0000-7000-8000-0000000012a1' and vendor_id = '00000000-0000-7000-8000-0000000012c1'$q$, 1);
select pg_temp.expect_accept('A saves U', $q$insert into saved_vendor (user_id, vendor_id) values ('00000000-0000-7000-8000-0000000012a1', '00000000-0000-7000-8000-0000000012c3')$q$);
select pg_temp.expect_code('A saves a draft business: refused',
  $q$insert into saved_vendor (user_id, vendor_id) values ('00000000-0000-7000-8000-0000000012a1', '00000000-0000-7000-8000-0000000012c4')$q$, 'LP107');

-- ------------------------------------------------ person B (cross-account) ---
select pg_temp.act('person', '00000000-0000-7000-8000-0000000012a2');
select pg_temp.expect_equal('B reads none of A''s events, private details, plan rows or saves', (
  select ((select count(*) from event) + (select count(*) from event_private) + (select count(*) from event_vendor)
        + (select count(*) from saved_vendor))::text), '0');
select pg_temp.expect_rows('B''s change to A''s event changes nothing',
  $q$update event set guest_count_estimate = 99 where id = '00000000-0000-7000-8000-0000000012f1'$q$, 0);
select pg_temp.expect_rows('B''s change to A''s private details changes nothing',
  $q$update event_private set notes = 'x' where event_id = '00000000-0000-7000-8000-0000000012f1'$q$, 0);
select pg_temp.expect_rows('B''s change to A''s plan row changes nothing',
  $q$update event_vendor set status = 'removed' where id = '00000000-0000-7000-8000-000000001261'$q$, 0);
select pg_temp.expect_code('B adds a business to A''s event, as host B',
  $q$insert into event_vendor (event_id, host_user_id, vendor_id)
     values ('00000000-0000-7000-8000-0000000012f1', '00000000-0000-7000-8000-0000000012a2', '00000000-0000-7000-8000-0000000012c2')$q$, 'LP101');
select pg_temp.expect_code('B adds a business to A''s event, as host A',
  $q$insert into event_vendor (event_id, host_user_id, vendor_id)
     values ('00000000-0000-7000-8000-0000000012f1', '00000000-0000-7000-8000-0000000012a1', '00000000-0000-7000-8000-0000000012c2')$q$, 'LP101');
select pg_temp.expect_code('B adds private details to A''s event: it looks missing, not cancelled',
  $q$insert into event_private (event_id, host_user_id, title)
     values ('00000000-0000-7000-8000-0000000012f1', '00000000-0000-7000-8000-0000000012a2', 'Mine now')$q$, 'LP101');
select pg_temp.expect_code('B saves as A',
  $q$insert into saved_vendor (user_id, vendor_id) values ('00000000-0000-7000-8000-0000000012a1', '00000000-0000-7000-8000-0000000012c2')$q$, 'LP101');
select pg_temp.expect_rows('B deletes A''s save: nothing happens',
  $q$delete from saved_vendor where user_id = '00000000-0000-7000-8000-0000000012a1'$q$, 0);
insert into event (id, host_user_id, event_date, municipality_id) values
  ('00000000-0000-7000-8000-0000000012f4', '00000000-0000-7000-8000-0000000012a2', pg_temp.today() + 10, '00000000-0000-7000-8000-0000000012b1');
insert into event_private (event_id, host_user_id, title) values
  ('00000000-0000-7000-8000-0000000012f4', '00000000-0000-7000-8000-0000000012a2', 'B''s do');
select pg_temp.check_names();
insert into saved_vendor (user_id, vendor_id) values ('00000000-0000-7000-8000-0000000012a2', '00000000-0000-7000-8000-0000000012c1');
select pg_temp.expect_equal('B sees only B''s own event and save', (
  select (select count(*) from event)::text || '/' || (select count(*) from saved_vendor)::text), '1/1');

-- ------------------------------------------------------------- self-booking ---
select pg_temp.act('person', '00000000-0000-7000-8000-0000000012a3');
insert into event (id, host_user_id, event_date, municipality_id) values
  ('00000000-0000-7000-8000-0000000012f3', '00000000-0000-7000-8000-0000000012a3', pg_temp.today() + 20, '00000000-0000-7000-8000-0000000012b1');
insert into event_private (event_id, host_user_id, title) values
  ('00000000-0000-7000-8000-0000000012f3', '00000000-0000-7000-8000-0000000012a3', 'O''s own party');
select pg_temp.check_names();
select pg_temp.expect_code('O puts his own business on his own event: refused',
  $q$insert into event_vendor (event_id, host_user_id, vendor_id)
     values ('00000000-0000-7000-8000-0000000012f3', '00000000-0000-7000-8000-0000000012a3', '00000000-0000-7000-8000-0000000012c1')$q$, 'LP108');
reset role;
insert into event_vendor (id, event_id, host_user_id, vendor_id) values
  ('00000000-0000-7000-8000-000000001264', '00000000-0000-7000-8000-0000000012f3', '00000000-0000-7000-8000-0000000012a3', '00000000-0000-7000-8000-0000000012c1');
set local role app_server;
select pg_temp.expect_code('O marks his own business booked (row put there by support): refused',
  $q$update event_vendor set status = 'booked' where id = '00000000-0000-7000-8000-000000001264'$q$, 'LP108');

-- ------------------------------------------- business side (R5, E §12) ---
-- A business has no rules on event or event_vendor at all: it sees its bookings only
-- through bookings_for_business() (D-40's summary) and flags only through flag_booking().
select pg_temp.act('business', '00000000-0000-7000-8000-0000000012a3', '00000000-0000-7000-8000-0000000012c1');
select pg_temp.expect_equal('O for V, while A is only considering V: nothing', (
  select ((select count(*) from bookings_for_business()) + (select count(*) from event_vendor) + (select count(*) from event))::text), '0');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000012a1');
update event_vendor set status = 'booked' where id = '00000000-0000-7000-8000-000000001261';
insert into event_vendor (id, event_id, host_user_id, vendor_id) values
  ('00000000-0000-7000-8000-000000001263', '00000000-0000-7000-8000-0000000012f1', '00000000-0000-7000-8000-0000000012a1', '00000000-0000-7000-8000-0000000012c2');
update event_vendor set status = 'booked' where id = '00000000-0000-7000-8000-000000001263';
select pg_temp.act('business', '00000000-0000-7000-8000-0000000012a3', '00000000-0000-7000-8000-0000000012c1');
select pg_temp.expect_equal('after A marks V booked, O sees exactly that booking: her name, the date''s offset, the town, the guests', (
  select string_agg(row_id::text || ' ' || person || ' ' || (event_date - pg_temp.today())::text || ' ' || town || ' ' || guests::text
                    || ' ' || cancelled::text || ' ' || coalesce(flagged_at::text, 'unflagged'), ',')
  from bookings_for_business()),
  (select '00000000-0000-7000-8000-000000001261 ' || display_name || ' 30 Test Town 15 false unflagged'
   from app_user where id = '00000000-0000-7000-8000-0000000012a1'));
select pg_temp.expect_equal('…and the function has exactly these columns: no time, type or name of the event', (
  select array_to_string(proargnames, ',') from pg_proc where proname = 'bookings_for_business'),
  'row_id,person,event_date,town,guests,cancelled,booked_at,flagged_at');
select pg_temp.expect_equal('…the business reads none of the tables directly (no time, type or private detail)', (
  select ((select count(*) from event_vendor) + (select count(*) from event) + (select count(*) from event_private)
        + (select count(*) from event_vendor_flag_note))::text), '0');
select pg_temp.expect_equal('O cannot see another business''s booking on the same event (Y, also booked)', (
  select count(*)::text from bookings_for_business() where row_id = '00000000-0000-7000-8000-000000001263'), '0');
select pg_temp.expect_rows('O cannot change the status (no rule lets the business write)',
  $q$update event_vendor set status = 'removed' where id = '00000000-0000-7000-8000-000000001261'$q$, 0);
select pg_temp.expect_reject('O cannot add a plan row',
  $q$insert into event_vendor (event_id, host_user_id, vendor_id)
     values ('00000000-0000-7000-8000-0000000012f1', '00000000-0000-7000-8000-0000000012a1', '00000000-0000-7000-8000-0000000012c3')$q$);
select pg_temp.expect_code('O cannot flag Y''s booking on the same event',
  $q$select * from flag_booking('00000000-0000-7000-8000-000000001263', null)$q$, 'LP101');
select pg_temp.expect_equal('O says the booking isn''t right, with a note: the function returns the event and who to tell', (
  select (event_id = '00000000-0000-7000-8000-0000000012f1')::text || ' ' || (host_user_id = '00000000-0000-7000-8000-0000000012a1')::text
  from flag_booking('00000000-0000-7000-8000-000000001261', '  We never spoke to them  ')), 'true true');
reset role;
select pg_temp.expect_equal('…the database stored now(), who flagged it, and the note (trimmed) in the team-only table', (
  select (ev.vendor_flagged_at = now())::text || ' ' || (ev.vendor_flagged_by = '00000000-0000-7000-8000-0000000012a3')::text || ' ' || n.note
  from event_vendor ev join event_vendor_flag_note n on n.event_vendor_id = ev.id
  where ev.id = '00000000-0000-7000-8000-000000001261'), 'true true We never spoke to them');
set local role app_server;
select pg_temp.act('business', '00000000-0000-7000-8000-0000000012a3', '00000000-0000-7000-8000-0000000012c1');
select pg_temp.expect_code('a second flag for the same marking is refused',
  $q$select * from flag_booking('00000000-0000-7000-8000-000000001261', 'Changed my mind')$q$, 'LP110');
select pg_temp.expect_equal('O sees the flag on his booking, and still not the note', (
  select (flagged_at is not null)::text || ' ' || (select count(*) from event_vendor_flag_note)::text
  from bookings_for_business() where row_id = '00000000-0000-7000-8000-000000001261'), 'true 0');
select pg_temp.expect_equal('status_change records the flag: by O, as the business', (
  select to_status || ' ' || actor_kind || ' ' || (actor_user_id = '00000000-0000-7000-8000-0000000012a3')
  from status_change where subject_id = '00000000-0000-7000-8000-000000001261' and field = 'vendor_flag'), 'flagged vendor true');
select pg_temp.expect_code('O cannot decide on the flag',
  $q$update event_vendor set flag_outcome = 'booking_not_real' where id = '00000000-0000-7000-8000-000000001261'$q$, '42501');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000012a6', '00000000-0000-7000-8000-0000000012c1');
select pg_temp.expect_equal('W acting for V (not on its team): nothing', (
  select count(*)::text from bookings_for_business()), '0');
select pg_temp.expect_code('W cannot flag V''s booking',
  $q$select * from flag_booking('00000000-0000-7000-8000-000000001261', null)$q$, 'LP101');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000012a6', '00000000-0000-7000-8000-0000000012c2');
select pg_temp.expect_equal('W acting for Y sees Y''s own booking only', (
  select string_agg(row_id::text, ',') from bookings_for_business()), '00000000-0000-7000-8000-000000001263');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000012a3', '00000000-0000-7000-8000-0000000012c2');
select pg_temp.expect_equal('O acting for Y (not his business): nothing', (
  select count(*)::text from bookings_for_business()), '0');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000012a5', '00000000-0000-7000-8000-0000000012c1');
select pg_temp.expect_equal('X, a manager who left V: nothing', (
  select count(*)::text from bookings_for_business()), '0');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000012a4', '00000000-0000-7000-8000-0000000012c1');
select pg_temp.expect_equal('S, V''s staff: nothing (owners and managers only)', (
  select count(*)::text from bookings_for_business()), '0');
reset role;
update vendor set listing_status = 'archived', archived_at = now() where id = '00000000-0000-7000-8000-0000000012c1';
set local role app_server;
select pg_temp.act('business', '00000000-0000-7000-8000-0000000012a3', '00000000-0000-7000-8000-0000000012c1');
select pg_temp.expect_equal('O, once V is archived: nothing', (
  select count(*)::text from bookings_for_business()), '0');
reset role;
update vendor set listing_status = 'published', archived_at = null where id = '00000000-0000-7000-8000-0000000012c1';
set local role app_server;
select pg_temp.act('business', '00000000-0000-7000-8000-0000000012a1', '00000000-0000-7000-8000-0000000012c1');
select pg_temp.expect_equal('A acting as if for V (not on its team): nothing anywhere', (
  select ((select count(*) from bookings_for_business()) + (select count(*) from event_vendor) + (select count(*) from event)
        + (select count(*) from event_private) + (select count(*) from saved_vendor))::text), '0');

-- D-41: the person sees that the business said it isn't booked, never the note.
select pg_temp.act('person', '00000000-0000-7000-8000-0000000012a1');
select pg_temp.expect_equal('A sees that V flagged her booking, and no note', (
  select (vendor_flagged_at >= booked_at)::text || ' ' || (select count(*) from event_vendor_flag_note)::text
  from event_vendor where id = '00000000-0000-7000-8000-000000001261'), 'true 0');

-- ---------------------------------------------------------------- team ---
select pg_temp.act('team', '00000000-0000-7000-8000-0000000012a8');
select pg_temp.expect_equal('N (not an admin) on the team side: nothing', (
  select ((select count(*) from event_vendor) + (select count(*) from event) + (select count(*) from featured_placement))::text), '0');
select pg_temp.expect_code('N cannot add an event type',
  $q$insert into event_type (key, name) values ('test_n', 'Test N')$q$, '42501');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000012a7');
select pg_temp.expect_equal('M sees only flagged plan rows and their events', (
  select (select string_agg(id::text, ',') from event_vendor) || ' ' || (select string_agg(id::text, ',') from event)),
  '00000000-0000-7000-8000-000000001261 00000000-0000-7000-8000-0000000012f1');
select pg_temp.expect_equal('M reads no private details, no considering rows and no saves', (
  select ((select count(*) from event_private) + (select count(*) from event_vendor where status = 'considering')
        + (select count(*) from saved_vendor))::text), '0');
select pg_temp.expect_accept('M adds an event type',
  $q$insert into event_type (id, key, name, sort_order) values ('00000000-0000-7000-8000-0000000012d3', 'test_new', 'Test new', 5002)$q$);
select pg_temp.expect_rows('M renames, reorders and hides it',
  $q$update event_type set name = 'Test newer', sort_order = 5003, is_active = false where id = '00000000-0000-7000-8000-0000000012d3'$q$, 1);
select pg_temp.expect_code('M cannot change a type''s key',
  $q$update event_type set key = 'test_other' where id = '00000000-0000-7000-8000-0000000012d3'$q$, '42501');
select pg_temp.expect_code('two types can''t share a name (any capitals)',
  $q$insert into event_type (key, name) values ('test_wedding', 'WEDDING')$q$, '23505');
select pg_temp.expect_rows('M cannot change a plan row',
  $q$update event_vendor set status = 'removed' where id = '00000000-0000-7000-8000-000000001261'$q$, 0);
select pg_temp.act('person', '00000000-0000-7000-8000-0000000012a1');
select pg_temp.expect_code('someone on the person side cannot add an event type',
  $q$insert into event_type (key, name) values ('test_a', 'Test A')$q$, '42501');

-- ------------------------------------------- ideas per type (D-43) ---
select pg_temp.expect_code('A cannot change which businesses are suggested',
  $q$insert into event_type_category (event_type_id, category_id) values ('00000000-0000-7000-8000-0000000012d2', '00000000-0000-7000-8000-0000000012e1')$q$, '42501');
select pg_temp.expect_rows('A cannot remove a suggestion',
  $q$delete from event_type_category where event_type_id in (select id from event_type where key = 'kids_birthday')$q$, 0);
select pg_temp.expect_code('A cannot feature a business',
  $q$insert into featured_placement (vendor_id, event_type_id, starts_on, ends_on, created_by)
     values ('00000000-0000-7000-8000-0000000012c1', '00000000-0000-7000-8000-0000000012d2', pg_temp.today(), pg_temp.today() + 30,
             '00000000-0000-7000-8000-0000000012a1')$q$, '42501');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000012a8');
select pg_temp.expect_code('N (not an admin) cannot feature a business',
  $q$insert into featured_placement (vendor_id, event_type_id, starts_on, ends_on, created_by)
     values ('00000000-0000-7000-8000-0000000012c1', '00000000-0000-7000-8000-0000000012d2', pg_temp.today(), pg_temp.today() + 30,
             '00000000-0000-7000-8000-0000000012a8')$q$, '42501');
select pg_temp.expect_code('N cannot change suggestions',
  $q$insert into event_type_category (event_type_id, category_id) values ('00000000-0000-7000-8000-0000000012d2', '00000000-0000-7000-8000-0000000012e1')$q$, '42501');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000012a7');
select pg_temp.expect_accept('M suggests a kind of business for a type',
  $q$insert into event_type_category (event_type_id, category_id, sort_order) values ('00000000-0000-7000-8000-0000000012d2', '00000000-0000-7000-8000-0000000012e1', 10)$q$);
select pg_temp.expect_rows('M reorders it',
  $q$update event_type_category set sort_order = 20 where event_type_id = '00000000-0000-7000-8000-0000000012d2'$q$, 1);
select pg_temp.expect_rows('M removes it',
  $q$delete from event_type_category where event_type_id = '00000000-0000-7000-8000-0000000012d2'$q$, 1);
select pg_temp.expect_accept('M features V for a type, with a team note',
  $q$insert into featured_placement (id, vendor_id, event_type_id, starts_on, ends_on, note, created_by)
     values ('00000000-0000-7000-8000-000000001271', '00000000-0000-7000-8000-0000000012c1', '00000000-0000-7000-8000-0000000012d2',
             pg_temp.today() - 1, pg_temp.today() + 30, 'Team note: spring', '00000000-0000-7000-8000-0000000012a7')$q$);
select pg_temp.expect_accept('M features Y (starting today) and U',
  $q$insert into featured_placement (id, vendor_id, event_type_id, starts_on, ends_on, created_by) values
     ('00000000-0000-7000-8000-000000001272', '00000000-0000-7000-8000-0000000012c2', '00000000-0000-7000-8000-0000000012d2',
      pg_temp.today(), pg_temp.today() + 30, '00000000-0000-7000-8000-0000000012a7'),
     ('00000000-0000-7000-8000-000000001273', '00000000-0000-7000-8000-0000000012c3', '00000000-0000-7000-8000-0000000012d2',
      pg_temp.today() - 2, pg_temp.today() + 30, '00000000-0000-7000-8000-0000000012a7')$q$);
select pg_temp.expect_accept('M features Q1 from tomorrow (upcoming) and Q3 (unpublished below)',
  $q$insert into featured_placement (id, vendor_id, event_type_id, starts_on, ends_on, created_by) values
     ('00000000-0000-7000-8000-000000001274', '00000000-0000-7000-8000-0000000012c6', '00000000-0000-7000-8000-0000000012d2',
      pg_temp.today() + 1, pg_temp.today() + 30, '00000000-0000-7000-8000-0000000012a7'),
     ('00000000-0000-7000-8000-000000001276', '00000000-0000-7000-8000-0000000012c8', '00000000-0000-7000-8000-0000000012d2',
      pg_temp.today() - 5, pg_temp.today() + 30, '00000000-0000-7000-8000-0000000012a7')$q$);
select pg_temp.expect_code('a placement in someone else''s name is refused',
  $q$insert into featured_placement (vendor_id, event_type_id, starts_on, ends_on, created_by)
     values ('00000000-0000-7000-8000-0000000012c9', '00000000-0000-7000-8000-0000000012d2', pg_temp.today(), pg_temp.today() + 30,
             '00000000-0000-7000-8000-0000000012a8')$q$, 'LP101');
select pg_temp.expect_code('featuring a draft business is refused',
  $q$insert into featured_placement (vendor_id, event_type_id, starts_on, ends_on, created_by)
     values ('00000000-0000-7000-8000-0000000012c4', '00000000-0000-7000-8000-0000000012d2', pg_temp.today(), pg_temp.today() + 30,
             '00000000-0000-7000-8000-0000000012a7')$q$, 'LP107');
select pg_temp.expect_code('a placement that would already be over is refused',
  $q$insert into featured_placement (vendor_id, event_type_id, starts_on, ends_on, created_by)
     values ('00000000-0000-7000-8000-0000000012c9', '00000000-0000-7000-8000-0000000012d2', pg_temp.today() - 10, pg_temp.today() - 1,
             '00000000-0000-7000-8000-0000000012a7')$q$, 'LP105');
select pg_temp.expect_code('a placement that ends before it starts is refused',
  $q$insert into featured_placement (vendor_id, event_type_id, starts_on, ends_on, created_by)
     values ('00000000-0000-7000-8000-0000000012c9', '00000000-0000-7000-8000-0000000012d2', pg_temp.today() + 5, pg_temp.today() + 4,
             '00000000-0000-7000-8000-0000000012a7')$q$, '23514');
select pg_temp.expect_code('a placement''s dates can''t be changed afterwards',
  $q$update featured_placement set ends_on = pg_temp.today() + 300 where id = '00000000-0000-7000-8000-000000001271'$q$, '42501');
select pg_temp.expect_rows('M ends U''s placement early, sending a made-up time',
  $q$update featured_placement set ended_at = '2000-01-01' where id = '00000000-0000-7000-8000-000000001273'$q$, 1);
select pg_temp.expect_equal('…the database stored now() and who ended it', (
  select (ended_at = now())::text || ' ' || (ended_by = '00000000-0000-7000-8000-0000000012a7')::text
  from featured_placement where id = '00000000-0000-7000-8000-000000001273'), 'true true');
select pg_temp.expect_code('an ended placement can''t be ended again',
  $q$update featured_placement set ended_at = '2001-01-01' where id = '00000000-0000-7000-8000-000000001273'$q$, 'LP109');
select pg_temp.expect_code('…or brought back',
  $q$update featured_placement set ended_at = null where id = '00000000-0000-7000-8000-000000001273'$q$, 'LP109');
select pg_temp.expect_equal('M reads every placement, with its team note', (
  select count(*)::text || ' ' || max(note) from featured_placement), '5 Team note: spring');
reset role;
-- Owner path (support work): an expired placement, two more current ones, and Q3 unpublished.
insert into featured_placement (id, vendor_id, event_type_id, starts_on, ends_on, created_by) values
  ('00000000-0000-7000-8000-000000001275', '00000000-0000-7000-8000-0000000012c7', '00000000-0000-7000-8000-0000000012d2',
   pg_temp.today() - 30, pg_temp.today() - 1, '00000000-0000-7000-8000-0000000012a7'),
  ('00000000-0000-7000-8000-000000001277', '00000000-0000-7000-8000-0000000012c9', '00000000-0000-7000-8000-0000000012d2',
   pg_temp.today() - 3, pg_temp.today() + 30, '00000000-0000-7000-8000-0000000012a7'),
  ('00000000-0000-7000-8000-000000001278', '00000000-0000-7000-8000-0000000012ca', '00000000-0000-7000-8000-0000000012d2',
   pg_temp.today() - 2, pg_temp.today() + 30, '00000000-0000-7000-8000-0000000012a7');
update vendor set listing_status = 'unpublished' where id = '00000000-0000-7000-8000-0000000012c8';
do $$ begin
  perform pg_temp.expect_equal('no money columns on the featured or suggestion tables (D-16, D-24)', (
    select count(*)::text from pg_attribute
    where attrelid in ('featured_placement'::regclass, 'event_type_category'::regclass) and attnum > 0 and not attisdropped
      and attname ~ '(price|amount|fee|cents|paid|pay|cost|currency|money|invoice|charge)'), '0');
  perform pg_temp.expect_equal('people get only the business from featured_for_type, never the note or who added it', (
    select array_to_string(proargnames, ',') from pg_proc where proname = 'featured_for_type'), 'p_type,vendor_id');
end $$;
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000012a1');
select pg_temp.expect_equal('a person reads no placements directly (no policy for them)', (
  select count(*)::text from featured_placement), '0');
select pg_temp.expect_equal('featured for a type: current, published, not ended, at most 3, earliest start first', (
  select string_agg(v.slug, ',' order by f.ord) from featured_for_type('00000000-0000-7000-8000-0000000012d2') with ordinality as f(vendor_id, ord)
  join vendor v on v.id = f.vendor_id), 'test-twelve-q4,test-twelve-q5,test-twelve-v');
select pg_temp.expect_equal('a type nobody is featured for: none', (
  select count(*)::text from featured_for_type('00000000-0000-7000-8000-0000000012d1')), '0');
select pg_temp.act(null, null);
select pg_temp.expect_equal('the featured list needs nobody signed in (it holds only public businesses)', (
  select count(*)::text from featured_for_type('00000000-0000-7000-8000-0000000012d2')), '3');

-- ------------------------------- a flag stays until the team decides (D-41, D-54) ---
-- A un-marks V and marks it again (an hour later, so the times differ). Since migration 0046
-- the business's "this wasn't booked" note stays with the booking until the team decides:
-- re-marking no longer clears it (the scenario tests found it let a fake review through).
select pg_temp.act('person', '00000000-0000-7000-8000-0000000012a1');
update event_vendor set status = 'considering' where id = '00000000-0000-7000-8000-000000001261';
reset role;
update event_vendor set vendor_flagged_at = vendor_flagged_at - interval '1 hour' where id = '00000000-0000-7000-8000-000000001261';
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000012a1');
update event_vendor set status = 'booked' where id = '00000000-0000-7000-8000-000000001261';
select pg_temp.expect_equal('after marking V booked again, the flag still counts for A', (
  select (vendor_flagged_at >= booked_at)::text from event_vendor where id = '00000000-0000-7000-8000-000000001261'), 'true');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000012a3', '00000000-0000-7000-8000-0000000012c1');
select pg_temp.expect_equal('…and O still sees the booking flagged', (
  select (flagged_at is not null)::text from bookings_for_business() where row_id = '00000000-0000-7000-8000-000000001261'), 'true');
select pg_temp.expect_code('…so O doesn''t need to flag it again',
  $q$select * from flag_booking('00000000-0000-7000-8000-000000001261', null)$q$, 'LP110');
reset role;
-- (The test's own back-dating above is recorded too, as support work: actor_kind 'system'.)
select pg_temp.expect_equal('…one flag by the business recorded in status_change, and its note kept', (
  select (select count(*) from status_change where subject_id = '00000000-0000-7000-8000-000000001261' and field = 'vendor_flag'
          and actor_kind = 'vendor')::text || ' '
      || (select count(*) from event_vendor_flag_note where event_vendor_id = '00000000-0000-7000-8000-000000001261')::text), '1 1');
-- Putting back a business that is no longer listed is refused, as adding it would be.
-- (Added weeks ago, so it doesn't change the team counts checked below.)
insert into event_vendor (id, event_id, host_user_id, vendor_id, status, removed_at, created_at) values
  ('00000000-0000-7000-8000-000000001265', '00000000-0000-7000-8000-0000000012f2', '00000000-0000-7000-8000-0000000012a1',
   '00000000-0000-7000-8000-0000000012c4', 'removed', now(), now() - interval '20 days');
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000012a1');
select pg_temp.expect_code('A puts back a business that isn''t listed any more: refused',
  $q$update event_vendor set status = 'considering' where id = '00000000-0000-7000-8000-000000001265'$q$, 'LP107');

-- ------------------------------------------------------------ lifecycle ---
select pg_temp.act('person', '00000000-0000-7000-8000-0000000012a1');
update event set status = 'cancelled' where id = '00000000-0000-7000-8000-0000000012f1';
select pg_temp.expect_equal('A cancels: the database sets cancelled_at and records it', (
  select (e.cancelled_at = now())::text || ' ' || sc.from_status || '>' || sc.to_status || ' ' || sc.actor_kind
  from event e join status_change sc on sc.subject_type = 'event' and sc.subject_id = e.id
  where e.id = '00000000-0000-7000-8000-0000000012f1'), 'true planning>cancelled consumer');
select pg_temp.expect_code('A edits a cancelled event: refused',
  $q$update event set guest_count_estimate = 20 where id = '00000000-0000-7000-8000-0000000012f1'$q$, 'LP102');
select pg_temp.expect_code('cancelled → planning: refused (cancel is final)',
  $q$update event set status = 'planning' where id = '00000000-0000-7000-8000-0000000012f1'$q$, 'LP102');
select pg_temp.expect_code('A edits the private details of a cancelled event: refused',
  $q$update event_private set notes = 'x' where event_id = '00000000-0000-7000-8000-0000000012f1'$q$, 'LP102');
select pg_temp.expect_code('A adds a business to a cancelled event: refused',
  $q$insert into event_vendor (event_id, host_user_id, vendor_id)
     values ('00000000-0000-7000-8000-0000000012f1', '00000000-0000-7000-8000-0000000012a1', '00000000-0000-7000-8000-0000000012c6')$q$, 'LP102');
select pg_temp.expect_code('A changes a plan row of a cancelled event: refused',
  $q$update event_vendor set status = 'considering' where id = '00000000-0000-7000-8000-000000001263'$q$, 'LP102');
select pg_temp.expect_code('a new event can''t start cancelled',
  $q$insert into event (host_user_id, event_date, municipality_id, status)
     values ('00000000-0000-7000-8000-0000000012a1', pg_temp.today() + 30, '00000000-0000-7000-8000-0000000012b1', 'cancelled')$q$, '42501');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000012a3', '00000000-0000-7000-8000-0000000012c1');
select pg_temp.expect_equal('the booked row stays booked after the cancel, and O still sees it, cancelled', (
  select string_agg(cancelled::text, ',') from bookings_for_business()), 'true');
select pg_temp.expect_code('a booking on a cancelled event can''t be flagged',
  $q$select * from flag_booking('00000000-0000-7000-8000-000000001261', null)$q$, 'LP102');

-- --------------------------------------------- team-only counts (D-42) ---
-- Today: A saved V then un-saved it, A saved U, B saved V. Plan rows added: V twice (A's
-- event, and O's own put there by support), U and Y once. Marked booked: V (twice, the
-- same row) and Y. Events: one of kind K (A's, later cancelled), four with no kind.
select pg_temp.act('person', '00000000-0000-7000-8000-0000000012a1');
select pg_temp.expect_code('a person cannot run the team''s counts',
  $q$select * from plan_counts_for_team(pg_temp.today(), pg_temp.today() + 1)$q$, 'LP101');
select pg_temp.expect_code('…nor the counts by kind of event',
  $q$select * from plan_type_counts_for_team(pg_temp.today(), pg_temp.today() + 1)$q$, 'LP101');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000012a3', '00000000-0000-7000-8000-0000000012c1');
select pg_temp.expect_code('a business cannot run them (not on its Analytics page)',
  $q$select * from plan_counts_for_team(pg_temp.today(), pg_temp.today() + 1)$q$, 'LP101');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000012a8');
select pg_temp.expect_code('N on the team side cannot run them',
  $q$select * from plan_counts_for_team(pg_temp.today(), pg_temp.today() + 1)$q$, 'LP101');
select pg_temp.act(null, null);
select pg_temp.expect_code('nobody acting cannot run them',
  $q$select * from plan_type_counts_for_team(pg_temp.today(), pg_temp.today() + 1)$q$, 'LP101');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000012a7');
select pg_temp.expect_equal('the team sees per business: saved / added / marked booked (current saves only)', (
  select string_agg(v.slug || '=' || c.saved || '/' || c.added || '/' || c.marked_booked, ' ' order by v.slug)
  from plan_counts_for_team(pg_temp.today(), pg_temp.today() + 1) c join vendor v on v.id = c.vendor_id),
  'test-twelve-u=1/1/0 test-twelve-v=1/2/1 test-twelve-y=0/1/1');
select pg_temp.expect_equal('…and per kind of event: planned / marked booked, with "no type given" its own row', (
  select string_agg(coalesce(t.key, 'none') || '=' || c.events_planned || '/' || c.marked_booked, ' ' order by t.key nulls last)
  from plan_type_counts_for_team(pg_temp.today(), pg_temp.today() + 1) c left join event_type t on t.id = c.event_type_id),
  'test_kind=1/2 none=4/0');
select pg_temp.expect_equal('a period with nothing in it: no rows', (
  select (select count(*) from plan_counts_for_team(pg_temp.today() - 10, pg_temp.today()))
       + (select count(*) from plan_type_counts_for_team(pg_temp.today() - 10, pg_temp.today())))::text, '0');
reset role;
do $$ begin
  perform pg_temp.expect_equal('the counts are totals only: no person, no event, no note', (
    select string_agg(proname || '(' || array_to_string(proargnames, ',') || ')', ' ' order by proname)
    from pg_proc where proname in ('plan_counts_for_team', 'plan_type_counts_for_team')),
    'plan_counts_for_team(p_from,p_to,vendor_id,saved,added,marked_booked) '
    'plan_type_counts_for_team(p_from,p_to,event_type_id,events_planned,marked_booked)');
end $$;
set local role app_server;

-- --------------------------------------------------------------- other ---
select pg_temp.act('person', '00000000-0000-7000-8000-0000000012a1');
update event set start_time = '22:00', end_time = '01:00' where id = '00000000-0000-7000-8000-0000000012f2';
select pg_temp.expect_equal('event_ends_at: 22:00 to 01:00 ends the next day', (
  select (event_ends_at(e) = ((e.event_date + 1) + time '01:00') at time zone 'America/Toronto')::text
  from event e where id = '00000000-0000-7000-8000-0000000012f2'), 'true');
select pg_temp.expect_accept('notification kinds: a booked event cancelled or changed, and a booking flagged (D-41)',
  $q$insert into notification (user_id, kind, subject_type, subject_id) values
     ('00000000-0000-7000-8000-0000000012a3', 'booked_event_cancelled', 'event_vendor', '00000000-0000-7000-8000-000000001261'),
     ('00000000-0000-7000-8000-0000000012a3', 'booked_event_changed', 'event_vendor', '00000000-0000-7000-8000-000000001261'),
     ('00000000-0000-7000-8000-0000000012a1', 'booking_flagged', 'event_vendor', '00000000-0000-7000-8000-000000001261')$q$);
select pg_temp.expect_reject('an unknown notification kind',
  $q$insert into notification (user_id, kind, subject_type, subject_id)
     values ('00000000-0000-7000-8000-0000000012a1', 'booking_paid', 'event_vendor', '00000000-0000-7000-8000-000000001261')$q$);
do $$
declare n int; t text; s record;
begin
  -- One read of every new table on every side: no policy loops into another.
  for s in select * from (values
      ('person', '00000000-0000-7000-8000-0000000012a1'::uuid, null::uuid),
      ('business', '00000000-0000-7000-8000-0000000012a3'::uuid, '00000000-0000-7000-8000-0000000012c1'::uuid),
      ('team', '00000000-0000-7000-8000-0000000012a7'::uuid, null::uuid),
      (null, null, null)) as x(side, who, biz) loop
    perform pg_temp.act(s.side, s.who, s.biz);
    foreach t in array array['event_type', 'event', 'event_private', 'event_vendor', 'saved_vendor',
                             'event_type_category', 'featured_placement'] loop
      execute format('select count(*) from %I', t) into n;
    end loop;
  end loop;
  raise notice 'PASS  no policy loops: every new table reads on every side';
end $$;
reset role;

-- -------------------------- table checks hold on the owner path too ---
-- (Support work in the SQL editor skips the app-path rules, never these.)
select pg_temp.expect_code('owner path: booked with no booked time',
  $q$update event_vendor set status = 'booked' where id = '00000000-0000-7000-8000-000000001262'$q$, '23514');
select pg_temp.expect_code('owner path: removed with no removed time',
  $q$update event_vendor set status = 'removed' where id = '00000000-0000-7000-8000-000000001262'$q$, '23514');
select pg_temp.expect_code('owner path: a flag without who flagged it',
  $q$update event_vendor set vendor_flagged_at = now() where id = '00000000-0000-7000-8000-000000001262'$q$, '23514');
update event_vendor set status = 'removed', removed_at = now() where id = '00000000-0000-7000-8000-000000001264';
select pg_temp.expect_code('owner path: removed → booked is still not a step',
  $q$update event_vendor set status = 'booked', booked_at = now(), removed_at = null where id = '00000000-0000-7000-8000-000000001264'$q$, 'LP109');
select pg_temp.expect_code('owner path: a plan row can''t move to another event',
  $q$update event_vendor set event_id = '00000000-0000-7000-8000-0000000012f2' where id = '00000000-0000-7000-8000-000000001264'$q$, 'LP100');
select pg_temp.expect_code('owner path: an event''s host can''t change',
  $q$update event set host_user_id = '00000000-0000-7000-8000-0000000012a2' where id = '00000000-0000-7000-8000-0000000012f2'$q$, 'LP100');

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;
set local role anon;
do $$
declare n int; t text;
begin
  foreach t in array array['event_type', 'event', 'event_private', 'event_vendor', 'saved_vendor',
                           'event_type_category', 'featured_placement'] loop
    begin
      execute format('select count(*) from %I', t) into n;
    exception when insufficient_privilege then n := 0;
    end;
    if n <> 0 then raise exception 'FAIL  anon role read % rows of %', n, t; end if;
  end loop;
  begin
    perform featured_for_type('00000000-0000-7000-8000-0000000012d2');
    raise exception 'FAIL  anon role ran featured_for_type';
  exception when insufficient_privilege then null;
  end;
  begin
    perform plan_counts_for_team(current_date, current_date + 1);
    raise exception 'FAIL  anon role ran plan_counts_for_team';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS  browser-facing role reads nothing from the new tables and runs none of the new functions';
end $$;
reset role;

rollback;
