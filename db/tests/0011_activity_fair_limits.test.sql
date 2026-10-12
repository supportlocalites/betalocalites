-- =============================================================================
-- Checks for migration 0011 (fairer limits on activity counting).
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
  ('00000000-0000-7000-8000-000000002b01', 'test-town-11', 'Test Town', 'Test County');
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, published_at) values
  ('00000000-0000-7000-8000-000000002c01', 'test-eleven-a', 'Eleven A', '00000000-0000-7000-8000-000000002b01', 'admin_entered', 'published', now());
-- One busy browser: 300 actions and 100 searches already today.
insert into activity_event (kind, vendor_id, visitor_id, page_view_id, occurred_at)
select 'profile_view', '00000000-0000-7000-8000-000000002c01', '00000000-0000-7000-8000-000000002f01', gen_random_uuid(), now()
from generate_series(1, 300);
insert into search_record (id, visitor_id, placement, words, words_norm, result_count)
select gen_random_uuid(), '00000000-0000-7000-8000-000000002f01', 'search', 'cakes', 'cakes', 1 from generate_series(1, 100);

set local role app_server;
do $$
begin
  perform pg_temp.expect_equal('a browser past 300 actions today isn''t counted', activity_record_event('00000000-0000-7000-8000-000000002d01', 'profile_view',
    '00000000-0000-7000-8000-000000002c01', '00000000-0000-7000-8000-000000002f01', 'direct', null, null, null, null, null, null)::text, 'false');
  perform pg_temp.expect_equal('a browser past 100 searches today isn''t counted', activity_record_list('00000000-0000-7000-8000-000000002e01', 'search', 'pies', null, 1,
    '{00000000-0000-7000-8000-000000002c01}', 1, '00000000-0000-7000-8000-000000002f01', null, null, null)::text, '0');
  perform pg_temp.expect_equal('…and it used up none of the day''s shared limit', (
    select coalesce(sum(events + searches), 0)::text from activity_budget where day = (now() at time zone 'America/Toronto')::date), '0');
  perform pg_temp.expect_equal('another browser is still counted', activity_record_event('00000000-0000-7000-8000-000000002d02', 'profile_view',
    '00000000-0000-7000-8000-000000002c01', '00000000-0000-7000-8000-000000002f02', 'direct', null, null, null, null, null, null)::text, 'true');
end $$;
reset role;
update activity_budget set events = 10000 where day = (now() at time zone 'America/Toronto')::date;
set local role app_server;
do $$
begin
  perform activity_record_event('00000000-0000-7000-8000-000000002d03', 'profile_view',
    '00000000-0000-7000-8000-000000002c01', '00000000-0000-7000-8000-000000002f03', 'direct', null, null, null, null, null, null);
  perform pg_temp.expect_equal('reaching the day''s shared limit is recorded, so reports can say so', (
    select (limited_at is not null)::text from activity_budget where day = (now() at time zone 'America/Toronto')::date), 'true');
end $$;
reset role;

rollback;
