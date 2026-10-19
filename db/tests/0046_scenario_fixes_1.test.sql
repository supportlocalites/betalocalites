-- =============================================================================
-- Checks for migration 0046: scenario-test fixes, round 1.
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

-- Pat (person), Ann (owns V).
insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000046a1', 'Pat', 'p-46@example.com'),
  ('00000000-0000-7000-8000-0000000046a9', 'Ann', 'o-46@example.com');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000046b1', 'test-town-46', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000046c1', 'test-46-v', 'V', '00000000-0000-7000-8000-0000000046b1', 'admin_entered', 'published', 'claimed', now());
insert into vendor_member (vendor_id, user_id, role, created_at) values
  ('00000000-0000-7000-8000-0000000046c1', '00000000-0000-7000-8000-0000000046a9', 'owner', now() - interval '1 day');
set local session_replication_role = replica;
insert into event (id, host_user_id, event_date, start_time, municipality_id) values
  ('00000000-0000-7000-8000-0000000046d1', '00000000-0000-7000-8000-0000000046a1', current_date - 3, '14:00', '00000000-0000-7000-8000-0000000046b1');
insert into event_vendor (id, event_id, host_user_id, vendor_id, status, booked_at, vendor_flagged_at, vendor_flagged_by) values
  ('00000000-0000-7000-8000-0000000046e1', '00000000-0000-7000-8000-0000000046d1', '00000000-0000-7000-8000-0000000046a1', '00000000-0000-7000-8000-0000000046c1', 'booked', now() - interval '2 days', null, null);
insert into review (id, event_vendor_id, vendor_id, author_user_id, event_date, rating, body, status) values
  ('00000000-0000-7000-8000-0000000046f1', '00000000-0000-7000-8000-0000000046e1', '00000000-0000-7000-8000-0000000046c1', '00000000-0000-7000-8000-0000000046a1', current_date - 3, 4, 'Lovely cake', 'pending');
insert into review (id, event_vendor_id, vendor_id, author_user_id, event_date, rating, body, status, decided_at, decided_by, decision_reason, language_flag) values
  ('00000000-0000-7000-8000-0000000046f2', null, '00000000-0000-7000-8000-0000000046c1', '00000000-0000-7000-8000-0000000046a1', current_date - 40, 1, 'Old rude words', 'declined', now() - interval '31 days', '00000000-0000-7000-8000-0000000046a9', 'Denied by the team', 'Word list: rude'),
  ('00000000-0000-7000-8000-0000000046f3', null, '00000000-0000-7000-8000-0000000046c1', '00000000-0000-7000-8000-0000000046a1', current_date - 20, 1, 'Recent rude words', 'declined', now() - interval '5 days', '00000000-0000-7000-8000-0000000046a9', 'Denied by the team', null);
insert into conversation (id, consumer_user_id, vendor_id, last_message_at) values
  ('00000000-0000-7000-8000-0000000046d9', '00000000-0000-7000-8000-0000000046a1', '00000000-0000-7000-8000-0000000046c1', now());
insert into message (id, conversation_id, author_user_id, author_side, body, removed_at) values
  ('00000000-0000-7000-8000-000000004601', '00000000-0000-7000-8000-0000000046d9', '00000000-0000-7000-8000-0000000046a1', 'consumer', '', now()),
  ('00000000-0000-7000-8000-000000004602', '00000000-0000-7000-8000-0000000046d9', '00000000-0000-7000-8000-0000000046a1', 'consumer', 'Still here', null);
set local session_replication_role = origin;

set local role app_server;
-- B2: a message taken back isn't emailed about; one still there is.
select pg_temp.act('person', '00000000-0000-7000-8000-0000000046a1');
select pg_temp.expect_equal('a message removed before its email went: nobody is emailed',
  (select count(*)::text from new_message_notices('00000000-0000-7000-8000-000000004601')), '0');
select pg_temp.expect_equal('…one still there: the owner is emailed',
  (select count(*)::text from new_message_notices('00000000-0000-7000-8000-000000004602')), '1');

-- B4: un-marking withdraws the waiting review; marking again brings it back, locked.
update event_vendor set status = 'considering' where id = '00000000-0000-7000-8000-0000000046e1';
reset role;
select pg_temp.expect_equal('un-marking withdraws the waiting review (as before)',
  (select status from review where id = '00000000-0000-7000-8000-0000000046f1'), 'withdrawn');
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000046a1');
update event_vendor set status = 'booked' where id = '00000000-0000-7000-8000-0000000046e1';
reset role;
select pg_temp.expect_equal('marking it again brings the review back, as written, locked',
  (select status || ' ' || body || ' ' || locked::text from review where id = '00000000-0000-7000-8000-0000000046f1'), 'pending Lovely cake true');
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000046a1');
select pg_temp.expect_code('…and its author can''t change it', $q$
  update review set body = 'Changed my mind' where id = '00000000-0000-7000-8000-0000000046f1'$q$, 'LP184');
select pg_temp.expect_code('…nor unlock it', $q$
  update review set locked = false where id = '00000000-0000-7000-8000-0000000046f1'$q$, '42501');
reset role;

-- B5: a business's note stays across un-marking and marking again.
set local role app_server;
select pg_temp.act('business', '00000000-0000-7000-8000-0000000046a9');
select set_config('localites.vendor_id', '00000000-0000-7000-8000-0000000046c1', true);
select * from flag_booking('00000000-0000-7000-8000-0000000046e1', 'Never booked us');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000046a1');
update event_vendor set status = 'considering' where id = '00000000-0000-7000-8000-0000000046e1';
reset role;
select pg_temp.act(null, null);  -- the test's own back-dating, as support work
update event_vendor set vendor_flagged_at = vendor_flagged_at - interval '1 hour' where id = '00000000-0000-7000-8000-0000000046e1';
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000046a1');
update event_vendor set status = 'booked' where id = '00000000-0000-7000-8000-0000000046e1';
reset role;
select pg_temp.expect_equal('a "wasn''t booked" note still counts after un-marking and marking again',
  (select (vendor_flagged_at >= booked_at and flag_resolved_at is null)::text from event_vendor where id = '00000000-0000-7000-8000-0000000046e1'), 'true');
select pg_temp.expect_equal('…the review doesn''t come back while the note counts (a new one would be refused too)',
  (select status from review where id = '00000000-0000-7000-8000-0000000046f1'), 'withdrawn');
select pg_temp.expect_equal('…and carrying the note forward isn''t recorded as a flag by the person',
  (select count(*)::text from status_change where subject_id = '00000000-0000-7000-8000-0000000046e1'
     and field = 'vendor_flag' and actor_kind = 'consumer'), '0');
-- The team settled it as "not a real booking" (as the team's decision will, round 2): still kept.
update event_vendor set flag_resolved_at = now(), flag_outcome = 'booking_not_real' where id = '00000000-0000-7000-8000-0000000046e1';
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000046a1');
update event_vendor set status = 'considering' where id = '00000000-0000-7000-8000-0000000046e1';
reset role;
select pg_temp.act(null, null);  -- the test's own back-dating, as support work
update event_vendor set vendor_flagged_at = vendor_flagged_at - interval '1 hour' where id = '00000000-0000-7000-8000-0000000046e1';
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000046a1');
update event_vendor set status = 'booked' where id = '00000000-0000-7000-8000-0000000046e1';
reset role;
select pg_temp.expect_equal('a note the team settled as "not a real booking" also stays after re-marking',
  (select (vendor_flagged_at >= booked_at)::text from event_vendor where id = '00000000-0000-7000-8000-0000000046e1'), 'true');

-- M6: declined reviews' words go 30 days after the decision.
set local role app_server;
select pg_temp.expect_equal('the morning run erases one declined review''s words', (select erase_declined_review_words()::text), '1');
reset role;
select pg_temp.expect_equal('…the one declined over 30 days ago, not the recent one',
  (select string_agg(body, ' | ' order by id) from review
   where id in ('00000000-0000-7000-8000-0000000046f2', '00000000-0000-7000-8000-0000000046f3')),
  'Erased 30 days after the team declined it. | Recent rude words');
select pg_temp.expect_equal('…with what the language check found in them',
  (select coalesce(language_flag, 'none') from review where id = '00000000-0000-7000-8000-0000000046f2'), 'none');

-- C12: a last name's first character is kept whole.
insert into app_user (id, display_name, email, given_name, family_name) values
  ('00000000-0000-7000-8000-0000000046a2', 'Flag', 'f-46@example.com', 'Kim', U&'\+01F1E8\+01F1E6 Lee'),
  ('00000000-0000-7000-8000-0000000046a3', 'Thumb', 't-46@example.com', 'Jo', U&'\+01F44D\+01F3FD'),
  ('00000000-0000-7000-8000-0000000046a4', 'Accent', 'a-46@example.com', 'Ana', 'élan');
set local role app_server;
select pg_temp.expect_equal('a flag stays whole as the initial', reviewer_name('00000000-0000-7000-8000-0000000046a2'), U&'Kim \+01F1E8\+01F1E6.');
select pg_temp.expect_equal('…an emoji keeps its skin tone', reviewer_name('00000000-0000-7000-8000-0000000046a3'), U&'Jo \+01F44D\+01F3FD.');
select pg_temp.expect_equal('…a letter is a capital as before', reviewer_name('00000000-0000-7000-8000-0000000046a4'), 'Ana É.');
select pg_temp.expect_equal('the business reviews page can ask which reviews have the badge (none here: under 100 reviewers)',
  (select count(*)::text from living_local_reviews('00000000-0000-7000-8000-0000000046c1')), '0');
reset role;
select pg_temp.expect_equal('…but the full list of badge holders isn''t open to the site',
  has_function_privilege('app_server', 'living_local_reviewers()', 'execute')::text, 'false');

rollback;
