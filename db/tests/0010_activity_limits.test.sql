-- =============================================================================
-- Checks for migration 0010 (limits on activity counting).
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

insert into municipality (id, slug, name, region) values
  ('00000000-0000-7000-8000-000000001b01', 'test-town-10', 'Test Town', 'Test County');
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, published_at) values
  ('00000000-0000-7000-8000-000000001c01', 'test-ten-a', 'Ten A', '00000000-0000-7000-8000-000000001b01', 'admin_entered', 'published', now());

set local role app_server;

do $$
declare today date := (now() at time zone 'America/Toronto')::date;
begin
  -- A page opened from a list that was never recorded: the place isn't kept.
  perform activity_record_event('00000000-0000-7000-8000-000000001d01', 'profile_view', '00000000-0000-7000-8000-000000001c01',
    '00000000-0000-7000-8000-000000001f01', 'search', '00000000-0000-7000-8000-000000001e99', 1, null, null, null, null);
  perform pg_temp.expect_equal('a place in a list that was never recorded is dropped', (
    select coalesce(list_position::text, 'none') || ' ' || coalesce(list_id::text, 'none') from activity_event
    where page_view_id = '00000000-0000-7000-8000-000000001d01'), 'none none');
  -- A real list, then a page opened from it: the place is kept.
  perform activity_record_list('00000000-0000-7000-8000-000000001e01', 'search', 'cakes', null, 1,
    '{00000000-0000-7000-8000-000000001c01}', 1, '00000000-0000-7000-8000-000000001f01', null, null, null);
  perform activity_record_event('00000000-0000-7000-8000-000000001d02', 'profile_view', '00000000-0000-7000-8000-000000001c01',
    '00000000-0000-7000-8000-000000001f01', 'search', '00000000-0000-7000-8000-000000001e01', 1, null, null, null, null);
  perform pg_temp.expect_equal('a place in a list just recorded is kept', (
    select list_position::text from activity_event where page_view_id = '00000000-0000-7000-8000-000000001d02'), '1');
  perform pg_temp.expect_equal('each new action and search uses up the day''s budget once', (
    select events || '/' || searches from activity_budget where day = today), '2/1');
  perform activity_record_list('00000000-0000-7000-8000-000000001e01', 'search', 'cakes', null, 1,
    '{00000000-0000-7000-8000-000000001c01}', 1, '00000000-0000-7000-8000-000000001f01', null, null, null);
  perform activity_record_event('00000000-0000-7000-8000-000000001d02', 'profile_view', '00000000-0000-7000-8000-000000001c01',
    '00000000-0000-7000-8000-000000001f01', 'search', null, null, null, null, null, null);
  perform pg_temp.expect_equal('a repeated report uses up nothing', (
    select events || '/' || searches from activity_budget where day = today), '2/1');
end $$;

reset role;
update activity_budget set events = 10000, searches = 5000 where day = (now() at time zone 'America/Toronto')::date;
set local role app_server;

do $$
begin
  perform pg_temp.expect_equal('past the day''s limit, a new action isn''t kept', activity_record_event('00000000-0000-7000-8000-000000001d03', 'profile_view',
    '00000000-0000-7000-8000-000000001c01', '00000000-0000-7000-8000-000000001f02', 'direct', null, null, null, null, null, null)::text, 'false');
  perform pg_temp.expect_equal('…nor stored', (
    select count(*)::text from activity_event where page_view_id = '00000000-0000-7000-8000-000000001d03'), '0');
  perform pg_temp.expect_equal('past the day''s limit, a new search isn''t kept', activity_record_list('00000000-0000-7000-8000-000000001e02', 'search', 'pies', null, 1,
    '{00000000-0000-7000-8000-000000001c01}', 1, '00000000-0000-7000-8000-000000001f02', null, null, null)::text, '0');
  perform pg_temp.expect_equal('…nor stored', (
    select count(*)::text from search_record where id = '00000000-0000-7000-8000-000000001e02'), '0');
end $$;

-- Every town is kept for the day (the report picks the top towns over the whole period).
reset role;
insert into activity_event (kind, vendor_id, visitor_id, source, page_view_id, viewer, occurred_at, visitor_town)
select 'profile_view', '00000000-0000-7000-8000-000000001c01', gen_random_uuid(), 'direct', gen_random_uuid(), 'public',
       timestamptz '2025-06-02 16:00:00+00', 'Town ' || g
from generate_series(1, 12) g;
set local role app_server;
do $$
begin
  perform activity_rollup_day('2025-06-02');
  perform pg_temp.expect_equal('all 12 towns kept for the day, none folded in', (
    select count(*)::text from vendor_daily_breakdown where vendor_id = '00000000-0000-7000-8000-000000001c01'
      and day = '2025-06-02' and dimension = 'town' and value <> 'elsewhere'), '12');
end $$;
reset role;

rollback;
