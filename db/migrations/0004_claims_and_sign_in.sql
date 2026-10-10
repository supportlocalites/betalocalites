-- =============================================================================
-- Localites — migration 0004: claiming a business, email-code sign-in (ADR-028)
-- =============================================================================
-- D-27 (one "Sign in or create an account" screen), D-32 (emailed 6-digit codes),
-- D-33 (claim checks), D-35 (first approved claim wins).
--   1. vendor_claim: how the claimant is connected to the business; a declined
--      claim must say why (the reason is emailed to them).
--   2. One active owner per business, enforced by the database (D-35).
--   3. notification: every email Localites sends a person, with an honest status
--      ("sent" only once the provider accepted it). Moved forward from the Stage 2
--      proposal (docs/schema/stage2-3-proposed.sql) with the Stage 1 kinds added.
--   4. sign_in_code_event: our own limits on sign-in codes (codes sent per address,
--      wrong guesses per code). Addresses are stored only as a SHA-256 hash, and
--      internet addresses are never stored (Cloudflare's rate limiter keeps those).
-- Not destructive: adds columns, constraints on rows that don't exist yet, tables.
-- =============================================================================

set search_path = public, extensions;

-- 1. Claims ------------------------------------------------------------------
alter table vendor_claim
  add column relationship text check (relationship in ('owner', 'manager', 'employee', 'other'));
alter table vendor_claim
  add constraint vendor_claim_declined_needs_reason check (status <> 'rejected' or decision_note is not null);
create index vendor_claim_open on vendor_claim (created_at) where status = 'submitted';
create index vendor_claim_claimant on vendor_claim (claimant_user_id, created_at);

-- 2. One active owner per business --------------------------------------------
create unique index vendor_member_one_owner on vendor_member (vendor_id) where role = 'owner' and ended_at is null;

-- 3. Emails sent to people ------------------------------------------------------
create table notification (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references app_user(id),
  kind            text not null check (kind in (
                    'claim_received', 'claim_decision',
                    -- Stage 2 and 3 (docs/schema/stage2-3-proposed.sql):
                    'new_message', 'marked_booked', 'booking_unmarked', 'review_request',
                    'review_reminder', 'review_published', 'review_reply', 'vendor_joined')),
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
create index notification_user on notification (user_id, created_at);

-- 4. Sign-in code limits ----------------------------------------------------------
create table sign_in_code_event (
  id          bigint generated always as identity primary key,
  email_hash  text not null check (email_hash ~ '^[0-9a-f]{64}$'),   -- sha256 of the lowercased address
  kind        text not null check (kind in ('sent', 'wrong_code')),
  created_at  timestamptz not null default now()
);
create index sign_in_code_event_lookup on sign_in_code_event (email_hash, created_at);
create index sign_in_code_event_age on sign_in_code_event (created_at);

-- Access: the app role, same rules as every other table (ADR-004).
do $$
declare t text;
begin
  foreach t in array array['notification', 'sign_in_code_event'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy app_server_all on %I to app_server using (true) with check (true)', t);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on notification, sign_in_code_event from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on notification, sign_in_code_event from authenticated;
  end if;
end $$;

grant select, insert, update on notification, sign_in_code_event to app_server;
-- Old code events (older than two days) are cleared as new ones arrive; nothing else is deleted.
grant delete on sign_in_code_event to app_server;
grant usage, select on all sequences in schema public to app_server;
