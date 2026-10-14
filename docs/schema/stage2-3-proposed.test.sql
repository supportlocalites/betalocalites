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

-- Files in conversations: now built (db/migrations/0028_conversation_files.sql, its checks in
-- db/tests/0028_conversation_files.test.sql).

-- ------------------------------------------------------- feedback request ---
select pg_temp.expect_reject('feedback request for a vendor not marked booked',
  $q$insert into review_request (event_vendor_id, scheduled_for, expires_at)
     values ('90000000-0000-7000-8000-000000000001', now(), now() + interval '60 days')$q$);

-- Reviews: now built (db/migrations/0031_reviews.sql, its checks in db/tests/0031_reviews.test.sql).

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
