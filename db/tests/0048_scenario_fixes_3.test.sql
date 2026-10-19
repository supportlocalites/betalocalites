-- =============================================================================
-- Checks for migration 0048: scenario-test fixes, round 3 (deleting conversations, editing messages).
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
  ('00000000-0000-7000-8000-0000000048a1', 'Pat', 'p-48@example.com'),
  ('00000000-0000-7000-8000-0000000048a2', 'Quinn', 'q-48@example.com'),
  ('00000000-0000-7000-8000-0000000048a7', 'Tess', 't-48@example.com'),
  ('00000000-0000-7000-8000-0000000048a9', 'Ann', 'o-48@example.com');
insert into platform_role (user_id, role) values ('00000000-0000-7000-8000-0000000048a7', 'admin');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000048b1', 'test-town-48', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000048c1', 'test-48-v', 'V', '00000000-0000-7000-8000-0000000048b1', 'admin_entered', 'published', 'claimed', now());
insert into vendor_member (vendor_id, user_id, role, created_at) values
  ('00000000-0000-7000-8000-0000000048c1', '00000000-0000-7000-8000-0000000048a9', 'owner', now() - interval '30 days');
set local session_replication_role = replica;
-- c1: Pat and V, with Pat's message and V's reply. c2: Quinn and V.
insert into conversation (id, consumer_user_id, vendor_id, last_message_at) values
  ('00000000-0000-7000-8000-0000000048d1', '00000000-0000-7000-8000-0000000048a1', '00000000-0000-7000-8000-0000000048c1', now()),
  ('00000000-0000-7000-8000-0000000048d2', '00000000-0000-7000-8000-0000000048a2', '00000000-0000-7000-8000-0000000048c1', now());
insert into message (id, conversation_id, author_user_id, author_side, body, created_at) values
  ('00000000-0000-7000-8000-000000004801', '00000000-0000-7000-8000-0000000048d1', '00000000-0000-7000-8000-0000000048a1', 'consumer', 'See you at 3', now() - interval '2 hours'),
  ('00000000-0000-7000-8000-000000004802', '00000000-0000-7000-8000-0000000048d1', '00000000-0000-7000-8000-0000000048a9', 'vendor', 'Great, 3 it is', now() - interval '1 hour'),
  ('00000000-0000-7000-8000-000000004803', '00000000-0000-7000-8000-0000000048d2', '00000000-0000-7000-8000-0000000048a2', 'consumer', 'Hello', now() - interval '1 hour');
set local session_replication_role = origin;

set local role app_server;

-- M2: editing.
select pg_temp.act('person', '00000000-0000-7000-8000-0000000048a2');
select pg_temp.expect_code('someone else can''t edit Pat''s message',
  $q$select edit_my_message('00000000-0000-7000-8000-000000004801', 'Changed')$q$, 'LP101');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000048a9', '00000000-0000-7000-8000-0000000048c1');
select pg_temp.expect_code('…nor the business',
  $q$select edit_my_message('00000000-0000-7000-8000-000000004801', 'Changed')$q$, 'LP101');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000048a1');
select pg_temp.expect_code('Pat can''t edit the business''s message',
  $q$select edit_my_message('00000000-0000-7000-8000-000000004802', 'Changed')$q$, 'LP101');
select pg_temp.expect_code('the site can''t change a message''s words directly',
  $q$update message set body = 'Sneaky' where id = '00000000-0000-7000-8000-000000004801'$q$, '42501');
select pg_temp.expect_code('a message can''t be emptied',
  $q$select edit_my_message('00000000-0000-7000-8000-000000004801', '   ')$q$, 'LP147');
select edit_my_message('00000000-0000-7000-8000-000000004801', 'See you at 4');
select pg_temp.expect_equal('Pat changes it: the new words show, marked edited',
  (select body || ' ' || (edited_at is not null)::text from message where id = '00000000-0000-7000-8000-000000004801'), 'See you at 4 true');
select pg_temp.expect_equal('…and Pat can see the earlier version',
  (select string_agg(body, ' | ') from message_edit where message_id = '00000000-0000-7000-8000-000000004801'), 'See you at 3');
select edit_my_message('00000000-0000-7000-8000-000000004801', 'See you at 4');
select pg_temp.expect_equal('saving the same words again keeps no extra version',
  (select count(*)::text from message_edit where message_id = '00000000-0000-7000-8000-000000004801'), '1');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000048a9', '00000000-0000-7000-8000-0000000048c1');
select pg_temp.expect_equal('the business sees the earlier version too',
  (select string_agg(body, ' | ') from message_edit where message_id = '00000000-0000-7000-8000-000000004801'), 'See you at 3');
select edit_my_message('00000000-0000-7000-8000-000000004802', 'Great, 4 it is');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000048a2');
select pg_temp.expect_equal('someone outside the conversation sees no versions',
  (select count(*)::text from message_edit where message_id in ('00000000-0000-7000-8000-000000004801', '00000000-0000-7000-8000-000000004802')), '0');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000048a7');
select pg_temp.expect_equal('the team sees no versions without a report',
  (select count(*)::text from message_edit), '0');
-- Blocked: no editing, as no sending.
select pg_temp.act('business', '00000000-0000-7000-8000-0000000048a9', '00000000-0000-7000-8000-0000000048c1');
update conversation set status = 'blocked_by_vendor' where id = '00000000-0000-7000-8000-0000000048d1';
select pg_temp.act('person', '00000000-0000-7000-8000-0000000048a1');
select pg_temp.expect_code('a blocked conversation''s messages can''t be edited',
  $q$select edit_my_message('00000000-0000-7000-8000-000000004801', 'Again')$q$, 'LP143');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000048a9', '00000000-0000-7000-8000-0000000048c1');
update conversation set status = 'open' where id = '00000000-0000-7000-8000-0000000048d1';
-- Removing a message removes its earlier versions (no report).
select pg_temp.act('business', '00000000-0000-7000-8000-0000000048a9', '00000000-0000-7000-8000-0000000048c1');
update message set removed_at = now() where id = '00000000-0000-7000-8000-000000004802';
reset role;
select pg_temp.expect_equal('removing a message removes its earlier versions',
  (select count(*)::text from message_edit where message_id = '00000000-0000-7000-8000-000000004802'), '0');

-- A report: the team reads every version.
insert into moderation_report (reporter_user_id, reporter_side, conversation_id, reason, team_email_status)
  values ('00000000-0000-7000-8000-0000000048a9', 'vendor', '00000000-0000-7000-8000-0000000048d1', 'harassment', 'sent');
set local role app_server;
select pg_temp.act('team', '00000000-0000-7000-8000-0000000048a7');
select pg_temp.expect_equal('through a report, the team reads the earlier versions',
  (select string_agg(body, ' | ') from reported_message_versions_for_team((select id from moderation_report where conversation_id = '00000000-0000-7000-8000-0000000048d1'))), 'See you at 3');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000048a1');
select pg_temp.expect_code('a person can''t use the team''s reader',
  $q$select * from reported_message_versions_for_team((select id from moderation_report limit 1))$q$, 'LP101');

-- M1: deleting a conversation.
select pg_temp.act('person', '00000000-0000-7000-8000-0000000048a2');
select pg_temp.expect_code('someone else can''t delete Pat''s conversation',
  $q$select delete_my_conversation('00000000-0000-7000-8000-0000000048d1')$q$, 'LP101');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000048a9', '00000000-0000-7000-8000-0000000048c1');
select pg_temp.expect_code('…nor the business',
  $q$select delete_my_conversation('00000000-0000-7000-8000-0000000048d1')$q$, 'LP101');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000048a1');
select delete_my_conversation('00000000-0000-7000-8000-0000000048d1');
select pg_temp.expect_equal('Pat deletes it: it''s gone from Pat''s messages',
  (select count(*)::text from conversation where id = '00000000-0000-7000-8000-0000000048d1'), '0');
select pg_temp.expect_equal('…with its messages',
  (select count(*)::text from message where conversation_id = '00000000-0000-7000-8000-0000000048d1'), '0');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000048a9', '00000000-0000-7000-8000-0000000048c1');
select pg_temp.expect_equal('…and from the business''s',
  (select count(*)::text from conversation where id = '00000000-0000-7000-8000-0000000048d1') || ' '
  || (select count(*)::text from message where conversation_id = '00000000-0000-7000-8000-0000000048d1'), '0 0');
select pg_temp.expect_equal('…while the business''s other conversation is untouched',
  (select count(*)::text from conversation where id = '00000000-0000-7000-8000-0000000048d2'), '1');
select pg_temp.expect_code('the business can''t reply in it',
  $q$insert into message (conversation_id, author_user_id, author_side, body)
     values ('00000000-0000-7000-8000-0000000048d1', '00000000-0000-7000-8000-0000000048a9', 'vendor', 'Hello?')$q$, 'LP101');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000048a1');
insert into conversation (id, consumer_user_id, vendor_id)
  values ('00000000-0000-7000-8000-0000000048d3', '00000000-0000-7000-8000-0000000048a1', '00000000-0000-7000-8000-0000000048c1');
select pg_temp.expect_equal('Pat can message V afresh',
  (select count(*)::text from conversation where id = '00000000-0000-7000-8000-0000000048d3'), '1');
-- For 30 days the business is told it was deleted, and can report it without reading it.
select pg_temp.act('business', '00000000-0000-7000-8000-0000000048a9', '00000000-0000-7000-8000-0000000048c1');
select pg_temp.expect_equal('the business sees that Pat deleted a conversation (already reported by Ann)',
  (select person || ' ' || reported::text from deleted_conversations_for_business()), 'Pat true');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000048a2');
select pg_temp.expect_code('a person can''t list a business''s deleted conversations',
  $q$select * from deleted_conversations_for_business()$q$, 'LP101');
select pg_temp.expect_code('…nor report one through the business''s door',
  $q$select * from report_deleted_conversation('00000000-0000-7000-8000-0000000048d1', 'spam', null)$q$, 'LP101');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000048a1');
select pg_temp.expect_equal('a message in a conversation deleted before its email went: nobody is emailed',
  (select count(*)::text from new_message_notices('00000000-0000-7000-8000-000000004801')), '0');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000048a7');
select pg_temp.expect_equal('the team still reads the reported conversation through its report',
  (select count(*)::text from reported_conversation_for_team((select id from moderation_report where conversation_id = '00000000-0000-7000-8000-0000000048d1'))), '2');
reset role;

-- Quinn deletes theirs; the business reports it afterwards.
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000048a2');
select delete_my_conversation('00000000-0000-7000-8000-0000000048d2');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000048a9', '00000000-0000-7000-8000-0000000048c1');
select pg_temp.expect_equal('the business reports a conversation the person deleted',
  (select person from report_deleted_conversation('00000000-0000-7000-8000-0000000048d2', 'harassment', 'Abuse, then deleted')), 'Quinn');
select pg_temp.expect_code('…once while it''s open (the usual limits)',
  $q$select * from report_deleted_conversation('00000000-0000-7000-8000-0000000048d2', 'harassment', null)$q$, 'LP183');
reset role;
select pg_temp.expect_code('nothing changes a message''s words except an edit, not even the database''s owner',
  $q$update message set body = 'Quietly changed' where id = '00000000-0000-7000-8000-000000004803'$q$, 'LP100');

-- 30 days on: a deleted conversation goes, unless it was reported.
insert into conversation (id, consumer_user_id, vendor_id, last_message_at, person_deleted_at, ended_at, ended_reason) values
  ('00000000-0000-7000-8000-0000000048d4', '00000000-0000-7000-8000-0000000048a2', '00000000-0000-7000-8000-0000000048c1', now() - interval '40 days',
   now() - interval '31 days', now() - interval '31 days', 'person_deleted');
set local session_replication_role = replica;
insert into message (conversation_id, author_user_id, author_side, body, created_at) values
  ('00000000-0000-7000-8000-0000000048d4', '00000000-0000-7000-8000-0000000048a2', 'consumer', 'Wrong business', now() - interval '40 days');
set local session_replication_role = origin;
update conversation set person_deleted_at = now() - interval '31 days' where id = '00000000-0000-7000-8000-0000000048d1';
set local role app_server;
select * from run_scheduled_deletions();
reset role;
select pg_temp.expect_equal('the morning run deletes a conversation deleted over 30 days ago, with its messages',
  (select count(*)::text from conversation where id = '00000000-0000-7000-8000-0000000048d4') || ' '
  || (select count(*)::text from message where conversation_id = '00000000-0000-7000-8000-0000000048d4'), '0 0');
select pg_temp.expect_equal('…but keeps a reported one with its report',
  (select count(*)::text from conversation where id = '00000000-0000-7000-8000-0000000048d1'), '1');

rollback;
