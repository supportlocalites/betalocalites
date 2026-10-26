-- =============================================================================
-- Localites — migration 0059: a unit or suite in a business's address (D-63)
-- =============================================================================
-- The product owner, 26 October 2026: "yes add unit to the business page too" (after Add my
-- business asked for "full address capabilities (unit, street number and address)").
--   vendor.address_unit  "2B", "Suite 200": shown after the street number and street.
--                        Like the number (0054), it needs a street, and it's never kept when the
--                        business keeps its number private (only the street and town show).
--   vendor_suggestion    the same for Add my business (0058): a private number means no unit
--                        kept either (any kept so far, from the last day, are erased).
--
-- Not destructive: one empty column and three checks added; a unit kept beside a private number
-- on Add my business (0058, only since 26 October 2026) is erased, as the form now does.
-- =============================================================================

set search_path = public, extensions;

alter table vendor
  add column address_unit text check (address_unit ~ '^[[:alnum:]#][[:alnum:] #.-]{0,29}$');

alter table vendor
  add constraint vendor_address_unit_needs_street check (address_unit is null or address_street is not null),
  add constraint vendor_hidden_unit_not_kept check (not hide_address_number or address_unit is null);

comment on column vendor.address_unit is
  'The unit or suite (0059, D-63), like 2B or Suite 200; never kept when hide_address_number is on.';

update vendor_suggestion set address_unit = null where hide_address_number and address_unit is not null;
alter table vendor_suggestion
  add constraint vendor_suggestion_hidden_unit_not_kept check (not hide_address_number or address_unit is null);
