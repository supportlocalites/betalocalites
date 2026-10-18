-- =============================================================================
-- Localites — migration 0040: a daily summary of booking emails (D-53)
-- =============================================================================
-- D-53 (the product owner, 18 October 2026: "Yes, a daily summary"): emails to a business about
-- its bookings (marked booked, no longer booked, an event cancelled or changed, D-40) wait and go
-- out together each morning, one email per person, instead of one per change. A booking marked
-- and un-marked before the morning cancels out. The email to a person when a business flags
-- their booking (D-41) still goes at once.
--   notification.status 'waiting': decided and kept for the morning summary.
--   notification.summary_line: the line the summary shows, written when the change was saved,
--   from the same few facts the single email showed (D-40). Cleared once the summary is sent,
--   fails or is called off, so the person's name isn't kept with the record.
--   booking_still_theirs(): at send time, whether the person is still an owner or manager of the
--   business on that booking (and the business still claimed and not archived); someone who left
--   the team since isn't sent the line. For the server only.
--
-- Not destructive: one more status, one column (empty for every email so far), an index, a function.
-- =============================================================================

set search_path = public, extensions;

alter table notification drop constraint notification_status_check;
alter table notification add constraint notification_status_check
  check (status in ('queued', 'sent', 'failed', 'suppressed', 'waiting'));
alter table notification add column summary_line text check (char_length(summary_line) between 1 and 600);
alter table notification add constraint notification_waiting_has_line check (status <> 'waiting' or summary_line is not null);
create index notification_waiting on notification (user_id, created_at) where status = 'waiting';

create function booking_still_theirs(p_user uuid, p_event_vendor uuid) returns boolean
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select exists (
    select 1 from event_vendor ev
    join vendor v on v.id = ev.vendor_id
    join vendor_member m on m.vendor_id = v.id
    where ev.id = p_event_vendor and m.user_id = p_user and m.role in ('owner', 'manager') and m.ended_at is null
      and v.claim_status = 'claimed' and v.listing_status <> 'archived')
$$;
revoke all on function booking_still_theirs(uuid, uuid) from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function booking_still_theirs(uuid, uuid) from %I', r);
    end if;
  end loop;
end $$;
grant execute on function booking_still_theirs(uuid, uuid) to app_server;
