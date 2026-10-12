-- =============================================================================
-- Localites — migration 0011: fairer limits on activity counting (second review, ADR-030)
-- =============================================================================
-- 1. One browser keeps at most 300 actions and 100 searches a day, so a single script
--    can't use up the whole day's limit and stop counting for everyone.
-- 2. activity_budget.limited_at: when a day's site-wide limit was reached, so reports
--    can say that day isn't fully counted (never silently low).
-- Not destructive: one new column; two functions replaced with the same names, arguments
-- and permissions. To undo: a later migration puts back the 0010 versions.
-- =============================================================================

set search_path = public, extensions;

alter table activity_budget add column limited_at timestamptz;
grant update (limited_at) on activity_budget to app_server;

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
    -- One browser: at most 100 searches a day, so one script can't use up everyone's.
    if (select count(*) from search_record
        where visitor_id = p_visitor and occurred_at >= (now() at time zone 'America/Toronto')::date::timestamp at time zone 'America/Toronto') >= 100 then
      return 0;
    end if;
    insert into activity_budget as b (day, searches) values ((now() at time zone 'America/Toronto')::date, 1)
    on conflict (day) do update set searches = b.searches + 1
    returning searches into v_used;
    if v_used > 5000 then
      update activity_budget set limited_at = coalesce(limited_at, now()) where day = (now() at time zone 'America/Toronto')::date;
      return 0;
    end if;
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
    -- One browser: at most 300 actions a day, so one script can't use up everyone's.
    if (select count(*) from activity_event
        where visitor_id = p_visitor and occurred_at >= (now() at time zone 'America/Toronto')::date::timestamp at time zone 'America/Toronto') >= 300 then
      return false;
    end if;
    insert into activity_budget as b (day, events) values ((now() at time zone 'America/Toronto')::date, 1)
    on conflict (day) do update set events = b.events + 1
    returning events into v_used;
    if v_used > 10000 then
      update activity_budget set limited_at = coalesce(limited_at, now()) where day = (now() at time zone 'America/Toronto')::date;
      return false;
    end if;
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
