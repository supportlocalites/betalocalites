-- =============================================================================
-- Checks for migration 0016: business photos (V2, P4; E §9).
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

create function pg_temp.expect_reject(label text, stmt text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'PASS  %  (refused: %)', label, sqlstate;
    return;
  end;
  raise exception 'FAIL  %: was accepted', label;
end $$;

insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000016a1', 'Owner O', 'owner-o-16@example.com');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000016b1', 'test-town-16', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000016c1', 'test-sixteen-v', 'Sixteen V', '00000000-0000-7000-8000-0000000016b1', 'admin_entered', 'published', 'claimed', now()),
  ('00000000-0000-7000-8000-0000000016c2', 'test-sixteen-w', 'Sixteen W', '00000000-0000-7000-8000-0000000016b1', 'admin_entered', 'published', 'claimed', now());

set local role app_server;
-- Nine photos belonging to V, and one belonging to W.
insert into media_asset (id, owner_kind, owner_id, bucket, storage_path, mime_type, byte_size, width, height, alt_text, uploaded_by)
select ('00000000-0000-7000-8000-00000000160' || n)::uuid, 'vendor', '00000000-0000-7000-8000-0000000016c1', 'public',
       'vendors/test-16/' || n || '.webp', 'image/webp', 1000, 1600, 1200, 'Photo ' || n, '00000000-0000-7000-8000-0000000016a1'
from generate_series(1, 9) n;
insert into media_asset (id, owner_kind, owner_id, bucket, storage_path, mime_type, byte_size, alt_text) values
  ('00000000-0000-7000-8000-0000000016f1', 'vendor', '00000000-0000-7000-8000-0000000016c2', 'public', 'vendors/test-16/w.webp', 'image/webp', 1000, 'W photo'),
  ('00000000-0000-7000-8000-0000000016f2', 'vendor', '00000000-0000-7000-8000-0000000016c1', 'public', 'vendors/test-16/blank.webp', 'image/webp', 1000, '  '),
  ('00000000-0000-7000-8000-0000000016f3', 'vendor', '00000000-0000-7000-8000-0000000016c1', 'private', 'vendors/test-16/private.webp', 'image/webp', 1000, 'Private');

select pg_temp.expect_reject('another business''s photo can''t be shown on V',
  $q$insert into vendor_media (vendor_id, media_asset_id, role) values ('00000000-0000-7000-8000-0000000016c1', '00000000-0000-7000-8000-0000000016f1', 'gallery')$q$);
select pg_temp.expect_reject('a photo without a description can''t be shown',
  $q$insert into vendor_media (vendor_id, media_asset_id, role) values ('00000000-0000-7000-8000-0000000016c1', '00000000-0000-7000-8000-0000000016f2', 'gallery')$q$);
select pg_temp.expect_reject('a file in private storage can''t be shown',
  $q$insert into vendor_media (vendor_id, media_asset_id, role) values ('00000000-0000-7000-8000-0000000016c1', '00000000-0000-7000-8000-0000000016f3', 'gallery')$q$);

insert into vendor_media (vendor_id, media_asset_id, role, sort_order)
select '00000000-0000-7000-8000-0000000016c1', ('00000000-0000-7000-8000-00000000160' || n)::uuid, 'gallery', n
from generate_series(1, 8) n;
select pg_temp.expect_equal('eight photos fit', (
  select count(*)::text from vendor_media where vendor_id = '00000000-0000-7000-8000-0000000016c1'), '8');
select pg_temp.expect_reject('a ninth is refused',
  $q$insert into vendor_media (vendor_id, media_asset_id, role) values ('00000000-0000-7000-8000-0000000016c1', '00000000-0000-7000-8000-000000001609', 'gallery')$q$);
select pg_temp.expect_reject('a photo can''t be moved to another business',
  $q$update vendor_media set vendor_id = '00000000-0000-7000-8000-0000000016c2' where media_asset_id = '00000000-0000-7000-8000-000000001601'$q$);
select pg_temp.expect_reject('a business''s photo place can''t be switched to another file',
  $q$update vendor_media set media_asset_id = '00000000-0000-7000-8000-000000001609' where media_asset_id = '00000000-0000-7000-8000-000000001602'$q$);
update vendor_media set sort_order = 0 where media_asset_id = '00000000-0000-7000-8000-000000001608';
select pg_temp.expect_equal('the order can change', (
  select media_asset_id::text from vendor_media where vendor_id = '00000000-0000-7000-8000-0000000016c1' order by sort_order limit 1),
  '00000000-0000-7000-8000-000000001608');

select pg_temp.expect_reject('a file''s storage place can''t be changed',
  $q$update media_asset set storage_path = 'vendors/elsewhere.webp' where id = '00000000-0000-7000-8000-000000001601'$q$);
select pg_temp.expect_reject('a file can''t be handed to another business',
  $q$update media_asset set owner_id = '00000000-0000-7000-8000-0000000016c2' where id = '00000000-0000-7000-8000-000000001601'$q$);
update media_asset set alt_text = 'A new description' where id = '00000000-0000-7000-8000-000000001601';
select pg_temp.expect_equal('the description can change', (
  select alt_text from media_asset where id = '00000000-0000-7000-8000-000000001601'), 'A new description');
select pg_temp.expect_reject('a photo still on the business can''t be marked removed',
  $q$update media_asset set deleted_at = now() where id = '00000000-0000-7000-8000-000000001601'$q$);

delete from vendor_media where media_asset_id = '00000000-0000-7000-8000-000000001601';
update media_asset set deleted_at = now() where id = '00000000-0000-7000-8000-000000001601';
select pg_temp.expect_reject('a removed photo can''t be shown again',
  $q$insert into vendor_media (vendor_id, media_asset_id, role) values ('00000000-0000-7000-8000-0000000016c1', '00000000-0000-7000-8000-000000001601', 'gallery')$q$);
select pg_temp.expect_reject('…or brought back',
  $q$update media_asset set deleted_at = null where id = '00000000-0000-7000-8000-000000001601'$q$);
insert into vendor_media (vendor_id, media_asset_id, role) values ('00000000-0000-7000-8000-0000000016c1', '00000000-0000-7000-8000-000000001609', 'gallery');
select pg_temp.expect_equal('after one is removed, there is room for another', (
  select count(*)::text from vendor_media where vendor_id = '00000000-0000-7000-8000-0000000016c1'), '8');
select pg_temp.expect_reject('a file can''t be marked deleted from storage while still in use',
  $q$update media_asset set storage_removed_at = now() where id = '00000000-0000-7000-8000-000000001602'$q$);
update media_asset set storage_removed_at = now() where id = '00000000-0000-7000-8000-000000001601';
select pg_temp.expect_equal('a removed photo''s file is marked deleted from storage', (
  select (storage_removed_at is not null)::text from media_asset where id = '00000000-0000-7000-8000-000000001601'), 'true');

reset role;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;
set local role anon;
do $$
begin
  perform count(*) from media_asset;
  raise exception 'FAIL  the browser-facing role can read photo records';
exception when insufficient_privilege then
  raise notice 'PASS  the browser-facing role can''t read photo records';
end $$;

rollback;
