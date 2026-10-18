-- =============================================================================
-- Localites — migration 0038: an email when a suggested business is listed (D-25)
-- =============================================================================
-- D-25: "suggestions from signed-in people linked to their account, with an email when the
-- business is added". The suggestion already records who suggested it (suggested_by, 0001;
-- set to null if they delete their account, 0014). This adds the kind of email: sent once per
-- suggestion, when its business is published (or straight away, if the team marks it as a
-- business that's already listed). Recorded in notification like every email to a person; one
-- row per suggestion at most (an index), so two team members publishing at once can't both send
-- it. If that one email fails, it isn't sent again (the person can still find the business).
--
-- Not destructive: one more kind of email and an index.
-- =============================================================================

set search_path = public, extensions;

alter table notification drop constraint notification_kind_check;
alter table notification add constraint notification_kind_check check (kind in (
  'claim_received', 'claim_decision', 'listing_change_undone', 'owner_removed', 'new_message', 'marked_booked',
  'booking_unmarked', 'review_request', 'review_reminder', 'review_published', 'review_reply', 'vendor_joined',
  'booked_event_cancelled', 'booked_event_changed', 'booking_flagged', 'review_declined', 'review_for_business',
  'held_edit_published', 'held_edit_declined', 'suggestion_listed'));

create unique index notification_suggestion_listed_once on notification (subject_id) where kind = 'suggestion_listed';
