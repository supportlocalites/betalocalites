-- =============================================================================
-- Localites — migration 0009: activity tracking and the Analytics page
--                            (D-22, D-30, D-37; ADR-023, ADR-030)
-- =============================================================================
-- Counts how people find and use each business, in our own database, with no outside
-- trackers. Only what a real browser confirms is counted (ADR-030): the page's server
-- signs what it showed, and the browser reports what was on screen.
--   1. activity_event gains more facts per action (where the visitor came from, their
--      place in the list, phone or computer, approximate town, time on the page) and
--      whose visit it was (the public, the business's own people, or the team).
--   2. search_record: one row per list a real browser showed (the words, or the category,
--      and how many results). Detail, team only.
--   3. vendor_daily_stats gains columns; vendor_daily_breakdown, vendor_period_people and
--      search_daily_stats hold the totals reports read. Rebuilt each night from detail
--      (activity_rollup records each night's count).
--   4. visitor_account: which browser belongs to which account, so the business's own
--      visits and the team's are left out of the totals.
--   5. vendor_analytics: the team's per-business switch for the Analytics page (D-37).
--   6. Functions that record a report from the browser, count a day, and unlink a person.
-- Not destructive: new tables, columns, indexes and functions; three check lists widened;
-- one grant narrowed. The activity tables are still empty. To undo: a later migration
-- drops what this one added (no existing row changes).
-- =============================================================================

set search_path = public, extensions;

-- 1. Wider check lists. Only kinds whose feature exists now; email, social, share,
--    directions and photos come with their features.
alter table activity_event drop constraint activity_event_kind_check;
alter table activity_event add constraint activity_event_kind_check check (kind in (
  'profile_view', 'website_tap', 'phone_tap', 'profile_time', 'services_seen'));
alter table activity_event drop constraint activity_event_source_check;
alter table activity_event add constraint activity_event_source_check check (source in (
  'search', 'category', 'collection', 'featured', 'shared_link', 'direct', 'other',
  'web_search', 'social', 'other_site'));
alter table vendor_daily_stats drop constraint vendor_daily_stats_placement_check;
alter table vendor_daily_stats add constraint vendor_daily_stats_placement_check check (placement in (
  'search', 'category', 'collection', 'featured', 'shared_link', 'direct', 'other',
  'web_search', 'social', 'other_site'));
comment on column vendor_daily_stats.placement is
  'Seen-in-search totals: the list it was seen in. Page opens and taps: where the visitor came from.';

-- 2. One row per list page a real browser showed. Appearances themselves are never stored
--    one by one: only which places on the page were already counted (seen_mask).
create table search_record (
  id             uuid primary key,          -- the list page's id, from its signed token
  occurred_at    timestamptz not null default now(),
  visitor_id     uuid,                      -- Localites' own cookie; cleared when unlinked
  viewer         text not null default 'public' check (viewer in ('public', 'team')),
  placement      text not null check (placement in ('search', 'category')),
  words          text check (char_length(words) between 1 and 100),
  words_norm     text check (char_length(words_norm) between 1 and 100),
  category_id    uuid references category(id),
  result_count   smallint not null check (result_count between 0 and 30),   -- 30 means "30 or more"
  device         text check (device in ('phone', 'tablet', 'computer')),
  visitor_town   text check (char_length(visitor_town) between 1 and 60),
  visitor_region text check (char_length(visitor_region) between 1 and 6),
  seen_mask      int not null default 0 check (seen_mask >= 0),            -- bit n-1: place n already counted
  check ((words is null) = (words_norm is null)),
  check (placement <> 'search' or words is not null)
);
create index search_record_time on search_record using brin (occurred_at);
create index search_record_visitor on search_record (visitor_id) where visitor_id is not null;

-- 3. More facts per action (the table is empty, so new defaults and checks are safe).
alter table activity_event
  add column page_view_id     uuid,
  add column list_id          uuid,          -- the search_record it came from (no link: it may arrive first)
  add column list_position    smallint check (list_position between 1 and 30),
  add column device           text check (device in ('phone', 'tablet', 'computer')),
  add column visitor_town     text check (char_length(visitor_town) between 1 and 60),
  add column visitor_region   text check (char_length(visitor_region) between 1 and 6),
  add column viewer           text not null default 'public' check (viewer in ('public', 'owner', 'team')),
  add column duration_seconds smallint check (duration_seconds between 1 and 1800),
  add constraint activity_event_duration_only_time check ((kind = 'profile_time') = (duration_seconds is not null));
comment on column activity_event.visitor_town is
  'Approximate town from Cloudflare (city level). Not an internet address; not the town filter (municipality_id).';
comment on column activity_event.viewer is
  'owner: someone from this business; team: Localites. Kept in the detail, left out of every total.';
create unique index activity_event_once on activity_event (page_view_id, kind) where page_view_id is not null;
create index activity_event_time on activity_event using brin (occurred_at);
create index activity_event_visitor on activity_event (visitor_id, vendor_id) where visitor_id is not null;
-- Detail is append-only, except time on the page (it grows) and unlinking a person.
revoke update on activity_event from app_server;
grant update (duration_seconds, user_id, visitor_id) on activity_event to app_server;

-- 4. More daily totals. seen_in_search and position_sum are written as browsers report;
--    the rest are set each night from the detail.
alter table vendor_daily_stats
  add column position_sum    int not null default 0 check (position_sum >= 0),  -- average place = position_sum / seen_in_search
  add column services_seen   int not null default 0 check (services_seen >= 0),
  add column timed_views     int not null default 0 check (timed_views >= 0),
  add column profile_seconds int not null default 0 check (profile_seconds >= 0);
create index vendor_daily_stats_day on vendor_daily_stats (day);
comment on column vendor_daily_stats.unique_people is
  'Different browsers in this row only. Never add up across rows; reports read vendor_period_people.';

-- 5. Page opens broken down (rebuilt each night).
create table vendor_daily_breakdown (
  vendor_id     uuid not null references vendor(id),
  day           date not null,
  dimension     text not null check (dimension in ('device', 'town', 'hour', 'left_out')),
  value         text not null check (char_length(value) between 1 and 60),
  profile_views int not null default 0 check (profile_views >= 0),
  primary key (vendor_id, day, dimension, value)
);

-- 6. Different visitors per period (different people can't be added up across days).
create table vendor_period_people (
  vendor_id        uuid not null references vendor(id),
  period           text not null check (period in ('day', 'week', 'month', 'year')),
  starts_on        date not null,                 -- Toronto date
  people           int not null default 0 check (people >= 0),
  returning_people int not null default 0 check (returning_people >= 0),
  updated_at       timestamptz not null default now(),
  primary key (vendor_id, period, starts_on),
  check (returning_people <= people),
  check (period <> 'week' or extract(isodow from starts_on) = 1),
  check (period <> 'month' or extract(day from starts_on) = 1),
  check (period <> 'year' or (extract(month from starts_on) = 1 and extract(day from starts_on) = 1))
);

-- 7. Search demand per day.
create table search_daily_stats (
  day           date not null,
  category_id   uuid references category(id),
  placement     text not null check (placement in ('search', 'category')),
  searches      int not null default 0 check (searches >= 0),
  found_nothing int not null default 0 check (found_nothing >= 0),
  people        int not null default 0 check (people >= 0),
  check (found_nothing <= searches),
  unique nulls not distinct (day, category_id, placement)
);

-- 8. Which browser belongs to which account. Written only where a sign-in has already
--    been checked (the member and team pages).
create table visitor_account (
  visitor_id    uuid not null,
  user_id       uuid not null references app_user(id),
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  primary key (visitor_id, user_id)
);
create index visitor_account_user on visitor_account (user_id);

-- 9. The team's per-business switch (D-37). Its own table, so the owner's edit page (which
--    writes only vendor and vendor_service) can never reach it. History: audit_log.
create table vendor_analytics (
  vendor_id  uuid primary key references vendor(id),
  enabled    boolean not null,
  changed_at timestamptz not null default now(),
  changed_by uuid not null references app_user(id),
  audit_id   uuid not null references audit_log(id)
);

-- 10. Each night's count (like team_digest): a day is counted once, a failure is retried.
create table activity_rollup (
  day            date primary key,               -- Toronto date
  status         text not null check (status in ('running', 'done', 'failed')),
  events         int not null default 0 check (events >= 0),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  failure_reason text check (char_length(failure_reason) <= 300),
  check ((status = 'running') = (finished_at is null)),
  check (status <> 'failed' or failure_reason is not null)
);

-- 11. "People who asked for you" (Suggest a business, D-25).
create index vendor_suggestion_vendor on vendor_suggestion (vendor_id) where vendor_id is not null;

-- =============================================================================
-- FUNCTIONS (run as the app role, under its own rules)
-- =============================================================================

-- Whose browser this is, for one business: 'team' (a Localites admin), 'owner' (someone
-- from that business) or 'public'. Only browsers that have opened a signed-in page are known.
create function activity_viewer(p_visitor uuid, p_vendor uuid) returns text
language sql stable security invoker set search_path = public, extensions as $$
  select case
    when p_visitor is null then 'public'
    when exists (select 1 from visitor_account va
                 join platform_role r on r.user_id = va.user_id and r.role = 'admin' and r.revoked_at is null
                 where va.visitor_id = p_visitor) then 'team'
    when p_vendor is not null and exists (
                 select 1 from visitor_account va
                 join vendor_member m on m.user_id = va.user_id and m.vendor_id = p_vendor and m.ended_at is null
                 where va.visitor_id = p_visitor) then 'owner'
    else 'public' end
$$;

-- A list page a browser reports: records the search once, and counts each business whose
-- card was on screen, once per place per page. Returns how many businesses were counted.
create function activity_record_list(
  p_id uuid, p_placement text, p_words text, p_category_slug text, p_result_count int,
  p_vendor_ids uuid[], p_mask int, p_visitor uuid, p_device text, p_town text, p_region text
) returns int
language plpgsql security invoker set search_path = public, extensions as $$
declare
  v_team  boolean := activity_viewer(p_visitor, null) = 'team';
  v_count int := coalesce(cardinality(p_vendor_ids), 0);
  v_words text := nullif(btrim(p_words), '');
  v_old   int;
  v_fresh int;
  v_rows  int;
begin
  if v_count > 30 then raise exception 'a list has at most 30 places'; end if;
  insert into search_record (id, visitor_id, viewer, placement, words, words_norm, category_id,
                             result_count, device, visitor_town, visitor_region)
  values (p_id, p_visitor, case when v_team then 'team' else 'public' end, p_placement,
          v_words, lower(regexp_replace(v_words, '\s+', ' ', 'g')),
          (select id from category where slug = p_category_slug),
          least(greatest(p_result_count, 0), 30), p_device, p_town, p_region)
  on conflict (id) do nothing;

  select seen_mask into v_old from search_record where id = p_id for update;
  v_fresh := coalesce(p_mask, 0) & ~v_old & ((1 << v_count) - 1);
  if v_fresh = 0 then return 0; end if;
  update search_record set seen_mask = v_old | v_fresh where id = p_id;
  if v_team then return 0; end if;

  insert into vendor_daily_stats as s (vendor_id, day, placement, municipality_id, seen_in_search, position_sum)
  select v.id, (now() at time zone 'America/Toronto')::date, p_placement, null, 1, u.pos
  from unnest(p_vendor_ids) with ordinality as u(vid, pos)
  join vendor v on v.id = u.vid and v.listing_status = 'published'
  where (v_fresh >> (u.pos::int - 1)) & 1 = 1
    and activity_viewer(p_visitor, v.id) <> 'owner'
  on conflict on constraint vendor_daily_stats_vendor_id_day_placement_municipality_id_key
  do update set seen_in_search = s.seen_in_search + 1,
                position_sum = s.position_sum + excluded.position_sum,
                updated_at = now();
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

-- One action a browser reports on a business's page (opened it, tapped, time, services).
-- Once per page and kind; time on the page keeps the larger value. Returns false for a
-- business that isn't published.
create function activity_record_event(
  p_page uuid, p_kind text, p_vendor uuid, p_visitor uuid, p_source text, p_list uuid,
  p_pos int, p_device text, p_town text, p_region text, p_seconds int
) returns boolean
language plpgsql security invoker set search_path = public, extensions as $$
declare
  v_source text := p_source;
  v_list   uuid := p_list;
  v_pos    int := p_pos;
  v_view   record;
begin
  if not exists (select 1 from vendor where id = p_vendor and listing_status = 'published') then
    return false;
  end if;
  -- A tap or time on the page belongs to the page opening it came with.
  if p_kind <> 'profile_view' then
    select e.source, e.list_id, e.list_position into v_view
    from activity_event e where e.page_view_id = p_page and e.kind = 'profile_view' and e.vendor_id = p_vendor;
    if found then
      v_source := coalesce(v_view.source, v_source);
      v_list := coalesce(v_view.list_id, v_list);
      v_pos := coalesce(v_view.list_position, v_pos);
    end if;
  end if;
  insert into activity_event (kind, vendor_id, visitor_id, source, page_view_id, list_id, list_position,
                              device, visitor_town, visitor_region, viewer, duration_seconds)
  values (p_kind, p_vendor, p_visitor, v_source, p_page, v_list, v_pos, p_device, p_town, p_region,
          activity_viewer(p_visitor, p_vendor),
          case when p_kind = 'profile_time' then p_seconds end)
  on conflict (page_view_id, kind) where page_view_id is not null
  do update set duration_seconds = greatest(activity_event.duration_seconds, excluded.duration_seconds)
     where excluded.kind = 'profile_time' and activity_event.vendor_id = excluded.vendor_id;
  return true;
end $$;

-- Counts one Toronto day from the detail into the totals. Safe to run again: every value
-- from the detail is replaced, never added to, and seen-in-search totals aren't touched.
-- The public only; at most 3 of each action per browser per business per day.
create function activity_rollup_day(d date) returns int
language plpgsql security invoker set search_path = public, extensions as $$
declare
  lo    timestamptz := d::timestamp at time zone 'America/Toronto';
  hi    timestamptz := (d + 1)::timestamp at time zone 'America/Toronto';
  today date := (now() at time zone 'America/Toronto')::date;
  v_events int;
begin
  update vendor_daily_stats
  set profile_views = 0, website_taps = 0, phone_taps = 0, services_seen = 0,
      timed_views = 0, profile_seconds = 0, unique_people = 0, updated_at = now()
  where day = d;

  with ranked as (
    select e.*, row_number() over (partition by e.vendor_id, e.kind, coalesce(e.visitor_id::text, e.id::text)
                                   order by e.occurred_at, e.id) as nth
    from activity_event e
    where e.occurred_at >= lo and e.occurred_at < hi and e.viewer = 'public'
  )
  insert into vendor_daily_stats as s (vendor_id, day, placement, municipality_id, profile_views, website_taps,
                                       phone_taps, services_seen, timed_views, profile_seconds, unique_people)
  select vendor_id, d, coalesce(source, 'other'), municipality_id,
         count(*) filter (where kind = 'profile_view'),
         count(*) filter (where kind = 'website_tap'),
         count(*) filter (where kind = 'phone_tap'),
         count(*) filter (where kind = 'services_seen'),
         count(*) filter (where kind = 'profile_time'),
         coalesce(sum(duration_seconds) filter (where kind = 'profile_time'), 0),
         count(distinct visitor_id) filter (where kind = 'profile_view')
  from ranked where nth <= 3
  group by vendor_id, coalesce(source, 'other'), municipality_id
  on conflict on constraint vendor_daily_stats_vendor_id_day_placement_municipality_id_key
  do update set profile_views = excluded.profile_views, website_taps = excluded.website_taps,
                phone_taps = excluded.phone_taps, services_seen = excluded.services_seen,
                timed_views = excluded.timed_views, profile_seconds = excluded.profile_seconds,
                unique_people = excluded.unique_people, updated_at = now();

  delete from vendor_daily_breakdown where day = d;
  with ranked as (
    select e.*, row_number() over (partition by e.vendor_id, e.viewer, coalesce(e.visitor_id::text, e.id::text)
                                   order by e.occurred_at, e.id) as nth
    from activity_event e
    where e.occurred_at >= lo and e.occurred_at < hi and e.kind = 'profile_view'
  ),
  counted as (select * from ranked where viewer = 'public' and nth <= 3),
  towns as (
    select vendor_id, coalesce(visitor_town, 'unknown') as town, count(*) as n,
           row_number() over (partition by vendor_id order by visitor_town is null, count(*) desc, coalesce(visitor_town, '')) as r
    from counted group by vendor_id, visitor_town
  )
  insert into vendor_daily_breakdown (vendor_id, day, dimension, value, profile_views)
  select vendor_id, d, 'device', coalesce(device, 'unknown'), count(*) from counted group by vendor_id, coalesce(device, 'unknown')
  union all
  select vendor_id, d, 'hour', to_char(occurred_at at time zone 'America/Toronto', 'HH24'), count(*)
  from counted group by vendor_id, to_char(occurred_at at time zone 'America/Toronto', 'HH24')
  union all
  select vendor_id, d, 'town', case when town = 'unknown' then 'unknown' when r <= 10 then town else 'elsewhere' end, sum(n)::int
  from towns group by vendor_id, case when town = 'unknown' then 'unknown' when r <= 10 then town else 'elsewhere' end
  union all
  select vendor_id, d, 'left_out', case when viewer <> 'public' then viewer else 'over_daily_cap' end, count(*)
  from ranked where viewer <> 'public' or nth > 3
  group by vendor_id, case when viewer <> 'public' then viewer else 'over_daily_cap' end;

  -- Different visitors for the day, week, month and year holding d, up to the end of yesterday.
  with vendors as (
    select distinct vendor_id from activity_event
    where occurred_at >= lo and occurred_at < hi and viewer = 'public' and kind = 'profile_view'
  ),
  periods as (
    select * from (values
      ('day', d, d + 1),
      ('week', date_trunc('week', d)::date, date_trunc('week', d)::date + 7),
      ('month', date_trunc('month', d)::date, (date_trunc('month', d) + interval '1 month')::date),
      ('year', date_trunc('year', d)::date, (date_trunc('year', d) + interval '1 year')::date)
    ) as p(period, starts_on, ends_on)
  ),
  seen as (
    select v.vendor_id, p.period, p.starts_on, e.visitor_id,
           max((e.occurred_at at time zone 'America/Toronto')::date) as last_day
    from vendors v cross join periods p
    join activity_event e on e.vendor_id = v.vendor_id and e.kind = 'profile_view' and e.viewer = 'public'
                         and e.visitor_id is not null
                         and e.occurred_at >= p.starts_on::timestamp at time zone 'America/Toronto'
                         and e.occurred_at < greatest(least(p.ends_on, today), d + 1)::timestamp at time zone 'America/Toronto'
    group by v.vendor_id, p.period, p.starts_on, e.visitor_id
  ),
  firsts as (
    select e.vendor_id, e.visitor_id, min((e.occurred_at at time zone 'America/Toronto')::date) as first_day
    from activity_event e
    where e.kind = 'profile_view' and e.viewer = 'public'
      and e.vendor_id in (select vendor_id from vendors)
      and e.visitor_id in (select visitor_id from seen)
    group by e.vendor_id, e.visitor_id
  )
  insert into vendor_period_people (vendor_id, period, starts_on, people, returning_people, updated_at)
  select s.vendor_id, s.period, s.starts_on, count(*), count(*) filter (where f.first_day < s.last_day), now()
  from seen s join firsts f on f.vendor_id = s.vendor_id and f.visitor_id = s.visitor_id
  group by s.vendor_id, s.period, s.starts_on
  on conflict (vendor_id, period, starts_on)
  do update set people = excluded.people, returning_people = excluded.returning_people, updated_at = now();

  delete from search_daily_stats where day = d;
  insert into search_daily_stats (day, category_id, placement, searches, found_nothing, people)
  select d, category_id, placement, count(*), count(*) filter (where result_count = 0), count(distinct visitor_id)
  from search_record
  where occurred_at >= lo and occurred_at < hi and viewer = 'public'
  group by category_id, placement;

  select count(*) into v_events from activity_event where occurred_at >= lo and occurred_at < hi;
  return v_events;
end $$;

-- Removes the link between a person and their activity (when their account is deleted);
-- every count stays.
create function unlink_person(p uuid) returns void
language plpgsql security invoker set search_path = public, extensions as $$
begin
  update activity_event set user_id = null, visitor_id = null
  where user_id = p or visitor_id in (select visitor_id from visitor_account where user_id = p);
  update search_record set visitor_id = null
  where visitor_id in (select visitor_id from visitor_account where user_id = p);
  delete from visitor_account where user_id = p;
end $$;

-- =============================================================================
-- ACCESS (the app role only, as every other table: ADR-004)
-- =============================================================================

do $$
declare t text; r text;
begin
  foreach t in array array['search_record', 'vendor_daily_breakdown', 'vendor_period_people', 'search_daily_stats',
                           'visitor_account', 'vendor_analytics', 'activity_rollup'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy app_server_all on %I to app_server using (true) with check (true)', t);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on %I from %I', t, r);
      end if;
    end loop;
  end loop;
  -- Supabase grants new functions to these roles by default; take that back (as 0003).
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function activity_viewer(uuid, uuid), activity_record_list(uuid, text, text, text, int, uuid[], int, uuid, text, text, text), activity_record_event(uuid, text, uuid, uuid, text, uuid, int, text, text, text, int), activity_rollup_day(date), unlink_person(uuid) from %I', r);
    end if;
  end loop;
end $$;

grant select, insert on search_record to app_server;
grant update (seen_mask, visitor_id) on search_record to app_server;
-- Totals rebuilt each night.
grant select, insert, update, delete on vendor_daily_breakdown, vendor_period_people, search_daily_stats to app_server;
-- Delete: unlinking a person only.
grant select, insert, delete on visitor_account to app_server;
grant update (last_seen_at) on visitor_account to app_server;
grant select, insert on vendor_analytics to app_server;
grant update (enabled, changed_at, changed_by, audit_id) on vendor_analytics to app_server;
grant select, insert, update on activity_rollup to app_server;

revoke all on function activity_viewer(uuid, uuid) from public;
revoke all on function activity_record_list(uuid, text, text, text, int, uuid[], int, uuid, text, text, text) from public;
revoke all on function activity_record_event(uuid, text, uuid, uuid, text, uuid, int, text, text, text, int) from public;
revoke all on function activity_rollup_day(date) from public;
revoke all on function unlink_person(uuid) from public;
grant execute on function activity_viewer(uuid, uuid) to app_server;
grant execute on function activity_record_list(uuid, text, text, text, int, uuid[], int, uuid, text, text, text) to app_server;
grant execute on function activity_record_event(uuid, text, uuid, uuid, text, uuid, int, text, text, text, int) to app_server;
grant execute on function activity_rollup_day(date) to app_server;
grant execute on function unlink_person(uuid) to app_server;
