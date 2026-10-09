-- =============================================================================
-- Checks for docs/schema/stage1-proposed.sql
-- =============================================================================
-- Proves the database itself rejects dishonest or inconsistent data.
-- Run against a scratch database that has the proposed schema applied:
--   psql -v ON_ERROR_STOP=1 -f stage1-proposed.test.sql
-- Everything runs in one transaction and is rolled back. Uses obviously fake data.
-- =============================================================================

begin;

create function pg_temp.expect_reject(label text, stmt text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'PASS  %  (rejected: %)', label, sqlerrm;
    return;
  end;
  raise exception 'FAIL  %: statement was accepted but must be rejected', label;
end $$;

create function pg_temp.expect_accept(label text, stmt text) returns void
language plpgsql as $$
begin
  execute stmt;
  raise notice 'PASS  %  (accepted)', label;
end $$;

-- ---------------------------------------------------------------- fixtures ---
insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-000000000001', 'Test Admin', 'admin@example.com');
insert into municipality (id, slug, name, region) values
  ('00000000-0000-7000-8000-0000000000a1', 'test-town', 'Test Town', 'Test County');
insert into vendor (id, slug, display_name, primary_municipality_id, source) values
  ('00000000-0000-7000-8000-0000000000b1', 'test-vendor-1', 'Test Vendor 1',
   '00000000-0000-7000-8000-0000000000a1', 'admin_entered');
insert into attribute_definition (id, key, label, data_type, is_filterable) values
  ('00000000-0000-7000-8000-0000000000c1', 'indoor_outdoor', 'Indoor or outdoor', 'single_choice', true),
  ('00000000-0000-7000-8000-0000000000c2', 'travels_to_venue', 'Travels to your venue', 'boolean', true),
  ('00000000-0000-7000-8000-0000000000c3', 'age_suitability', 'Suitable ages', 'multi_choice', true);
insert into attribute_option (id, attribute_definition_id, value, label) values
  ('00000000-0000-7000-8000-0000000000d1', '00000000-0000-7000-8000-0000000000c1', 'indoor', 'Indoor'),
  ('00000000-0000-7000-8000-0000000000d2', '00000000-0000-7000-8000-0000000000c1', 'outdoor', 'Outdoor'),
  ('00000000-0000-7000-8000-0000000000d3', '00000000-0000-7000-8000-0000000000c3', 'age_3_5', '3–5'),
  ('00000000-0000-7000-8000-0000000000d4', '00000000-0000-7000-8000-0000000000c3', 'age_6_8', '6–8');
insert into media_asset (id, owner_kind, owner_id, bucket, storage_path, mime_type, byte_size) values
  ('00000000-0000-7000-8000-0000000000e1', 'vendor', '00000000-0000-7000-8000-0000000000b1', 'public', 'v/1/a.webp', 'image/webp', 1000),
  ('00000000-0000-7000-8000-0000000000e2', 'vendor', '00000000-0000-7000-8000-0000000000b1', 'public', 'v/1/b.webp', 'image/webp', 1000);

-- --------------------------------------------------------- honest pricing ---
select pg_temp.expect_reject('fixed price with no amount',
  $q$insert into vendor_service (vendor_id, name, pricing_model)
     values ('00000000-0000-7000-8000-0000000000b1', 'Package', 'fixed')$q$);
select pg_temp.expect_reject('custom quote that also shows a price',
  $q$insert into vendor_service (vendor_id, name, pricing_model, price_cents)
     values ('00000000-0000-7000-8000-0000000000b1', 'Package', 'custom_quote', 25000)$q$);
select pg_temp.expect_reject('negative price',
  $q$insert into vendor_service (vendor_id, name, pricing_model, price_cents)
     values ('00000000-0000-7000-8000-0000000000b1', 'Package', 'fixed', -1)$q$);
select pg_temp.expect_reject('min guests above max guests',
  $q$insert into vendor_service (vendor_id, name, pricing_model, min_guests, max_guests)
     values ('00000000-0000-7000-8000-0000000000b1', 'Package', 'not_listed', 20, 10)$q$);
select pg_temp.expect_accept('custom quote with no price',
  $q$insert into vendor_service (vendor_id, name, pricing_model)
     values ('00000000-0000-7000-8000-0000000000b1', 'Custom party', 'custom_quote')$q$);
select pg_temp.expect_accept('starting-at price',
  $q$insert into vendor_service (vendor_id, name, pricing_model, price_cents)
     values ('00000000-0000-7000-8000-0000000000b1', 'Basic', 'starting_at', 15000)$q$);

-- ------------------------------------------------------ honest statuses ---
select pg_temp.expect_reject('published with no publish date',
  $q$update vendor set listing_status = 'published'
     where id = '00000000-0000-7000-8000-0000000000b1'$q$);
select pg_temp.expect_reject('verified with no verification date',
  $q$update vendor set verification_status = 'verified'
     where id = '00000000-0000-7000-8000-0000000000b1'$q$);
select pg_temp.expect_reject('archived with no archive date',
  $q$update vendor set listing_status = 'archived'
     where id = '00000000-0000-7000-8000-0000000000b1'$q$);
select pg_temp.expect_reject('unknown listing status',
  $q$update vendor set listing_status = 'featured'
     where id = '00000000-0000-7000-8000-0000000000b1'$q$);
select pg_temp.expect_accept('published with a publish date',
  $q$update vendor set listing_status = 'published', published_at = now()
     where id = '00000000-0000-7000-8000-0000000000b1'$q$);

-- ------------------------------------------------------ typed attributes ---
select pg_temp.expect_reject('yes/no attribute given a choice',
  $q$insert into vendor_attribute_value (vendor_id, attribute_definition_id, option_id)
     values ('00000000-0000-7000-8000-0000000000b1', '00000000-0000-7000-8000-0000000000c2',
             '00000000-0000-7000-8000-0000000000d1')$q$);
select pg_temp.expect_reject('choice attribute given free text',
  $q$insert into vendor_attribute_value (vendor_id, attribute_definition_id, value_text)
     values ('00000000-0000-7000-8000-0000000000b1', '00000000-0000-7000-8000-0000000000c1', 'Indoors')$q$);
select pg_temp.expect_reject('option borrowed from a different attribute',
  $q$insert into vendor_attribute_value (vendor_id, attribute_definition_id, option_id)
     values ('00000000-0000-7000-8000-0000000000b1', '00000000-0000-7000-8000-0000000000c1',
             '00000000-0000-7000-8000-0000000000d3')$q$);
select pg_temp.expect_reject('two value columns set at once',
  $q$insert into vendor_attribute_value (vendor_id, attribute_definition_id, value_boolean, value_text)
     values ('00000000-0000-7000-8000-0000000000b1', '00000000-0000-7000-8000-0000000000c2', true, 'yes')$q$);
select pg_temp.expect_accept('single choice, first value',
  $q$insert into vendor_attribute_value (vendor_id, attribute_definition_id, option_id)
     values ('00000000-0000-7000-8000-0000000000b1', '00000000-0000-7000-8000-0000000000c1',
             '00000000-0000-7000-8000-0000000000d1')$q$);
select pg_temp.expect_reject('single choice, second value',
  $q$insert into vendor_attribute_value (vendor_id, attribute_definition_id, option_id)
     values ('00000000-0000-7000-8000-0000000000b1', '00000000-0000-7000-8000-0000000000c1',
             '00000000-0000-7000-8000-0000000000d2')$q$);
select pg_temp.expect_accept('multi choice, two values',
  $q$insert into vendor_attribute_value (vendor_id, attribute_definition_id, option_id)
     values ('00000000-0000-7000-8000-0000000000b1', '00000000-0000-7000-8000-0000000000c3',
             '00000000-0000-7000-8000-0000000000d3'),
            ('00000000-0000-7000-8000-0000000000b1', '00000000-0000-7000-8000-0000000000c3',
             '00000000-0000-7000-8000-0000000000d4')$q$);
select pg_temp.expect_accept('yes/no attribute given yes',
  $q$insert into vendor_attribute_value (vendor_id, attribute_definition_id, value_boolean)
     values ('00000000-0000-7000-8000-0000000000b1', '00000000-0000-7000-8000-0000000000c2', true)$q$);
select pg_temp.expect_reject('free-text attribute marked filterable',
  $q$insert into attribute_definition (key, label, data_type, is_filterable)
     values ('notes', 'Notes', 'text', true)$q$);

-- ---------------------------------------------- tier 3 cannot shadow tier 2 ---
select pg_temp.expect_reject('managed attribute hidden in profile_extras',
  $q$update vendor set profile_extras = '{"travels_to_venue": "yes"}'
     where id = '00000000-0000-7000-8000-0000000000b1'$q$);
select pg_temp.expect_accept('display-only extra',
  $q$update vendor set profile_extras = '{"founded_note": "Family run since the 90s"}'
     where id = '00000000-0000-7000-8000-0000000000b1'$q$);

-- ---------------------------------------------------------------- media ---
select pg_temp.expect_accept('one logo',
  $q$insert into vendor_media (vendor_id, media_asset_id, role)
     values ('00000000-0000-7000-8000-0000000000b1', '00000000-0000-7000-8000-0000000000e1', 'logo')$q$);
select pg_temp.expect_reject('second logo',
  $q$insert into vendor_media (vendor_id, media_asset_id, role)
     values ('00000000-0000-7000-8000-0000000000b1', '00000000-0000-7000-8000-0000000000e2', 'logo')$q$);
select pg_temp.expect_reject('unsupported file type',
  $q$insert into media_asset (owner_kind, owner_id, bucket, storage_path, mime_type, byte_size)
     values ('vendor', '00000000-0000-7000-8000-0000000000b1', 'public', 'v/1/x.exe', 'application/x-msdownload', 10)$q$);

-- ---------------------------------------------------------------- claims ---
select pg_temp.expect_reject('claim approved without a reviewer',
  $q$insert into vendor_claim (vendor_id, claimant_user_id, status)
     values ('00000000-0000-7000-8000-0000000000b1', '00000000-0000-7000-8000-000000000001', 'approved')$q$);

-- ------------------------------------------------------------ audit trail ---
insert into audit_log (actor_user_id, action, subject_type, subject_id)
  values ('00000000-0000-7000-8000-000000000001', 'vendor.publish', 'vendor',
          '00000000-0000-7000-8000-0000000000b1');
select pg_temp.expect_reject('editing the audit log',
  $q$update audit_log set action = 'vendor.nothing'$q$);
select pg_temp.expect_reject('deleting from the audit log',
  $q$delete from audit_log$q$);

-- --------------------------------------------- browser roles see nothing ---
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end $$;
grant usage on schema public to anon;
grant select on vendor, vendor_service, audit_log to anon;
set local role anon;
do $$
declare n int;
begin
  select count(*) into n from vendor;
  if n <> 0 then raise exception 'FAIL  anon role read % vendor rows', n; end if;
  select count(*) into n from audit_log;
  if n <> 0 then raise exception 'FAIL  anon role read % audit rows', n; end if;
  raise notice 'PASS  browser-facing role reads zero rows even with a table grant';
end $$;
reset role;

do $$ begin raise notice 'ALL SCHEMA CHECKS PASSED'; end $$;

rollback;
