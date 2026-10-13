-- =============================================================================
-- Checks for migration 0018: the part of a photo that always stays in view.
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

insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000018b1', 'test-town-18', 'Test Town 18', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000018c1', 'test-eighteen-v', 'Eighteen V', '00000000-0000-7000-8000-0000000018b1', 'admin_entered', 'published', 'claimed', now());

set local role app_server;
insert into media_asset (id, owner_kind, owner_id, bucket, storage_path, mime_type, byte_size, width, height, alt_text) values
  ('00000000-0000-7000-8000-0000000018a1', 'vendor', '00000000-0000-7000-8000-0000000018c1', 'public', 'vendors/test-18/a.webp', 'image/webp', 1000, 1600, 900, 'A photo');
select pg_temp.expect_equal('a new photo keeps its middle in view',
  (select focus_x || ',' || focus_y from media_asset where id = '00000000-0000-7000-8000-0000000018a1'), '0.5,0.5');
update media_asset set focus_x = 0.2, focus_y = 0.85 where id = '00000000-0000-7000-8000-0000000018a1';
select pg_temp.expect_equal('the owner''s chosen spot is kept',
  (select focus_x || ',' || focus_y from media_asset where id = '00000000-0000-7000-8000-0000000018a1'), '0.2,0.85');
select pg_temp.expect_reject('a spot outside the photo is refused',
  $q$update media_asset set focus_x = 1.5 where id = '00000000-0000-7000-8000-0000000018a1'$q$);
select pg_temp.expect_reject('…on either axis',
  $q$update media_asset set focus_y = -0.1 where id = '00000000-0000-7000-8000-0000000018a1'$q$);

rollback;
