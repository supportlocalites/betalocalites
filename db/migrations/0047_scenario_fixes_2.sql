-- =============================================================================
-- Localites — migration 0047: fixes from the scenario tests, round 2 (D-54)
-- =============================================================================
-- Reviews and bookings a business says aren't real, as the product owner chose on 19 October 2026:
--   M4  a person withdraws their own waiting review (withdraw_my_review(); it doesn't come back
--       if the booking is marked again), and asks the team to remove a published one (a review
--       report with the reason 'author_request', which only its author can send);
--   M8  the team decides a business's "this wasn't booked" note (decide_booking_flag()): the
--       booking stands, or it wasn't real, and then its review is removed; a new flag on a
--       later marking starts afresh;
--   M9  a business marked booked only after the event can be reviewed 24 hours after the
--       marking (LP185, the owner: "offer a 24 hour grace period before review"); whether it was
--       marked after the event is recorded as it's marked (event_vendor.booked_after_event), so
--       moving the event afterwards doesn't change it; the team sees when a reviewed booking was
--       marked (review_booking_timing());
--   M7  two more kinds of email: the outcome of a report, to the person who sent it; the team's
--       decision on a booking note, to the person and the business ('review_reply' already exists).
--
--   M6+ a review its author withdrew loses its words 30 days later, as a declined one does.
--
-- Not destructive: columns, functions and rules. A review is removed only by the team's
-- decision; words are erased only as above.
-- =============================================================================

set search_path = public, extensions;

-- M9 --------------------------------------------------------------------------------------
-- Set as the booking is marked (after event_vendor_rules sets booked_at), never by the site.
-- Bookings marked before this migration count as marked before their event.
alter table event_vendor add column booked_after_event boolean not null default false;
create function event_vendor_booked_after_event() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
begin
  if new.status = 'booked' and (tg_op = 'INSERT' or old.status is distinct from 'booked') then
    new.booked_after_event := coalesce(new.booked_at, now()) > (select event_ends_at(e) from event e where e.id = new.event_id);
  elsif tg_op = 'UPDATE' then
    new.booked_after_event := old.booked_after_event;            -- only a marking changes it
  end if;
  return new;
end $$;
create trigger event_vendor_zz_booked_after_event before insert or update on event_vendor
  for each row execute function event_vendor_booked_after_event();

-- The rules as 0031, plus the 24 hours (M9).
create or replace function enforce_review_rules() returns trigger
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
    select x.id, x.status, x.vendor_id, x.booked_at, x.booked_after_event, x.vendor_flagged_at, x.flag_outcome,
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
    -- Marked booked only after the event (M9, D-54): reviews open 24 hours after the marking.
    if ev.booked_after_event and now() < ev.booked_at + interval '24 hours' then
      raise exception 'reviews open 24 hours after a business is marked booked after the event' using errcode = 'LP185';
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

-- M4: withdrawing a waiting review ------------------------------------------------------
alter table review add column withdrawn_by_author boolean not null default false;
comment on column review.withdrawn_by_author is
  'Its author withdrew it (0047): it stays withdrawn, even if the booking is marked again.';

create function withdraw_my_review(p_review uuid) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if acting_side() is distinct from 'person' then
    raise exception 'only the author can withdraw a review' using errcode = 'LP101';
  end if;
  update review set status = 'withdrawn', withdrawn_by_author = true
  where id = p_review and author_user_id = acting_user() and status = 'pending';
  if not found then
    if exists (select 1 from review where id = p_review and author_user_id = acting_user()) then
      raise exception 'only a review that''s waiting for our team can be withdrawn' using errcode = 'LP186';
    end if;
    raise exception 'only the author can withdraw a review' using errcode = 'LP101';
  end if;
end $$;

-- As 0046, except a review its author withdrew stays withdrawn.
create or replace function restore_withdrawn_review() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  -- Not while the business's note counts: a new review would be refused then too (LP153).
  if old.status is distinct from 'booked' and new.status = 'booked'
     and not (new.vendor_flagged_at is not null and new.vendor_flagged_at >= new.booked_at
              and new.flag_outcome is distinct from 'booking_stands') then
    update review set status = 'pending', locked = true
    where event_vendor_id = new.id and status = 'withdrawn' and decided_at is null and not withdrawn_by_author;
  end if;
  return null;
end $$;

-- M4: asking for a published review to be removed ---------------------------------------
alter table review_report drop constraint review_report_reason_check;
alter table review_report add constraint review_report_reason_check
  check (reason in ('not_genuine', 'personal_details', 'offensive', 'conflict', 'other', 'author_request'));

create or replace function enforce_review_report_rules() returns trigger
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
    -- One report of a review at a time, so two at once don't both email the team.
    perform pg_advisory_xact_lock(hashtextextended('localites.review-report:' || new.review_id::text, 0));
    select * into t from review_reportable(new.review_id);
    if not found then
      raise exception 'that review isn''t on Localites' using errcode = 'LP101';
    end if;
    if v_side = 'person' then
      -- Its author can't report it, but can ask for it to be removed (M4, D-54); nobody else can
      -- send that request.
      if t.own_review and new.reason <> 'author_request' then
        raise exception 'you can''t report your own review' using errcode = 'LP158';
      end if;
      if not t.own_review and new.reason = 'author_request' then
        raise exception 'that can''t be changed' using errcode = 'LP100';
      end if;
      new.reporter_side := 'consumer';
    else
      if not acting_in_business() or acting_vendor() is distinct from t.vendor_id then
        raise exception 'a business reports only its own reviews' using errcode = 'LP101';
      end if;
      if new.reason = 'author_request' then
        raise exception 'that can''t be changed' using errcode = 'LP100';
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

-- M8: the team decides a booking note ----------------------------------------------------
create or replace function flag_booking(p_row uuid, p_note text)
returns table (event_id uuid, event_date date, host_user_id uuid)
language plpgsql security definer set search_path = public, extensions as $$
declare
  r record;
begin
  if not acting_for_business() then
    raise exception 'only the business itself can say this' using errcode = 'LP101';
  end if;
  select ev.id, ev.status, ev.booked_at, ev.vendor_flagged_at, e.status as event_status,
         e.id as eid, e.event_date as edate, e.host_user_id as host into r
  from event_vendor ev join event e on e.id = ev.event_id
  where ev.id = p_row and ev.vendor_id = acting_vendor()
    and (ev.booked_at >= business_joined_at(ev.vendor_id)
         or e.event_date >= (now() at time zone 'America/Toronto')::date)
  for update of ev;
  if not found or r.status <> 'booked' then
    raise exception 'only the business itself can say this' using errcode = 'LP101';
  end if;
  if r.event_status <> 'planning' then
    raise exception 'that event is cancelled' using errcode = 'LP102';
  end if;
  if r.vendor_flagged_at is not null and r.vendor_flagged_at >= r.booked_at then
    raise exception 'you''ve already told us about this booking' using errcode = 'LP110';
  end if;
  -- A flag on a later marking starts afresh: the team's decision on an earlier one doesn't carry over.
  update event_vendor set vendor_flagged_at = now(), vendor_flagged_by = acting_user(),
                          flag_resolved_at = null, flag_outcome = null
  where id = p_row;
  if nullif(btrim(coalesce(p_note, '')), '') is null then
    delete from event_vendor_flag_note where event_vendor_id = p_row;
  else
    insert into event_vendor_flag_note (event_vendor_id, note) values (p_row, btrim(p_note))
    on conflict (event_vendor_id) do update set note = excluded.note, updated_at = now();
  end if;
  return query select r.eid, r.edate, r.host;
end $$;

-- 'stands': the booking counts, and can be reviewed. 'not_real': it doesn't, and a review of
-- it (waiting or published) is removed. Once decided, it stays decided (a later marking that
-- the business flags again starts afresh, flag_booking above). Returns what the emails need.
create function decide_booking_flag(p_row uuid, p_outcome text)
returns table (vendor_id uuid, host_user_id uuid, event_date date, review_removed boolean)
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  r record;
  v_removed int := 0;
begin
  if not acting_as_team() then
    raise exception 'only the Localites team can do this' using errcode = 'LP101';
  end if;
  if p_outcome not in ('stands', 'not_real') then
    raise exception 'that change isn''t possible' using errcode = 'LP109';
  end if;
  select ev.id, ev.vendor_id, ev.vendor_flagged_at, ev.flag_resolved_at, e.host_user_id as host, e.event_date as edate into r
  from event_vendor ev join event e on e.id = ev.event_id
  where ev.id = p_row for update of ev;
  if not found or r.vendor_flagged_at is null then
    raise exception 'that booking isn''t flagged' using errcode = 'LP101';
  end if;
  if r.flag_resolved_at is not null then
    raise exception 'that was already decided' using errcode = 'LP109';
  end if;
  update event_vendor set flag_resolved_at = now(),
                          flag_outcome = case p_outcome when 'stands' then 'booking_stands' else 'booking_not_real' end
  where id = p_row;
  if p_outcome = 'not_real' then
    update review set status = 'removed', decided_by = acting_user(), decided_at = now(),
                      decision_reason = 'The business said it wasn''t booked for this event, and our team agreed.'
    where event_vendor_id = p_row and status in ('pending', 'published');
    get diagnostics v_removed = row_count;
  end if;
  return query select r.vendor_id, r.host, r.edate, v_removed > 0;
end $$;

-- M9: for the team, when the booking behind a review was marked (it sees only flagged
-- bookings otherwise, 0012). Nothing else about the booking or its event.
create function review_booking_timing(p_review uuid)
returns table (booked_at timestamptz, event_ends timestamptz, reviewed_at timestamptz, booked_after_event boolean)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
begin
  if not acting_as_team() then
    raise exception 'only the Localites team can do this' using errcode = 'LP101';
  end if;
  return query
  select ev.booked_at, event_ends_at(e), r.created_at, ev.booked_after_event
  from review r join event_vendor ev on ev.id = r.event_vendor_id join event e on e.id = ev.event_id
  where r.id = p_review;
end $$;

-- M6+: as 0046, plus a review its author withdrew, 30 days after they did.
create or replace function erase_declined_review_words() returns int
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  n int;
  m int;
begin
  update review set body = 'Erased 30 days after the team declined it.', language_flag = null
  where status = 'declined' and decided_at < now() - interval '30 days'
    and (body <> 'Erased 30 days after the team declined it.' or language_flag is not null);
  get diagnostics n = row_count;
  update review set body = 'Erased 30 days after its author withdrew it.', language_flag = null
  where status = 'withdrawn' and withdrawn_by_author and updated_at < now() - interval '30 days'
    and (body <> 'Erased 30 days after its author withdrew it.' or language_flag is not null);
  get diagnostics m = row_count;
  return n + m;
exception when others then
  return -1;
end $$;

-- M7, M8: two more kinds of email -------------------------------------------------------
alter table notification drop constraint notification_kind_check;
alter table notification add constraint notification_kind_check check (kind in (
  'claim_received', 'claim_decision', 'listing_change_undone', 'owner_removed', 'new_message', 'marked_booked',
  'booking_unmarked', 'review_request', 'review_reminder', 'review_published', 'review_reply', 'vendor_joined',
  'booked_event_cancelled', 'booked_event_changed', 'booking_flagged', 'review_declined', 'review_for_business',
  'held_edit_published', 'held_edit_declined', 'suggestion_listed', 'report_outcome', 'flag_decision'));

revoke all on function withdraw_my_review(uuid), decide_booking_flag(uuid, text), review_booking_timing(uuid) from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function withdraw_my_review(uuid), decide_booking_flag(uuid, text), '
                     'review_booking_timing(uuid) from %I', r);
    end if;
  end loop;
end $$;
grant execute on function withdraw_my_review(uuid), decide_booking_flag(uuid, text), review_booking_timing(uuid) to app_server;
