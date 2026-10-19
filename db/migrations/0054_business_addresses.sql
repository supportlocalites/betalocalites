-- =============================================================================
-- Localites — migration 0054: business addresses and the map, step 3 of the redesign (D-56, D-57)
-- =============================================================================
-- The product owner, 19 October 2026: "We should make it a priority to have businesses
-- addresses ... if they really don't provide an address we just acknowledge the city/town they
-- are in and dont put them on the map"; "I want the ability to hide the number of the address
-- but not the street (this will be used more by personal addresses than real businesses) for
-- those that hide their personal address we can use a pin but somewhere it should note that it
-- is approximate location"; and, asked when a hidden number is shown: "Never on Localites".
--
--   vendor.address_street        the street, like "Lakeshore Road" (the town is the listing's own).
--   vendor.address_number        the number on the street, like "22" or "22A".
--   vendor.hide_address_number   the business keeps its number to itself: the site never shows
--                                it, and the pin is only near the street. Turning it on clears
--                                the number (it isn't kept, since it's never shown).
--   vendor.map_lat, map_lng      where its pin goes; none: not on the map (town only).
--   vendor.map_approximate       the pin is near, not at, the address (shown as "Approximate location").
--
-- Set by the business's owner or a manager (their own page, recorded like any owner change) or
-- by the team. Not destructive: six columns and their checks, and one more owner-change flag.
-- =============================================================================

set search_path = public, extensions;

alter table vendor
  add column address_street text check (address_street ~ '^[[:alnum:]][[:alnum:] .,''’&/-]{0,119}$'),
  add column address_number text check (address_number ~ '^[0-9]{1,6}[A-Za-z]?(-[0-9]{1,6}[A-Za-z]?)?$'),
  add column hide_address_number boolean not null default false,
  add column map_lat double precision check (map_lat between 41 and 57),
  add column map_lng double precision check (map_lng between -96 and -74),
  add column map_approximate boolean not null default false;

-- A number only with its street; a hidden number isn't kept at all; a pin is both
-- coordinates or neither; an approximate pin is still a pin.
alter table vendor
  add constraint vendor_address_number_needs_street check (address_number is null or address_street is not null),
  add constraint vendor_hidden_number_not_kept check (not hide_address_number or address_number is null),
  add constraint vendor_map_point_whole check ((map_lat is null) = (map_lng is null)),
  add constraint vendor_map_approximate_has_point check (not map_approximate or map_lat is not null);

-- An owner's or manager's address change is an owner change like any other (ADR-029): the team
-- gets a "check now" email and can undo it.
alter table owner_change drop constraint owner_change_flags_check;
alter table owner_change add constraint owner_change_flags_check check (flags <@ array['website', 'phone', 'name', 'address']::text[]);

comment on column vendor.address_street is 'The street of the business''s address (0054, D-56), without the town (primary_municipality_id).';
comment on column vendor.address_number is 'The number on the street (0054); never kept when hide_address_number is on.';
comment on column vendor.hide_address_number is
  'The business keeps its street number to itself (0054): never shown on Localites; the pin is near the street (map_approximate).';
comment on column vendor.map_lat is 'Where its pin goes on the map (0054); with map_lng, or neither (then it''s listed by its town only).';
comment on column vendor.map_lng is 'See map_lat.';
comment on column vendor.map_approximate is 'The pin is near, not at, the address (0054): shown as "Approximate location".';
