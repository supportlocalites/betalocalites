-- =============================================================================
-- Checks for migration 0045: fixes from the whole-site security review.
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

insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000045a1', 'Pat', 'p-45@example.com'),
  ('00000000-0000-7000-8000-0000000045a9', 'Ann', 'o-45@example.com');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000045b1', 'test-town-45', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000045c1', 'test-45-v', 'V', '00000000-0000-7000-8000-0000000045b1', 'admin_entered', 'published', 'claimed', now());
insert into vendor_member (vendor_id, user_id, role) values
  ('00000000-0000-7000-8000-0000000045c1', '00000000-0000-7000-8000-0000000045a9', 'owner');
set local session_replication_role = replica;
insert into conversation (id, consumer_user_id, vendor_id, last_message_at) values
  ('00000000-0000-7000-8000-0000000045d1', '00000000-0000-7000-8000-0000000045a1', '00000000-0000-7000-8000-0000000045c1', now());
insert into message (id, conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000004501', '00000000-0000-7000-8000-0000000045d1', '00000000-0000-7000-8000-0000000045a9', 'vendor', 'Rude'),
  ('00000000-0000-7000-8000-000000004502', '00000000-0000-7000-8000-0000000045d1', '00000000-0000-7000-8000-0000000045a9', 'vendor', 'Rude again');
-- Files kept for reports: one on a conversation whose report closed 100 days ago, one 10 days ago.
insert into app_user (id, display_name, email) values ('00000000-0000-7000-8000-0000000045a2', 'Kim', 'k-45@example.com');
insert into conversation (id, consumer_user_id, vendor_id, last_message_at) values
  ('00000000-0000-7000-8000-0000000045d2', '00000000-0000-7000-8000-0000000045a2', '00000000-0000-7000-8000-0000000045c1', now());
insert into message (id, conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000004503', '00000000-0000-7000-8000-0000000045d2', '00000000-0000-7000-8000-0000000045a2', 'consumer', 'File'),
  ('00000000-0000-7000-8000-000000004504', '00000000-0000-7000-8000-0000000045d1', '00000000-0000-7000-8000-0000000045a1', 'consumer', 'File');
insert into conversation_file (id, message_id, conversation_id, uploaded_by, storage_path, file_name, mime_type, byte_size, width, height, deleted_at, kept_for_report) values
  ('00000000-0000-7000-8000-0000000045f1', '00000000-0000-7000-8000-000000004503', '00000000-0000-7000-8000-0000000045d2', '00000000-0000-7000-8000-0000000045a2', 'test-45/a', 'a.jpg', 'image/jpeg', 10, 1, 1, now(), true),
  ('00000000-0000-7000-8000-0000000045f2', '00000000-0000-7000-8000-000000004504', '00000000-0000-7000-8000-0000000045d1', '00000000-0000-7000-8000-0000000045a1', 'test-45/b', 'b.jpg', 'image/jpeg', 2000000, 1, 1, now(), true);
insert into moderation_report (reporter_user_id, reporter_side, conversation_id, reason, status, reviewed_by, reviewed_at, decision_note, created_at) values
  ('00000000-0000-7000-8000-0000000045a2', 'consumer', '00000000-0000-7000-8000-0000000045d2', 'spam', 'dismissed', '00000000-0000-7000-8000-0000000045a9', now() - interval '100 days', 'ok', now() - interval '101 days'),
  ('00000000-0000-7000-8000-0000000045a1', 'consumer', '00000000-0000-7000-8000-0000000045d1', 'spam', 'dismissed', '00000000-0000-7000-8000-0000000045a9', now() - interval '10 days', 'ok', now() - interval '11 days');
set local session_replication_role = origin;

set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000045a1');
insert into moderation_report (reporter_user_id, reporter_side, conversation_id, message_id, reason)
values ('00000000-0000-7000-8000-0000000045a1', 'consumer', '00000000-0000-7000-8000-0000000045d1', '00000000-0000-7000-8000-000000004501', 'harassment');
select pg_temp.expect_code('the same message can''t be reported twice while the first report is open', $q$
  insert into moderation_report (reporter_user_id, reporter_side, conversation_id, message_id, reason)
  values ('00000000-0000-7000-8000-0000000045a1', 'consumer', '00000000-0000-7000-8000-0000000045d1', '00000000-0000-7000-8000-000000004501', 'spam')$q$, 'LP183');
insert into moderation_report (reporter_user_id, reporter_side, conversation_id, message_id, reason)
values ('00000000-0000-7000-8000-0000000045a1', 'consumer', '00000000-0000-7000-8000-0000000045d1', '00000000-0000-7000-8000-000000004502', 'harassment');
select pg_temp.expect_equal('…but another message can be',
  (select count(*)::text from moderation_report where reporter_user_id = '00000000-0000-7000-8000-0000000045a1' and status = 'open'), '2');
reset role;
-- Eight more today (as the owner, rules off), making 10 in a day with the two above.
set local session_replication_role = replica;
insert into moderation_report (reporter_user_id, reporter_side, conversation_id, reason, status, reviewed_by, reviewed_at, decision_note)
select '00000000-0000-7000-8000-0000000045a1', 'consumer', '00000000-0000-7000-8000-0000000045d1', 'spam', 'dismissed',
       '00000000-0000-7000-8000-0000000045a9', now(), 'x' from generate_series(1, 8);
set local session_replication_role = origin;
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000045a1');
select pg_temp.expect_code('at most 10 reports a day per person', $q$
  insert into moderation_report (reporter_user_id, reporter_side, conversation_id, reason)
  values ('00000000-0000-7000-8000-0000000045a1', 'consumer', '00000000-0000-7000-8000-0000000045d1', 'other')$q$, 'LP182');
select pg_temp.expect_equal('the bytes a person sent in files today, for the 25 MB cap',
  (select files_bytes_sent_today('00000000-0000-7000-8000-0000000045a1')::text), '2000000');
select pg_temp.expect_equal('…only their own: asking about someone else gives nothing',
  (select files_bytes_sent_today('00000000-0000-7000-8000-0000000045a2')::text), '0');
select pg_temp.expect_equal('the morning run lets go of one file', (select release_report_files()::text), '1');
select pg_temp.expect_code('the server can no longer unlink someone directly', $q$
  select unlink_person('00000000-0000-7000-8000-0000000045a2')$q$, '42501');
reset role;
select pg_temp.expect_equal('…the one whose report closed over 90 days ago, not the one closed 10 days ago',
  (select string_agg(kept_for_report::text, ',' order by id) from conversation_file
   where id in ('00000000-0000-7000-8000-0000000045f1', '00000000-0000-7000-8000-0000000045f2')), 'false,true');

rollback;
