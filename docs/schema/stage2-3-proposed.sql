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

-- Files shared in a conversation. Always private storage, only the two parties
-- can open them (enforced in the application's policy layer and storage rules).
-- Localites does not read or interpret file contents. An invoice is just a file.
create table message_attachment (
  message_id      uuid not null references message(id),
  media_asset_id  uuid not null unique references media_asset(id),  -- a file belongs to one message
  primary key (message_id, media_asset_id)
);

create function enforce_attachment_rules() returns trigger
language plpgsql as $$
declare
  a media_asset%rowtype;
  m message%rowtype;
begin
  select * into strict a from media_asset where id = new.media_asset_id;
  select * into strict m from message where id = new.message_id;
  if a.bucket <> 'private' then
    raise exception 'files shared in conversations must be stored privately';
  end if;
  if a.uploaded_by is distinct from m.author_user_id then
    raise exception 'a file can only be attached by the person who uploaded it';
  end if;
  if (select count(*) from message_attachment x where x.message_id = new.message_id) >= 5 then
    raise exception 'a message can have at most 5 files';
  end if;
  return new;
end $$;

create trigger message_attachment_rules
  before insert on message_attachment
  for each row execute function enforce_attachment_rules();

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

create table review (
  id                 uuid primary key default gen_random_uuid(),
  event_vendor_id    uuid not null unique references event_vendor(id),  -- one review per booking
  author_user_id     uuid not null references app_user(id),
  rating             smallint not null check (rating between 1 and 5),
  body               text check (char_length(body) <= 3000),
  moderation_status  text not null default 'pending'
                     check (moderation_status in ('pending', 'published', 'rejected', 'removed')),
  moderation_reason  text,
  moderated_by       uuid references app_user(id),
  moderated_at       timestamptz,
  published_at       timestamptz,
  vendor_reply       text check (char_length(vendor_reply) <= 1500),
  vendor_replied_by  uuid references app_user(id),
  vendor_replied_at  timestamptz,
  -- Set by the database, never by the app: true if the vendor replied to the host
  -- in a Localites conversation. False shows the label "Planned outside Localites".
  planned_on_localites boolean not null default false,
  created_at         timestamptz not null default now(),
  check (moderation_status = 'pending' or (moderated_by is not null and moderated_at is not null)),
  check (moderation_status <> 'published' or published_at is not null),
  check (moderation_status not in ('rejected', 'removed') or moderation_reason is not null),
  check ((vendor_reply is null) = (vendor_replied_at is null)),
  check ((vendor_reply is null) = (vendor_replied_by is null))
);

-- [D-06, option B] Who may review: the host, for a vendor they marked booked,
-- after the event, within 60 days, if the vendor hasn't flagged the booking.
-- A Localites conversation is not required; the database records whether there
-- was one (the vendor replied at least once), so the label can't be faked.
-- Every review starts pending and is published only by the platform team.
create function enforce_review_eligibility() returns trigger
language plpgsql as $$
declare
  ev event_vendor%rowtype;
  e  event%rowtype;
begin
  select * into strict ev from event_vendor where id = new.event_vendor_id;
  select * into strict e  from event where id = ev.event_id;

  if new.author_user_id <> e.host_user_id then
    raise exception 'only the person who planned the event can review a vendor booked for it';
  end if;
  if ev.status <> 'booked' then
    raise exception 'a vendor can only be reviewed after being marked as booked';
  end if;
  if e.status = 'cancelled' then
    raise exception 'vendors cannot be reviewed for a cancelled event';
  end if;
  if event_ends_at(e) > now() then
    raise exception 'a vendor can only be reviewed after the event has taken place';
  end if;
  if now() > event_ends_at(e) + interval '60 days' then
    raise exception 'the 60-day window to review this booking has closed';
  end if;
  if ev.vendor_flagged_at is not null and ev.flag_outcome is distinct from 'booking_stands' then
    raise exception 'the business has said this booking is not real; it can be reviewed only if the platform team confirms it';
  end if;
  new.planned_on_localites := exists (
    select 1 from conversation c
    join message m on m.conversation_id = c.id
    where c.consumer_user_id = e.host_user_id
      and c.vendor_id = ev.vendor_id
      and m.author_side = 'vendor');
  if new.moderation_status <> 'pending' then
    raise exception 'new reviews start as pending until the platform team checks them';
  end if;
  return new;
end $$;

create trigger review_eligibility
  before insert on review
  for each row execute function enforce_review_eligibility();

-- After the platform team's check, the consumer's words are fixed. Localites never
-- edits a review; it only publishes, rejects, or removes it. The vendor gets one
-- reply, on a published review, written by an owner or manager.
create function enforce_review_changes() returns trigger
language plpgsql as $$
declare
  vendor_of_review uuid;
begin
  if new.event_vendor_id <> old.event_vendor_id or new.author_user_id <> old.author_user_id then
    raise exception 'a review cannot be moved to another booking or author';
  end if;
  if new.planned_on_localites <> old.planned_on_localites then
    raise exception 'whether a booking was planned on Localites is recorded by the database and cannot be changed';
  end if;
  if old.moderation_status <> 'pending'
     and (new.rating <> old.rating or new.body is distinct from old.body) then
    raise exception 'a review cannot be changed after it has been checked';
  end if;
  if old.vendor_reply is not null and new.vendor_reply is distinct from old.vendor_reply then
    raise exception 'a business can reply to a review only once';
  end if;
  if new.vendor_reply is not null and old.vendor_reply is null then
    if new.moderation_status <> 'published' then
      raise exception 'a business can only reply to a published review';
    end if;
    select ev.vendor_id into vendor_of_review from event_vendor ev where ev.id = new.event_vendor_id;
    if not exists (select 1 from vendor_member m
                   where m.vendor_id = vendor_of_review and m.user_id = new.vendor_replied_by
                     and m.role in ('owner', 'manager') and m.ended_at is null) then
      raise exception 'only the business''s owner or a manager can reply to a review';
    end if;
  end if;
  return new;
end $$;

create trigger review_changes
  before update on review
  for each row execute function enforce_review_changes();

-- Calculated, never typed in. The average appears only from 3 published reviews.
create view vendor_rating_summary as
select ev.vendor_id,
       count(*)::int as review_count,
       case when count(*) >= 3 then round(avg(r.rating), 1) end as average_rating
from review r
join event_vendor ev on ev.id = r.event_vendor_id
where r.moderation_status = 'published'
group by ev.vendor_id;

-- =============================================================================
-- ACCESS CONTROL  (second lock — see ADR-004)
-- =============================================================================
-- As in Stage 1: row-level security on, no access for browser-facing roles.
-- Stage 2 also adds per-request ownership rules for app_server on the most
-- private tables, so that even a bug in the application's permission check cannot
-- expose another person's events or conversations. Events and plans have them
-- (0012, ADR-031: who is acting, in the database); conversation, message and
-- message_attachment get theirs, the same way, when they are built.

do $$
declare t text;
begin
  foreach t in array array[
    'message_attachment',
    'review_request', 'review'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;
