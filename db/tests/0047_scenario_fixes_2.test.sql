-- =============================================================================
-- Checks for migration 0047: scenario-test fixes, round 2 (reviews and booking notes).
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

create function pg_temp.act(p_side text, p_user uuid, p_vendor uuid default null) returns void
language plpgsql as $$
begin
  perform set_config('localites.side', coalesce(p_side, ''), true),
          set_config('localites.user_id', coalesce(p_user::text, ''), true),
          set_config('localites.vendor_id', coalesce(p_vendor::text, ''), true);
end $$;

-- Pat and Quinn (people), Ann (owns V), Tess (the team).
insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000047a1', 'Pat', 'p-47@example.com'),
  ('00000000-0000-7000-8000-0000000047a2', 'Quinn', 'q-47@example.com'),
  ('00000000-0000-7000-8000-0000000047a7', 'Tess', 't-47@example.com'),
  ('00000000-0000-7000-8000-0000000047a9', 'Ann', 'o-47@example.com');
insert into platform_role (user_id, role) values ('00000000-0000-7000-8000-0000000047a7', 'admin');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000047b1', 'test-town-47', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000047c1', 'test-47-v', 'V', '00000000-0000-7000-8000-0000000047b1', 'admin_entered', 'published', 'claimed', now());
insert into vendor_member (vendor_id, user_id, role, created_at) values
  ('00000000-0000-7000-8000-0000000047c1', '00000000-0000-7000-8000-0000000047a9', 'owner', now() - interval '30 days');
set local session_replication_role = replica;
-- Four of Pat's events, all three days ago.
insert into event (id, host_user_id, event_date, start_time, municipality_id) values
  ('00000000-0000-7000-8000-0000000047d1', '00000000-0000-7000-8000-0000000047a1', current_date - 3, '14:00', '00000000-0000-7000-8000-0000000047b1'),
  ('00000000-0000-7000-8000-0000000047d2', '00000000-0000-7000-8000-0000000047a1', current_date - 3, '14:00', '00000000-0000-7000-8000-0000000047b1'),
  ('00000000-0000-7000-8000-0000000047d3', '00000000-0000-7000-8000-0000000047a1', current_date - 3, '14:00', '00000000-0000-7000-8000-0000000047b1'),
  ('00000000-0000-7000-8000-0000000047d4', '00000000-0000-7000-8000-0000000047a1', current_date - 3, '14:00', '00000000-0000-7000-8000-0000000047b1');
-- e1: booked before the event, with a waiting review. e2: marked booked an hour ago, after
-- the event. e3: flagged by V, with a published review. e4: flagged by V, no review.
insert into event_vendor (id, event_id, host_user_id, vendor_id, status, booked_at, vendor_flagged_at, vendor_flagged_by) values
  ('00000000-0000-7000-8000-0000000047e1', '00000000-0000-7000-8000-0000000047d1', '00000000-0000-7000-8000-0000000047a1', '00000000-0000-7000-8000-0000000047c1', 'booked', now() - interval '10 days', null, null),
  ('00000000-0000-7000-8000-0000000047e2', '00000000-0000-7000-8000-0000000047d2', '00000000-0000-7000-8000-0000000047a1', '00000000-0000-7000-8000-0000000047c1', 'booked', now() - interval '1 hour', null, null),
  ('00000000-0000-7000-8000-0000000047e3', '00000000-0000-7000-8000-0000000047d3', '00000000-0000-7000-8000-0000000047a1', '00000000-0000-7000-8000-0000000047c1', 'booked', now() - interval '10 days', now() - interval '1 day', '00000000-0000-7000-8000-0000000047a9'),
  ('00000000-0000-7000-8000-0000000047e4', '00000000-0000-7000-8000-0000000047d4', '00000000-0000-7000-8000-0000000047a1', '00000000-0000-7000-8000-0000000047c1', 'booked', now() - interval '10 days', now() - interval '1 day', '00000000-0000-7000-8000-0000000047a9');
insert into review (id, event_vendor_id, vendor_id, author_user_id, event_date, rating, body, status) values
  ('00000000-0000-7000-8000-0000000047f1', '00000000-0000-7000-8000-0000000047e1', '00000000-0000-7000-8000-0000000047c1', '00000000-0000-7000-8000-0000000047a1', current_date - 3, 4, 'Lovely cake', 'pending');
insert into review (id, event_vendor_id, vendor_id, author_user_id, event_date, rating, body, status, decided_at, decided_by, published_at) values
  ('00000000-0000-7000-8000-0000000047f3', '00000000-0000-7000-8000-0000000047e3', '00000000-0000-7000-8000-0000000047c1', '00000000-0000-7000-8000-0000000047a1', current_date - 3, 2, 'Never showed up', 'published', now() - interval '2 days', '00000000-0000-7000-8000-0000000047a7', now() - interval '2 days');
update event_vendor set booked_after_event = true where id = '00000000-0000-7000-8000-0000000047e2';
set local session_replication_role = origin;

set local role app_server;

-- M4: withdrawing a waiting review.
select pg_temp.act('person', '00000000-0000-7000-8000-0000000047a2');
select pg_temp.expect_code('someone else can''t withdraw Pat''s review',
  $q$select withdraw_my_review('00000000-0000-7000-8000-0000000047f1')$q$, 'LP101');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000047a1');
select pg_temp.expect_code('a published review can''t be withdrawn (it can be asked to be removed)',
  $q$select withdraw_my_review('00000000-0000-7000-8000-0000000047f3')$q$, 'LP186');
select withdraw_my_review('00000000-0000-7000-8000-0000000047f1');
select pg_temp.expect_equal('Pat withdraws the waiting review',
  (select status || ' ' || withdrawn_by_author::text from review where id = '00000000-0000-7000-8000-0000000047f1'), 'withdrawn true');
update event_vendor set status = 'considering' where id = '00000000-0000-7000-8000-0000000047e1';
update event_vendor set status = 'booked' where id = '00000000-0000-7000-8000-0000000047e1';
select pg_temp.expect_equal('…and it doesn''t come back when the booking is marked again',
  (select status from review where id = '00000000-0000-7000-8000-0000000047f1'), 'withdrawn');
select pg_temp.expect_code('…nor can it be written again',
  $q$update review set body = 'Again' where id = '00000000-0000-7000-8000-0000000047f1'$q$, 'LP155');

-- M4: asking for a published review to be removed.
select pg_temp.expect_code('its author can''t report it for another reason',
  $q$insert into review_report (review_id, reporter_user_id, reporter_side, reason)
     values ('00000000-0000-7000-8000-0000000047f3', '00000000-0000-7000-8000-0000000047a1', 'consumer', 'offensive')$q$, 'LP158');
insert into review_report (review_id, reporter_user_id, reporter_side, reason, details)
  values ('00000000-0000-7000-8000-0000000047f3', '00000000-0000-7000-8000-0000000047a1', 'consumer', 'author_request', 'Please take it down');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000047a2');
select pg_temp.expect_code('nobody else can ask for it to be removed as its author',
  $q$insert into review_report (review_id, reporter_user_id, reporter_side, reason)
     values ('00000000-0000-7000-8000-0000000047f3', '00000000-0000-7000-8000-0000000047a2', 'consumer', 'author_request')$q$, 'LP100');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000047a9', '00000000-0000-7000-8000-0000000047c1');
select pg_temp.expect_code('…nor the business',
  $q$insert into review_report (review_id, reporter_user_id, reporter_side, reason)
     values ('00000000-0000-7000-8000-0000000047f3', '00000000-0000-7000-8000-0000000047a9', 'vendor', 'author_request')$q$, 'LP100');
reset role;
select pg_temp.expect_equal('the author''s request waits for the team',
  (select reason || ' ' || status from review_report where review_id = '00000000-0000-7000-8000-0000000047f3'), 'author_request open');

-- M9: a business marked booked after the event: reviews open 24 hours later.
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000047a1');
select pg_temp.expect_code('marked booked an hour ago, after the event: not yet',
  $q$insert into review (event_vendor_id, author_user_id, rating, body)
     values ('00000000-0000-7000-8000-0000000047e2', '00000000-0000-7000-8000-0000000047a1', 5, 'Great')$q$, 'LP185');
select pg_temp.expect_code('the site can''t say a booking was marked before the event',
  $q$update event_vendor set booked_after_event = false where id = '00000000-0000-7000-8000-0000000047e2'$q$, '42501');
-- Moving the event to just before the marking doesn't open reviews early (independent review).
-- (Toronto time: it now ends 10 minutes ago, after the marking an hour ago.)
update event set event_date = ((now() - interval '10 minutes') at time zone 'America/Toronto')::date,
                 start_time = ((now() - interval '12 minutes') at time zone 'America/Toronto')::time(0),
                 end_time = ((now() - interval '10 minutes') at time zone 'America/Toronto')::time(0)
  where id = '00000000-0000-7000-8000-0000000047d2';
select pg_temp.expect_code('…nor does moving the event afterwards',
  $q$insert into review (event_vendor_id, author_user_id, rating, body)
     values ('00000000-0000-7000-8000-0000000047e2', '00000000-0000-7000-8000-0000000047a1', 5, 'Great')$q$, 'LP185');
reset role;
-- e1 was marked again (by Pat, above) three days after its event: recorded as it was marked.
select pg_temp.expect_equal('a business marked booked after its event is recorded so as it''s marked',
  (select booked_after_event::text from event_vendor where id = '00000000-0000-7000-8000-0000000047e1'), 'true');
update event_vendor set booked_at = now() - interval '25 hours' where id = '00000000-0000-7000-8000-0000000047e2';
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000047a1');
insert into review (id, event_vendor_id, author_user_id, rating, body)
  values ('00000000-0000-7000-8000-0000000047f2', '00000000-0000-7000-8000-0000000047e2', '00000000-0000-7000-8000-0000000047a1', 5, 'Great');
select pg_temp.expect_equal('…25 hours after the marking, it can be reviewed',
  (select status from review where id = '00000000-0000-7000-8000-0000000047f2'), 'pending');
select pg_temp.expect_code('a person can''t ask when a booking was marked',
  $q$select * from review_booking_timing('00000000-0000-7000-8000-0000000047f2')$q$, 'LP101');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000047a7');
select pg_temp.expect_equal('the team sees it was marked after the event, and a day before the review',
  (select booked_after_event::text || ' ' || (reviewed_at - booked_at > interval '24 hours')::text
   from review_booking_timing('00000000-0000-7000-8000-0000000047f2')), 'true true');

-- M8: the team decides a booking note.
select pg_temp.act('person', '00000000-0000-7000-8000-0000000047a1');
select pg_temp.expect_code('a person can''t decide a booking note',
  $q$select * from decide_booking_flag('00000000-0000-7000-8000-0000000047e3', 'stands')$q$, 'LP101');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000047a9', '00000000-0000-7000-8000-0000000047c1');
select pg_temp.expect_code('…nor the business',
  $q$select * from decide_booking_flag('00000000-0000-7000-8000-0000000047e3', 'not_real')$q$, 'LP101');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000047a7');
select pg_temp.expect_code('a booking nobody flagged can''t be decided',
  $q$select * from decide_booking_flag('00000000-0000-7000-8000-0000000047e1', 'stands')$q$, 'LP101');
select pg_temp.expect_equal('the team says e3 wasn''t real: its published review is removed',
  (select review_removed::text from decide_booking_flag('00000000-0000-7000-8000-0000000047e3', 'not_real')), 'true');
reset role;
select pg_temp.expect_equal('…the review is removed with a reason, and the author''s request is closed with it',
  (select r.status || ' ' || (r.decision_reason is not null)::text || ' ' || x.status
   from review r join review_report x on x.review_id = r.id where r.id = '00000000-0000-7000-8000-0000000047f3'), 'removed true actioned');
select pg_temp.expect_equal('…recorded as the team''s decision',
  (select actor_kind || ' ' || to_status from status_change where subject_id = '00000000-0000-7000-8000-0000000047e3' and field = 'flag_outcome'),
  'admin booking_not_real');
set local role app_server;
select pg_temp.act('team', '00000000-0000-7000-8000-0000000047a7');
select pg_temp.expect_code('…and it stays decided',
  $q$select * from decide_booking_flag('00000000-0000-7000-8000-0000000047e3', 'stands')$q$, 'LP109');
select pg_temp.expect_code('only "stands" or "not real"',
  $q$select * from decide_booking_flag('00000000-0000-7000-8000-0000000047e4', 'maybe')$q$, 'LP109');
select pg_temp.expect_equal('the team says e4 stands: nothing removed',
  (select review_removed::text from decide_booking_flag('00000000-0000-7000-8000-0000000047e4', 'stands')), 'false');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000047a1');
insert into review (id, event_vendor_id, author_user_id, rating, body)
  values ('00000000-0000-7000-8000-0000000047f4', '00000000-0000-7000-8000-0000000047e4', '00000000-0000-7000-8000-0000000047a1', 4, 'Fine');
select pg_temp.expect_equal('…so Pat can review it',
  (select status from review where id = '00000000-0000-7000-8000-0000000047f4'), 'pending');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000047a9', '00000000-0000-7000-8000-0000000047c1');
select pg_temp.expect_code('the business can''t flag a booking the team says stands',
  $q$select * from flag_booking('00000000-0000-7000-8000-0000000047e4', null)$q$, 'LP110');
reset role;
-- Pat un-marks and marks e4 again (an hour later): the business may flag the new marking,
-- and that flag counts afresh.
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000047a1');
update event_vendor set status = 'considering' where id = '00000000-0000-7000-8000-0000000047e4';
reset role;
select pg_temp.act(null, null);
update event_vendor set vendor_flagged_at = vendor_flagged_at - interval '1 hour' where id = '00000000-0000-7000-8000-0000000047e4';
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000047a1');
update event_vendor set status = 'booked' where id = '00000000-0000-7000-8000-0000000047e4';
select pg_temp.act('business', '00000000-0000-7000-8000-0000000047a9', '00000000-0000-7000-8000-0000000047c1');
select * from flag_booking('00000000-0000-7000-8000-0000000047e4', 'Not again');
reset role;
select pg_temp.expect_equal('a flag on the new marking starts afresh: undecided, and it counts',
  (select (flag_outcome is null and flag_resolved_at is null and vendor_flagged_at >= booked_at)::text
   from event_vendor where id = '00000000-0000-7000-8000-0000000047e4'), 'true');


-- M6+: a review its author withdrew loses its words 30 days later.
set local session_replication_role = replica;   -- back-dated as written (the rules set updated_at themselves)
update review set updated_at = now() - interval '31 days' where id = '00000000-0000-7000-8000-0000000047f1';
set local session_replication_role = origin;
set local role app_server;
select erase_declined_review_words();
reset role;
select pg_temp.expect_equal('a review withdrawn by its author over 30 days ago has its words erased',
  (select body from review where id = '00000000-0000-7000-8000-0000000047f1'), 'Erased 30 days after its author withdrew it.');

rollback;
