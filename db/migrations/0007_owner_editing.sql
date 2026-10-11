-- =============================================================================
-- Localites — migration 0007: owners edit their own listing (D-34, ADR-029)
-- =============================================================================
-- Owners' edits go live at once; the team gets one note a day listing them, an
-- immediate "check now" email for a new website or phone, and can undo any save.
--   1. owner_change: the team's review state for each owner save (in a daily note yet?
--      alerted? undone?). What changed, before and after, lives only in audit_log (the
--      one record of changes); this table never repeats it and can't rewrite it.
--   2. team_digest: one row per day for the daily note, so it's sent at most once and a
--      failed send is retried.
--   3. notification: two more kinds of email to a person.
-- Not destructive: two new tables; one constraint widened.
-- =============================================================================

set search_path = public, extensions;

-- 2. Daily note ------------------------------------------------------------------
create table team_digest (
  day             date primary key,              -- the date in Toronto: at most one note a day
  status          text not null check (status in ('sending', 'sent', 'failed', 'empty')),
  change_count    int not null default 0 check (change_count >= 0),
  started_at      timestamptz not null default now(),
  sent_at         timestamptz,
  failure_reason  text check (char_length(failure_reason) <= 300),
  check ((status = 'sent') = (sent_at is not null)),
  check (status <> 'failed' or failure_reason is not null),
  check (status <> 'empty' or change_count = 0)
);

-- 1. Owner saves --------------------------------------------------------------------
create table owner_change (
  audit_id       uuid primary key references audit_log(id),
  vendor_id      uuid not null references vendor(id),
  -- What made this save worth a "check now" email: a new website or phone.
  flags          text[] not null default '{}' check (flags <@ array['website', 'phone']::text[]),
  alert_status   text not null default 'none' check (alert_status in ('none', 'sent', 'failed', 'skipped')),
  alert_error    text check (char_length(alert_error) <= 300),
  digest_day     date references team_digest(day),
  undone_at      timestamptz,
  undone_by      uuid references app_user(id),
  undo_audit_id  uuid references audit_log(id),
  created_at     timestamptz not null default now(),
  check (alert_status <> 'failed' or alert_error is not null),
  check (cardinality(flags) > 0 or alert_status = 'none'),
  check (num_nulls(undone_at, undone_by, undo_audit_id) in (0, 3))
);
-- Ids are time-ordered (uuidv7), so ordering by audit_id is ordering by time.
create index owner_change_vendor on owner_change (vendor_id, audit_id);
create index owner_change_pending on owner_change (audit_id) where digest_day is null;

-- 3. More kinds of email to a person ------------------------------------------------
alter table notification drop constraint notification_kind_check;
alter table notification add constraint notification_kind_check check (kind in (
  'claim_received', 'claim_decision', 'listing_change_undone', 'owner_removed',
  -- Stage 2 and 3 (docs/schema/stage2-3-proposed.sql):
  'new_message', 'marked_booked', 'booking_unmarked', 'review_request',
  'review_reminder', 'review_published', 'review_reply', 'vendor_joined'));

-- Access: the app role only, same rules as every other table (ADR-004).
do $$
declare t text;
begin
  foreach t in array array['team_digest', 'owner_change'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy app_server_all on %I to app_server using (true) with check (true)', t);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on team_digest, owner_change from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on team_digest, owner_change from authenticated;
  end if;
end $$;

grant select, insert, update on team_digest to app_server;
-- A save's record can only be marked (noted, alerted, undone): never re-pointed or deleted.
grant select, insert on owner_change to app_server;
grant update (alert_status, alert_error, digest_day, undone_at, undone_by, undo_audit_id) on owner_change to app_server;
