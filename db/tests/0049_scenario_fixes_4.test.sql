-- =============================================================================
-- Checks for migration 0049: scenario-test fixes, round 4 (cancelled events, cancellation emails).
-- One transaction, rolled back.
-- =============================================================================

begin;

create function pg_temp.expect_equal(label text, got text, want text) returns void
language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL  %: got %, want %', label, coalesce(got, 'null'), coalesce(want, 'null');
  end if;
  raise notice 'PASS  %  (%)', label, want;
end $$;

create function pg_temp.expect_code(label text, stmt text, code text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate <> code then
      raise exception 'FAIL  %: rejected with % (%), want %', label, sqlstate, sqlerrm, code;
    end if;
    raise notice 'PASS  %  (refused: %)', label, code;
    return;
  end;
  raise exception 'FAIL  %: was accepted, want %', label, code;
end $$;

create function pg_temp.act(p_side text, p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('localites.side', coalesce(p_side, ''), true),
          set_config('localites.user_id', coalesce(p_user::text, ''), true),
          set_config('localites.vendor_id', '', true);
end $$;

-- Pat (host), Quinn (someone else).
insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000049a1', 'Pat', 'p-49@example.com'),
  ('00000000-0000-7000-8000-0000000049a2', 'Quinn', 'q-49@example.com');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000049b1', 'test-town-49', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000049c1', 'test-49-v', 'V', '00000000-0000-7000-8000-0000000049b1', 'admin_entered', 'published', 'claimed', now());
set local session_replication_role = replica;
-- d1: cancelled, with a booked business, guests (25 with an email) and a question. d2: still planned.
insert into event (id, host_user_id, event_date, start_time, municipality_id, status, cancelled_at) values
  ('00000000-0000-7000-8000-0000000049d1', '00000000-0000-7000-8000-0000000049a1', current_date + 20, '14:00', '00000000-0000-7000-8000-0000000049b1', 'cancelled', now()),
  ('00000000-0000-7000-8000-0000000049d2', '00000000-0000-7000-8000-0000000049a1', current_date + 20, '14:00', '00000000-0000-7000-8000-0000000049b1', 'planning', null);
insert into event_private (event_id, host_user_id, title) values
  ('00000000-0000-7000-8000-0000000049d1', '00000000-0000-7000-8000-0000000049a1', 'Cancelled party'),
  ('00000000-0000-7000-8000-0000000049d2', '00000000-0000-7000-8000-0000000049a1', 'Planned party');
insert into event_vendor (id, event_id, host_user_id, vendor_id, status, booked_at) values
  ('00000000-0000-7000-8000-0000000049e1', '00000000-0000-7000-8000-0000000049d1', '00000000-0000-7000-8000-0000000049a1', '00000000-0000-7000-8000-0000000049c1', 'booked', now() - interval '3 days');
insert into guest (id, event_id, host_user_id, name, email, token_hash, created_at)
  select gen_random_uuid(), '00000000-0000-7000-8000-0000000049d1', '00000000-0000-7000-8000-0000000049a1', 'Guest ' || n,
         case when n <= 25 then 'guest' || n || '-49@example.com' end, sha256(convert_to('t49-' || n, 'UTF8')), now() - (n || ' minutes')::interval
  from generate_series(1, 30) n;
-- Two guests share an address that already had two emails today.
update guest set email = 'shared-49@example.com' where event_id = '00000000-0000-7000-8000-0000000049d1' and name in ('Guest 1', 'Guest 2');
insert into guest_email (guest_id, host_user_id, to_hash, status, sent_at)
  select g.id, '00000000-0000-7000-8000-0000000049a1', sha256(convert_to('shared-49@example.com', 'UTF8')), 'sent', now()
  from guest g where g.event_id = '00000000-0000-7000-8000-0000000049d1' and g.name in ('Guest 26', 'Guest 27');
insert into event_question (id, event_id, host_user_id, question) values
  ('00000000-0000-7000-8000-0000000049f1', '00000000-0000-7000-8000-0000000049d1', '00000000-0000-7000-8000-0000000049a1', 'Allergies?');
set local session_replication_role = origin;

set local role app_server;

-- C10: the cancellation emails.
select pg_temp.act('person', '00000000-0000-7000-8000-0000000049a2');
select pg_temp.expect_code('someone else can''t email Pat''s guests',
  $q$select * from cancel_notice_emails('00000000-0000-7000-8000-0000000049d1')$q$, 'LP101');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000049a1');
select pg_temp.expect_code('…nor can Pat for an event that isn''t cancelled',
  $q$select * from cancel_notice_emails('00000000-0000-7000-8000-0000000049d2')$q$, 'LP101');
create temp table sent49 as select * from cancel_notice_emails('00000000-0000-7000-8000-0000000049d1');
select pg_temp.expect_equal('at most 20 guest emails a day for one host (2 went earlier today): 18 now, the other 7 counted',
  (select count(*) filter (where email_id is not null)::text || ' ' || max(held_back)::text from sent49), '18 7');
select pg_temp.expect_equal('…never to an address already emailed twice today',
  (select count(*)::text from sent49 where email = 'shared-49@example.com'), '0');
select pg_temp.expect_equal('…recorded as queued, cancellation emails',
  (select count(*)::text from guest_email where kind = 'event_cancelled' and status = 'queued'), '18');
select pg_temp.expect_equal('asking again the same day sends nothing more (the host''s daily limit)',
  (select count(*) filter (where email_id is not null)::text from cancel_notice_emails('00000000-0000-7000-8000-0000000049d1')), '0');
-- Those 18 failed to send (the email service refused the batch): they can be tried again, once the day's limits allow.
reset role;
update guest_email set status = 'failed', failure_reason = 'refused' where kind = 'event_cancelled';
update guest_email set created_at = now() - interval '2 days' where kind = 'event_cancelled' or guest_id in (
  select id from guest where name in ('Guest 26', 'Guest 27'));
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000049a1');
select pg_temp.expect_equal('an email that failed can go again; still at most 20 for the event',
  (select count(*) filter (where email_id is not null)::text from cancel_notice_emails('00000000-0000-7000-8000-0000000049d1')), '20');
-- Not once the event's date has passed.
reset role;
update event set event_date = current_date - 10 where id = '00000000-0000-7000-8000-0000000049d1';
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000049a1');
select pg_temp.expect_code('a cancelled event whose date has passed: no emails',
  $q$select * from cancel_notice_emails('00000000-0000-7000-8000-0000000049d1')$q$, 'LP191');

-- M10: deleting a cancelled event.
select pg_temp.act('person', '00000000-0000-7000-8000-0000000049a2');
select pg_temp.expect_code('someone else can''t delete Pat''s event',
  $q$select delete_cancelled_event('00000000-0000-7000-8000-0000000049d1')$q$, 'LP101');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000049a1');
select pg_temp.expect_code('a planned event can''t be deleted this way',
  $q$select delete_cancelled_event('00000000-0000-7000-8000-0000000049d2')$q$, 'LP189');
-- The business's cancellation notice is waiting for its morning summary.
reset role;
insert into notification (user_id, kind, subject_type, subject_id, status, summary_line)
  values ('00000000-0000-7000-8000-0000000049a2', 'booked_event_cancelled', 'event_vendor', '00000000-0000-7000-8000-0000000049e1', 'waiting', 'Cancelled');
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000049a1');
select pg_temp.expect_code('not before the businesses have been told it''s cancelled',
  $q$select delete_cancelled_event('00000000-0000-7000-8000-0000000049d1')$q$, 'LP190');
reset role;
update notification set status = 'sent', sent_at = now() where subject_id = '00000000-0000-7000-8000-0000000049e1';
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000049a1');
select pg_temp.expect_code('…nor within a day of cancelling, when a business was booked (its notice may still be on its way)',
  $q$select delete_cancelled_event('00000000-0000-7000-8000-0000000049d1')$q$, 'LP190');
reset role;
update event set cancelled_at = now() - interval '25 hours' where id = '00000000-0000-7000-8000-0000000049d1';
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000049a1');
select delete_cancelled_event('00000000-0000-7000-8000-0000000049d1');
reset role;
select pg_temp.expect_equal('the cancelled event goes, with its plan, guests and questions',
  (select count(*) from event where id = '00000000-0000-7000-8000-0000000049d1')::text || ' '
  || (select count(*) from event_vendor where event_id = '00000000-0000-7000-8000-0000000049d1')::text || ' '
  || (select count(*) from guest where event_id = '00000000-0000-7000-8000-0000000049d1')::text || ' '
  || (select count(*) from event_question where event_id = '00000000-0000-7000-8000-0000000049d1')::text, '0 0 0 0');
select pg_temp.expect_equal('…but its email records stay, without the guest, so the day''s limits still count them',
  (select count(*)::text from guest_email where kind = 'event_cancelled' and guest_id is null and created_at > now() - interval '1 day'), '20');
select pg_temp.expect_equal('…and the deletion is recorded',
  (select count(*)::text from audit_log where action = 'event.delete_cancelled' and subject_id = '00000000-0000-7000-8000-0000000049d1'), '1');
select pg_temp.expect_equal('…and the planned one stays',
  (select count(*)::text from event where id = '00000000-0000-7000-8000-0000000049d2'), '1');

rollback;
