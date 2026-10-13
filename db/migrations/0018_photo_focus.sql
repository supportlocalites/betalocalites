-- =============================================================================
-- Localites — migration 0018: the part of a photo that always stays in view
-- =============================================================================
-- Every photo frame on Localites has one shape (4:3, product owner 13 October 2026), so a
-- wide or tall photo is trimmed to fit. The business's owner or a manager can tap the most
-- important part of each photo; frames then keep that spot in view. Stored as a point from
-- 0 to 1 across and down the photo; the middle (0.5, 0.5) until they choose. The photo
-- itself is stored whole and opens whole when tapped.
-- Not destructive: two columns with a default. To undo: a later migration drops them.
-- =============================================================================

set search_path = public, extensions;

alter table media_asset
  add column focus_x real not null default 0.5 check (focus_x between 0 and 1),
  add column focus_y real not null default 0.5 check (focus_y between 0 and 1);
