-- =============================================================================
-- Localites — migration 0031: reviews (Stage 3, part 1)
-- =============================================================================
-- D-06 (option B), D-19, D-48, ADR-026, E §4.4 and §4.5. A person reviews a business they
-- marked booked on their own event, once the event has happened, within 60 days, unless the
-- business flagged the booking (and the team didn't confirm it). Every review waits for the
-- Localites team to publish or decline it. Once published, the business's owner or a
-- manager can reply once. The average shows only from 3 published reviews.
--
--   person side    writes their own reviews (one per booking), changes one while it waits,
--                  reads their own (any status);
--   business side  anyone on the team reads its published reviews; owners and managers
--                  reply once;
--   team           reads every review; publishes or declines a waiting one (with a reason
--                  for declining), removes a published one or its reply (with a reason);
--   the public     published reviews of a listed business, through published_reviews():
--                  the author as "Sarah M." (D-48), never more about them.
--
-- A review outlives the booking it came from (deleting an account deletes its events,
-- 0014): it keeps its business, its event's date, and its author (shown as "A Localites
-- member" once they've deleted their account). A waiting review of a deleted account is
-- withdrawn.
--
-- Not destructive: new tables, functions and rules; two more kinds of email. To undo: a
-- later migration drops them.
-- =============================================================================

set search_path = public, extensions;

create table review (
  id                    uuid primary key default gen_random_uuid(),
  event_vendor_id       uuid unique references event_vendor(id) on delete set null,  -- one review per booking
  vendor_id             uuid not null references vendor(id),
  author_user_id        uuid not null references app_user(id),
  event_date            date not null,             -- when the event was (its month is shown)
  rating                smallint not null check (rating between 1 and 5),
  body                  text not null check (char_length(btrim(body)) between 1 and 3000),
  status                text not null default 'pending'
                        check (status in ('pending', 'published', 'declined', 'removed', 'withdrawn')),
  decision_reason       text check (char_length(btrim(decision_reason)) between 1 and 1000),
  decided_by            uuid references app_user(id),
  decided_at            timestamptz,
  published_at          timestamptz,
  vendor_reply          text check (char_length(btrim(vendor_reply)) between 1 and 1500),
  vendor_replied_by     uuid references app_user(id),
  vendor_replied_at     timestamptz,
  reply_removed_at      timestamptz,
  reply_removed_reason  text check (char_length(btrim(reply_removed_reason)) between 1 and 1000),
  planned_on_localites  boolean not null default false,   -- set by the database (D-06)
  team_email_status     text not null default 'pending' check (team_email_status in ('pending', 'sent', 'failed')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check ((status = 'pending') = (decided_at is null) or status = 'withdrawn'),
  check (status <> 'published' or published_at is not null),
  check (status not in ('declined', 'removed') or decision_reason is not null),
  check ((vendor_reply is null) = (vendor_replied_at is null)),
  check ((vendor_reply is null) = (vendor_replied_by is null)),
  check ((reply_removed_at is null) = (reply_removed_reason is null)),
  check (reply_removed_at is null or vendor_reply is not null)
);
create index review_for_vendor on review (vendor_id, published_at desc) where status = 'published';
create index review_waiting on review (created_at) where status = 'pending';
create index review_by_author on review (author_user_id, created_at);
comment on table review is
  'A person''s review of a business they booked (D-06). Waits for the team; public once published, with the business''s one reply.';

-- -----------------------------------------------------------------------------
-- 1. WHO MAY REVIEW (E §4.5)
-- -----------------------------------------------------------------------------
create function enforce_review_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
declare
  ev record;
  v_side text := acting_side();
begin
  if tg_op = 'UPDATE' and (new.id <> old.id or new.vendor_id <> old.vendor_id or new.author_user_id <> old.author_user_id
                           or new.event_date <> old.event_date or new.created_at <> old.created_at
                           or new.planned_on_localites <> old.planned_on_localites
                           or (new.event_vendor_id is distinct from old.event_vendor_id and new.event_vendor_id is not null)) then
    raise exception 'that can''t be changed' using errcode = 'LP100';
  end if;
  -- The booking is gone (unmarked, or its event deleted): a review still waiting goes too.
  if tg_op = 'UPDATE' and old.event_vendor_id is not null and new.event_vendor_id is null and old.status = 'pending' then
    new.status := 'withdrawn';
  end if;
  if current_user <> 'app_server' then
    new.updated_at := now();
    return new;                                                   -- owner path (functions)
  end if;

  if tg_op = 'INSERT' then
    if v_side is distinct from 'person' or new.author_user_id is distinct from acting_user() then
      raise exception 'only you can review in your own name' using errcode = 'LP101';
    end if;
    -- The booking and its event, as the person may see them (their own only).
    select x.id, x.status, x.vendor_id, x.booked_at, x.vendor_flagged_at, x.flag_outcome,
           e.event_date, e.status as event_status, event_ends_at(e) as ends
    into ev
    from event_vendor x join event e on e.id = x.event_id
    where x.id = new.event_vendor_id;
    if not found then
      raise exception 'only the person who planned the event can review a business booked for it' using errcode = 'LP101';
    end if;
    if ev.status <> 'booked' then
      raise exception 'a business can only be reviewed once it''s marked booked' using errcode = 'LP150';
    end if;
    if ev.event_status = 'cancelled' then
      raise exception 'businesses can''t be reviewed for a cancelled event' using errcode = 'LP150';
    end if;
    if ev.ends > now() then
      raise exception 'a business can be reviewed once the event has happened' using errcode = 'LP151';
    end if;
    if now() > ev.ends + interval '60 days' then
      raise exception 'the 60 days to review this booking have passed' using errcode = 'LP152';
    end if;
    if ev.vendor_flagged_at is not null and ev.vendor_flagged_at >= ev.booked_at
       and ev.flag_outcome is distinct from 'booking_stands' then
      raise exception 'the business says it wasn''t booked for this event' using errcode = 'LP153';
    end if;
    if exists (select 1 from vendor_member m where m.vendor_id = ev.vendor_id and m.user_id = new.author_user_id and m.ended_at is null) then
      raise exception 'you can''t review your own business' using errcode = 'LP108';
    end if;
    if not exists (select 1 from vendor v where v.id = ev.vendor_id and v.listing_status = 'published') then
      raise exception 'this business isn''t listed at the moment' using errcode = 'LP154';
    end if;
    new.vendor_id := ev.vendor_id;
    new.event_date := ev.event_date;
    new.planned_on_localites := exists (
      select 1 from conversation c join message m on m.conversation_id = c.id
      where c.consumer_user_id = new.author_user_id and c.vendor_id = ev.vendor_id and m.author_side = 'vendor');
    new.status := 'pending'; new.decision_reason := null; new.decided_by := null; new.decided_at := null;
    new.published_at := null; new.vendor_reply := null; new.vendor_replied_by := null; new.vendor_replied_at := null;
    new.reply_removed_at := null; new.reply_removed_reason := null; new.team_email_status := 'pending';
    new.created_at := now(); new.updated_at := now();
    return new;
  end if;

  -- UPDATE
  if v_side = 'person' then
    if old.author_user_id is distinct from acting_user() then
      raise exception 'only the author can change a review' using errcode = 'LP101';
    end if;
    if (new.rating, new.body) is distinct from (old.rating, old.body) and old.status <> 'pending' then
      raise exception 'a review can''t be changed once our team has looked at it' using errcode = 'LP155';
    end if;
    if new.status is distinct from old.status or new.decision_reason is distinct from old.decision_reason
       or new.vendor_reply is distinct from old.vendor_reply or new.reply_removed_at is distinct from old.reply_removed_at
       or new.reply_removed_reason is distinct from old.reply_removed_reason then
      raise exception 'that can''t be changed' using errcode = 'LP100';
    end if;
    if new.team_email_status is distinct from old.team_email_status and old.team_email_status <> 'pending' then
      raise exception 'that can''t be changed' using errcode = 'LP100';
    end if;
  elsif v_side = 'business' then
    if (new.rating, new.body, new.status, new.team_email_status, new.decision_reason)
         is distinct from (old.rating, old.body, old.status, old.team_email_status, old.decision_reason)
       or (new.reply_removed_at, new.reply_removed_reason) is distinct from (old.reply_removed_at, old.reply_removed_reason) then
      raise exception 'that can''t be changed' using errcode = 'LP100';
    end if;
    if new.vendor_reply is distinct from old.vendor_reply then
      if old.vendor_reply is not null then
        raise exception 'a business replies to a review once' using errcode = 'LP156';
      end if;
      if old.status <> 'published' or not acting_for_business() or old.vendor_id is distinct from acting_vendor() then
        raise exception 'only the business''s owner or a manager can reply to its published reviews' using errcode = 'LP101';
      end if;
      new.vendor_replied_by := acting_user(); new.vendor_replied_at := now();
    end if;
  elsif acting_as_team() then
    if (new.rating, new.body, new.vendor_reply) is distinct from (old.rating, old.body, old.vendor_reply)
       or new.team_email_status is distinct from old.team_email_status then
      raise exception 'Localites never changes what people wrote' using errcode = 'LP100';
    end if;
    if new.status is distinct from old.status then
      if (old.status, new.status) not in (('pending', 'published'), ('pending', 'declined'), ('published', 'removed')) then
        raise exception 'that change isn''t possible' using errcode = 'LP109';
      end if;
      if new.status in ('declined', 'removed') and new.decision_reason is null then
        raise exception 'say why, in a few words' using errcode = 'LP157';
      end if;
      new.decided_by := acting_user(); new.decided_at := now();
      if new.status = 'published' then new.published_at := now(); new.decision_reason := null; end if;
    elsif new.decision_reason is distinct from old.decision_reason then
      raise exception 'that can''t be changed' using errcode = 'LP100';
    end if;
    if new.reply_removed_at is not distinct from old.reply_removed_at
       and new.reply_removed_reason is distinct from old.reply_removed_reason then
      raise exception 'that can''t be changed' using errcode = 'LP100';
    end if;
    if new.reply_removed_at is distinct from old.reply_removed_at then
      if old.vendor_reply is null or old.reply_removed_at is not null or new.reply_removed_reason is null then
        raise exception 'say why, in a few words' using errcode = 'LP157';
      end if;
      new.reply_removed_at := now();
    end if;
  else
    raise exception 'no one is acting' using errcode = 'LP101';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger review_rules before insert or update on review
  for each row execute function enforce_review_rules();

-- A waiting review of someone who deletes their account is withdrawn (published ones stay,
-- as "A Localites member", E §8).
create function withdraw_reviews_of_deleted() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    update review set status = 'withdrawn' where author_user_id = new.id and status = 'pending';
  end if;
  return null;
end $$;
create trigger app_user_withdraw_reviews after update of deleted_at on app_user
  for each row execute function withdraw_reviews_of_deleted();

-- A waiting review whose booking no longer stands goes too: the person unmarked it, or the
-- event was cancelled. (A business flagging it doesn't: the team sees the flag and decides.)
create function withdraw_reviews_of_unbooked() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if tg_table_name = 'event_vendor' then
    if old.status = 'booked' and new.status <> 'booked' then
      update review set status = 'withdrawn' where event_vendor_id = new.id and status = 'pending';
    end if;
  elsif old.status <> 'cancelled' and new.status = 'cancelled' then
    update review set status = 'withdrawn'
    where status = 'pending' and event_vendor_id in (select x.id from event_vendor x where x.event_id = new.id);
  end if;
  return null;
end $$;
create trigger event_vendor_withdraw_reviews after update of status on event_vendor
  for each row execute function withdraw_reviews_of_unbooked();
create trigger event_withdraw_reviews after update of status on event
  for each row execute function withdraw_reviews_of_unbooked();

-- -----------------------------------------------------------------------------
-- 2. WHAT THE PUBLIC SEES (D-48)
-- -----------------------------------------------------------------------------
-- "Living Local": reviewers in the top 1% by published reviews, once there are 100 or more
-- reviewers (nobody before that).
create function living_local_reviewers() returns table (user_id uuid)
language sql stable security definer set search_path = public, extensions as $$
  with counts as (
    select r.author_user_id as uid, count(*) as n
    from review r join app_user u on u.id = r.author_user_id
    where r.status = 'published' and u.deleted_at is null
    group by r.author_user_id
  ), ranked as (
    -- cume_dist: the share of reviewers with at least as many reviews (ties counted in full).
    select uid, cume_dist() over (order by n desc) as share, count(*) over () as reviewers from counts
  )
  select uid from ranked where reviewers >= 100 and share <= 0.01
$$;

-- How an author is shown: "Sarah M." (first name, initial of the last); "A Localites member"
-- once they've deleted their account.
create function reviewer_name(p_user uuid) returns text
language sql stable security definer set search_path = public, extensions as $$
  select case
           when u.deleted_at is not null then 'A Localites member'
           else coalesce(nullif(btrim(u.given_name), ''), split_part(btrim(u.display_name), ' ', 1))
                || coalesce(' ' || upper(left(nullif(btrim(u.family_name), ''), 1)) || '.', '')
         end
  from app_user u where u.id = p_user
$$;

-- A listed business's published reviews, newest first: never the author's id or anything
-- else about them, nor a removed reply.
create function published_reviews(p_vendor uuid, p_limit int default 50)
returns table (id uuid, rating smallint, body text, author text, living_local boolean, event_month date,
               planned_on_localites boolean, published_at timestamptz, reply text, replied_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select r.id, r.rating, r.body, reviewer_name(r.author_user_id),
         r.author_user_id in (select user_id from living_local_reviewers()),
         date_trunc('month', r.event_date)::date, r.planned_on_localites, r.published_at,
         case when r.reply_removed_at is null then r.vendor_reply end,
         case when r.reply_removed_at is null then r.vendor_replied_at end
  from review r join vendor v on v.id = r.vendor_id
  where r.vendor_id = p_vendor and r.status = 'published' and v.listing_status = 'published'
  order by r.published_at desc
  limit least(greatest(p_limit, 0), 200)
$$;

-- The rating: how many published reviews, and the average only from 3.
create function vendor_rating(p_vendor uuid) returns table (review_count int, average numeric)
language sql stable security definer set search_path = public, extensions as $$
  select count(*)::int, case when count(*) >= 3 then round(avg(r.rating), 1) end
  from review r join vendor v on v.id = r.vendor_id
  where r.vendor_id = p_vendor and r.status = 'published' and v.listing_status = 'published'
$$;

-- For the emails after the team's decision (only the team, as it decides): the review's
-- author and business, and the business's owners and managers to tell of a published review.
create function review_for_email(p_review uuid)
returns table (author_user_id uuid, vendor_id uuid, rating smallint, decision_reason text)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not acting_as_team() then
    raise exception 'only the Localites team can do this' using errcode = 'LP101';
  end if;
  return query select r.author_user_id, r.vendor_id, r.rating, r.decision_reason from review r where r.id = p_review;
end $$;

create function review_business_contacts(p_review uuid)
returns table (id uuid, email text, name text)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not acting_as_team() then
    raise exception 'only the Localites team can do this' using errcode = 'LP101';
  end if;
  return query
  select u.id, u.email::text, coalesce(u.given_name, u.display_name)
  from review r join vendor_member m on m.vendor_id = r.vendor_id join app_user u on u.id = m.user_id
  where r.id = p_review and r.status = 'published' and m.ended_at is null and m.role in ('owner', 'manager')
    and u.deleted_at is null;
end $$;

-- -----------------------------------------------------------------------------
-- 3. ROW-LEVEL SECURITY, POLICIES, GRANTS
-- -----------------------------------------------------------------------------
alter table review enable row level security;
alter table review force row level security;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on review from %I', r);
    end if;
  end loop;
end $$;

create policy review_author on review for all to app_server
  using (acting_side() = 'person' and author_user_id = acting_user())
  with check (acting_side() = 'person' and author_user_id = acting_user());
create policy review_business_read on review for select to app_server
  using (acting_in_business() and vendor_id = acting_vendor() and status = 'published');
create policy review_business_reply on review for update to app_server
  using (acting_for_business() and vendor_id = acting_vendor() and status = 'published')
  with check (acting_for_business() and vendor_id = acting_vendor() and status = 'published');
create policy review_team on review for select to app_server using (acting_as_team());
create policy review_team_decide on review for update to app_server
  using (acting_as_team()) with check (acting_as_team());

grant select, insert (id, event_vendor_id, author_user_id, rating, body) on review to app_server;
grant update (rating, body, status, decision_reason, vendor_reply, reply_removed_at, reply_removed_reason, team_email_status)
  on review to app_server;

-- Two more kinds of email: the author told a review was declined; a business told it has a
-- new published review.
alter table notification drop constraint notification_kind_check;
alter table notification add constraint notification_kind_check check (kind in (
  'claim_received', 'claim_decision', 'listing_change_undone', 'owner_removed', 'new_message', 'marked_booked',
  'booking_unmarked', 'review_request', 'review_reminder', 'review_published', 'review_reply', 'vendor_joined',
  'booked_event_cancelled', 'booked_event_changed', 'booking_flagged', 'review_declined', 'review_for_business'));

revoke all on function withdraw_reviews_of_deleted(), withdraw_reviews_of_unbooked(), living_local_reviewers(), reviewer_name(uuid),
  published_reviews(uuid, int), vendor_rating(uuid), review_for_email(uuid), review_business_contacts(uuid) from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function living_local_reviewers(), reviewer_name(uuid), published_reviews(uuid, int), '
                     'vendor_rating(uuid), review_for_email(uuid), review_business_contacts(uuid) from %I', r);
    end if;
  end loop;
end $$;
grant execute on function reviewer_name(uuid), published_reviews(uuid, int), vendor_rating(uuid), review_for_email(uuid),
  review_business_contacts(uuid) to app_server;
