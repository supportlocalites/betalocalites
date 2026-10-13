-- =============================================================================
-- Localites — migration 0013: bookings marked before a business joined (D-44)
-- =============================================================================
-- The product owner (13 October 2026): a business that joins Localites later sees a
-- booking marked before it joined only if that event is still to come. Past bookings from
-- before it joined stay hidden, so a business can't gauge how popular it has been on
-- Localites.
--
-- "Joined" is when the business's earliest current owner or manager started (the claim
-- approval, D-33). A booking marked (or marked again) after that is always shown.
--
-- Not destructive: two functions from 0012 are replaced with the same columns and the same
-- rights (create or replace keeps who may run them); no table or row changes. To undo: a
-- later migration puts the 0012 bodies back.
-- =============================================================================

set search_path = public, extensions;

-- When the business joined: its earliest current owner or manager. Null when no one runs it.
create function business_joined_at(p_vendor uuid) returns timestamptz
language sql stable security definer set search_path = public, extensions as $$
  select min(m.created_at) from vendor_member m
  where m.vendor_id = p_vendor and m.role in ('owner', 'manager') and m.ended_at is null
$$;

-- What a business sees of its bookings (D-40), now also: only from when it joined, unless
-- the event is still to come (D-44).
create or replace function bookings_for_business()
returns table (row_id uuid, person text, event_date date, town text, guests int, cancelled boolean,
               booked_at timestamptz, flagged_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select ev.id, u.display_name, e.event_date, mu.name, e.guest_count_estimate, e.status = 'cancelled',
         ev.booked_at, case when ev.vendor_flagged_at >= ev.booked_at then ev.vendor_flagged_at end
  from event_vendor ev
  join event e on e.id = ev.event_id
  join municipality mu on mu.id = e.municipality_id
  join app_user u on u.id = e.host_user_id
  where acting_for_business() and ev.vendor_id = acting_vendor() and ev.status = 'booked'
    and (ev.booked_at >= business_joined_at(ev.vendor_id)
         or e.event_date >= (now() at time zone 'America/Toronto')::date)
$$;

-- "This isn't right" (D-41): only for a booking the business can see (D-44).
create or replace function flag_booking(p_row uuid, p_note text)
returns table (event_id uuid, event_date date, host_user_id uuid)
language plpgsql security definer set search_path = public, extensions as $$
declare
  r record;
begin
  if not acting_for_business() then
    raise exception 'only the business itself can say this' using errcode = 'LP101';
  end if;
  select ev.id, ev.status, ev.booked_at, ev.vendor_flagged_at, e.status as event_status,
         e.id as eid, e.event_date as edate, e.host_user_id as host into r
  from event_vendor ev join event e on e.id = ev.event_id
  where ev.id = p_row and ev.vendor_id = acting_vendor()
    and (ev.booked_at >= business_joined_at(ev.vendor_id)
         or e.event_date >= (now() at time zone 'America/Toronto')::date)
  for update of ev;
  if not found or r.status <> 'booked' then
    raise exception 'only the business itself can say this' using errcode = 'LP101';
  end if;
  if r.event_status <> 'planning' then
    raise exception 'that event is cancelled' using errcode = 'LP102';
  end if;
  if r.vendor_flagged_at is not null and r.vendor_flagged_at >= r.booked_at then
    raise exception 'you''ve already told us about this booking' using errcode = 'LP110';
  end if;
  update event_vendor set vendor_flagged_at = now(), vendor_flagged_by = acting_user() where id = p_row;
  if nullif(btrim(coalesce(p_note, '')), '') is null then
    delete from event_vendor_flag_note where event_vendor_id = p_row;
  else
    insert into event_vendor_flag_note (event_vendor_id, note) values (p_row, btrim(p_note))
    on conflict (event_vendor_id) do update set note = excluded.note, updated_at = now();
  end if;
  return query select r.eid, r.edate, r.host;
end $$;

-- The new helper: only the app role runs it (as 0012).
revoke all on function business_joined_at(uuid) from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function business_joined_at(uuid) from %I', r);
    end if;
  end loop;
end $$;
grant execute on function business_joined_at(uuid) to app_server;
