-- =============================================================================
-- Checks for migration 0009 (activity tracking and the Analytics page).
-- One transaction, rolled back. Obviously fake data.
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

create function pg_temp.expect_equal(label text, got text, want text) returns void
language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL  %: got %, want %', label, coalesce(got, 'null'), coalesce(want, 'null');
  end if;
  raise notice 'PASS  %  (%)', label, want;
end $$;

-- People, places and businesses.
insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000009a1', 'Owner Nine', 'owner-9@example.com'),
  ('00000000-0000-7000-8000-0000000009a2', 'Admin Nine', 'admin-9@example.com');
insert into platform_role (user_id, role) values ('00000000-0000-7000-8000-0000000009a2', 'admin');
insert into municipality (id, slug, name, region) values
  ('00000000-0000-7000-8000-0000000009b1', 'test-town-9', 'Test Town', 'Test County');
insert into category (id, slug, name) values ('00000000-0000-7000-8000-0000000009e1', 'test-cat-9', 'Test Category');
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, published_at, archived_at) values
  ('00000000-0000-7000-8000-0000000009c1', 'test-nine-a', 'Nine A', '00000000-0000-7000-8000-0000000009b1', 'admin_entered', 'published', now(), null),
  ('00000000-0000-7000-8000-0000000009c2', 'test-nine-b', 'Nine B', '00000000-0000-7000-8000-0000000009b1', 'admin_entered', 'published', now(), null),
  ('00000000-0000-7000-8000-0000000009c3', 'test-nine-c', 'Nine C', '00000000-0000-7000-8000-0000000009b1', 'admin_entered', 'published', now(), null),
  ('00000000-0000-7000-8000-0000000009c4', 'test-nine-d', 'Nine D', '00000000-0000-7000-8000-0000000009b1', 'admin_entered', 'archived', now(), now());
insert into vendor_member (vendor_id, user_id, role) values
  ('00000000-0000-7000-8000-0000000009c1', '00000000-0000-7000-8000-0000000009a1', 'owner');
-- Browsers: O is the owner's, T the admin's; P1-P4 are the public.
insert into visitor_account (visitor_id, user_id) values
  ('00000000-0000-7000-8000-00000000090f', '00000000-0000-7000-8000-0000000009a1'),
  ('00000000-0000-7000-8000-00000000091f', '00000000-0000-7000-8000-0000000009a2');

-- Detail for one Toronto day, 1 November 2025 (clocks change the next morning).
insert into activity_event (kind, vendor_id, visitor_id, source, page_view_id, viewer, occurred_at, device, visitor_town)
select 'profile_view', '00000000-0000-7000-8000-0000000009c1', '00000000-0000-7000-8000-0000000009f1', 'search',
       ('00000000-0000-7000-8000-0000000097' || lpad(g::text, 2, '0'))::uuid, 'public',
       timestamptz '2025-11-01 14:00:00+00' + g * interval '1 minute', 'phone', 'Orillia'
from generate_series(1, 5) g;
insert into activity_event (kind, vendor_id, visitor_id, source, page_view_id, viewer, occurred_at, device, visitor_town) values
  ('profile_view', '00000000-0000-7000-8000-0000000009c1', '00000000-0000-7000-8000-0000000009f2', 'direct',
   '00000000-0000-7000-8000-000000009801', 'public', '2025-10-30 15:00:00+00', 'computer', 'Barrie'),
  ('profile_view', '00000000-0000-7000-8000-0000000009c1', '00000000-0000-7000-8000-0000000009f2', 'direct',
   '00000000-0000-7000-8000-000000009802', 'public', '2025-11-01 15:00:00+00', 'computer', 'Barrie'),
  -- 03:30 UTC on 2 November is 23:30 on 1 November in Toronto.
  ('profile_view', '00000000-0000-7000-8000-0000000009c1', '00000000-0000-7000-8000-0000000009f3', 'direct',
   '00000000-0000-7000-8000-000000009803', 'public', '2025-11-02 03:30:00+00', null, null),
  ('profile_view', '00000000-0000-7000-8000-0000000009c1', '00000000-0000-7000-8000-00000000090f', 'direct',
   '00000000-0000-7000-8000-000000009804', 'owner', '2025-11-01 16:00:00+00', 'phone', 'Orillia'),
  ('profile_view', '00000000-0000-7000-8000-0000000009c1', '00000000-0000-7000-8000-00000000091f', 'direct',
   '00000000-0000-7000-8000-000000009805', 'team', '2025-11-01 16:00:00+00', 'computer', 'Toronto'),
  ('website_tap', '00000000-0000-7000-8000-0000000009c1', '00000000-0000-7000-8000-0000000009f2', 'direct',
   '00000000-0000-7000-8000-000000009802', 'public', '2025-11-01 15:01:00+00', 'computer', 'Barrie');
insert into activity_event (kind, vendor_id, visitor_id, source, page_view_id, viewer, occurred_at, duration_seconds) values
  ('profile_time', '00000000-0000-7000-8000-0000000009c1', '00000000-0000-7000-8000-0000000009f2', 'direct',
   '00000000-0000-7000-8000-000000009802', 'public', '2025-11-01 15:02:00+00', 80);
insert into vendor_daily_stats (vendor_id, day, placement, municipality_id, seen_in_search, position_sum)
values ('00000000-0000-7000-8000-0000000009c1', '2025-11-01', 'search', null, 7, 14);
insert into search_record (id, visitor_id, viewer, placement, words, words_norm, category_id, result_count, occurred_at) values
  ('00000000-0000-7000-8000-000000009901', '00000000-0000-7000-8000-0000000009f1', 'public', 'search', 'cakes', 'cakes', null, 3, '2025-11-01 14:00:00+00'),
  ('00000000-0000-7000-8000-000000009902', '00000000-0000-7000-8000-0000000009f2', 'public', 'search', 'unicorns', 'unicorns', null, 0, '2025-11-01 14:00:00+00'),
  ('00000000-0000-7000-8000-000000009903', '00000000-0000-7000-8000-00000000091f', 'team', 'search', 'cakes', 'cakes', null, 3, '2025-11-01 14:00:00+00');

set local role app_server;

-- 1. What can be stored.
select pg_temp.expect_reject('an unknown action', $q$insert into activity_event (kind, vendor_id) values ('ad_click', '00000000-0000-7000-8000-0000000009c1')$q$);
select pg_temp.expect_reject('an unknown source', $q$insert into activity_event (kind, vendor_id, source) values ('profile_view', '00000000-0000-7000-8000-0000000009c1', 'google')$q$);
select pg_temp.expect_reject('an unknown viewer', $q$insert into activity_event (kind, vendor_id, viewer) values ('profile_view', '00000000-0000-7000-8000-0000000009c1', 'bot')$q$);
select pg_temp.expect_reject('an unknown device', $q$insert into activity_event (kind, vendor_id, device) values ('profile_view', '00000000-0000-7000-8000-0000000009c1', 'watch')$q$);
select pg_temp.expect_reject('a town longer than 60 characters', $q$insert into activity_event (kind, vendor_id, visitor_town) values ('profile_view', '00000000-0000-7000-8000-0000000009c1', repeat('x', 61))$q$);
select pg_temp.expect_reject('a time on a page opening', $q$insert into activity_event (kind, vendor_id, duration_seconds) values ('profile_view', '00000000-0000-7000-8000-0000000009c1', 5)$q$);
select pg_temp.expect_reject('more than half an hour on a page', $q$insert into activity_event (kind, vendor_id, duration_seconds) values ('profile_time', '00000000-0000-7000-8000-0000000009c1', 1801)$q$);
select pg_temp.expect_reject('the same page opened twice', $q$insert into activity_event (kind, vendor_id, page_view_id) values ('profile_view', '00000000-0000-7000-8000-0000000009c1', '00000000-0000-7000-8000-000000009701')$q$);
select pg_temp.expect_reject('a search with no words', $q$insert into search_record (id, placement, result_count) values ('00000000-0000-7000-8000-0000000099ff', 'search', 1)$q$);
select pg_temp.expect_reject('a week that doesn''t start on a Monday', $q$insert into vendor_period_people (vendor_id, period, starts_on) values ('00000000-0000-7000-8000-0000000009c1', 'week', '2025-11-04')$q$);
select pg_temp.expect_reject('a month that doesn''t start on the 1st', $q$insert into vendor_period_people (vendor_id, period, starts_on) values ('00000000-0000-7000-8000-0000000009c1', 'month', '2025-11-02')$q$);
select pg_temp.expect_reject('a night''s count marked done with no finish time', $q$insert into activity_rollup (day, status) values ('2025-01-01', 'done')$q$);
select pg_temp.expect_reject('a failed night''s count with no reason', $q$insert into activity_rollup (day, status, finished_at) values ('2025-01-01', 'failed', now())$q$);

-- 2. What the app may change.
select pg_temp.expect_reject('the app can''t rewrite what an action was', $q$update activity_event set kind = 'phone_tap'$q$);
select pg_temp.expect_reject('the app can''t delete actions', $q$delete from activity_event$q$);
select pg_temp.expect_reject('the app can''t delete totals', $q$delete from vendor_daily_stats$q$);
select pg_temp.expect_reject('the app can''t rewrite a search''s words', $q$update search_record set words = 'x'$q$);
select pg_temp.expect_reject('the app can''t delete the Analytics switch', $q$delete from vendor_analytics$q$);
select pg_temp.expect_accept('the app can record time on a page growing', $q$update activity_event set duration_seconds = 90 where kind = 'profile_time'$q$);

-- 3. A list a browser reports.
do $$
declare n int;
begin
  n := activity_record_list('00000000-0000-7000-8000-000000009a01', 'search', '  Wedding   CAKES ', null, 3,
    '{00000000-0000-7000-8000-0000000009c1,00000000-0000-7000-8000-0000000009c2,00000000-0000-7000-8000-0000000009c3}',
    3, '00000000-0000-7000-8000-0000000009f4', 'phone', 'Orillia', 'ON');
  perform pg_temp.expect_equal('the first two places seen are counted', n::text, '2');
  perform pg_temp.expect_equal('…at their places in the list', (
    select string_agg(position_sum::text, ',' order by vendor_id) from vendor_daily_stats
    where day = (now() at time zone 'America/Toronto')::date and placement = 'search'), '1,2');
  perform pg_temp.expect_equal('the search''s words are kept tidied, for the team', (
    select words_norm from search_record where id = '00000000-0000-7000-8000-000000009a01'), 'wedding cakes');
  n := activity_record_list('00000000-0000-7000-8000-000000009a01', 'search', 'Wedding cakes', null, 3,
    '{00000000-0000-7000-8000-0000000009c1,00000000-0000-7000-8000-0000000009c2,00000000-0000-7000-8000-0000000009c3}',
    3, '00000000-0000-7000-8000-0000000009f4', 'phone', 'Orillia', 'ON');
  perform pg_temp.expect_equal('the same report again counts nothing', n::text, '0');
  n := activity_record_list('00000000-0000-7000-8000-000000009a01', 'search', 'Wedding cakes', null, 3,
    '{00000000-0000-7000-8000-0000000009c1,00000000-0000-7000-8000-0000000009c2,00000000-0000-7000-8000-0000000009c3}',
    6 | 32, '00000000-0000-7000-8000-0000000009f4', 'phone', 'Orillia', 'ON');
  perform pg_temp.expect_equal('only the new place is counted; places past the list are ignored', n::text, '1');
  perform pg_temp.expect_equal('…the third at place 3', (
    select position_sum::text from vendor_daily_stats
    where vendor_id = '00000000-0000-7000-8000-0000000009c3' and day = (now() at time zone 'America/Toronto')::date), '3');
  n := activity_record_list('00000000-0000-7000-8000-000000009a02', 'category', null, 'test-cat-9', 2,
    '{00000000-0000-7000-8000-0000000009c4,00000000-0000-7000-8000-0000000009c2}',
    1, '00000000-0000-7000-8000-0000000009f4', null, null, null);
  perform pg_temp.expect_equal('an archived business is never counted', n::text, '0');
  perform pg_temp.expect_equal('a category browse is recorded with its category', (
    select category_id::text from search_record where id = '00000000-0000-7000-8000-000000009a02'), '00000000-0000-7000-8000-0000000009e1');
  n := activity_record_list('00000000-0000-7000-8000-000000009a03', 'search', 'cakes', null, 2,
    '{00000000-0000-7000-8000-0000000009c1,00000000-0000-7000-8000-0000000009c2}',
    3, '00000000-0000-7000-8000-00000000090f', null, null, null);
  perform pg_temp.expect_equal('the owner''s own browser counts others, never their own business', n::text, '1');
  n := activity_record_list('00000000-0000-7000-8000-000000009a04', 'search', 'cakes', null, 2,
    '{00000000-0000-7000-8000-0000000009c1,00000000-0000-7000-8000-0000000009c2}',
    3, '00000000-0000-7000-8000-00000000091f', null, null, null);
  perform pg_temp.expect_equal('the team''s browser counts nothing', n::text, '0');
  perform pg_temp.expect_equal('…and its search is marked as the team''s', (
    select viewer from search_record where id = '00000000-0000-7000-8000-000000009a04'), 'team');
  perform pg_temp.expect_equal('no browser report adds a second totals row (no town filter)', (
    select count(*)::text from vendor_daily_stats
    where vendor_id = '00000000-0000-7000-8000-0000000009c2' and day = (now() at time zone 'America/Toronto')::date and placement = 'search'), '1');
end $$;

-- 4. Actions a browser reports on a business's page.
do $$
begin
  perform pg_temp.expect_equal('a page opening is recorded', activity_record_event('00000000-0000-7000-8000-000000009b01', 'profile_view',
    '00000000-0000-7000-8000-0000000009c2', '00000000-0000-7000-8000-0000000009f4', 'search',
    '00000000-0000-7000-8000-000000009a01', 2, 'phone', 'Orillia', 'ON', null)::text, 'true');
  perform activity_record_event('00000000-0000-7000-8000-000000009b01', 'website_tap',
    '00000000-0000-7000-8000-0000000009c2', '00000000-0000-7000-8000-0000000009f4', null, null, null, 'phone', 'Orillia', 'ON', null);
  perform pg_temp.expect_equal('a tap takes where the visitor came from, and the place, from its page', (
    select source || ' ' || list_position from activity_event where page_view_id = '00000000-0000-7000-8000-000000009b01' and kind = 'website_tap'), 'search 2');
  perform activity_record_event('00000000-0000-7000-8000-000000009b01', 'website_tap',
    '00000000-0000-7000-8000-0000000009c2', '00000000-0000-7000-8000-0000000009f4', null, null, null, 'phone', 'Orillia', 'ON', null);
  perform pg_temp.expect_equal('a second tap of the same kind on the same page isn''t counted again', (
    select count(*)::text from activity_event where page_view_id = '00000000-0000-7000-8000-000000009b01' and kind = 'website_tap'), '1');
  perform activity_record_event('00000000-0000-7000-8000-000000009b01', 'profile_time',
    '00000000-0000-7000-8000-0000000009c2', '00000000-0000-7000-8000-0000000009f4', null, null, null, null, null, null, 40);
  perform activity_record_event('00000000-0000-7000-8000-000000009b01', 'profile_time',
    '00000000-0000-7000-8000-0000000009c2', '00000000-0000-7000-8000-0000000009f4', null, null, null, null, null, null, 25);
  perform pg_temp.expect_equal('time on the page keeps the larger figure', (
    select duration_seconds::text from activity_event where page_view_id = '00000000-0000-7000-8000-000000009b01' and kind = 'profile_time'), '40');
  perform activity_record_event('00000000-0000-7000-8000-000000009b02', 'profile_view',
    '00000000-0000-7000-8000-0000000009c1', '00000000-0000-7000-8000-00000000090f', 'direct', null, null, null, null, null, null);
  perform pg_temp.expect_equal('a business''s own owner opening its page is marked "owner"', (
    select viewer from activity_event where page_view_id = '00000000-0000-7000-8000-000000009b02'), 'owner');
  perform pg_temp.expect_equal('an archived business records nothing', activity_record_event('00000000-0000-7000-8000-000000009b03', 'profile_view',
    '00000000-0000-7000-8000-0000000009c4', '00000000-0000-7000-8000-0000000009f4', 'direct', null, null, null, null, null, null)::text, 'false');
end $$;

-- 5. Counting a day, twice.
do $$
declare first text; second text;
begin
  perform activity_rollup_day('2025-11-01');
  select string_agg(concat_ws(':', placement, profile_views, website_taps, timed_views, profile_seconds, unique_people, seen_in_search), ' ' order by placement)
    into first from vendor_daily_stats where vendor_id = '00000000-0000-7000-8000-0000000009c1' and day = '2025-11-01';
  perform pg_temp.expect_equal('a day''s totals: 3 of 5 opens from one browser, the late-night one, no owner or team visits',
    first, 'direct:2:1:1:90:2:0 search:3:0:0:0:1:7');
  perform activity_rollup_day('2025-11-01');
  select string_agg(concat_ws(':', placement, profile_views, website_taps, timed_views, profile_seconds, unique_people, seen_in_search), ' ' order by placement)
    into second from vendor_daily_stats where vendor_id = '00000000-0000-7000-8000-0000000009c1' and day = '2025-11-01';
  perform pg_temp.expect_equal('counting the same day again changes nothing (seen-in-search kept)', second, first);
  perform pg_temp.expect_equal('what was left out, and why', (
    select string_agg(value || '=' || profile_views, ' ' order by value) from vendor_daily_breakdown
    where vendor_id = '00000000-0000-7000-8000-0000000009c1' and day = '2025-11-01' and dimension = 'left_out'), 'over_daily_cap=2 owner=1 team=1');
  perform pg_temp.expect_equal('phone or computer', (
    select string_agg(value || '=' || profile_views, ' ' order by value) from vendor_daily_breakdown
    where vendor_id = '00000000-0000-7000-8000-0000000009c1' and day = '2025-11-01' and dimension = 'device'), 'computer=1 phone=3 unknown=1');
  perform pg_temp.expect_equal('approximate towns', (
    select string_agg(value || '=' || profile_views, ' ' order by value) from vendor_daily_breakdown
    where vendor_id = '00000000-0000-7000-8000-0000000009c1' and day = '2025-11-01' and dimension = 'town'), 'Barrie=1 Orillia=3 unknown=1');
  perform pg_temp.expect_equal('different visitors that day, and one who came back', (
    select people || '/' || returning_people from vendor_period_people
    where vendor_id = '00000000-0000-7000-8000-0000000009c1' and period = 'day' and starts_on = '2025-11-01'), '3/1');
  perform pg_temp.expect_equal('the week starts on Monday and counts each visitor once', (
    select people || '/' || returning_people from vendor_period_people
    where vendor_id = '00000000-0000-7000-8000-0000000009c1' and period = 'week' and starts_on = '2025-10-27'), '3/1');
  perform pg_temp.expect_equal('search demand: the public''s searches, and those that found nothing', (
    select searches || '/' || found_nothing || '/' || people from search_daily_stats where day = '2025-11-01' and placement = 'search'), '2/1/2');
end $$;
reset role;
insert into activity_event (kind, vendor_id, visitor_id, source, page_view_id, viewer, occurred_at) values
  ('profile_view', '00000000-0000-7000-8000-0000000009c1', '00000000-0000-7000-8000-0000000009f5', 'direct',
   '00000000-0000-7000-8000-000000009806', 'public', '2025-11-01 18:00:00+00');
set local role app_server;
do $$
begin
  perform activity_rollup_day('2025-11-01');
  perform pg_temp.expect_equal('one more opening, counted again: exactly one more', (
    select sum(profile_views)::text from vendor_daily_stats where vendor_id = '00000000-0000-7000-8000-0000000009c1' and day = '2025-11-01'), '6');
end $$;

-- 6. Unlinking a person keeps every count.
do $$
begin
  perform unlink_person('00000000-0000-7000-8000-0000000009a1');
  perform pg_temp.expect_equal('the person''s browser is no longer linked to their actions', (
    select count(*)::text from activity_event where visitor_id = '00000000-0000-7000-8000-00000000090f'), '0');
  perform pg_temp.expect_equal('…their actions are still there', (
    select count(*)::text from activity_event where page_view_id = '00000000-0000-7000-8000-000000009804'), '1');
  perform pg_temp.expect_equal('…nobody else''s link changed', (
    select count(*)::text from activity_event where visitor_id = '00000000-0000-7000-8000-0000000009f1'), '5');
  perform pg_temp.expect_equal('…and the browser link is gone', (
    select count(*)::text from visitor_account where user_id = '00000000-0000-7000-8000-0000000009a1'), '0');
end $$;
reset role;

-- 7. Browser-facing roles see none of it and can run none of it.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;
set local role anon;
do $$
declare n int; t text;
begin
  foreach t in array array['activity_event', 'vendor_daily_stats', 'search_record', 'vendor_daily_breakdown',
                           'vendor_period_people', 'search_daily_stats', 'visitor_account', 'vendor_analytics', 'activity_rollup'] loop
    begin
      execute format('select count(*) from %I', t) into n;
    exception when insufficient_privilege then n := 0;
    end;
    if n <> 0 then raise exception 'FAIL  anon role read % rows of %', n, t; end if;
  end loop;
  begin
    perform activity_rollup_day('2025-11-01');
    raise exception 'FAIL  anon role ran the nightly count';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS  browser-facing role reads no activity and can run none of its functions';
end $$;
reset role;

rollback;
