-- =============================================================================
-- Localites — migration 0060: distances from the person's own home (D-64)
-- =============================================================================
-- The product owner, 26 October 2026: "I want the distance filter to measure the distance from
-- the users address"; "addresses should be exact because it is just for them"; "a house icon
-- ... to show their home"; and "From: Home or Current Location".
--
--   person_profile  + where their address is on the map (home_lat, home_lng: exact, from the
--                   same free address search as businesses' pins), and whether it was found.
--                   Only ever sent to that person's own browser, which works out distances to
--                   businesses there. Never shown to anyone else, never to businesses.
--                   Any change to the address clears the point, so it's looked up again.
--   Download your data includes it (my_data() reads the whole row, 0043); deleting the account
--   or clearing the details deletes the row (0014, 0005).
--   "Current location" is the browser's own and is never sent to Localites.
--
-- Not destructive: four empty columns, two checks and a trigger added.
-- =============================================================================

set search_path = public, extensions;

alter table person_profile
  add column home_lat double precision check (home_lat between 41 and 57),
  add column home_lng double precision check (home_lng between -96 and -74),
  add column home_lookup text check (home_lookup in ('found', 'not_found')),
  add column home_looked_up_at timestamptz;

alter table person_profile
  add constraint person_profile_home_point_whole check ((home_lat is null) = (home_lng is null)),
  add constraint person_profile_home_found_has_point check ((home_lat is not null) = (home_lookup is not distinct from 'found')),
  add constraint person_profile_home_lookup_dated check ((home_lookup is null) = (home_looked_up_at is null));

comment on column person_profile.home_lat is
  'Where their address is (0060, D-64): exact, for their own distances only. Cleared when the address changes.';
comment on column person_profile.home_lng is 'See home_lat.';
comment on column person_profile.home_lookup is
  'Whether the address search found their address (0060): found, not_found, or not looked up yet (null).';

-- A changed address: the old point no longer applies, and it's looked up again.
create function person_home_moves() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
begin
  if (new.street_address, new.unit, new.town, new.province, new.postal_code)
     is distinct from (old.street_address, old.unit, old.town, old.province, old.postal_code) then
    new.home_lat := null;
    new.home_lng := null;
    new.home_lookup := null;
    new.home_looked_up_at := null;
  end if;
  return new;
end $$;
create trigger person_profile_home_moves before update on person_profile
  for each row execute function person_home_moves();

revoke all on function person_home_moves() from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function person_home_moves() from %I', r);
    end if;
  end loop;
end $$;
