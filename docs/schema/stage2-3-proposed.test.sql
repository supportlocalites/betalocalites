-- =============================================================================
-- Checks for docs/schema/stage2-3-proposed.sql
-- =============================================================================
-- Proves the database itself enforces the consumer–vendor relationship rules.
-- Run by `npm run test:db` on top of the real migrations (0001–0012) and the
-- remaining proposal (stage2-3-proposed.sql).
-- Runs in one transaction and is rolled back. Uses obviously fake data.
--
-- Cast of characters (all fake):
--   Consumer A, Consumer B           people planning events
--   Owner V, Staff S, Former X       Test Vendor 1's team (X has left)
--   Owner W                          owns Test Vendors 3 and 4
--   Outsider O                       nobody's anybody
--   Admin M                          the platform team
-- =============================================================================

begin;

create function pg_temp.expect_reject(label text, stmt text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'PASS  %  (rejected: %)', label, sqlerrm;
    return;
  end;
  raise exception 'FAIL  %: statement was accepted but must be rejected', label;
end $$;

create function pg_temp.expect_accept(label text, stmt text) returns void
language plpgsql as $$
begin
  execute stmt;
  raise notice 'PASS  %  (accepted)', label;
end $$;

-- ---------------------------------------------------------------- fixtures ---
insert into app_user (id, display_name, email) values
  ('10000000-0000-7000-8000-000000000001', 'Consumer A', 'a@example.com'),
  ('10000000-0000-7000-8000-000000000002', 'Consumer B', 'b@example.com'),
  ('10000000-0000-7000-8000-000000000003', 'Owner V',    'v@example.com'),
  ('10000000-0000-7000-8000-000000000004', 'Staff S',    's@example.com'),
  ('10000000-0000-7000-8000-000000000005', 'Outsider O', 'o@example.com'),
  ('10000000-0000-7000-8000-000000000006', 'Admin M',    'm@example.com'),
  ('10000000-0000-7000-8000-000000000007', 'Former X',   'x@example.com'),
  ('10000000-0000-7000-8000-000000000008', 'Owner W',    'w@example.com');

insert into municipality (id, slug, name, region) values
  ('20000000-0000-7000-8000-000000000001', 'test-town', 'Test Town', 'Test County');

insert into vendor (id, slug, display_name, primary_municipality_id, source, claim_status) values
  ('30000000-0000-7000-8000-000000000001', 'test-vendor-1', 'Test Vendor 1', '20000000-0000-7000-8000-000000000001', 'admin_entered', 'claimed'),
  ('30000000-0000-7000-8000-000000000002', 'test-vendor-2', 'Test Vendor 2', '20000000-0000-7000-8000-000000000001', 'admin_entered', 'unclaimed'),
  ('30000000-0000-7000-8000-000000000003', 'test-vendor-3', 'Test Vendor 3', '20000000-0000-7000-8000-000000000001', 'admin_entered', 'claimed'),
  ('30000000-0000-7000-8000-000000000004', 'test-vendor-4', 'Test Vendor 4', '20000000-0000-7000-8000-000000000001', 'admin_entered', 'claimed');

insert into vendor_member (vendor_id, user_id, role, ended_at) values
  ('30000000-0000-7000-8000-000000000001', '10000000-0000-7000-8000-000000000003', 'owner', null),
  ('30000000-0000-7000-8000-000000000001', '10000000-0000-7000-8000-000000000004', 'staff', null),
  ('30000000-0000-7000-8000-000000000001', '10000000-0000-7000-8000-000000000007', 'manager', now() - interval '1 day'),
  ('30000000-0000-7000-8000-000000000003', '10000000-0000-7000-8000-000000000008', 'owner', null),
  ('30000000-0000-7000-8000-000000000004', '10000000-0000-7000-8000-000000000008', 'owner', null);

-- The real types are seeded by migration 0012; this one is the file's own.
insert into event_type (id, key, name) values
  ('40000000-0000-7000-8000-000000000001', 'test_party', 'Test party');

insert into event (id, host_user_id, event_type_id, municipality_id, event_date) values
  ('50000000-0000-7000-8000-000000000001', '10000000-0000-7000-8000-000000000001', '40000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000001', current_date - 10),
  ('50000000-0000-7000-8000-000000000002', '10000000-0000-7000-8000-000000000001', '40000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000001', current_date + 20),
  ('50000000-0000-7000-8000-000000000003', '10000000-0000-7000-8000-000000000002', '40000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000001', current_date - 12),
  ('50000000-0000-7000-8000-000000000004', '10000000-0000-7000-8000-000000000001', '40000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000001', current_date - 30),
  ('50000000-0000-7000-8000-000000000005', '10000000-0000-7000-8000-000000000001', '40000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000001', current_date - 90);

insert into media_asset (id, owner_kind, owner_id, bucket, storage_path, mime_type, byte_size, uploaded_by) values
  ('80000000-0000-7000-8000-000000000001', 'user', '10000000-0000-7000-8000-000000000001', 'private', 'c/a/1.pdf',  'application/pdf', 5000, '10000000-0000-7000-8000-000000000001'),
  ('80000000-0000-7000-8000-000000000002', 'user', '10000000-0000-7000-8000-000000000001', 'public',  'c/a/2.webp', 'image/webp',      5000, '10000000-0000-7000-8000-000000000001'),
  ('80000000-0000-7000-8000-000000000003', 'user', '10000000-0000-7000-8000-000000000002', 'private', 'c/b/3.pdf',  'application/pdf', 5000, '10000000-0000-7000-8000-000000000002'),
  ('80000000-0000-7000-8000-000000000004', 'user', '10000000-0000-7000-8000-000000000004', 'private', 'c/s/4.pdf',  'application/pdf', 5000, '10000000-0000-7000-8000-000000000004');

-- ------------------------------------------------------------ event plans ---
-- The event-plan checks now live with the migration: db/tests/0012_event_plans.test.sql.
-- This file needs one plan row: A considering Test Vendor 1 for her past party.
insert into event_vendor (id, event_id, vendor_id, host_user_id) values
  ('90000000-0000-7000-8000-000000000001', '50000000-0000-7000-8000-000000000001', '30000000-0000-7000-8000-000000000001', '10000000-0000-7000-8000-000000000001');

-- ------------------------------------------- conversations and messages ---
-- Their checks now live with the migration: db/tests/0023_conversations.test.sql. This file
-- needs one conversation with three messages for the file checks below.
insert into conversation (id, consumer_user_id, vendor_id, event_id) values
  ('60000000-0000-7000-8000-000000000001', '10000000-0000-7000-8000-000000000001', '30000000-0000-7000-8000-000000000001', '50000000-0000-7000-8000-000000000001');
insert into message (id, conversation_id, author_user_id, author_side, body) values
  ('70000000-0000-7000-8000-000000000001', '60000000-0000-7000-8000-000000000001', '10000000-0000-7000-8000-000000000001', 'consumer', 'Are you free on the 14th?'),
  ('70000000-0000-7000-8000-000000000002', '60000000-0000-7000-8000-000000000001', '10000000-0000-7000-8000-000000000004', 'vendor', 'Yes! Invoice attached.');

-- ------------------------------------------------------------------ files ---
select pg_temp.expect_reject('file stored publicly',
  $q$insert into message_attachment (message_id, media_asset_id)
     values ('70000000-0000-7000-8000-000000000001', '80000000-0000-7000-8000-000000000002')$q$);
select pg_temp.expect_reject('attaching someone else''s upload',
  $q$insert into message_attachment (message_id, media_asset_id)
     values ('70000000-0000-7000-8000-000000000001', '80000000-0000-7000-8000-000000000003')$q$);
select pg_temp.expect_accept('vendor staff shares a PDF (e.g. an invoice) in the conversation',
  $q$insert into message_attachment (message_id, media_asset_id)
     values ('70000000-0000-7000-8000-000000000002', '80000000-0000-7000-8000-000000000004')$q$);
insert into message (id, conversation_id, author_user_id, author_side, body) values
  ('70000000-0000-7000-8000-000000000003', '60000000-0000-7000-8000-000000000001', '10000000-0000-7000-8000-000000000004', 'vendor', 'Sending it again');
select pg_temp.expect_reject('same file attached to a second message (same uploader)',
  $q$insert into message_attachment (message_id, media_asset_id)
     values ('70000000-0000-7000-8000-000000000003', '80000000-0000-7000-8000-000000000004')$q$);

-- ------------------------------------------------------- feedback request ---
select pg_temp.expect_reject('feedback request for a vendor not marked booked',
  $q$insert into review_request (event_vendor_id, scheduled_for, expires_at)
     values ('90000000-0000-7000-8000-000000000001', now(), now() + interval '60 days')$q$);

-- ---------------------------------------------------------------- reviews ---
select pg_temp.expect_reject('review of a vendor only "considering"',
  $q$insert into review (event_vendor_id, author_user_id, rating)
     values ('90000000-0000-7000-8000-000000000001', '10000000-0000-7000-8000-000000000001', 5)$q$);
select pg_temp.expect_accept('A marks Test Vendor 1 as booked',
  $q$update event_vendor set status = 'booked', booked_at = now()
     where id = '90000000-0000-7000-8000-000000000001'$q$);
select pg_temp.expect_accept('feedback request for a booked vendor',
  $q$insert into review_request (event_vendor_id, scheduled_for, expires_at)
     values ('90000000-0000-7000-8000-000000000001', now(), now() + interval '60 days')$q$);
select pg_temp.expect_reject('feedback request marked sent with no send time',
  $q$update review_request set status = 'sent'
     where event_vendor_id = '90000000-0000-7000-8000-000000000001'$q$);
select pg_temp.expect_reject('review written by someone other than the host',
  $q$insert into review (event_vendor_id, author_user_id, rating)
     values ('90000000-0000-7000-8000-000000000001', '10000000-0000-7000-8000-000000000002', 1)$q$);

insert into event_vendor (id, event_id, vendor_id, host_user_id, status, booked_at) values
  ('90000000-0000-7000-8000-000000000002', '50000000-0000-7000-8000-000000000002', '30000000-0000-7000-8000-000000000001', '10000000-0000-7000-8000-000000000001', 'booked', now());
select pg_temp.expect_reject('review before the event has happened',
  $q$insert into review (event_vendor_id, author_user_id, rating)
     values ('90000000-0000-7000-8000-000000000002', '10000000-0000-7000-8000-000000000001', 5)$q$);

insert into event_vendor (id, event_id, vendor_id, host_user_id, status, booked_at) values
  ('90000000-0000-7000-8000-000000000005', '50000000-0000-7000-8000-000000000005', '30000000-0000-7000-8000-000000000001', '10000000-0000-7000-8000-000000000001', 'booked', now());
select pg_temp.expect_reject('review after the 60-day window',
  $q$insert into review (event_vendor_id, author_user_id, rating)
     values ('90000000-0000-7000-8000-000000000005', '10000000-0000-7000-8000-000000000001', 5)$q$);

-- Test Vendor 3: booked, but the vendor never replied on Localites.
insert into conversation (id, consumer_user_id, vendor_id) values
  ('60000000-0000-7000-8000-000000000003', '10000000-0000-7000-8000-000000000001', '30000000-0000-7000-8000-000000000003');
insert into message (conversation_id, author_user_id, author_side, body) values
  ('60000000-0000-7000-8000-000000000003', '10000000-0000-7000-8000-000000000001', 'consumer', 'Hi there');
insert into event_vendor (id, event_id, vendor_id, host_user_id, status, booked_at) values
  ('90000000-0000-7000-8000-000000000003', '50000000-0000-7000-8000-000000000001', '30000000-0000-7000-8000-000000000003', '10000000-0000-7000-8000-000000000001', 'booked', now());
-- D-06 option B: allowed, but recorded as planned outside Localites, even if the
-- app claims otherwise.
select pg_temp.expect_accept('review with no conversation reply from the vendor (D-06 B)',
  $q$insert into review (id, event_vendor_id, author_user_id, rating, planned_on_localites)
     values ('a0000000-0000-7000-8000-000000000003', '90000000-0000-7000-8000-000000000003', '10000000-0000-7000-8000-000000000001', 1, true)$q$);
do $$ begin
  if (select planned_on_localites from review where id = 'a0000000-0000-7000-8000-000000000003') then
    raise exception 'FAIL  a review with no vendor reply was recorded as planned on Localites';
  end if;
  raise notice 'PASS  review with no vendor reply is recorded as planned outside Localites (app''s claim ignored)';
end $$;
select pg_temp.expect_reject('changing whether a review was planned on Localites',
  $q$update review set planned_on_localites = true where id = 'a0000000-0000-7000-8000-000000000003'$q$);

-- Test Vendor 4: they talked, but the vendor flagged the booking as not real.
insert into conversation (id, consumer_user_id, vendor_id) values
  ('60000000-0000-7000-8000-000000000004', '10000000-0000-7000-8000-000000000001', '30000000-0000-7000-8000-000000000004');
insert into message (conversation_id, author_user_id, author_side, body) values
  ('60000000-0000-7000-8000-000000000004', '10000000-0000-7000-8000-000000000001', 'consumer', 'Hi'),
  ('60000000-0000-7000-8000-000000000004', '10000000-0000-7000-8000-000000000008', 'vendor', 'Sorry, we''re fully booked');
insert into event_vendor (id, event_id, vendor_id, host_user_id, status, booked_at, vendor_flagged_at, vendor_flagged_by) values
  ('90000000-0000-7000-8000-000000000004', '50000000-0000-7000-8000-000000000001', '30000000-0000-7000-8000-000000000004', '10000000-0000-7000-8000-000000000001', 'booked', now(), now(), '10000000-0000-7000-8000-000000000008');
select pg_temp.expect_reject('review of a booking the vendor has flagged',
  $q$insert into review (event_vendor_id, author_user_id, rating)
     values ('90000000-0000-7000-8000-000000000004', '10000000-0000-7000-8000-000000000001', 1)$q$);
select pg_temp.expect_accept('platform team confirms the booking stands',
  $q$update event_vendor set flag_resolved_at = now(), flag_outcome = 'booking_stands'
     where id = '90000000-0000-7000-8000-000000000004'$q$);
select pg_temp.expect_accept('review allowed once the flag is resolved in the consumer''s favour',
  $q$insert into review (event_vendor_id, author_user_id, rating, body)
     values ('90000000-0000-7000-8000-000000000004', '10000000-0000-7000-8000-000000000001', 2, 'Test review')$q$);

select pg_temp.expect_reject('rating of 6 stars',
  $q$insert into review (event_vendor_id, author_user_id, rating)
     values ('90000000-0000-7000-8000-000000000001', '10000000-0000-7000-8000-000000000001', 6)$q$);
select pg_temp.expect_reject('review that skips the platform team''s check',
  $q$insert into review (event_vendor_id, author_user_id, rating, moderation_status, moderated_by, moderated_at, published_at)
     values ('90000000-0000-7000-8000-000000000001', '10000000-0000-7000-8000-000000000001', 5, 'published',
             '10000000-0000-7000-8000-000000000006', now(), now())$q$);
select pg_temp.expect_accept('A reviews Test Vendor 1: booked, event passed, they talked',
  $q$insert into review (id, event_vendor_id, author_user_id, rating, body)
     values ('a0000000-0000-7000-8000-000000000001', '90000000-0000-7000-8000-000000000001', '10000000-0000-7000-8000-000000000001', 5, 'Test review')$q$);
do $$ begin
  if not (select planned_on_localites from review where id = 'a0000000-0000-7000-8000-000000000001') then
    raise exception 'FAIL  a review after a Localites conversation was not recorded as planned on Localites';
  end if;
  raise notice 'PASS  review after a Localites conversation is recorded as planned on Localites';
end $$;
select pg_temp.expect_reject('second review of the same booking',
  $q$insert into review (event_vendor_id, author_user_id, rating)
     values ('90000000-0000-7000-8000-000000000001', '10000000-0000-7000-8000-000000000001', 4)$q$);
select pg_temp.expect_reject('publishing without recording who checked it',
  $q$update review set moderation_status = 'published', published_at = now()
     where id = 'a0000000-0000-7000-8000-000000000001'$q$);
select pg_temp.expect_accept('platform team publishes the review',
  $q$update review set moderation_status = 'published', published_at = now(),
            moderated_by = '10000000-0000-7000-8000-000000000006', moderated_at = now()
     where id = 'a0000000-0000-7000-8000-000000000001'$q$);
select pg_temp.expect_reject('changing the rating after publication',
  $q$update review set rating = 1 where id = 'a0000000-0000-7000-8000-000000000001'$q$);
select pg_temp.expect_reject('vendor staff (not owner/manager) replies to the review',
  $q$update review set vendor_reply = 'Thanks!', vendor_replied_at = now(),
            vendor_replied_by = '10000000-0000-7000-8000-000000000004'
     where id = 'a0000000-0000-7000-8000-000000000001'$q$);
select pg_temp.expect_accept('vendor owner replies once',
  $q$update review set vendor_reply = 'Thanks!', vendor_replied_at = now(),
            vendor_replied_by = '10000000-0000-7000-8000-000000000003'
     where id = 'a0000000-0000-7000-8000-000000000001'$q$);
select pg_temp.expect_reject('vendor owner replies a second time',
  $q$update review set vendor_reply = 'Thanks again!'
     where id = 'a0000000-0000-7000-8000-000000000001'$q$);

-- --------------------------------------------- rating shown only from 3 ---
do $$
declare s record;
begin
  select * into s from vendor_rating_summary where vendor_id = '30000000-0000-7000-8000-000000000001';
  if s.review_count <> 1 or s.average_rating is not null then
    raise exception 'FAIL  one review: expected count 1 and no average, got % / %', s.review_count, s.average_rating;
  end if;
  raise notice 'PASS  one published review: counted, but no average shown';
end $$;

-- Two more genuine bookings of Test Vendor 1: Consumer B's party and A's older party.
insert into conversation (id, consumer_user_id, vendor_id) values
  ('60000000-0000-7000-8000-000000000002', '10000000-0000-7000-8000-000000000002', '30000000-0000-7000-8000-000000000001');
insert into message (conversation_id, author_user_id, author_side, body) values
  ('60000000-0000-7000-8000-000000000002', '10000000-0000-7000-8000-000000000002', 'consumer', 'Hi'),
  ('60000000-0000-7000-8000-000000000002', '10000000-0000-7000-8000-000000000003', 'vendor', 'Hello!');
insert into event_vendor (id, event_id, vendor_id, host_user_id, status, booked_at) values
  ('90000000-0000-7000-8000-000000000006', '50000000-0000-7000-8000-000000000003', '30000000-0000-7000-8000-000000000001', '10000000-0000-7000-8000-000000000002', 'booked', now()),
  ('90000000-0000-7000-8000-000000000007', '50000000-0000-7000-8000-000000000004', '30000000-0000-7000-8000-000000000001', '10000000-0000-7000-8000-000000000001', 'booked', now());
insert into review (event_vendor_id, author_user_id, rating, moderation_status, moderated_by, moderated_at, published_at)
  select '90000000-0000-7000-8000-000000000006', '10000000-0000-7000-8000-000000000002', 4, 'pending', null, null, null;
update review set moderation_status = 'published', published_at = now(),
       moderated_by = '10000000-0000-7000-8000-000000000006', moderated_at = now()
 where event_vendor_id = '90000000-0000-7000-8000-000000000006';
insert into review (event_vendor_id, author_user_id, rating) values
  ('90000000-0000-7000-8000-000000000007', '10000000-0000-7000-8000-000000000001', 3);

do $$
declare s record;
begin
  select * into s from vendor_rating_summary where vendor_id = '30000000-0000-7000-8000-000000000001';
  if s.review_count <> 2 or s.average_rating is not null then
    raise exception 'FAIL  pending review must not count: got % / %', s.review_count, s.average_rating;
  end if;
  raise notice 'PASS  a pending review is not counted until the platform team publishes it';
end $$;

update review set moderation_status = 'published', published_at = now(),
       moderated_by = '10000000-0000-7000-8000-000000000006', moderated_at = now()
 where event_vendor_id = '90000000-0000-7000-8000-000000000007';

do $$
declare s record;
begin
  select * into s from vendor_rating_summary where vendor_id = '30000000-0000-7000-8000-000000000001';
  if s.review_count <> 3 or s.average_rating <> 4.0 then
    raise exception 'FAIL  three reviews (5,4,3): expected 3 / 4.0, got % / %', s.review_count, s.average_rating;
  end if;
  raise notice 'PASS  three published reviews: average of 4.0 now shown';
end $$;

-- ---------------------------------------------------------- notifications ---
select pg_temp.expect_reject('email marked sent with no send time',
  $q$insert into notification (user_id, kind, subject_type, subject_id, status)
     values ('10000000-0000-7000-8000-000000000003', 'new_message', 'conversation',
             '60000000-0000-7000-8000-000000000001', 'sent')$q$);
select pg_temp.expect_reject('email marked failed with no reason',
  $q$insert into notification (user_id, kind, subject_type, subject_id, status)
     values ('10000000-0000-7000-8000-000000000003', 'new_message', 'conversation',
             '60000000-0000-7000-8000-000000000001', 'failed')$q$);

-- ----------------------------------------------- browser roles see nothing ---
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end $$;
grant usage on schema public to anon;
grant select on conversation, message, event, review to anon;
set local role anon;
do $$
declare n int;
begin
  select (select count(*) from conversation) + (select count(*) from message)
       + (select count(*) from event) + (select count(*) from review) into n;
  if n <> 0 then raise exception 'FAIL  browser-facing role read % private rows', n; end if;
  raise notice 'PASS  browser-facing role reads zero events, conversations, messages or reviews';
end $$;
reset role;

do $$ begin raise notice 'ALL HANDSHAKE CHECKS PASSED'; end $$;

rollback;
