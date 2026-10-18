-- =============================================================================
-- Localites — migration 0036: words checked before they show (D-50)
-- =============================================================================
-- The product owner (17 October 2026): a system reviews what business owners write and, if it
-- finds inappropriate or offensive language, pauses the update and emails the team. Chosen:
-- a word list plus Cloudflare's AI checker (free daily allowance; the word list alone if it's
-- unavailable), the whole save held, and reviews included.
--   1. owner_edit_hold: an owner's save the checker flagged. Nothing in it is live; the team
--      puts it live (the save is then made as the owner's, as if just saved) or declines it
--      with a reason. One waiting at a time per business; the owner can withdraw it.
--   2. review.language_flag: what the checker found in a review (reviews already wait for the
--      team, D-06). Set with the words, while the review waits; only for the team to see.
--   3. review.reply_held_*: a business's reply the checker flagged is kept off the business
--      page until the team puts it live (or removes it, as before).
--   4. notification: two more kinds of email to a person.
--
-- Not destructive: a new table, new columns (empty for what exists), a replaced read function
-- with the same answer for every reply not held.
-- =============================================================================

set search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- 1. Owners' saves held for the team
-- -----------------------------------------------------------------------------
create table owner_edit_hold (
  id                 uuid primary key default gen_random_uuid(),
  vendor_id          uuid not null references vendor(id),
  user_id            uuid not null references app_user(id),           -- who saved it
  base               jsonb not null check (jsonb_typeof(base) = 'object'),        -- what their page had loaded
  submitted          jsonb not null check (jsonb_typeof(submitted) = 'object'),   -- what they saved
  changes            jsonb not null check (jsonb_typeof(changes) = 'object'),     -- field by field, for the team
  flag_reason        text not null check (char_length(btrim(flag_reason)) between 1 and 500),
  status             text not null default 'waiting' check (status in ('waiting', 'published', 'declined', 'withdrawn')),
  decided_by         uuid references app_user(id),
  decided_at         timestamptz,
  decision_reason    text check (char_length(btrim(decision_reason)) between 1 and 1000),
  team_email_status  text not null default 'pending' check (team_email_status in ('pending', 'sent', 'failed', 'skipped')),
  created_at         timestamptz not null default now(),
  check ((status = 'waiting') = (decided_at is null)),
  check (status not in ('published', 'declined') or decided_by is not null),
  check (status <> 'declined' or decision_reason is not null)
);
create unique index owner_edit_hold_one_waiting on owner_edit_hold (vendor_id) where status = 'waiting';
create index owner_edit_hold_vendor on owner_edit_hold (vendor_id, created_at desc);
create index owner_edit_hold_day on owner_edit_hold (created_at) where team_email_status = 'sent';
comment on table owner_edit_hold is
  'An owner''s save that the language check flagged (D-50): not live until the team puts it live; or declined, or withdrawn.';

-- Decisions are final, and the database sets when.
create function owner_edit_hold_rules() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
begin
  if (new.vendor_id, new.user_id, new.base, new.submitted, new.changes, new.flag_reason, new.created_at)
       is distinct from (old.vendor_id, old.user_id, old.base, old.submitted, old.changes, old.flag_reason, old.created_at) then
    raise exception 'a held change can''t be rewritten' using errcode = 'LP100';
  end if;
  if new.status is distinct from old.status then
    if old.status <> 'waiting' then
      raise exception 'that change has already been dealt with' using errcode = 'LP171';
    end if;
    new.decided_at := now();
    if new.status = 'withdrawn' then
      new.decided_by := null; new.decision_reason := null;
    end if;
  elsif (new.decided_by, new.decision_reason, new.decided_at) is distinct from (old.decided_by, old.decision_reason, old.decided_at) then
    raise exception 'that can''t be changed' using errcode = 'LP100';
  end if;
  return new;
end $$;
create trigger owner_edit_hold_rules before update on owner_edit_hold
  for each row execute function owner_edit_hold_rules();

-- Like owner_change (0007): reached by the owner's editing (ownership checked in the same
-- query, ADR-029) and by the team's pages after the team gate.
alter table owner_edit_hold enable row level security;
alter table owner_edit_hold force row level security;
create policy app_server_all on owner_edit_hold to app_server using (true) with check (true);
grant select, insert (id, vendor_id, user_id, base, submitted, changes, flag_reason) on owner_edit_hold to app_server;
grant update (status, decided_by, decision_reason, team_email_status) on owner_edit_hold to app_server;

-- -----------------------------------------------------------------------------
-- 2 and 3. Reviews and replies
-- -----------------------------------------------------------------------------
alter table review add column language_flag text check (char_length(btrim(language_flag)) between 1 and 500);
alter table review add column reply_held_reason text check (char_length(btrim(reply_held_reason)) between 1 and 500);
alter table review add column reply_held_at timestamptz;
alter table review add constraint review_reply_held_check check ((reply_held_at is null) = (reply_held_reason is null));
alter table review add constraint review_reply_held_has_reply check (reply_held_at is null or vendor_reply is not null);

-- Runs before review_rules (0031), which still decides everything else.
create function review_language_rules() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
declare
  v_side text := acting_side();
begin
  if tg_op = 'INSERT' then
    new.reply_held_reason := null; new.reply_held_at := null;
    return new;
  end if;
  -- The check's finding on a review: the author's words, so only with them, while it waits.
  if new.language_flag is distinct from old.language_flag
     and (v_side is distinct from 'person' or old.status <> 'pending' or old.author_user_id is distinct from acting_user()) then
    raise exception 'that can''t be changed' using errcode = 'LP100';
  end if;
  if (new.reply_held_reason, new.reply_held_at) is distinct from (old.reply_held_reason, old.reply_held_at) then
    if v_side = 'business' and old.vendor_reply is null and new.vendor_reply is not null and old.reply_held_at is null then
      -- Held as the reply is written: the database sets when.
      new.reply_held_at := case when new.reply_held_reason is null then null else now() end;
    elsif acting_as_team() and old.reply_held_at is not null and new.reply_held_reason is null then
      -- The team puts it live.
      new.reply_held_at := null;
    else
      raise exception 'that can''t be changed' using errcode = 'LP100';
    end if;
  end if;
  return new;
end $$;
create trigger review_language_rules before insert or update on review
  for each row execute function review_language_rules();

grant insert (language_flag) on review to app_server;
grant update (language_flag, reply_held_reason, reply_held_at) on review to app_server;

-- The business page's reviews: a held reply isn't shown (otherwise as 0031).
create or replace function published_reviews(p_vendor uuid, p_limit int default 50)
returns table (id uuid, rating smallint, body text, author text, living_local boolean, event_month date,
               planned_on_localites boolean, published_at timestamptz, reply text, replied_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select r.id, r.rating, r.body, reviewer_name(r.author_user_id),
         r.author_user_id in (select user_id from living_local_reviewers()),
         date_trunc('month', r.event_date)::date, r.planned_on_localites, r.published_at,
         case when r.reply_removed_at is null and r.reply_held_at is null then r.vendor_reply end,
         case when r.reply_removed_at is null and r.reply_held_at is null then r.vendor_replied_at end
  from review r join vendor v on v.id = r.vendor_id
  where r.vendor_id = p_vendor and r.status = 'published' and v.listing_status = 'published'
  order by r.published_at desc
  limit least(greatest(p_limit, 0), 200)
$$;

-- -----------------------------------------------------------------------------
-- 4. Emails to the owner about their held save
-- -----------------------------------------------------------------------------
alter table notification drop constraint notification_kind_check;
alter table notification add constraint notification_kind_check check (kind in (
  'claim_received', 'claim_decision', 'listing_change_undone', 'owner_removed', 'new_message', 'marked_booked',
  'booking_unmarked', 'review_request', 'review_reminder', 'review_published', 'review_reply', 'vendor_joined',
  'booked_event_cancelled', 'booked_event_changed', 'booking_flagged', 'review_declined', 'review_for_business',
  'held_edit_published', 'held_edit_declined'));

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on owner_edit_hold from %I', r);
    end if;
  end loop;
end $$;
