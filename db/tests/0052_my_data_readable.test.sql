-- =============================================================================
-- Checks for migration 0052: Download your data, what you did for a business (M21). Rolled back.
-- =============================================================================

begin;

create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAIL  %', label; end if;
  raise notice 'PASS  %', label;
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

-- Ann owns V; Sam was on V's staff, left and came back; Kim is a customer.
insert into app_user (id, display_name, given_name, family_name, email) values
  ('00000000-0000-7000-8000-0000000052a1', 'Ann O.', 'Ann', 'Owner', 'ann-52@example.com'),
  ('00000000-0000-7000-8000-0000000052a2', 'Sam S.', 'Sam', 'Staff', 'sam-52@example.com'),
  ('00000000-0000-7000-8000-0000000052a3', 'Kim C.', 'Kim', 'Customer', 'kim-52@example.com');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000052b1', 'test-town-52', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000052c1', 'test-52-v', 'Vee Fifty Two', '00000000-0000-7000-8000-0000000052b1', 'admin_entered', 'published', 'claimed', now());

set local session_replication_role = replica;
insert into vendor_member (vendor_id, user_id, role, created_at, ended_at) values
  ('00000000-0000-7000-8000-0000000052c1', '00000000-0000-7000-8000-0000000052a1', 'owner', now() - interval '1 year', null),
  ('00000000-0000-7000-8000-0000000052c1', '00000000-0000-7000-8000-0000000052a2', 'staff', now() - interval '6 months', now() - interval '3 months'),
  ('00000000-0000-7000-8000-0000000052c1', '00000000-0000-7000-8000-0000000052a2', 'staff', now() - interval '1 month', null);
insert into event (id, host_user_id, event_date, start_time, municipality_id) values
  ('00000000-0000-7000-8000-0000000052d1', '00000000-0000-7000-8000-0000000052a3', current_date - 10, '14:00', '00000000-0000-7000-8000-0000000052b1');
insert into event_private (event_id, host_user_id, title) values
  ('00000000-0000-7000-8000-0000000052d1', '00000000-0000-7000-8000-0000000052a3', 'Kim party');
insert into event_vendor (id, event_id, host_user_id, vendor_id, status, booked_at, vendor_flagged_at, vendor_flagged_by) values
  ('00000000-0000-7000-8000-0000000052e1', '00000000-0000-7000-8000-0000000052d1', '00000000-0000-7000-8000-0000000052a3',
   '00000000-0000-7000-8000-0000000052c1', 'booked', now(), now(), '00000000-0000-7000-8000-0000000052a1');
insert into event_vendor_flag_note (event_vendor_id, note) values ('00000000-0000-7000-8000-0000000052e1', 'Ann flag note');
insert into conversation (id, consumer_user_id, vendor_id, last_message_at) values
  ('00000000-0000-7000-8000-0000000052f1', '00000000-0000-7000-8000-0000000052a3', '00000000-0000-7000-8000-0000000052c1', now());
insert into message (conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-0000000052f1', '00000000-0000-7000-8000-0000000052a3', 'consumer', 'Kim customer words'),
  ('00000000-0000-7000-8000-0000000052f1', '00000000-0000-7000-8000-0000000052a1', 'vendor', 'Ann business words'),
  ('00000000-0000-7000-8000-0000000052f1', '00000000-0000-7000-8000-0000000052a2', 'vendor', 'Sam business words');
insert into review (id, event_vendor_id, vendor_id, author_user_id, event_date, rating, body, status, published_at, decided_at,
                    vendor_reply, vendor_replied_by, vendor_replied_at) values
  ('00000000-0000-7000-8000-000000005291', '00000000-0000-7000-8000-0000000052e1', '00000000-0000-7000-8000-0000000052c1',
   '00000000-0000-7000-8000-0000000052a3', current_date - 10, 5, 'Kim review words', 'published', now(), now(),
   'Ann reply words', '00000000-0000-7000-8000-0000000052a1', now());
insert into media_asset (owner_kind, owner_id, bucket, storage_path, mime_type, byte_size, alt_text, uploaded_by) values
  ('vendor', '00000000-0000-7000-8000-0000000052c1', 'public', 'test-52/photo.webp', 'image/webp', 100, 'Ann photo words',
   '00000000-0000-7000-8000-0000000052a1');
insert into audit_log (actor_user_id, action, subject_type, subject_id, changes) values
  ('00000000-0000-7000-8000-0000000052a1', 'vendor.owner_edit', 'vendor', '00000000-0000-7000-8000-0000000052c1',
   '{"tagline": {"from": null, "to": "Ann tagline words"}}'),
  ('00000000-0000-7000-8000-0000000052a1', 'vendor.update', 'vendor', '00000000-0000-7000-8000-0000000052c1',
   '{"tagline": {"from": null, "to": "Team words"}}');
set local session_replication_role = origin;

set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000052a1');
create temp table ann as select my_data() as d;
select pg_temp.expect('Ann: one business, with her message, page change, reply, photo and "wasn''t booked" note',
  (select jsonb_array_length(d->'for_your_businesses') = 1
          and d #>> '{for_your_businesses,0,business}' = 'Vee Fifty Two'
          and d::text like '%Ann business words%' and d::text like '%Ann tagline words%' and d::text like '%Ann reply words%'
          and d::text like '%Ann photo words%' and d::text like '%Ann flag note%' from ann));
select pg_temp.expect('…never what Sam wrote, the customer''s words, review or name, or a change log entry that isn''t her own save',
  (select d::text not like '%Sam business words%' and d::text not like '%Kim customer words%' and d::text not like '%Kim review words%'
          and d::text not like '%kim-52@example.com%' and d::text not like '%Kim party%' and d::text not like '%Team words%' from ann));
select pg_temp.expect('…and everything 0043 gave is still there, with the new description',
  (select d ? 'events' and d ? 'conversations' and d ? 'activity' and d->>'about' like '%what you did for businesses%' from ann));

select pg_temp.act('person', '00000000-0000-7000-8000-0000000052a2');
create temp table sam as select my_data() as d;
select pg_temp.expect('Sam: the business once, both his times on the team, his own message only',
  (select jsonb_array_length(d->'for_your_businesses') = 1
          and jsonb_array_length(d #> '{for_your_businesses,0,your_places_on_the_team}') = 2
          and d::text like '%Sam business words%' and d::text not like '%Ann business words%' and d::text not like '%Ann flag note%' from sam));

select pg_temp.act('person', '00000000-0000-7000-8000-0000000052a3');
create temp table kim as select my_data() as d;
select pg_temp.expect('Kim (the customer): no business section, and none of the business''s private note',
  (select d->'for_your_businesses' = '[]'::jsonb and d::text not like '%Ann flag note%' and d::text like '%Kim customer words%' from kim));

select pg_temp.act('business', '00000000-0000-7000-8000-0000000052a1');
select pg_temp.expect_code('only as the person (not the business side)', 'select my_data()', 'LP101');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000052a1');
select pg_temp.expect_code('the old version can''t be called by the site', 'select my_data_0043()', '42501');
reset role;

rollback;
