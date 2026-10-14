-- =============================================================================
-- Localites — migration 0032: "How was it?" emails and reporting a review (Stage 3, part 2)
-- =============================================================================
-- D-06, ADR-026, E §4.4, roadmap Stage 3.
--
--   "How was it?"  the morning after an event, its host is emailed once about the businesses
--                  they booked and haven't reviewed yet; one reminder a week later if any are
--                  still not reviewed; never after the 60 days to review. Events in the 60
--                  days before this release are asked too (oldest last). At most 20 of these
--                  emails a day across the site (the email service allows 100 a day, D-20);
--                  the rest wait for the next day. A person can turn them off on their account.
--   reports        anyone signed in can report a published review; a business can report
--                  its own. Only the team reads reports; removing the review closes them.
--
-- Not destructive: new tables, functions and rules. To undo: a later migration drops them.
-- =============================================================================

set search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- 1. A PERSON'S EMAIL CHOICES
-- -----------------------------------------------------------------------------
create table email_choice (
  user_id          uuid primary key references app_user(id),
  review_requests  boolean not null default true,   -- "How was it?" emails after their events
  updated_at       timestamptz not null default now()
);
comment on table email_choice is
  'A person''s own email choices. No row: the defaults. Only the person reads or writes it.';

alter table email_choice enable row level security;
alter table email_choice force row level security;
create policy email_choice_own on email_choice for all to app_server
  using (acting_side() = 'person' and user_id = acting_user())
  with check (acting_side() = 'person' and user_id = acting_user());
grant select, insert, update (review_requests, updated_at) on email_choice to app_server;

-- Deleting an account deletes its choices too.
create function forget_email_choices() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    delete from email_choice where user_id = new.id;
  end if;
  return null;
end $$;
create trigger app_user_forget_email_choices after update of deleted_at on app_user
  for each row execute function forget_email_choices();

-- -----------------------------------------------------------------------------
-- 2. "HOW WAS IT?" EMAILS
-- -----------------------------------------------------------------------------
-- Run by the site's morning job (workers/app.ts), twice a morning: claims the emails due now
-- (as 'queued' notifications), up to p_limit and the site's 20 a day; the job then sends them
-- and records each as sent or failed. One that failed is tried again the next run, at most 3
-- times. Only the host's own event, only businesses they could review now (E §4.5).
create function review_requests_due(p_limit int)
returns table (notification_id uuid, kind text, user_id uuid, email text, name text, event_id uuid,
               event_date date, businesses int, row_id uuid)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_today_start timestamptz := ((now() at time zone 'America/Toronto')::date)::timestamp at time zone 'America/Toronto';
  v_sent_today int;
  v_room int;
begin
  if acting_side() is not null then
    raise exception 'only the site''s morning job sends these' using errcode = 'LP101';  -- nobody acting
  end if;
  perform pg_advisory_xact_lock(hashtextextended('localites.review-requests', 0));
  select count(*) into v_sent_today from notification n
  where n.kind in ('review_request', 'review_reminder') and n.created_at >= v_today_start
    and (n.status = 'sent' or (n.status = 'queued' and n.created_at > now() - interval '10 minutes'));
  v_room := least(greatest(p_limit, 0), 20 - v_sent_today);
  if v_room <= 0 then
    return;
  end if;
  return query
  with open_rows as (
    select e.id as eid, e.host_user_id as uid, e.event_date as edate, event_ends_at(e) as ends, x.id as xid
    from event e
      join event_vendor x on x.event_id = e.id
      join vendor v on v.id = x.vendor_id and v.listing_status = 'published'
      join app_user u on u.id = e.host_user_id and u.deleted_at is null
    where e.status <> 'cancelled' and x.status = 'booked'
      and event_ends_at(e) < now() and event_ends_at(e) > now() - interval '60 days'
      and not (x.vendor_flagged_at is not null and x.vendor_flagged_at >= x.booked_at
               and x.flag_outcome is distinct from 'booking_stands')
      and not exists (select 1 from review r where r.event_vendor_id = x.id)
      and not exists (select 1 from vendor_member m
                      where m.vendor_id = x.vendor_id and m.user_id = e.host_user_id and m.ended_at is null)
      and not exists (select 1 from email_choice c where c.user_id = e.host_user_id and not c.review_requests)
  ),
  per_event as (
    select o.eid, o.uid, o.edate, max(o.ends) as ends, count(*)::int as n,
           case when count(*) = 1 then min(o.xid::text)::uuid end as only_row
    from open_rows o group by o.eid, o.uid, o.edate
  ),
  told as (
    select n.subject_id as eid, n.kind as nkind, n.status, n.sent_at, n.created_at
    from notification n
    where n.subject_type = 'event' and n.kind in ('review_request', 'review_reminder')
      and n.subject_id in (select p.eid from per_event p)
  ),
  due as (
    select p.*,
           case
             when not exists (select 1 from told t where t.eid = p.eid and t.nkind = 'review_request'
                                and (t.status = 'sent' or (t.status = 'queued' and t.created_at > now() - interval '10 minutes')))
               then 'review_request'
             when exists (select 1 from told t where t.eid = p.eid and t.nkind = 'review_request' and t.status = 'sent'
                            and t.sent_at < now() - interval '6 days 20 hours')
              and not exists (select 1 from told t where t.eid = p.eid and t.nkind = 'review_reminder'
                                and (t.status = 'sent' or (t.status = 'queued' and t.created_at > now() - interval '10 minutes')))
               then 'review_reminder'
           end as dkind
    from per_event p
    -- The morning after: an event that ended today waits for tomorrow.
    where p.ends < v_today_start
  ),
  chosen as (
    select d.* from due d
    where d.dkind is not null
      and (select count(*) from told t where t.eid = d.eid and t.nkind = d.dkind and t.status = 'failed') < 3
    order by (d.dkind = 'review_request') desc,                     -- first asks before reminders
             case when d.dkind = 'review_request' then d.ends end desc,  -- the newest events first
             d.ends                                                   -- reminders: the oldest first
    limit v_room
  ),
  queued as (
    insert into notification (user_id, kind, subject_type, subject_id)
    select c.uid, c.dkind, 'event', c.eid from chosen c
    returning id, notification.subject_id
  )
  select q.id, c.dkind, c.uid, u.email::text, coalesce(u.given_name, u.display_name), c.eid, c.edate, c.n, c.only_row
  from queued q join chosen c on c.eid = q.subject_id join app_user u on u.id = c.uid;
end $$;

-- -----------------------------------------------------------------------------
-- 3. REPORTING A REVIEW
-- -----------------------------------------------------------------------------
create table review_report (
  id                 uuid primary key default gen_random_uuid(),
  review_id          uuid not null references review(id),
  reporter_user_id   uuid not null references app_user(id),
  reporter_side      text not null check (reporter_side in ('consumer', 'vendor')),
  reason             text not null check (reason in ('not_genuine', 'personal_details', 'offensive', 'conflict', 'other')),
  details            text check (char_length(btrim(details)) between 1 and 2000),
  status             text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  reviewed_by        uuid references app_user(id),
  reviewed_at        timestamptz,
  decision_note      text check (char_length(btrim(decision_note)) between 1 and 1000),
  team_email_status  text not null default 'pending' check (team_email_status in ('pending', 'sent', 'failed', 'not_needed')),
  created_at         timestamptz not null default now(),
  check ((status = 'open') = (reviewed_at is null)),
  check (status = 'open' or decision_note is not null)
);
create unique index review_report_one_open on review_report (review_id, reporter_user_id) where status = 'open';
create index review_report_open on review_report (created_at) where status = 'open';
create index review_report_by_reporter on review_report (reporter_user_id, created_at);
comment on table review_report is
  'Reports of a published review (E §4.4). The reporter writes it; only the team reads it all.';

-- What the report's rules need to know about a review: that it's published on a listed
-- business, which business, whether the reporter wrote it, and whether it already has an open
-- report (the team is then not emailed again), and whether the team has had 20 emails about
-- reports today (the Reviews page still lists every report). Nothing about its author.
create function review_reportable(p_review uuid)
returns table (vendor_id uuid, own_review boolean, reported boolean, emails_full boolean)
language sql stable security definer set search_path = public, extensions as $$
  select r.vendor_id, r.author_user_id = acting_user(),
         exists (select 1 from review_report x where x.review_id = r.id and x.status = 'open'),
         (select count(*) from review_report x
          where x.team_email_status = 'sent' and x.created_at > now() - interval '1 day') >= 20
  from review r join vendor v on v.id = r.vendor_id
  where r.id = p_review and r.status = 'published' and v.listing_status = 'published'
$$;

create function enforce_review_report_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
declare
  t record;
  v_side text := acting_side();
begin
  if tg_op = 'UPDATE' and (new.id <> old.id or new.review_id <> old.review_id or new.reporter_user_id <> old.reporter_user_id
                           or new.reporter_side <> old.reporter_side or new.reason <> old.reason
                           or new.details is distinct from old.details or new.created_at <> old.created_at) then
    raise exception 'that can''t be changed' using errcode = 'LP100';
  end if;
  if current_user <> 'app_server' then
    return new;                                                    -- owner path (functions)
  end if;

  if tg_op = 'INSERT' then
    if new.reporter_user_id is distinct from acting_user() or v_side not in ('person', 'business') then
      raise exception 'only you can report in your own name' using errcode = 'LP101';
    end if;
    select * into t from review_reportable(new.review_id);
    if not found then
      raise exception 'that review isn''t on Localites' using errcode = 'LP101';
    end if;
    if v_side = 'person' then
      if t.own_review then
        raise exception 'you can''t report your own review' using errcode = 'LP158';
      end if;
      new.reporter_side := 'consumer';
    else
      if not acting_in_business() or acting_vendor() is distinct from t.vendor_id then
        raise exception 'a business reports only its own reviews' using errcode = 'LP101';
      end if;
      new.reporter_side := 'vendor';
    end if;
    if (select count(*) from review_report r
        where r.reporter_user_id = new.reporter_user_id and r.created_at > now() - interval '1 day') >= 10 then
      raise exception 'that''s the most reports for one day' using errcode = 'LP160';
    end if;
    if exists (select 1 from review_report r
               where r.review_id = new.review_id and r.reporter_user_id = new.reporter_user_id and r.status = 'open') then
      raise exception 'you''ve already reported this review' using errcode = 'LP159';
    end if;
    -- The team is emailed once per review while its reports are open, at most 20 a day (the
    -- Reviews page lists them all).
    new.team_email_status := case when t.reported or t.emails_full then 'not_needed' else 'pending' end;
    new.status := 'open'; new.reviewed_by := null; new.reviewed_at := null; new.decision_note := null;
    new.created_at := now();
    return new;
  end if;

  -- UPDATE: the reporter records how the team email went (once); the team decides.
  if acting_as_team() then
    if new.team_email_status is distinct from old.team_email_status then
      raise exception 'that can''t be changed' using errcode = 'LP100';
    end if;
    if new.status is distinct from old.status then
      if old.status <> 'open' or new.status not in ('actioned', 'dismissed') then
        raise exception 'that change isn''t possible' using errcode = 'LP109';
      end if;
      if new.decision_note is null then
        raise exception 'say why, in a few words' using errcode = 'LP157';
      end if;
      new.reviewed_by := acting_user(); new.reviewed_at := now();
    elsif new.decision_note is distinct from old.decision_note then
      raise exception 'that can''t be changed' using errcode = 'LP100';
    end if;
  elsif old.reporter_user_id = acting_user() then
    if (new.status, new.decision_note) is distinct from (old.status, old.decision_note)
       or old.team_email_status <> 'pending' or new.team_email_status not in ('sent', 'failed') then
      raise exception 'that can''t be changed' using errcode = 'LP100';
    end if;
  else
    raise exception 'no one is acting' using errcode = 'LP101';
  end if;
  return new;
end $$;
create trigger review_report_rules before insert or update on review_report
  for each row execute function enforce_review_report_rules();

-- Removing a review closes its open reports.
create function close_reports_of_removed() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if old.status = 'published' and new.status = 'removed' then
    update review_report set status = 'actioned', reviewed_by = new.decided_by, reviewed_at = now(),
                             decision_note = 'The review was removed: ' || new.decision_reason
    where review_id = new.id and status = 'open';
  end if;
  return null;
end $$;
create trigger review_close_reports after update of status on review
  for each row execute function close_reports_of_removed();

alter table review_report enable row level security;
alter table review_report force row level security;
-- The reporter sees their own reports (to know they've reported); the team sees all.
create policy review_report_reporter on review_report for all to app_server
  using (acting_side() in ('person', 'business') and reporter_user_id = acting_user())
  with check (acting_side() in ('person', 'business') and reporter_user_id = acting_user());
create policy review_report_team on review_report for select to app_server using (acting_as_team());
create policy review_report_team_decide on review_report for update to app_server
  using (acting_as_team()) with check (acting_as_team());
grant select, insert (id, review_id, reporter_user_id, reporter_side, reason, details) on review_report to app_server;
grant update (status, decision_note, team_email_status) on review_report to app_server;

-- -----------------------------------------------------------------------------
-- 4. PERMISSIONS
-- -----------------------------------------------------------------------------
revoke all on function forget_email_choices(), review_requests_due(int), review_reportable(uuid),
  enforce_review_report_rules(), close_reports_of_removed() from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on email_choice, review_report from %I', r);
      execute format('revoke all on function review_requests_due(int), review_reportable(uuid) from %I', r);
    end if;
  end loop;
end $$;
grant execute on function review_requests_due(int), review_reportable(uuid) to app_server;
