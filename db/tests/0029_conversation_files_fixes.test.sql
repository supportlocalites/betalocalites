-- Checks for migration 0029: the daily file limit counts every side. Rolled back.
begin;

create function pg_temp.expect_equal(label text, got text, want text) returns void
language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL  %: got %, want %', label, coalesce(got, 'null'), coalesce(want, 'null');
  end if;
  raise notice 'PASS  %  (%)', label, want;
end $$;

create function pg_temp.act(p_side text, p_user uuid, p_vendor uuid default null) returns void
language plpgsql as $$
begin
  perform set_config('localites.side', coalesce(p_side, ''), true),
          set_config('localites.user_id', coalesce(p_user::text, ''), true),
          set_config('localites.vendor_id', coalesce(p_vendor::text, ''), true);
end $$;

insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000029a1', 'Person A', 'a-29@example.com'),
  ('00000000-0000-7000-8000-0000000029a3', 'Owner O', 'o-29@example.com');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000029b1', 'test-town-29', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000029c1', 'test-29-v', 'Twenty-nine V', '00000000-0000-7000-8000-0000000029b1', 'admin_entered', 'published', 'claimed', now());
insert into vendor_member (vendor_id, user_id, role, created_at) values
  ('00000000-0000-7000-8000-0000000029c1', '00000000-0000-7000-8000-0000000029a3', 'owner', now() - interval '1 day');

set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000029a1');
insert into conversation (id, consumer_user_id, vendor_id) values
  ('00000000-0000-7000-8000-000000002961', '00000000-0000-7000-8000-0000000029a1', '00000000-0000-7000-8000-0000000029c1');
insert into message (id, conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002971', '00000000-0000-7000-8000-000000002961', '00000000-0000-7000-8000-0000000029a1', 'consumer', 'Hi');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000029a3', '00000000-0000-7000-8000-0000000029c1');
insert into message (id, conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002972', '00000000-0000-7000-8000-000000002961', '00000000-0000-7000-8000-0000000029a3', 'vendor', 'Menu');
insert into conversation_file (message_id, conversation_id, uploaded_by, storage_path, file_name, mime_type, byte_size)
values ('00000000-0000-7000-8000-000000002972', '00000000-0000-7000-8000-000000002961', '00000000-0000-7000-8000-0000000029a3',
        'conversations/00000000-0000-7000-8000-000000002961/m.pdf', 'menu.pdf', 'application/pdf', 100);
select pg_temp.act('person', '00000000-0000-7000-8000-0000000029a3');
select pg_temp.expect_equal('the daily file limit counts files sent from every side', (
  select files_sent_today('00000000-0000-7000-8000-0000000029a3')::text), '1');
select pg_temp.expect_equal('…and only your own', (
  select files_sent_today('00000000-0000-7000-8000-0000000029a1')::text), '0');

rollback;
