-- =============================================================================
-- Checks for migration 0041: the deletions the privacy policy promises. Rolled back.
-- =============================================================================

begin;

create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAIL  %', label; end if;
  raise notice 'PASS  %', label;
end $$;

-- Earlier tests' and seed rows aren't old enough to be touched; these are.
insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000041a1', 'Pat', 'p-41@example.com'),
  ('00000000-0000-7000-8000-0000000041a9', 'Ann', 'o-41@example.com');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000041b1', 'test-town-41', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000041c1', 'test-41-v', 'V', '00000000-0000-7000-8000-0000000041b1', 'admin_entered', 'published', 'claimed', now());

-- Rules on the tables would stop setting times in the past: written as the database owner, rules off.
set local session_replication_role = replica;
insert into notification (id, user_id, kind, subject_type, subject_id, status, sent_at, created_at) values
  ('00000000-0000-7000-8000-0000000041e1', '00000000-0000-7000-8000-0000000041a1', 'new_message', 'conversation', gen_random_uuid(), 'sent', now() - interval '13 months', now() - interval '13 months'),
  ('00000000-0000-7000-8000-0000000041e2', '00000000-0000-7000-8000-0000000041a1', 'new_message', 'conversation', gen_random_uuid(), 'sent', now() - interval '11 months', now() - interval '11 months');
insert into audit_log (id, actor_user_id, action, subject_type, subject_id, created_at) values
  ('00000000-0000-7000-8000-0000000041f1', '00000000-0000-7000-8000-0000000041a9', 'test.old', 'vendor', '00000000-0000-7000-8000-0000000041c1', now() - interval '25 months'),
  ('00000000-0000-7000-8000-0000000041f2', '00000000-0000-7000-8000-0000000041a9', 'test.young', 'vendor', '00000000-0000-7000-8000-0000000041c1', now() - interval '23 months'),
  ('00000000-0000-7000-8000-0000000041f3', '00000000-0000-7000-8000-0000000041a9', 'test.history', 'vendor', '00000000-0000-7000-8000-0000000041c1', now() - interval '30 months');
insert into owner_change (audit_id, vendor_id, created_at) values
  ('00000000-0000-7000-8000-0000000041f3', '00000000-0000-7000-8000-0000000041c1', now() - interval '30 months');
-- Conversations: old; old but reported; old with a file still stored; recent.
insert into conversation (id, consumer_user_id, vendor_id, last_message_at, created_at) values
  ('00000000-0000-7000-8000-0000000041d1', '00000000-0000-7000-8000-0000000041a1', '00000000-0000-7000-8000-0000000041c1', now() - interval '37 months', now() - interval '40 months');
insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000041a2', 'Quin', 'q-41@example.com'),
  ('00000000-0000-7000-8000-0000000041a3', 'Rae', 'r-41@example.com'),
  ('00000000-0000-7000-8000-0000000041a4', 'Sol', 's-41@example.com');
insert into conversation (id, consumer_user_id, vendor_id, last_message_at, created_at) values
  ('00000000-0000-7000-8000-0000000041d2', '00000000-0000-7000-8000-0000000041a2', '00000000-0000-7000-8000-0000000041c1', now() - interval '37 months', now() - interval '40 months'),
  ('00000000-0000-7000-8000-0000000041d3', '00000000-0000-7000-8000-0000000041a3', '00000000-0000-7000-8000-0000000041c1', now() - interval '37 months', now() - interval '40 months'),
  ('00000000-0000-7000-8000-0000000041d4', '00000000-0000-7000-8000-0000000041a4', '00000000-0000-7000-8000-0000000041c1', now() - interval '35 months', now() - interval '40 months');
insert into message (id, conversation_id, author_user_id, author_side, body, created_at) values
  ('00000000-0000-7000-8000-000000004101', '00000000-0000-7000-8000-0000000041d1', '00000000-0000-7000-8000-0000000041a1', 'consumer', 'Old hello', now() - interval '37 months'),
  ('00000000-0000-7000-8000-000000004102', '00000000-0000-7000-8000-0000000041d2', '00000000-0000-7000-8000-0000000041a2', 'consumer', 'Reported', now() - interval '37 months'),
  ('00000000-0000-7000-8000-000000004103', '00000000-0000-7000-8000-0000000041d3', '00000000-0000-7000-8000-0000000041a3', 'consumer', 'With a file', now() - interval '37 months'),
  ('00000000-0000-7000-8000-000000004104', '00000000-0000-7000-8000-0000000041d4', '00000000-0000-7000-8000-0000000041a4', 'consumer', 'Recent', now() - interval '35 months');
insert into conversation_file (message_id, conversation_id, uploaded_by, storage_path, file_name, mime_type, byte_size, width, height, created_at, deleted_at, storage_removed_at) values
  ('00000000-0000-7000-8000-000000004101', '00000000-0000-7000-8000-0000000041d1', '00000000-0000-7000-8000-0000000041a1', 'test-41/a', 'a.jpg', 'image/jpeg', 10, 1, 1, now() - interval '37 months', now() - interval '30 months', now() - interval '30 months'),
  ('00000000-0000-7000-8000-000000004103', '00000000-0000-7000-8000-0000000041d3', '00000000-0000-7000-8000-0000000041a3', 'test-41/c', 'c.jpg', 'image/jpeg', 10, 1, 1, now() - interval '37 months', now() - interval '30 months', null);
insert into conversation_read (conversation_id, user_id, last_read_at) values
  ('00000000-0000-7000-8000-0000000041d1', '00000000-0000-7000-8000-0000000041a1', now() - interval '37 months');
insert into moderation_report (reporter_user_id, reporter_side, conversation_id, reason) values
  ('00000000-0000-7000-8000-0000000041a2', 'consumer', '00000000-0000-7000-8000-0000000041d2', 'spam');
-- Suggestions: declined 13 months ago; declined 6 months ago; added 13 months ago.
insert into vendor_suggestion (id, business_name, contact, status, reviewed_by, reviewed_at, decline_reason, vendor_id) values
  ('00000000-0000-7000-8000-0000000041b5', 'Old declined', '705-555-0101', 'declined', '00000000-0000-7000-8000-0000000041a9', now() - interval '13 months', 'Not local', null),
  ('00000000-0000-7000-8000-0000000041b6', 'New declined', '705-555-0102', 'declined', '00000000-0000-7000-8000-0000000041a9', now() - interval '6 months', 'Not local', null),
  ('00000000-0000-7000-8000-0000000041b7', 'Old added', '705-555-0103', 'added', '00000000-0000-7000-8000-0000000041a9', now() - interval '13 months', null, '00000000-0000-7000-8000-0000000041c1');
set local session_replication_role = origin;

-- Nobody but the morning run deletes from the team's change log.
do $$ begin
  begin
    delete from audit_log where id = '00000000-0000-7000-8000-0000000041f1';
    raise exception 'FAIL  the database owner deleted from the change log directly';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS  the change log stays append-only, even for the database owner  (%)', sqlerrm;
  end;
end $$;
set local role app_server;
do $$ begin
  begin
    perform set_config('localites.retention', 'on', true);
    delete from audit_log where id = '00000000-0000-7000-8000-0000000041f1';
    raise exception 'FAIL  the server deleted from the change log';
  exception when insufficient_privilege then
    raise notice 'PASS  the server can''t delete from the change log, even with the setting  (42501)';
  end;
end $$;

select * from run_scheduled_deletions();
reset role;

select pg_temp.expect('an email record over a year old is deleted',
  not exists (select 1 from notification where id = '00000000-0000-7000-8000-0000000041e1'));
select pg_temp.expect('…one under a year old stays',
  exists (select 1 from notification where id = '00000000-0000-7000-8000-0000000041e2'));
select pg_temp.expect('a change-log row over 2 years old is deleted',
  not exists (select 1 from audit_log where id = '00000000-0000-7000-8000-0000000041f1'));
select pg_temp.expect('…one under 2 years old stays',
  exists (select 1 from audit_log where id = '00000000-0000-7000-8000-0000000041f2'));
select pg_temp.expect('…and an old one a business page''s history points at stays',
  exists (select 1 from audit_log where id = '00000000-0000-7000-8000-0000000041f3'));
select pg_temp.expect('a conversation 3 years after its last message is deleted, with its messages, files and read markers',
  not exists (select 1 from conversation where id = '00000000-0000-7000-8000-0000000041d1')
  and not exists (select 1 from message where conversation_id = '00000000-0000-7000-8000-0000000041d1')
  and not exists (select 1 from conversation_file where conversation_id = '00000000-0000-7000-8000-0000000041d1')
  and not exists (select 1 from conversation_read where conversation_id = '00000000-0000-7000-8000-0000000041d1'));
select pg_temp.expect('…a reported one stays, with the report',
  exists (select 1 from message where conversation_id = '00000000-0000-7000-8000-0000000041d2'));
select pg_temp.expect('…one whose stored file isn''t removed yet waits',
  exists (select 1 from conversation where id = '00000000-0000-7000-8000-0000000041d3'));
select pg_temp.expect('…a newer one stays',
  exists (select 1 from conversation where id = '00000000-0000-7000-8000-0000000041d4'));
select pg_temp.expect('a declined suggestion''s contact is erased after a year; the suggestion stays',
  (select contact is null from vendor_suggestion where id = '00000000-0000-7000-8000-0000000041b5'));
select pg_temp.expect('…a newer declined one keeps it, and an added one keeps it',
  (select count(*) = 2 from vendor_suggestion where id in ('00000000-0000-7000-8000-0000000041b6', '00000000-0000-7000-8000-0000000041b7') and contact is not null));
select pg_temp.expect('the change log is append-only again after the run',
  current_setting('localites.retention', true) is distinct from 'on');

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end $$;
set local role anon;
do $$ begin
  begin
    perform run_scheduled_deletions();
    raise exception 'FAIL  the browser-facing role ran the deletions';
  exception when insufficient_privilege then
    raise notice 'PASS  the browser-facing role can''t run them  (42501)';
  end;
end $$;
reset role;

rollback;
