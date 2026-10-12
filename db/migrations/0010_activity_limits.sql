-- =============================================================================
-- Localites — migration 0010: limits on activity counting (review of ADR-030)
-- =============================================================================
-- 1. activity_budget: how many actions and searches were kept each (Toronto) day. Past
--    10,000 actions or 5,000 searches in a day, more aren't kept, so a script can never
--    fill the free database (D-20). The team's Activity page shows the day's use.
-- 2. A page opening keeps its "place in a list" only when that list page was really
--    recorded in the last 12 hours.
-- 3. The nightly count keeps every town for each day; reports choose the top towns over
--    the whole period (choosing per day split a town between its name and "Other towns").
-- Not destructive: one new table; three functions replaced with the same names, arguments
-- and permissions. To undo: a later migration puts back the 0009 versions.
-- =============================================================================

set search_path = public, extensions;

create table activity_budget (
  day      date primary key,                   -- Toronto date
  events   int not null default 0 check (events >= 0),
  searches int not null default 0 check (searches >= 0)
);

do $$
declare r text;
begin
  alter table activity_budget enable row level security;
  alter table activity_budget force row level security;
  create policy app_server_all on activity_budget to app_server using (true) with check (true);
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on activity_budget from %I', r);
    end if;
  end loop;
end $$;
grant select, insert on activity_budget to app_server;
grant update (events, searches) on activity_budget to app_server;

create or replace function activity_record_list(
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
  v_used  int;
begin
  if v_count > 30 then raise exception 'a list has at most 30 places'; end if;
  -- A new list page uses up one of the day's searches; past the day's limit, nothing is kept.
  if not exists (select 1 from search_record where id = p_id) then
    insert into activity_budget as b (day, searches) values ((now() at time zone 'America/Toronto')::date, 1)
    on conflict (day) do update set searches = b.searches + 1
    returning searches into v_used;
    if v_used > 5000 then return 0; end if;
  end if;
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

create or replace function activity_record_event(
  p_page uuid, p_kind text, p_vendor uuid, p_visitor uuid, p_source text, p_list uuid,
  p_pos int, p_device text, p_town text, p_region text, p_seconds int
) returns boolean
language plpgsql security invoker set search_path = public, extensions as $$
declare
  v_source text := p_source;
  v_list   uuid := p_list;
  v_pos    int := p_pos;
  v_view   record;
  v_used   int;
begin
  if not exists (select 1 from vendor where id = p_vendor and listing_status = 'published') then
    return false;
  end if;
  -- The place in a list is kept only when that list page really was recorded, lately.
  if v_list is not null and not exists (
       select 1 from search_record where id = v_list and occurred_at > now() - interval '12 hours') then
    v_list := null;
    v_pos := null;
  end if;
  -- A new action uses up one of the day's actions; past the day's limit, nothing is kept.
  if not exists (select 1 from activity_event where page_view_id = p_page and kind = p_kind) then
    insert into activity_budget as b (day, events) values ((now() at time zone 'America/Toronto')::date, 1)
    on conflict (day) do update set events = b.events + 1
    returning events into v_used;
    if v_used > 10000 then return false; end if;
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

create or replace function activity_rollup_day(d date) returns int
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
  counted as (select * from ranked where viewer = 'public' and nth <= 3)
  insert into vendor_daily_breakdown (vendor_id, day, dimension, value, profile_views)
  select vendor_id, d, 'device', coalesce(device, 'unknown'), count(*) from counted group by vendor_id, coalesce(device, 'unknown')
  union all
  select vendor_id, d, 'hour', to_char(occurred_at at time zone 'America/Toronto', 'HH24'), count(*)
  from counted group by vendor_id, to_char(occurred_at at time zone 'America/Toronto', 'HH24')
  union all
  select vendor_id, d, 'town', coalesce(visitor_town, 'unknown'), count(*) from counted group by vendor_id, coalesce(visitor_town, 'unknown')
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
