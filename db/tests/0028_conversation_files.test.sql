-- =============================================================================
-- Checks for migration 0028: files in conversations (Stage 2B, part 3).
-- One transaction, rolled back. Obviously fake data.
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

-- Person A and B; business V (owner O, staff S); business W (owner P); M on the team.
insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000028a1', 'Person A', 'a-28@example.com'),
  ('00000000-0000-7000-8000-0000000028a2', 'Person B', 'b-28@example.com'),
  ('00000000-0000-7000-8000-0000000028a3', 'Owner O', 'o-28@example.com'),
  ('00000000-0000-7000-8000-0000000028a5', 'Staff S', 's-28@example.com'),
  ('00000000-0000-7000-8000-0000000028a6', 'Owner P', 'p-28@example.com'),
  ('00000000-0000-7000-8000-0000000028a7', 'Team M', 'm-28@example.com');
insert into platform_role (user_id, role) values ('00000000-0000-7000-8000-0000000028a7', 'admin');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000028b1', 'test-town-28', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000028c1', 'test-28-v', 'Twenty-eight V', '00000000-0000-7000-8000-0000000028b1', 'admin_entered', 'published', 'claimed', now()),
  ('00000000-0000-7000-8000-0000000028c2', 'test-28-w', 'Twenty-eight W', '00000000-0000-7000-8000-0000000028b1', 'admin_entered', 'published', 'claimed', now());
insert into vendor_member (vendor_id, user_id, role, created_at) values
  ('00000000-0000-7000-8000-0000000028c1', '00000000-0000-7000-8000-0000000028a3', 'owner', now() - interval '1 day'),
  ('00000000-0000-7000-8000-0000000028c1', '00000000-0000-7000-8000-0000000028a5', 'staff', now() - interval '1 day'),
  ('00000000-0000-7000-8000-0000000028c2', '00000000-0000-7000-8000-0000000028a6', 'owner', now() - interval '1 day');

set local role app_server;

-- A starts a conversation with V, with a photo and no words.
select pg_temp.act('person', '00000000-0000-7000-8000-0000000028a1');
insert into conversation (id, consumer_user_id, vendor_id) values
  ('00000000-0000-7000-8000-000000002861', '00000000-0000-7000-8000-0000000028a1', '00000000-0000-7000-8000-0000000028c1');
insert into message (id, conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002871', '00000000-0000-7000-8000-000000002861', '00000000-0000-7000-8000-0000000028a1',
   'consumer', '');
insert into conversation_file (id, message_id, conversation_id, uploaded_by, storage_path, file_name, mime_type, byte_size, width, height)
values ('00000000-0000-7000-8000-000000002881', '00000000-0000-7000-8000-000000002871', '00000000-0000-7000-8000-000000002861',
        '00000000-0000-7000-8000-0000000028a1', 'conversations/00000000-0000-7000-8000-000000002861/a.jpg', 'cake.jpg',
        'image/jpeg', 1000, 800, 600);
select pg_temp.expect_equal('a message can be just a file', (select count(*)::text from conversation_file), '1');
select pg_temp.expect_code('…but not nothing at all (checked at the end of the step)', $q$
  do $d$ begin
    insert into message (conversation_id, author_user_id, author_side, body) values
      ('00000000-0000-7000-8000-000000002861', '00000000-0000-7000-8000-0000000028a1', 'consumer', '  ');
    set constraints message_has_content immediate;
  end $d$$q$, 'LP147');
select pg_temp.expect_code('one file per message', $q$
  insert into conversation_file (message_id, conversation_id, uploaded_by, storage_path, file_name, mime_type, byte_size)
  values ('00000000-0000-7000-8000-000000002871', '00000000-0000-7000-8000-000000002861', '00000000-0000-7000-8000-0000000028a1',
          'conversations/00000000-0000-7000-8000-000000002861/b.pdf', 'b.pdf', 'application/pdf', 100)$q$, '23505');
select pg_temp.expect_code('only photos and PDFs', $q$
  insert into message (id, conversation_id, author_user_id, author_side, body) values
    ('00000000-0000-7000-8000-000000002872', '00000000-0000-7000-8000-000000002861', '00000000-0000-7000-8000-0000000028a1', 'consumer', 'x');
  insert into conversation_file (message_id, conversation_id, uploaded_by, storage_path, file_name, mime_type, byte_size)
  values ('00000000-0000-7000-8000-000000002872', '00000000-0000-7000-8000-000000002861', '00000000-0000-7000-8000-0000000028a1',
          'conversations/00000000-0000-7000-8000-000000002861/c.exe', 'c.exe', 'application/octet-stream', 100)$q$, '23514');
select pg_temp.expect_code('nothing over 4 MB', $q$
  insert into message (id, conversation_id, author_user_id, author_side, body) values
    ('00000000-0000-7000-8000-000000002873', '00000000-0000-7000-8000-000000002861', '00000000-0000-7000-8000-0000000028a1', 'consumer', 'x');
  insert into conversation_file (message_id, conversation_id, uploaded_by, storage_path, file_name, mime_type, byte_size)
  values ('00000000-0000-7000-8000-000000002873', '00000000-0000-7000-8000-000000002861', '00000000-0000-7000-8000-0000000028a1',
          'conversations/00000000-0000-7000-8000-000000002861/d.pdf', 'd.pdf', 'application/pdf', 5000000)$q$, '23514');
select pg_temp.expect_code('only under this conversation''s own folder', $q$
  insert into message (id, conversation_id, author_user_id, author_side, body) values
    ('00000000-0000-7000-8000-000000002874', '00000000-0000-7000-8000-000000002861', '00000000-0000-7000-8000-0000000028a1', 'consumer', 'x');
  insert into conversation_file (message_id, conversation_id, uploaded_by, storage_path, file_name, mime_type, byte_size)
  values ('00000000-0000-7000-8000-000000002874', '00000000-0000-7000-8000-000000002861', '00000000-0000-7000-8000-0000000028a1',
          'vendors/elsewhere/e.pdf', 'e.pdf', 'application/pdf', 100)$q$, 'LP101');

-- ---------------------------------------------------------------- who reads files
select pg_temp.act('business', '00000000-0000-7000-8000-0000000028a5', '00000000-0000-7000-8000-0000000028c1');
select pg_temp.expect_equal('anyone on the business''s team sees the file', (select file_name from conversation_file), 'cake.jpg');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000028a2');
select pg_temp.expect_equal('another person sees nothing', (select count(*)::text from conversation_file), '0');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000028a6', '00000000-0000-7000-8000-0000000028c2');
select pg_temp.expect_equal('another business sees nothing', (select count(*)::text from conversation_file), '0');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000028a6', '00000000-0000-7000-8000-0000000028c1');
select pg_temp.expect_equal('…not even claiming to act for this one', (select count(*)::text from conversation_file), '0');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000028a7');
select pg_temp.expect_equal('the Localites team sees nothing directly', (select count(*)::text from conversation_file), '0');
select pg_temp.act(null, null);
select pg_temp.expect_equal('nobody acting sees nothing', (select count(*)::text from conversation_file), '0');

-- ---------------------------------------------------------------- who adds files
select pg_temp.act('business', '00000000-0000-7000-8000-0000000028a5', '00000000-0000-7000-8000-0000000028c1');
insert into message (id, conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002875', '00000000-0000-7000-8000-000000002861', '00000000-0000-7000-8000-0000000028a5',
   'vendor', 'Here is our quote');
insert into conversation_file (id, message_id, conversation_id, uploaded_by, storage_path, file_name, mime_type, byte_size)
values ('00000000-0000-7000-8000-000000002882', '00000000-0000-7000-8000-000000002875', '00000000-0000-7000-8000-000000002861',
        '00000000-0000-7000-8000-0000000028a5', 'conversations/00000000-0000-7000-8000-000000002861/q.pdf', 'quote.pdf',
        'application/pdf', 2000);
select pg_temp.expect_equal('the business''s team sends a PDF with a reply', (
  select count(*)::text from conversation_file where mime_type = 'application/pdf'), '1');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000028a1');
select pg_temp.expect_code('only the author of a message adds its file', $q$
  insert into conversation_file (message_id, conversation_id, uploaded_by, storage_path, file_name, mime_type, byte_size)
  values ('00000000-0000-7000-8000-000000002875', '00000000-0000-7000-8000-000000002861', '00000000-0000-7000-8000-0000000028a1',
          'conversations/00000000-0000-7000-8000-000000002861/x.pdf', 'x.pdf', 'application/pdf', 100)$q$, 'LP101');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000028a2');
select pg_temp.expect_code('nobody adds a file to someone else''s conversation', $q$
  insert into conversation_file (message_id, conversation_id, uploaded_by, storage_path, file_name, mime_type, byte_size)
  values ('00000000-0000-7000-8000-000000002871', '00000000-0000-7000-8000-000000002861', '00000000-0000-7000-8000-0000000028a2',
          'conversations/00000000-0000-7000-8000-000000002861/y.pdf', 'y.pdf', 'application/pdf', 100)$q$, 'LP101');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000028a1');
insert into message (id, conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002877', '00000000-0000-7000-8000-000000002861', '00000000-0000-7000-8000-0000000028a1',
   'consumer', 'An older message');
reset role;
set constraints message_has_content immediate;
alter table message disable trigger message_rules;
update message set created_at = now() - interval '1 hour' where id = '00000000-0000-7000-8000-000000002877';
alter table message enable trigger message_rules;
set constraints message_has_content deferred;
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000028a1');
select pg_temp.expect_code('a file goes with a message as it''s written, never added to an old one', $q$
  insert into conversation_file (message_id, conversation_id, uploaded_by, storage_path, file_name, mime_type, byte_size)
  values ('00000000-0000-7000-8000-000000002877', '00000000-0000-7000-8000-000000002861', '00000000-0000-7000-8000-0000000028a1',
          'conversations/00000000-0000-7000-8000-000000002861/z.pdf', 'z.pdf', 'application/pdf', 100)$q$, 'LP109');
select pg_temp.expect_code('a file can''t be changed', $q$
  update conversation_file set file_name = 'other.jpg'$q$, '42501');

-- ---------------------------------------------------------------- a file goes with its message
update message set removed_at = now() where id = '00000000-0000-7000-8000-000000002871';
reset role;
select pg_temp.expect_equal('the author removes the message: the file goes, and its storage is to be deleted', (
  select (deleted_at is not null)::text || ' ' || kept_for_report::text from conversation_file
  where id = '00000000-0000-7000-8000-000000002881'), 'true false');
select pg_temp.expect_equal('…the site is told to delete it', (
  select string_agg(storage_path, ',') from conversation_files_to_remove(10)),
  'conversations/00000000-0000-7000-8000-000000002861/a.jpg');
select conversation_file_storage_removed('00000000-0000-7000-8000-000000002881');
select pg_temp.expect_equal('…and records it deleted', (select count(*)::text from conversation_files_to_remove(10)), '0');
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000028a1');
select pg_temp.expect_code('the site can''t mark a file deleted itself', $q$
  update conversation_file set deleted_at = now()$q$, '42501');

-- A reports the conversation; the business then removes its quote: the team keeps it.
insert into moderation_report (id, reporter_user_id, reporter_side, conversation_id, reason) values
  ('00000000-0000-7000-8000-000000002891', '00000000-0000-7000-8000-0000000028a1', 'consumer',
   '00000000-0000-7000-8000-000000002861', 'scam_or_fraud');
reset role;
update moderation_report set created_at = clock_timestamp() where id = '00000000-0000-7000-8000-000000002891';
set local role app_server;
select pg_temp.act('business', '00000000-0000-7000-8000-0000000028a5', '00000000-0000-7000-8000-0000000028c1');
update message set removed_at = now() where id = '00000000-0000-7000-8000-000000002875';
reset role;
select pg_temp.expect_equal('removed after the report: kept for the team, not deleted', (
  select kept_for_report::text || ' ' || (select count(*) from conversation_files_to_remove(10))::text
  from conversation_file where id = '00000000-0000-7000-8000-000000002882'), 'true 0');
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000028a1');
select pg_temp.expect_equal('…both sides see it gone', (
  select (deleted_at is not null)::text from conversation_file where id = '00000000-0000-7000-8000-000000002882'), 'true');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000028a7');
select pg_temp.expect_equal('…the team lists the report''s files (the one removed before the report is gone)', (
  select string_agg(file_name || ':' || gone::text, ',' order by file_name)
  from reported_conversation_files_for_team('00000000-0000-7000-8000-000000002891')), 'cake.jpg:true,quote.pdf:false');
select pg_temp.expect_equal('…and opens the kept one, through the report', (
  select file_name from team_reported_file('00000000-0000-7000-8000-000000002891', '00000000-0000-7000-8000-000000002882')),
  'quote.pdf');
select pg_temp.expect_equal('…each look written to the audit log', (
  select count(*)::text from audit_log where action = 'conversation.report_file_view'
    and subject_id = '00000000-0000-7000-8000-000000002891'), '1');
select pg_temp.expect_code('…never one the report doesn''t keep', $q$
  select * from team_reported_file('00000000-0000-7000-8000-000000002891', '00000000-0000-7000-8000-000000002881')$q$, 'LP101');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000028a1');
select pg_temp.expect_code('a person can''t open files through a report', $q$
  select * from team_reported_file('00000000-0000-7000-8000-000000002891', '00000000-0000-7000-8000-000000002882')$q$, 'LP101');
select pg_temp.expect_code('…nor list them', $q$
  select * from reported_conversation_files_for_team('00000000-0000-7000-8000-000000002891')$q$, 'LP101');

-- ---------------------------------------------------------------- a person deletes their account
select pg_temp.act('person', '00000000-0000-7000-8000-0000000028a2');
insert into conversation (id, consumer_user_id, vendor_id) values
  ('00000000-0000-7000-8000-000000002862', '00000000-0000-7000-8000-0000000028a2', '00000000-0000-7000-8000-0000000028c2');
insert into message (id, conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002876', '00000000-0000-7000-8000-000000002862', '00000000-0000-7000-8000-0000000028a2',
   'consumer', 'My floor plan');
insert into conversation_file (id, message_id, conversation_id, uploaded_by, storage_path, file_name, mime_type, byte_size)
values ('00000000-0000-7000-8000-000000002883', '00000000-0000-7000-8000-000000002876', '00000000-0000-7000-8000-000000002862',
        '00000000-0000-7000-8000-0000000028a2', 'conversations/00000000-0000-7000-8000-000000002862/f.pdf', 'plan.pdf',
        'application/pdf', 3000);
select delete_my_account();
reset role;
select pg_temp.expect_equal('a person deletes their account: their files go, and are deleted', (
  select (deleted_at is not null)::text || ' ' || kept_for_report::text from conversation_file
  where id = '00000000-0000-7000-8000-000000002883'), 'true false');
select pg_temp.expect_equal('the site-wide total counts what''s still stored', (
  select conversation_files_stored_bytes()::text), '5000');
set local role app_server;
select pg_temp.expect_code('the site can''t read who''s kept for a report', $q$
  select kept_for_report from conversation_file$q$, '42501');

rollback;
