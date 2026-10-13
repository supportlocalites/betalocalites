-- =============================================================================
-- Checks for migration 0013: bookings marked before a business joined (D-44).
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

-- A host, and a business that wasn't on Localites when she marked it booked twice: for a
-- party last week and one next month. A week later, its owner joins.
insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000013a1', 'Host H', 'host-h-13@example.com'),
  ('00000000-0000-7000-8000-0000000013a2', 'Owner J', 'owner-j-13@example.com');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000013b1', 'test-town-13', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000013c1', 'test-thirteen-v', 'Thirteen V', '00000000-0000-7000-8000-0000000013b1',
   'admin_entered', 'published', 'unclaimed', now());
insert into event (id, host_user_id, event_date, municipality_id) values
  ('00000000-0000-7000-8000-0000000013f1', '00000000-0000-7000-8000-0000000013a1', pg_temp.today() - 3, '00000000-0000-7000-8000-0000000013b1'),
  ('00000000-0000-7000-8000-0000000013f2', '00000000-0000-7000-8000-0000000013a1', pg_temp.today() + 30, '00000000-0000-7000-8000-0000000013b1');
insert into event_private (event_id, host_user_id, title) values
  ('00000000-0000-7000-8000-0000000013f1', '00000000-0000-7000-8000-0000000013a1', 'Last week'),
  ('00000000-0000-7000-8000-0000000013f2', '00000000-0000-7000-8000-0000000013a1', 'Next month');
insert into event_vendor (id, event_id, host_user_id, vendor_id, status, booked_at, created_at) values
  ('00000000-0000-7000-8000-000000001361', '00000000-0000-7000-8000-0000000013f1', '00000000-0000-7000-8000-0000000013a1',
   '00000000-0000-7000-8000-0000000013c1', 'booked', now() - interval '10 days', now() - interval '10 days'),
  ('00000000-0000-7000-8000-000000001362', '00000000-0000-7000-8000-0000000013f2', '00000000-0000-7000-8000-0000000013a1',
   '00000000-0000-7000-8000-0000000013c1', 'booked', now() - interval '9 days', now() - interval '9 days');
update vendor set claim_status = 'claimed' where id = '00000000-0000-7000-8000-0000000013c1';
insert into vendor_member (vendor_id, user_id, role, created_at) values
  ('00000000-0000-7000-8000-0000000013c1', '00000000-0000-7000-8000-0000000013a2', 'owner', now() - interval '2 days');

set local role app_server;
select pg_temp.act('business', '00000000-0000-7000-8000-0000000013a2', '00000000-0000-7000-8000-0000000013c1');
select pg_temp.expect_equal('a business that joined later sees the booking still to come, not the one already past', (
  select string_agg(row_id::text, ',') from bookings_for_business()), '00000000-0000-7000-8000-000000001362');
select pg_temp.expect_code('…and can''t flag the hidden past booking',
  $q$select * from flag_booking('00000000-0000-7000-8000-000000001361', null)$q$, 'LP101');
select pg_temp.expect_equal('…but can flag the one still to come', (
  select (event_id = '00000000-0000-7000-8000-0000000013f2')::text from flag_booking('00000000-0000-7000-8000-000000001362', null)), 'true');

-- A booking marked after the business joined is shown even once its event has passed.
reset role;
update event_vendor set booked_at = now() - interval '1 day' where id = '00000000-0000-7000-8000-000000001361';
set local role app_server;
select pg_temp.act('business', '00000000-0000-7000-8000-0000000013a2', '00000000-0000-7000-8000-0000000013c1');
select pg_temp.expect_equal('a past booking marked after it joined is shown', (
  select count(*)::text from bookings_for_business() where row_id = '00000000-0000-7000-8000-000000001361'), '1');

select pg_temp.expect_equal('business_joined_at is the earliest current owner or manager', (
  select (business_joined_at('00000000-0000-7000-8000-0000000013c1') = now() - interval '2 days')::text), 'true');

reset role;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;
set local role anon;
do $$
begin
  perform business_joined_at('00000000-0000-7000-8000-0000000013c1');
  raise exception 'FAIL  the browser-facing role can run business_joined_at';
exception when insufficient_privilege then
  raise notice 'PASS  the browser-facing role can''t run business_joined_at';
end $$;

rollback;
