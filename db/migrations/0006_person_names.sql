-- =============================================================================
-- Localites — migration 0006: first and last name (D-36, amended 11 October 2026)
-- =============================================================================
-- Sign-up asks for the first and last name in two boxes, both needed to continue.
-- display_name stays the name shown everywhere ("First Last"); these two keep the
-- parts as typed. Accounts made before this (the team's) have neither until the person
-- saves them on Your account.
-- Not destructive: two new optional columns.
-- =============================================================================

set search_path = public, extensions;

alter table app_user
  add column given_name text check (char_length(given_name) between 1 and 60),
  add column family_name text check (char_length(family_name) between 1 and 60),
  -- Both or neither, so a name is never half-recorded.
  add constraint app_user_names_together check ((given_name is null) = (family_name is null));
