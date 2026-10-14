-- =============================================================================
-- Checks for migration 0032: "How was it?" emails and reporting a review. One transaction,
-- rolled back.
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

-- A (host), B (another host), C (opted out); business V (owner O, staff S), W (owner P); M on the team.
insert into app_user (id, display_name, given_name, family_name, email) values
  ('00000000-0000-7000-8000-0000000032a1', 'Ann Host', 'Ann', 'Host', 'a-32@example.com'),
  ('00000000-0000-7000-8000-0000000032a2', 'Bo Host', 'Bo', 'Host', 'b-32@example.com'),
  ('00000000-0000-7000-8000-0000000032a3', 'Cy Host', 'Cy', 'Host', 'c-32@example.com'),
  ('00000000-0000-7000-8000-0000000032a4', 'Owner O', 'Olive', 'Owner', 'o-32@example.com'),
  ('00000000-0000-7000-8000-0000000032a5', 'Staff S', 'Sam', 'Staff', 's-32@example.com'),
  ('00000000-0000-7000-8000-0000000032a6', 'Owner P', 'Pat', 'Owner', 'p-32@example.com'),
  ('00000000-0000-7000-8000-0000000032a7', 'Team M', 'Mo', 'Team', 'm-32@example.com');
insert into platform_role (user_id, role) values ('00000000-0000-7000-8000-0000000032a7', 'admin');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000032b1', 'test-town-32', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000032c1', 'test-32-v', 'Thirty-two V', '00000000-0000-7000-8000-0000000032b1', 'admin_entered', 'published', 'claimed', now()),
  ('00000000-0000-7000-8000-0000000032c2', 'test-32-w', 'Thirty-two W', '00000000-0000-7000-8000-0000000032b1', 'admin_entered', 'published', 'claimed', now());
insert into vendor_member (vendor_id, user_id, role) values
  ('00000000-0000-7000-8000-0000000032c1', '00000000-0000-7000-8000-0000000032a4', 'owner'),
  ('00000000-0000-7000-8000-0000000032c1', '00000000-0000-7000-8000-0000000032a5', 'staff'),
  ('00000000-0000-7000-8000-0000000032c2', '00000000-0000-7000-8000-0000000032a6', 'owner');
-- Events: A's 2 days ago (V and W booked); A's today (V booked; not yet: the morning after);
-- B's 70 days ago (too late); B's 10 days ago (V booked, already reviewed); C's 3 days ago (opted out).
insert into event (id, host_user_id, event_date, municipality_id) values
  ('00000000-0000-7000-8000-0000000032f1', '00000000-0000-7000-8000-0000000032a1', current_date - 2, '00000000-0000-7000-8000-0000000032b1'),
  ('00000000-0000-7000-8000-0000000032f2', '00000000-0000-7000-8000-0000000032a1', (now() at time zone 'America/Toronto')::date, '00000000-0000-7000-8000-0000000032b1'),
  ('00000000-0000-7000-8000-0000000032f3', '00000000-0000-7000-8000-0000000032a2', current_date - 70, '00000000-0000-7000-8000-0000000032b1'),
  ('00000000-0000-7000-8000-0000000032f4', '00000000-0000-7000-8000-0000000032a2', current_date - 10, '00000000-0000-7000-8000-0000000032b1'),
  ('00000000-0000-7000-8000-0000000032f5', '00000000-0000-7000-8000-0000000032a3', current_date - 3, '00000000-0000-7000-8000-0000000032b1');
insert into event_vendor (id, event_id, host_user_id, vendor_id, status, booked_at) values
  ('00000000-0000-7000-8000-0000000032e1', '00000000-0000-7000-8000-0000000032f1', '00000000-0000-7000-8000-0000000032a1', '00000000-0000-7000-8000-0000000032c1', 'booked', now() - interval '20 days'),
  ('00000000-0000-7000-8000-0000000032e2', '00000000-0000-7000-8000-0000000032f1', '00000000-0000-7000-8000-0000000032a1', '00000000-0000-7000-8000-0000000032c2', 'booked', now() - interval '20 days'),
  ('00000000-0000-7000-8000-0000000032e3', '00000000-0000-7000-8000-0000000032f2', '00000000-0000-7000-8000-0000000032a1', '00000000-0000-7000-8000-0000000032c1', 'booked', now() - interval '5 days'),
  ('00000000-0000-7000-8000-0000000032e4', '00000000-0000-7000-8000-0000000032f3', '00000000-0000-7000-8000-0000000032a2', '00000000-0000-7000-8000-0000000032c1', 'booked', now() - interval '80 days'),
  ('00000000-0000-7000-8000-0000000032e5', '00000000-0000-7000-8000-0000000032f4', '00000000-0000-7000-8000-0000000032a2', '00000000-0000-7000-8000-0000000032c1', 'booked', now() - interval '20 days'),
  ('00000000-0000-7000-8000-0000000032e6', '00000000-0000-7000-8000-0000000032f5', '00000000-0000-7000-8000-0000000032a3', '00000000-0000-7000-8000-0000000032c2', 'booked', now() - interval '20 days');
-- B's review of V (published), for the reports below.
insert into review (id, event_vendor_id, vendor_id, author_user_id, event_date, rating, body, status, decided_at, decided_by, published_at) values
  ('00000000-0000-7000-8000-000000003291', '00000000-0000-7000-8000-0000000032e5', '00000000-0000-7000-8000-0000000032c1',
   '00000000-0000-7000-8000-0000000032a2', current_date - 10, 2, 'Late and rude.', 'published', now(), '00000000-0000-7000-8000-0000000032a7', now());

set local role app_server;

-- ---------------------------------------------------------------- email choices
select pg_temp.act('person', '00000000-0000-7000-8000-0000000032a3');
insert into email_choice (user_id, review_requests) values ('00000000-0000-7000-8000-0000000032a3', false);
select pg_temp.expect_equal('a person turns off "How was it?" emails for themselves', (
  select review_requests::text from email_choice), 'false');
select pg_temp.expect_code('…never for someone else', $q$
  insert into email_choice (user_id, review_requests) values ('00000000-0000-7000-8000-0000000032a1', false)$q$, '42501');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000032a1');
select pg_temp.expect_equal('another person doesn''t see that choice', (select count(*)::text from email_choice), '0');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000032a4', '00000000-0000-7000-8000-0000000032c1');
select pg_temp.expect_equal('nor does a business', (select count(*)::text from email_choice), '0');

-- ---------------------------------------------------------------- "How was it?"
select pg_temp.act(null, null);
select pg_temp.expect_equal('due now: only A''s event from 2 days ago, with its 2 businesses', (
  select string_agg(kind || ' ' || event_id::text || ' ' || businesses::text || ' ' || coalesce(row_id::text, '-') || ' ' || name, ',')
  from review_requests_due(50)),
  'review_request 00000000-0000-7000-8000-0000000032f1 2 - Ann');
select pg_temp.expect_equal('…claimed as queued, so a second run doesn''t send it again', (
  select count(*)::text from review_requests_due(50)), '0');
reset role;
select pg_temp.expect_equal('…recorded as an email about the event', (
  select status || ' ' || subject_type from notification where kind = 'review_request' and user_id = '00000000-0000-7000-8000-0000000032a1'),
  'queued event');
update notification set status = 'failed', failure_reason = 'test' where kind = 'review_request' and user_id = '00000000-0000-7000-8000-0000000032a1';
set local role app_server;
select pg_temp.expect_equal('one that failed is tried again', (select count(*)::text from review_requests_due(50)), '1');
reset role;
update notification set status = 'failed', failure_reason = 'test' where kind = 'review_request' and status = 'queued';
insert into notification (user_id, kind, subject_type, subject_id, status, failure_reason)
  values ('00000000-0000-7000-8000-0000000032a1', 'review_request', 'event', '00000000-0000-7000-8000-0000000032f1', 'failed', 'test');
set local role app_server;
select pg_temp.expect_equal('…but not after 3 failures', (select count(*)::text from review_requests_due(50)), '0');
reset role;
delete from notification where kind = 'review_request';
insert into notification (user_id, kind, subject_type, subject_id, status, sent_at, created_at)
  values ('00000000-0000-7000-8000-0000000032a1', 'review_request', 'event', '00000000-0000-7000-8000-0000000032f1', 'sent',
          now() - interval '3 days', now() - interval '3 days');
set local role app_server;
select pg_temp.expect_equal('asked 3 days ago: no reminder yet', (select count(*)::text from review_requests_due(50)), '0');
reset role;
update notification set sent_at = now() - interval '7 days', created_at = now() - interval '7 days' where kind = 'review_request';
-- A reviews W meanwhile: the reminder is about V only.
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000032a1');
insert into review (event_vendor_id, author_user_id, rating, body) values
  ('00000000-0000-7000-8000-0000000032e2', '00000000-0000-7000-8000-0000000032a1', 5, 'Lovely.');
select pg_temp.act(null, null);
select pg_temp.expect_equal('a week later: one reminder, about the business not reviewed yet', (
  select string_agg(kind || ' ' || businesses::text || ' ' || coalesce(row_id::text, '-'), ',') from review_requests_due(50)),
  'review_reminder 1 00000000-0000-7000-8000-0000000032e1');
reset role;
update notification set status = 'sent', sent_at = now() where kind = 'review_reminder';
set local role app_server;
select pg_temp.expect_equal('…only one', (select count(*)::text from review_requests_due(50)), '0');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000032a1');
insert into review (event_vendor_id, author_user_id, rating, body) values
  ('00000000-0000-7000-8000-0000000032e1', '00000000-0000-7000-8000-0000000032a1', 4, 'Good.');
-- The site's limit: 20 a day.
reset role;
delete from notification where kind in ('review_request', 'review_reminder');
insert into notification (user_id, kind, subject_type, subject_id, status, sent_at)
  select '00000000-0000-7000-8000-0000000032a2', 'review_request', 'event', gen_random_uuid(), 'sent', now() from generate_series(1, 20);
insert into event_vendor (id, event_id, host_user_id, vendor_id, status, booked_at) values
  ('00000000-0000-7000-8000-0000000032e7', '00000000-0000-7000-8000-0000000032f4', '00000000-0000-7000-8000-0000000032a2', '00000000-0000-7000-8000-0000000032c2', 'booked', now() - interval '20 days');
set local role app_server;
select pg_temp.act(null, null);
select pg_temp.expect_equal('after 20 today, the rest wait for tomorrow', (select count(*)::text from review_requests_due(50)), '0');
reset role;
update notification set created_at = now() - interval '1 day' where kind = 'review_request';
set local role app_server;
select pg_temp.expect_equal('…then go (B''s event 10 days ago, another business booked)', (
  select string_agg(event_id::text, ',') from review_requests_due(50)), '00000000-0000-7000-8000-0000000032f4');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000032a1');
select pg_temp.expect_code('a person can''t claim emails', $q$ select * from review_requests_due(1) $q$, 'LP101');

-- ---------------------------------------------------------------- reporting a review
select pg_temp.act('person', '00000000-0000-7000-8000-0000000032a2');
select pg_temp.expect_code('the author can''t report their own review', $q$
  insert into review_report (review_id, reporter_user_id, reporter_side, reason)
  values ('00000000-0000-7000-8000-000000003291', '00000000-0000-7000-8000-0000000032a2', 'consumer', 'other')$q$, 'LP158');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000032a1');
select pg_temp.expect_code('nobody reports in someone else''s name', $q$
  insert into review_report (review_id, reporter_user_id, reporter_side, reason)
  values ('00000000-0000-7000-8000-000000003291', '00000000-0000-7000-8000-0000000032a3', 'consumer', 'other')$q$, 'LP101');
insert into review_report (review_id, reporter_user_id, reporter_side, reason, details)
  values ('00000000-0000-7000-8000-000000003291', '00000000-0000-7000-8000-0000000032a1', 'vendor', 'offensive', 'Rude words');
select pg_temp.expect_equal('anyone signed in reports a published review, as themselves; the team is to be emailed', (
  select reporter_side || ' ' || status || ' ' || team_email_status from review_report), 'consumer open pending');
select pg_temp.expect_code('…once while it''s open', $q$
  insert into review_report (review_id, reporter_user_id, reporter_side, reason)
  values ('00000000-0000-7000-8000-000000003291', '00000000-0000-7000-8000-0000000032a1', 'consumer', 'other')$q$, 'LP159');
update review_report set team_email_status = 'sent';
select pg_temp.expect_code('the reporter records the email once, nothing else', $q$
  update review_report set status = 'dismissed', decision_note = 'mine'$q$, 'LP100');
select pg_temp.expect_code('a waiting review can''t be reported (it isn''t shown)', $q$
  insert into review_report (review_id, reporter_user_id, reporter_side, reason)
  select r.id, '00000000-0000-7000-8000-0000000032a1', 'consumer', 'other' from review r
  where r.event_vendor_id = '00000000-0000-7000-8000-0000000032e1'$q$, 'LP101');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000032a6', '00000000-0000-7000-8000-0000000032c2');
select pg_temp.expect_code('another business can''t report it', $q$
  insert into review_report (review_id, reporter_user_id, reporter_side, reason)
  values ('00000000-0000-7000-8000-000000003291', '00000000-0000-7000-8000-0000000032a6', 'vendor', 'other')$q$, 'LP101');
select pg_temp.expect_equal('…nor see the reports', (select count(*)::text from review_report), '0');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000032a5', '00000000-0000-7000-8000-0000000032c1');
insert into review_report (review_id, reporter_user_id, reporter_side, reason)
  values ('00000000-0000-7000-8000-000000003291', '00000000-0000-7000-8000-0000000032a5', 'consumer', 'not_genuine');
select pg_temp.expect_equal('anyone on the business''s team reports its own review; the team is emailed once per review', (
  select reporter_side || ' ' || team_email_status from review_report), 'vendor not_needed');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000032a3');
select pg_temp.expect_equal('a reporter sees only their own reports', (select count(*)::text from review_report), '0');

select pg_temp.act('team', '00000000-0000-7000-8000-0000000032a7');
select pg_temp.expect_equal('the team sees every report', (select count(*)::text from review_report), '2');
select pg_temp.expect_code('dismissing needs a reason', $q$
  update review_report set status = 'dismissed' where reporter_user_id = '00000000-0000-7000-8000-0000000032a5'$q$, 'LP157');
update review_report set status = 'dismissed', decision_note = 'It''s an honest review'
where reporter_user_id = '00000000-0000-7000-8000-0000000032a5';
select pg_temp.expect_equal('the team dismisses one, recorded with who', (
  select status || ' ' || (reviewed_by = '00000000-0000-7000-8000-0000000032a7')::text from review_report
  where reporter_user_id = '00000000-0000-7000-8000-0000000032a5'), 'dismissed true');
update review set status = 'removed', decision_reason = 'Abusive words' where id = '00000000-0000-7000-8000-000000003291';
select pg_temp.expect_equal('removing the review closes the open report', (
  select status || ' | ' || decision_note from review_report where reporter_user_id = '00000000-0000-7000-8000-0000000032a1'),
  'actioned | The review was removed: Abusive words');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000032a3');
select pg_temp.expect_code('a removed review can''t be reported', $q$
  insert into review_report (review_id, reporter_user_id, reporter_side, reason)
  values ('00000000-0000-7000-8000-000000003291', '00000000-0000-7000-8000-0000000032a3', 'consumer', 'other')$q$, 'LP101');

-- ---------------------------------------------------------------- a person deletes their account
select pg_temp.act('person', '00000000-0000-7000-8000-0000000032a3');
select delete_my_account();
reset role;
select pg_temp.expect_equal('their email choices go with it', (
  select count(*)::text from email_choice where user_id = '00000000-0000-7000-8000-0000000032a3'), '0');

-- ---------------------------------------------------------------- nobody else
set local role app_server;
select pg_temp.act(null, null);
select pg_temp.expect_equal('nobody acting reads reports or choices', (
  select (select count(*) from review_report) + (select count(*) from email_choice))::text, '0');

rollback;
