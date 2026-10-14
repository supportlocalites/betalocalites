-- Checks for migration 0030: files in conversations end (D-47). Rolled back.
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

insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000030a1', 'Person A', 'a-30@example.com'),
  ('00000000-0000-7000-8000-0000000030a2', 'Person B', 'b-30@example.com'),
  ('00000000-0000-7000-8000-0000000030a3', 'Owner O', 'o-30@example.com');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000030b1', 'test-town-30', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000030c1', 'test-30-v', 'Thirty V', '00000000-0000-7000-8000-0000000030b1', 'admin_entered', 'published', 'claimed', now());
insert into vendor_member (vendor_id, user_id, role) values
  ('00000000-0000-7000-8000-0000000030c1', '00000000-0000-7000-8000-0000000030a3', 'owner');
-- A's event was 40 days ago; B has no event.
insert into event (id, host_user_id, event_date, municipality_id) values
  ('00000000-0000-7000-8000-0000000030f1', '00000000-0000-7000-8000-0000000030a1', current_date - 40, '00000000-0000-7000-8000-0000000030b1');
insert into conversation (id, consumer_user_id, vendor_id, event_id) values
  ('00000000-0000-7000-8000-000000003061', '00000000-0000-7000-8000-0000000030a1', '00000000-0000-7000-8000-0000000030c1', '00000000-0000-7000-8000-0000000030f1'),
  ('00000000-0000-7000-8000-000000003062', '00000000-0000-7000-8000-0000000030a2', '00000000-0000-7000-8000-0000000030c1', null);
insert into message (id, conversation_id, author_user_id, author_side, body, created_at) values
  ('00000000-0000-7000-8000-000000003071', '00000000-0000-7000-8000-000000003061', '00000000-0000-7000-8000-0000000030a1', 'consumer', 'Plan', now() - interval '50 days'),
  ('00000000-0000-7000-8000-000000003072', '00000000-0000-7000-8000-000000003061', '00000000-0000-7000-8000-0000000030a1', 'consumer', 'Photo after', now() - interval '5 days'),
  ('00000000-0000-7000-8000-000000003073', '00000000-0000-7000-8000-000000003062', '00000000-0000-7000-8000-0000000030a2', 'consumer', 'Old menu', now() - interval '13 months'),
  ('00000000-0000-7000-8000-000000003074', '00000000-0000-7000-8000-000000003062', '00000000-0000-7000-8000-0000000030a2', 'consumer', 'New menu', now() - interval '11 months');
insert into conversation_file (id, message_id, conversation_id, uploaded_by, storage_path, file_name, mime_type, byte_size, created_at) values
  ('00000000-0000-7000-8000-000000003081', '00000000-0000-7000-8000-000000003071', '00000000-0000-7000-8000-000000003061', '00000000-0000-7000-8000-0000000030a1',
   'conversations/00000000-0000-7000-8000-000000003061/a.pdf', 'plan.pdf', 'application/pdf', 100, now() - interval '50 days'),
  ('00000000-0000-7000-8000-000000003082', '00000000-0000-7000-8000-000000003072', '00000000-0000-7000-8000-000000003061', '00000000-0000-7000-8000-0000000030a1',
   'conversations/00000000-0000-7000-8000-000000003061/b.pdf', 'after.pdf', 'application/pdf', 100, now() - interval '5 days'),
  ('00000000-0000-7000-8000-000000003083', '00000000-0000-7000-8000-000000003073', '00000000-0000-7000-8000-000000003062', '00000000-0000-7000-8000-0000000030a2',
   'conversations/00000000-0000-7000-8000-000000003062/c.pdf', 'old.pdf', 'application/pdf', 100, now() - interval '13 months'),
  ('00000000-0000-7000-8000-000000003084', '00000000-0000-7000-8000-000000003074', '00000000-0000-7000-8000-000000003062', '00000000-0000-7000-8000-0000000030a2',
   'conversations/00000000-0000-7000-8000-000000003062/d.pdf', 'new.pdf', 'application/pdf', 100, now() - interval '11 months');
-- B reported their conversation a month after the old menu was sent: that file is kept for the team.
insert into moderation_report (reporter_user_id, reporter_side, conversation_id, reason, created_at) values
  ('00000000-0000-7000-8000-0000000030a2', 'consumer', '00000000-0000-7000-8000-000000003062', 'other', now() - interval '12 months');

set local role app_server;
select pg_temp.expect_code('the site can''t work out end dates itself', $q$
  select conversation_file_ends('00000000-0000-7000-8000-000000003081')$q$, '42501');
select pg_temp.expect_equal('the nightly run ends the files past their date', (select expire_conversation_files(100)::text), '2');
reset role;
select pg_temp.expect_equal('…a file in a conversation about an event: 30 days after the event', (
  select (expired_at is not null)::text from conversation_file where id = '00000000-0000-7000-8000-000000003081'), 'true');
select pg_temp.expect_equal('…one sent after that still gets 30 days', (
  select (deleted_at is null)::text from conversation_file where id = '00000000-0000-7000-8000-000000003082'), 'true');
select pg_temp.expect_equal('…any other conversation''s file: a year after it was sent', (
  select (expired_at is not null)::text || ' ' || kept_for_report::text from conversation_file where id = '00000000-0000-7000-8000-000000003083'),
  'true true');
select pg_temp.expect_equal('…(kept for the team: a report covers it; storage not deleted)', (
  select string_agg(storage_path, ',') from conversation_files_to_remove(10)),
  'conversations/00000000-0000-7000-8000-000000003061/a.pdf');
select pg_temp.expect_equal('…younger than a year: kept', (
  select (deleted_at is null)::text from conversation_file where id = '00000000-0000-7000-8000-000000003084'), 'true');
set local role app_server;
select pg_temp.expect_equal('running it again ends nothing more', (select expire_conversation_files(100)::text), '0');

rollback;
