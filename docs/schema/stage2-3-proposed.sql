-- =============================================================================
-- Localites — PROPOSED Stage 2–3 schema: the consumer–vendor handshake and reviews
-- =============================================================================
-- STATUS: PROPOSAL FOR REVIEW. NOT APPLIED TO ANY DATABASE.
-- Applies on top of stage1-proposed.sql.
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

-- =============================================================================
-- EVENTS
-- =============================================================================

create table event_type (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  name        text not null,
  is_active   boolean not null default true,
  sort_order  int not null default 0
);

create table event (
  id                    uuid primary key default gen_random_uuid(),
  host_user_id          uuid not null references app_user(id),   -- the consumer
  event_type_id         uuid not null references event_type(id),
  title                 text not null check (char_length(title) between 1 and 120),
  event_date            date not null,
  start_time            time,
  end_time              time,
  timezone              text not null default 'America/Toronto'
                        check (timezone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$'),
  municipality_id       uuid references municipality(id),
  venue_note            text check (char_length(venue_note) <= 200),
  guest_count_estimate  int check (guest_count_estimate between 1 and 5000),
  age_range_min         smallint check (age_range_min between 0 and 120),
  age_range_max         smallint check (age_range_max between 0 and 120),
  budget_cents          int check (budget_cents >= 0),     -- the consumer's private planning figure
  notes                 text check (char_length(notes) <= 5000),
  status                text not null default 'planning'
                        check (status in ('planning', 'cancelled', 'archived')),
  cancelled_at          timestamptz,
  archived_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (age_range_min is null or age_range_max is null or age_range_min <= age_range_max),
  check (status <> 'cancelled' or cancelled_at is not null),
  check (status <> 'archived' or archived_at is not null)
);
create trigger event_updated before update on event
  for each row execute function set_updated_at();
create index event_host on event (host_user_id, event_date);

-- When an event is over: its end time if given (next day if it runs past
-- midnight), otherwise the end of its date, in the event's own time zone.
-- "Completed" is never stored; it is a fact calculated from the date.
create function event_ends_at(e event) returns timestamptz
language sql stable as $$
  select ((e.event_date
           + case when e.end_time is not null and e.start_time is not null
                       and e.end_time < e.start_time then 1 else 0 end)
          + coalesce(e.end_time, time '23:59:59')) at time zone e.timezone
$$;

-- A vendor on a consumer's event plan. Only the consumer sets the status.
create table event_vendor (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null references event(id),
  vendor_id          uuid not null references vendor(id),
  status             text not null default 'considering'
                     check (status in ('considering', 'booked', 'removed')),
  booked_at          timestamptz,
  removed_at         timestamptz,
  -- The vendor's side: "this isn't a real booking" (protects review integrity).
  vendor_flagged_at  timestamptz,
  vendor_flag_note   text check (char_length(vendor_flag_note) <= 1000),
  flag_resolved_at   timestamptz,
  flag_outcome       text check (flag_outcome in ('booking_stands', 'booking_not_real')),
  added_by           uuid not null references app_user(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (event_id, vendor_id),
  check ((status = 'booked') = (booked_at is not null)),
  check ((status = 'removed') = (removed_at is not null)),
  check ((flag_resolved_at is null) = (flag_outcome is null)),
  check (flag_resolved_at is null or vendor_flagged_at is not null)
);
create trigger event_vendor_updated before update on event_vendor
  for each row execute function set_updated_at();
create index event_vendor_by_vendor on event_vendor (vendor_id, status);

create function enforce_event_vendor_owner() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and (new.event_id <> old.event_id or new.vendor_id <> old.vendor_id) then
    raise exception 'an event-vendor link cannot be moved to another event or vendor';
  end if;
  if not exists (select 1 from event e where e.id = new.event_id and e.host_user_id = new.added_by) then
    raise exception 'only the person planning the event can add vendors to it';
  end if;
  return new;
end $$;

create trigger event_vendor_owner
  before insert or update on event_vendor
  for each row execute function enforce_event_vendor_owner();

-- =============================================================================
-- THE HANDSHAKE: conversations, messages, files
-- =============================================================================

create table conversation (
  id                uuid primary key default gen_random_uuid(),
  consumer_user_id  uuid not null references app_user(id),
  vendor_id         uuid not null references vendor(id),
  event_id          uuid references event(id),     -- optional; can be linked later
  status            text not null default 'open'
                    check (status in ('open', 'blocked_by_consumer', 'blocked_by_vendor')),
  blocked_at        timestamptz,
  last_message_at   timestamptz,
  created_at        timestamptz not null default now(),
  check ((status = 'open') = (blocked_at is null))
);
create unique index conversation_general_once
  on conversation (consumer_user_id, vendor_id) where event_id is null;
create unique index conversation_event_once
  on conversation (consumer_user_id, vendor_id, event_id) where event_id is not null;
create index conversation_for_vendor on conversation (vendor_id, last_message_at desc);
create index conversation_for_consumer on conversation (consumer_user_id, last_message_at desc);

create function enforce_conversation_parties() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.consumer_user_id <> old.consumer_user_id or new.vendor_id <> old.vendor_id then
      raise exception 'the people in a conversation cannot be changed';
    end if;
    if old.event_id is not null and new.event_id is distinct from old.event_id then
      raise exception 'a conversation already linked to an event cannot be moved to another';
    end if;
  end if;

  if tg_op = 'INSERT' then
    -- [D-05] Messaging is only possible with businesses that have claimed their listing.
    if not exists (select 1 from vendor v
                   where v.id = new.vendor_id and v.claim_status = 'claimed'
                     and v.listing_status <> 'archived') then
      raise exception 'this business has not joined Localites yet, so it cannot receive messages';
    end if;
    if exists (select 1 from vendor_member m
               where m.vendor_id = new.vendor_id and m.user_id = new.consumer_user_id
                 and m.ended_at is null) then
      raise exception 'you cannot start a conversation with your own business';
    end if;
  end if;

  if new.event_id is not null and not exists (
       select 1 from event e where e.id = new.event_id and e.host_user_id = new.consumer_user_id) then
    raise exception 'a conversation can only be about the consumer''s own event';
  end if;
  return new;
end $$;

create trigger conversation_parties
  before insert or update of consumer_user_id, vendor_id, event_id on conversation
  for each row execute function enforce_conversation_parties();

create table message (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversation(id),
  author_user_id   uuid not null references app_user(id),
  author_side      text not null check (author_side in ('consumer', 'vendor')),
  body             text not null default '' check (char_length(body) <= 5000),
  created_at       timestamptz not null default now(),
  removed_at       timestamptz          -- author removed it; shown as "message removed"
);
create index message_in_conversation on message (conversation_id, created_at);

create function enforce_message_author() returns trigger
language plpgsql as $$
declare
  c conversation%rowtype;
begin
  select * into strict c from conversation where id = new.conversation_id;

  if c.status <> 'open' then
    raise exception 'this conversation has been blocked, so no new messages can be sent';
  end if;

  if new.author_side = 'consumer' then
    if new.author_user_id <> c.consumer_user_id then
      raise exception 'only the consumer in this conversation can write as the consumer';
    end if;
  else
    if not exists (select 1 from vendor_member m
                   where m.vendor_id = c.vendor_id and m.user_id = new.author_user_id
                     and m.ended_at is null) then
      raise exception 'only a current member of this business''s team can write as the business';
    end if;
    -- [D-13 R1] Vendors reply; they never start conversations.
    if not exists (select 1 from message m
                   where m.conversation_id = c.id and m.author_side = 'consumer') then
      raise exception 'businesses can reply to a conversation but cannot start one';
    end if;
  end if;

  update conversation set last_message_at = new.created_at where id = c.id;
  return new;
end $$;

create trigger message_author
  before insert on message
  for each row execute function enforce_message_author();

-- Messages can be removed by their author, never rewritten.
create function enforce_message_immutable() returns trigger
language plpgsql as $$
begin
  if new.body <> old.body or new.author_user_id <> old.author_user_id
     or new.author_side <> old.author_side or new.conversation_id <> old.conversation_id
     or new.created_at <> old.created_at then
    raise exception 'messages cannot be edited, only removed';
  end if;
  if old.removed_at is not null and new.removed_at is distinct from old.removed_at then
    raise exception 'a removed message stays removed';
  end if;
  return new;
end $$;

create trigger message_immutable
  before update on message
  for each row execute function enforce_message_immutable();

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

-- Each person's own unread position. Private to them: this is an unread
-- count, not a read receipt, and is never shown to the other side.
create table conversation_read_marker (
  conversation_id  uuid not null references conversation(id),
  user_id          uuid not null references app_user(id),
  last_read_at     timestamptz not null,
  primary key (conversation_id, user_id)
);

-- A consumer who wanted to message a business that hasn't joined Localites.
-- Used to (truthfully) invite the business, and to tell the consumer when it joins.
create table vendor_interest (
  vendor_id           uuid not null references vendor(id),
  user_id             uuid not null references app_user(id),
  created_at          timestamptz not null default now(),
  notified_joined_at  timestamptz,
  primary key (vendor_id, user_id)
);

-- =============================================================================
-- SAFETY & NOTIFICATIONS
-- =============================================================================

create table moderation_report (
  id                uuid primary key default gen_random_uuid(),
  reporter_user_id  uuid not null references app_user(id),
  subject_type      text not null check (subject_type in ('message', 'conversation', 'review', 'vendor')),
  subject_id        uuid not null,
  reason            text not null
                    check (reason in ('spam', 'harassment', 'scam_or_fraud', 'inappropriate', 'other')),
  details           text check (char_length(details) <= 2000),
  status            text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  reviewed_by       uuid references app_user(id),
  reviewed_at       timestamptz,
  decision_note     text,
  created_at        timestamptz not null default now(),
  check ((status = 'open') = (reviewed_at is null)),
  check (status = 'open' or reviewed_by is not null)
);
create index moderation_report_open on moderation_report (created_at) where status = 'open';

-- Every email Localites sends, with an honest status: "sent" only once the
-- provider accepted it.
create table notification (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references app_user(id),
  kind            text not null check (kind in (
                    'new_message', 'marked_booked', 'booking_unmarked', 'review_request',
                    'review_reminder', 'review_published', 'review_reply', 'vendor_joined',
                    'claim_decision')),
  subject_type    text not null,
  subject_id      uuid not null,
  channel         text not null default 'email' check (channel in ('email')),
  status          text not null default 'queued'
                  check (status in ('queued', 'sent', 'failed', 'suppressed')),
  sent_at         timestamptz,
  failure_reason  text,
  created_at      timestamptz not null default now(),
  check ((status = 'sent') = (sent_at is not null)),
  check (status <> 'failed' or failure_reason is not null)
);
create index notification_queued on notification (created_at) where status = 'queued';

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
  created_at         timestamptz not null default now(),
  check (moderation_status = 'pending' or (moderated_by is not null and moderated_at is not null)),
  check (moderation_status <> 'published' or published_at is not null),
  check (moderation_status not in ('rejected', 'removed') or moderation_reason is not null),
  check ((vendor_reply is null) = (vendor_replied_at is null)),
  check ((vendor_reply is null) = (vendor_replied_by is null))
);

-- [D-06] Who may review: the host, for a vendor they marked booked, after the
-- event, within 60 days, if the vendor hasn't flagged the booking, and if the
-- two exchanged messages on Localites (the vendor replied at least once).
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
  if not exists (select 1 from conversation c
                 join message m on m.conversation_id = c.id
                 where c.consumer_user_id = e.host_user_id
                   and c.vendor_id = ev.vendor_id
                   and m.author_side = 'vendor') then
    raise exception 'a vendor can only be reviewed after you have exchanged messages with them on Localites';
  end if;
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
-- private tables (event, conversation, message, message_attachment), so that
-- even a bug in the application's permission check cannot expose another
-- person's events or conversations. Those policies are written with the
-- Stage 2 code, because they depend on how the server passes the acting user.

do $$
declare t text;
begin
  foreach t in array array[
    'event_type', 'event', 'event_vendor', 'conversation', 'message',
    'message_attachment', 'conversation_read_marker', 'vendor_interest',
    'moderation_report', 'notification', 'review_request', 'review'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;
