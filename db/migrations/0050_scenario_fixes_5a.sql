-- =============================================================================
-- Localites — migration 0050: fixes from the scenario tests, round 5, part 1 (D-54)
-- =============================================================================
-- Businesses, as the product owner chose on 19 October 2026:
--   B6/M18  an owner can hide their business's page and show it again (vendor.owner_hidden_at:
--           only a page the owner hid can be shown again by them; anything the team does to
--           the listing clears it), hand the business to someone on its team (they're emailed:
--           a new kind of email, 'ownership_given'), or, with no team, take it off Localites.
--           Managers and staff can leave a team. (Site code, with these columns.)
--   M22     suggestions are limited per home connection a day, not only per browser: a
--           fingerprint of the connection (a keyed hash, never the address) is kept with a
--           suggestion for two days, then erased (run_scheduled_deletions).
--
-- Not destructive: two columns, one more kind of email, and an erasure of fingerprints.
-- =============================================================================

set search_path = public, extensions;

-- B6/M18 ----------------------------------------------------------------------------------
alter table vendor add column owner_hidden_at timestamptz;
comment on column vendor.owner_hidden_at is
  'Its owner hid the page (0050): they can show it again while it''s unpublished. Cleared by anything the team does to the listing.';

alter table notification drop constraint notification_kind_check;
alter table notification add constraint notification_kind_check check (kind in (
  'claim_received', 'claim_decision', 'listing_change_undone', 'owner_removed', 'new_message', 'marked_booked',
  'booking_unmarked', 'review_request', 'review_reminder', 'review_published', 'review_reply', 'vendor_joined',
  'booked_event_cancelled', 'booked_event_changed', 'booking_flagged', 'review_declined', 'review_for_business',
  'held_edit_published', 'held_edit_declined', 'suggestion_listed', 'report_outcome', 'flag_decision', 'ownership_given'));

-- M22 -------------------------------------------------------------------------------------
alter table vendor_suggestion add column connection_hash bytea check (octet_length(connection_hash) = 32);
comment on column vendor_suggestion.connection_hash is
  'A keyed fingerprint of the connection it came from (0050), for the daily limit; erased after two days.';
create index vendor_suggestion_connection on vendor_suggestion (connection_hash, created_at) where connection_hash is not null;

-- As 0049, plus the fingerprints' erasure.
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

  -- A suggestion's connection fingerprint, kept two days for its daily limit (0050); on its own,
  -- so a failure above can't keep it longer.
  begin
    update vendor_suggestion set connection_hash = null where connection_hash is not null and created_at < now() - interval '2 days';
  exception when others then
    raise warning 'scheduled deletions: suggestion fingerprints: %', sqlerrm;
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
