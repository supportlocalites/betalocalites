-- =============================================================================
-- Localites — migration 0055: a hidden street number's pin is always approximate (D-56)
-- =============================================================================
-- From the independent review of step 3 (19 October 2026): nothing in 0054 stopped a business
-- that hides its street number ("Never on Localites") from keeping an exact pin. The site
-- already only ever writes an approximate one; this makes the database refuse anything else.
-- Any listing that somehow has a hidden number with an exact pin is first marked approximate.
--
-- Not destructive: one check, after marking any such pin approximate.
-- =============================================================================

set search_path = public, extensions;

update vendor set map_approximate = true
where hide_address_number and map_lat is not null and not map_approximate;

alter table vendor
  add constraint vendor_hidden_number_pin_approximate check (not hide_address_number or map_lat is null or map_approximate);
