-- =============================================================================
-- Localites — PROPOSED Stage 2–3 schema: the consumer–vendor handshake and reviews
-- =============================================================================
-- STATUS: the event-plan part is BUILT (migration 0012), inquiries (0021), and
-- conversations and messages (0023). The file, report and review parts below are still a
-- PROPOSAL FOR REVIEW, NOT APPLIED TO ANY DATABASE. Applies on top of migrations 0001–0023.
--
-- What this models (see docs/roles-and-relationships.md):
--   * A consumer plans an event and adds vendors to it (considering -> booked).
--     "Booked" is the consumer's own record; only the consumer sets it.
--   * A consumer and a claimed vendor talk in a conversation, sharing messages
--     and files. Only the consumer can start it; vendors reply.
--   * After a booked event has taken place, Localites asks the consumer how it went.
--     The answer becomes a review, published after a check by the platform team.
--   * Localites never handles money. There are no payment, transaction, or balance
--     fields anywhere in this schema.
--
-- Rules marked [D-xx] follow a recommendation awaiting the product owner's
-- decision, and change if that decision goes the other way.
-- =============================================================================

-- EVENTS: now in db/migrations/0012_event_plans.sql (event_type, event, event_private,
-- event_vendor, saved_vendor, with per-person rules). What follows reads them as built.

-- =============================================================================
-- THE HANDSHAKE: conversations, messages, files
-- =============================================================================

-- CONVERSATIONS AND MESSAGES: now in db/migrations/0023_conversations.sql (conversation,
-- message, conversation_read, with per-side rules: ADR-031). What follows reads them as built.

-- FILES IN CONVERSATIONS: now in db/migrations/0028_conversation_files.sql (conversation_file:
-- one photo or PDF per message, in a private storage folder, read by the same two sides as the
-- messages; the team only through a report).

-- INQUIRIES: now in db/migrations/0021_inquiries.sql (vendor_interest, with per-person
-- rules, the team email's status and the "told it joined" mark; ADR-024).

-- =============================================================================
-- SAFETY & NOTIFICATIONS
-- =============================================================================

-- REPORTS: now in db/migrations/0024_reports.sql (moderation_report, for conversations and
-- messages; listing and review reports come with Stage 3).

-- Every email Localites sends, with an honest status: the `notification` table now
-- exists from migration 0004 (Stage 1 claim emails), with these Stage 2 and 3 kinds
-- already allowed: new_message, marked_booked, booking_unmarked, review_request,
-- review_reminder, review_published, review_reply, vendor_joined.

-- =============================================================================
-- FEEDBACK & REVIEWS
-- =============================================================================

-- "How was [Vendor]?" One per booked vendor on an event.
create table review_request (
  id               uuid primary key default gen_random_uuid(),
  event_vendor_id  uuid not null unique references event_vendor(id),
  status           text not null default 'scheduled'
                   check (status in ('scheduled', 'sent', 'completed', 'expired', 'cancelled')),
  scheduled_for    timestamptz not null,       -- the morning after the event
  sent_at          timestamptz,
  reminded_at      timestamptz,
  completed_at     timestamptz,
  expires_at       timestamptz not null,       -- 60 days after the event
  created_at       timestamptz not null default now(),
  check (status <> 'sent' or sent_at is not null),
  check ((status = 'completed') = (completed_at is not null)),
  check (reminded_at is null or sent_at is not null),
  check (expires_at > scheduled_for)
);

create function enforce_review_request_booked() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from event_vendor ev
                 where ev.id = new.event_vendor_id and ev.status = 'booked') then
    raise exception 'feedback is only requested for vendors marked as booked';
  end if;
  return new;
end $$;

create trigger review_request_booked
  before insert on review_request
  for each row execute function enforce_review_request_booked();

-- REVIEWS: now in db/migrations/0031_reviews.sql (review, with per-side rules, the public's
-- published_reviews() and vendor_rating(), D-06 and D-48). Still proposed here: the
-- "How was it?" request below (part 2).

-- =============================================================================
-- ACCESS CONTROL  (second lock — see ADR-004)
-- =============================================================================
-- As in Stage 1: row-level security on, no access for browser-facing roles.
-- Stage 2 also adds per-request ownership rules for app_server on the most
-- private tables, so that even a bug in the application's permission check cannot
-- expose another person's events or conversations. Events and plans have them
-- (0012, ADR-031: who is acting, in the database); so do conversations, messages and their
-- files (0023, 0028).

do $$
declare t text;
begin
  foreach t in array array[
    'review_request'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;
