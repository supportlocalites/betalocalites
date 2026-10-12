-- =============================================================================
-- Localites — migration 0008: a "check now" email being sent (ADR-029, review of D-34)
-- =============================================================================
-- The "check now" email for an owner's new website or phone is limited to one per
-- business an hour and 20 a day. Quick saves could each pass that limit while the
-- earlier emails were still on their way. Now the email's place is taken ('sending')
-- before it goes, under one lock, and the result is recorded after ('sent' or 'failed').
-- Not destructive: one constraint widened.
-- =============================================================================

set search_path = public, extensions;

alter table owner_change drop constraint owner_change_alert_status_check;
alter table owner_change add constraint owner_change_alert_status_check
  check (alert_status in ('none', 'sending', 'sent', 'failed', 'skipped'));
