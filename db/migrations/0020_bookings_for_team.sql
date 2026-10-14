-- =============================================================================
-- Localites — migration 0020: the team sees every booking; a business taken down can't be newly booked (D-46)
-- =============================================================================
-- The product owner (13 October 2026): a business that's no longer listed "should be
-- hidden to others - so they cant book but for those who have booked it (and the event had
-- yet to happen) we will want to know so we can reach out to proactively to see if this is
-- an issue."
--
-- 1. A business that isn't listed can't be newly marked booked. (0012 already refused
--    adding it to a plan or putting it back; marking one already on a plan as booked was
--    still allowed.)
-- 2. The team sees, through two functions, every booking: which person marked which business
--    booked (listed or not, past events too): the person's name and email, the date, the town
--    and about how many guests. Upcoming bookings of a business that isn't listed are counted
--    for the team's menu, so the team can check in with those people. Never the event's
--    name, kind, times or private details (as D-40), and never what a person is only
--    considering or has saved. The owner, the same day: "at any moment an admin should know
--    all businesses who are booking business on the app and who they are working with. Even
--    after we remove them - their data should still exist from an admin view ... hidden to
--    everyone else except our admin".
--
-- Not destructive: one trigger function from 0012 is replaced with the same behaviour plus
-- one refusal; two functions are added; no table or row changes. To undo: a later migration
-- puts the 0012 trigger function back and drops the two functions.
-- =============================================================================

set search_path = public, extensions;

-- 0012's rules for plan rows, plus: marking booked needs the business to be listed now.
create or replace function enforce_event_vendor_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
declare
  v_side text := acting_side();
  v_event_status text;
begin
  -- Everyone: links don't move; status follows B §4.
  if tg_op = 'UPDATE' then
    if new.event_id <> old.event_id or new.vendor_id <> old.vendor_id
       or new.host_user_id <> old.host_user_id or new.created_at <> old.created_at then
      raise exception 'a business on a plan can''t be moved to another event or business' using errcode = 'LP100';
    end if;
    if new.status <> old.status and (old.status, new.status) not in (
         ('considering', 'booked'), ('booked', 'considering'), ('considering', 'removed'),
         ('booked', 'removed'), ('removed', 'considering')) then
      raise exception 'that change to a plan isn''t possible' using errcode = 'LP109';
    end if;
  end if;
  if current_user <> 'app_server' then return new; end if;        -- owner path

  if tg_op = 'UPDATE' and (new.flag_resolved_at is distinct from old.flag_resolved_at
                            or new.flag_outcome is distinct from old.flag_outcome) then
    raise exception 'deciding on flags comes later' using errcode = 'LP101';
  end if;

  if v_side = 'person' then
    if new.host_user_id is distinct from acting_user() then
      raise exception 'only the person planning this event can change its plan' using errcode = 'LP101';
    end if;
    if tg_op = 'UPDATE' and (new.vendor_flagged_at is distinct from old.vendor_flagged_at
                              or new.vendor_flagged_by is distinct from old.vendor_flagged_by) then
      raise exception 'only the business can say a booking isn''t right' using errcode = 'LP101';
    end if;
    select status into v_event_status from event where id = new.event_id;   -- host policy
    if v_event_status is null then
      raise exception 'only the person planning this event can change its plan' using errcode = 'LP101';
    elsif v_event_status <> 'planning' then
      raise exception 'a cancelled event''s plan can''t be changed' using errcode = 'LP102';
    end if;
    if tg_op = 'INSERT' then
      if new.status <> 'considering' then
        raise exception 'a business joins a plan as considering' using errcode = 'LP109';
      end if;
      if not exists (select 1 from vendor where id = new.vendor_id and listing_status = 'published') then
        raise exception 'that business isn''t listed on Localites' using errcode = 'LP107';
      end if;
    end if;
    if new.status in ('considering', 'booked') and (tg_op = 'INSERT' or new.status <> old.status) then
      if exists (select 1 from vendor_member m where m.vendor_id = new.vendor_id
                 and m.user_id = new.host_user_id and m.ended_at is null) then
        raise exception 'you can''t put your own business on your own event plan' using errcode = 'LP108';
      end if;
      if exists (select 1 from vendor where id = new.vendor_id and listing_status = 'archived') then
        raise exception 'that business isn''t listed on Localites' using errcode = 'LP107';
      end if;
      -- Putting a removed business back is like adding it again, and marking one booked
      -- needs it listed now (D-46): either way it must be listed.
      if tg_op = 'UPDATE' and (old.status = 'removed' or new.status = 'booked')
         and not exists (select 1 from vendor where id = new.vendor_id and listing_status = 'published') then
        raise exception 'that business isn''t listed on Localites' using errcode = 'LP107';
      end if;
    end if;
    -- The database owns the times; the app has no grant on them.
    if tg_op = 'INSERT' then
      new.booked_at := null; new.removed_at := null;
    elsif new.status <> old.status then
      new.booked_at  := case when new.status = 'booked'  then now() end;
      new.removed_at := case when new.status = 'removed' then now() end;
    end if;
    return new;

  end if;

  -- A business never writes plan rows directly: it flags through flag_booking() (owner path).
  raise exception 'no one is acting for a person or a business' using errcode = 'LP101';
end $$;

-- The team's view of bookings (D-46): every business marked booked, by whom, listed or not,
-- including past and cancelled events, so the team always knows who works with whom.
-- p_vendor: one business only. Runs as this migration's role (the team side can't read
-- plans, by design) and refuses anyone not acting as the team. Deleted accounts are left
-- out. Never the event's name, kind, times or private details, and never what a person is
-- only considering or has saved.
create function bookings_for_team(p_vendor uuid default null)
returns table (row_id uuid, vendor_id uuid, business text, listing_status text, person text, person_email text,
               event_date date, town text, guests int, booked_at timestamptz, cancelled boolean, upcoming boolean)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not acting_as_team() then
    raise exception 'only the Localites team sees these bookings' using errcode = 'LP101';
  end if;
  return query
  select ev.id, v.id, v.display_name, v.listing_status, u.display_name, u.email::text,
         e.event_date, mu.name, e.guest_count_estimate, ev.booked_at, e.status = 'cancelled',
         e.status = 'planning' and event_ends_at(e) >= now()
  from event_vendor ev
  join vendor v on v.id = ev.vendor_id
  join event e on e.id = ev.event_id
  join municipality mu on mu.id = e.municipality_id
  join app_user u on u.id = e.host_user_id
  where ev.status = 'booked' and u.deleted_at is null and (p_vendor is null or ev.vendor_id = p_vendor)
  order by (e.status = 'planning' and event_ends_at(e) >= now()) desc,
           case when e.status = 'planning' and event_ends_at(e) >= now() then e.event_date end,
           e.event_date desc, v.display_name, ev.id;
end $$;

-- How many bookings for events still to come (not cancelled, not over): with p_vendor, that
-- business's (listed or not, so the team sees them before taking it down); without, those of
-- every business that isn't listed: the ones to check in about. A count only: never who.
create function taken_down_booking_count(p_vendor uuid default null) returns int
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not acting_as_team() then
    raise exception 'only the Localites team sees these bookings' using errcode = 'LP101';
  end if;
  return (
    select count(*)::int
    from event_vendor ev
    join vendor v on v.id = ev.vendor_id
    join event e on e.id = ev.event_id
    join app_user u on u.id = e.host_user_id
    where ev.status = 'booked' and e.status = 'planning' and event_ends_at(e) >= now() and u.deleted_at is null
      and case when p_vendor is null then v.listing_status <> 'published' else v.id = p_vendor end);
end $$;

-- Only the app role runs them (as 0012).
revoke all on function bookings_for_team(uuid), taken_down_booking_count(uuid) from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function bookings_for_team(uuid), taken_down_booking_count(uuid) from %I', r);
    end if;
  end loop;
end $$;
grant execute on function bookings_for_team(uuid), taken_down_booking_count(uuid) to app_server;
