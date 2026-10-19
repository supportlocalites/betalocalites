-- =============================================================================
-- Localites — migration 0049: fixes from the scenario tests, round 4 (D-54)
-- =============================================================================
-- Events and guests, as the product owner chose on 19 October 2026:
--   M10  the host deletes a cancelled event (delete_cancelled_event()), with its plan, guest
--        list, replies, questions and updates, as deleting an account does for every event
--        (0014). Only a cancelled one, and only once the businesses have been told (a day after
--        cancelling, when any were booked). Recorded in audit_log. (Copying needs nothing new.)
--   C10  after cancelling, the host can have Localites email the guests who have an email
--        address on file (the owner: "allow hosts the option to send a cancellation reminder";
--        extends D-49): cancel_notice_emails(). Once per guest; at most 20 for one event in all;
--        at most 20 guest emails a day for one host; within the site's daily limit of guest
--        emails (30, as 0034) and 2 a day to one address, so sign-in codes keep their share of
--        the free plan's emails; not once the event's date has passed. The rest are counted
--        for the host to tell themselves. An email that failed can be tried again.
--        guest_email rows now outlive their guest (guest_id set null), so deleting a guest or
--        an event can't reset the limits; they're deleted after a year, as other email records.
--
-- Not destructive except M10, which deletes only what the host chooses to, once it's cancelled.
-- =============================================================================

set search_path = public, extensions;

-- M10 -------------------------------------------------------------------------------------
create function delete_cancelled_event(p_event uuid) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if acting_side() is distinct from 'person' then
    raise exception 'only the person planning this event can delete it' using errcode = 'LP101';
  end if;
  perform 1 from event where id = p_event and host_user_id = acting_user() for update;
  if not found then
    raise exception 'only the person planning this event can delete it' using errcode = 'LP101';
  end if;
  if not exists (select 1 from event where id = p_event and status = 'cancelled') then
    raise exception 'only a cancelled event can be deleted' using errcode = 'LP189';
  end if;
  -- Not before the businesses are told it's cancelled (their morning summary, 0040): their
  -- notices would otherwise find no booking and never go. A day after cancelling, or while a
  -- notice still waits (the notice itself is saved just after the cancelling, so the day covers it).
  if exists (select 1 from event e where e.id = p_event and e.cancelled_at > now() - interval '1 day'
               and exists (select 1 from event_vendor ev where ev.event_id = e.id and ev.status = 'booked'))
     or exists (select 1 from notification n join event_vendor ev on ev.id = n.subject_id
                where n.subject_type = 'event_vendor' and ev.event_id = p_event and n.status in ('waiting', 'queued')) then
    raise exception 'the businesses haven''t been told yet' using errcode = 'LP190';
  end if;
  insert into audit_log (actor_user_id, action, subject_type, subject_id)
  values (acting_user(), 'event.delete_cancelled', 'event', p_event);
  -- As deleting an account (0014); guests, replies, questions and updates go with the event.
  delete from event_vendor_flag_note n using event_vendor ev where n.event_vendor_id = ev.id and ev.event_id = p_event;
  delete from event_vendor where event_id = p_event;
  delete from event_private where event_id = p_event;
  delete from event where id = p_event;
end $$;

-- C10 -------------------------------------------------------------------------------------
alter table guest_email drop constraint guest_email_kind_check;
-- A guest's email records stay when the guest (or their event) is deleted, so the limits count them.
alter table guest_email alter column guest_id drop not null;
alter table guest_email drop constraint guest_email_guest_id_fkey;
alter table guest_email add constraint guest_email_guest_id_fkey foreign key (guest_id) references guest(id) on delete set null;
alter table guest_email add constraint guest_email_kind_check check (kind in ('reply_changed', 'event_cancelled'));
comment on table guest_email is
  'Emails to a guest about a reply their host changed (D-49), or that the event is cancelled (D-54). The host reads and records its own; nothing else.';

-- The emails to send now (queued here; the host's request sends them and records how each went),
-- and how many guests with an address weren't emailed because of a limit.
create function cancel_notice_emails(p_event uuid)
returns table (email_id uuid, email text, guest_name text, held_back int)
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  g record;
  v_to bytea;
  v_site int;
  v_sent int := 0;
  v_held int := 0;
  v_host int;
  v_event int;
begin
  if acting_side() is distinct from 'person' then
    raise exception 'only the person planning this event can tell its guests' using errcode = 'LP101';
  end if;
  perform 1 from event e where e.id = p_event and e.host_user_id = acting_user() and e.status = 'cancelled' for update;
  if not found then
    raise exception 'only the person planning this event can tell its guests' using errcode = 'LP101';
  end if;
  if exists (select 1 from event e where e.id = p_event and event_ends_at(e) < now()) then
    raise exception 'the event''s date has passed' using errcode = 'LP191';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('localites.guest-email', 0));
  select count(*) into v_site from guest_email x where x.status in ('sent', 'queued') and x.created_at > now() - interval '1 day';
  -- What this host has sent today (any kind), and this event's cancellation emails in all.
  select count(*) into v_host from guest_email x
  where x.host_user_id = acting_user() and x.status in ('sent', 'queued') and x.created_at > now() - interval '1 day';
  select count(*) into v_event from guest_email x join guest gu on gu.id = x.guest_id
  where gu.event_id = p_event and x.kind = 'event_cancelled' and x.status in ('sent', 'queued');
  for g in
    select gu.id, gu.name, gu.email from guest gu
    where gu.event_id = p_event and gu.host_user_id = acting_user() and gu.email is not null
      -- Told already, or being told: an email that failed (or was left queued) can go again.
      and not exists (select 1 from guest_email x where x.guest_id = gu.id and x.kind = 'event_cancelled'
                      and (x.status = 'sent' or (x.status = 'queued' and x.created_at > now() - interval '10 minutes')))
    order by gu.created_at, gu.name, gu.id
  loop
    v_to := sha256(convert_to(lower(g.email), 'UTF8'));
    if v_event + v_sent >= 20 or v_host + v_sent >= 20 or v_site + v_sent >= 30
       or (select count(*) from guest_email x where x.to_hash = v_to
           and x.status in ('sent', 'queued') and x.created_at > now() - interval '1 day') >= 2 then
      v_held := v_held + 1;
      continue;
    end if;
    insert into guest_email (guest_id, host_user_id, kind, to_hash) values (g.id, acting_user(), 'event_cancelled', v_to)
    returning id into email_id;
    email := g.email; guest_name := g.name; held_back := null;
    v_sent := v_sent + 1;
    return next;
  end loop;
  -- One last row with the count held back (no email).
  email_id := null; email := null; guest_name := null; held_back := v_held;
  return next;
end $$;

revoke all on function delete_cancelled_event(uuid), cancel_notice_emails(uuid) from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function delete_cancelled_event(uuid), cancel_notice_emails(uuid) from %I', r);
    end if;
  end loop;
end $$;
grant execute on function delete_cancelled_event(uuid), cancel_notice_emails(uuid) to app_server;

-- Guests' email records, deleted after a year (as 0048 otherwise).
create or replace function run_scheduled_deletions()
returns table (emails int, audit int, conversations int, suggestions int)
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_batch constant int := 2000;
  v_convs uuid[];
begin
  perform set_config('localites.retention', 'on', true);

  -- Each kind on its own: one that fails (-1, logged by the morning run) doesn't stop the rest.
  begin
    with gone as (
      delete from notification where id in (
        select id from notification where created_at < now() - interval '1 year'
        order by created_at limit v_batch)
      returning 1)
    select count(*)::int into emails from gone;
    -- Guests' email records too (0034; kept after their guest or event is deleted, 0049, so the
    -- daily limits still count them): a year, as other email records.
    delete from guest_email where created_at < now() - interval '1 year';
  exception when others then
    emails := -1;
    raise warning 'scheduled deletions: email records: %', sqlerrm;
  end;

  begin
    with gone as (
      delete from audit_log a where a.id in (
        select l.id from audit_log l
        where l.created_at < now() - interval '2 years'
          and not exists (select 1 from owner_change o where o.audit_id = l.id or o.undo_audit_id = l.id)
          and not exists (select 1 from vendor_analytics c where c.audit_id = l.id)
        order by l.created_at limit v_batch)
      returning 1)
    select count(*)::int into audit from gone;
  exception when others then
    audit := -1;
    raise warning 'scheduled deletions: change log: %', sqlerrm;
  end;

  begin
    -- A conversation the person deleted, 30 days on and unreported: its files go first (the
    -- nightly clean-up removes them from storage), then it goes with its messages (0048).
    update conversation_file f set deleted_at = now(), kept_for_report = false
    from conversation c
    where c.id = f.conversation_id and f.deleted_at is null and c.person_deleted_at < now() - interval '30 days'
      and not exists (select 1 from moderation_report r where r.conversation_id = c.id);
    select coalesce(array_agg(c.id), '{}') into v_convs from (
      select c.id from conversation c
      where (coalesce(c.last_message_at, c.created_at) < now() - interval '3 years'
             or c.person_deleted_at < now() - interval '30 days')   -- deleted by the person (0048)
        and not exists (select 1 from moderation_report r where r.conversation_id = c.id)
        and not exists (select 1 from conversation_file f where f.conversation_id = c.id and f.storage_removed_at is null)
      order by coalesce(c.last_message_at, c.created_at) limit v_batch
      for update of c skip locked) c;
    delete from conversation_file where conversation_id = any(v_convs);
    delete from reported_message_text t using message m where m.id = t.message_id and m.conversation_id = any(v_convs);
    delete from message_edit e using message m where m.id = e.message_id and m.conversation_id = any(v_convs);
    delete from conversation_read where conversation_id = any(v_convs);
    delete from message where conversation_id = any(v_convs);
    delete from conversation where id = any(v_convs);
    conversations := cardinality(v_convs);
  exception when others then
    conversations := -1;
    raise warning 'scheduled deletions: conversations: %', sqlerrm;
  end;

  begin
    with erased as (
      update vendor_suggestion set contact = null where id in (
        select id from vendor_suggestion
        where status = 'declined' and contact is not null and reviewed_at < now() - interval '1 year'
        limit v_batch)
      returning 1)
    select count(*)::int into suggestions from erased;
  exception when others then
    suggestions := -1;
    raise warning 'scheduled deletions: suggestions: %', sqlerrm;
  end;

  perform set_config('localites.retention', 'off', true);
  return next;
end $$;
