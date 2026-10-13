-- =============================================================================
-- Checks for migration 0019: a business's square profile photo, and its framing.
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

-- Refused for this exact reason (sqlstate), not just any error.
create function pg_temp.expect_code(label text, stmt text, code text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate <> code then
      raise exception 'FAIL  %: refused with %, want %', label, sqlstate, code;
    end if;
    raise notice 'PASS  %  (refused: %)', label, sqlstate;
    return;
  end;
  raise exception 'FAIL  %: was accepted', label;
end $$;

insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000019b1', 'test-town-19', 'Test Town 19', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000019c1', 'test-nineteen-v', 'Nineteen V', '00000000-0000-7000-8000-0000000019b1', 'admin_entered', 'published', 'claimed', now());

set local role app_server;
insert into media_asset (id, owner_kind, owner_id, bucket, storage_path, mime_type, byte_size, width, height, alt_text)
select ('00000000-0000-7000-8000-00000000190' || n)::uuid, 'vendor', '00000000-0000-7000-8000-0000000019c1', 'public',
       'vendors/test-19/' || n || '.webp', 'image/webp', 1000, 1600, 1200, 'Photo ' || n
from generate_series(1, 9) n;
insert into media_asset (id, owner_kind, owner_id, bucket, storage_path, mime_type, byte_size, alt_text) values
  ('00000000-0000-7000-8000-0000000019f1', 'vendor', '00000000-0000-7000-8000-0000000019c1', 'public', 'vendors/test-19/logo.webp', 'image/webp', 1000, 'Our logo'),
  ('00000000-0000-7000-8000-0000000019f2', 'vendor', '00000000-0000-7000-8000-0000000019c1', 'public', 'vendors/test-19/logo2.webp', 'image/webp', 1000, 'Another logo');
insert into vendor_media (vendor_id, media_asset_id, role, sort_order)
select '00000000-0000-7000-8000-0000000019c1', ('00000000-0000-7000-8000-00000000190' || n)::uuid, 'gallery', n from generate_series(1, 8) n;
insert into vendor_media (vendor_id, media_asset_id, role) values ('00000000-0000-7000-8000-0000000019c1', '00000000-0000-7000-8000-0000000019f1', 'logo');
select pg_temp.expect_equal('8 page photos and a profile photo fit', (
  select count(*)::text from vendor_media where vendor_id = '00000000-0000-7000-8000-0000000019c1'), '9');
select pg_temp.expect_code('a ninth page photo is still refused',
  $q$insert into vendor_media (vendor_id, media_asset_id, role) values ('00000000-0000-7000-8000-0000000019c1', '00000000-0000-7000-8000-000000001909', 'gallery')$q$, 'LP122');
select pg_temp.expect_code('a second profile photo is refused',
  $q$insert into vendor_media (vendor_id, media_asset_id, role) values ('00000000-0000-7000-8000-0000000019c1', '00000000-0000-7000-8000-0000000019f2', 'logo')$q$, '23505');
select pg_temp.expect_code('the profile photo can''t quietly become a ninth page photo',
  $q$update vendor_media set role = 'gallery' where media_asset_id = '00000000-0000-7000-8000-0000000019f1'$q$, 'LP100');
select pg_temp.expect_code('a page photo can''t quietly become the profile photo (refused by the rule, not just the one-logo index)',
  $q$update vendor_media set role = 'logo', media_asset_id = media_asset_id where media_asset_id = '00000000-0000-7000-8000-000000001901'$q$, 'LP100');

update media_asset set crop_x = -12.5, crop_y = 0, crop_w = 125, crop_h = 100 where id = '00000000-0000-7000-8000-0000000019f1';
select pg_temp.expect_equal('a framing (zoomed out to show the whole photo) is kept',
  (select crop_x || ',' || crop_y || ',' || crop_w || ',' || crop_h from media_asset where id = '00000000-0000-7000-8000-0000000019f1'), '-12.5,0,125,100');
select pg_temp.expect_reject('a framing must have all four numbers',
  $q$update media_asset set crop_h = null where id = '00000000-0000-7000-8000-0000000019f1'$q$);
select pg_temp.expect_code('a framing with no size is refused',
  $q$update media_asset set crop_w = 0 where id = '00000000-0000-7000-8000-0000000019f1'$q$, '23514');
select pg_temp.expect_code('a framing zoomed out past 500% is refused',
  $q$update media_asset set crop_h = 600 where id = '00000000-0000-7000-8000-0000000019f1'$q$, '23514');
select pg_temp.expect_code('a framing far off the photo is refused',
  $q$update media_asset set crop_x = -401 where id = '00000000-0000-7000-8000-0000000019f1'$q$, '23514');
update media_asset set crop_x = null, crop_y = null, crop_w = null, crop_h = null where id = '00000000-0000-7000-8000-0000000019f1';
select pg_temp.expect_equal('“Start again” clears it', (select (crop_x is null)::text from media_asset where id = '00000000-0000-7000-8000-0000000019f1'), 'true');

rollback;
