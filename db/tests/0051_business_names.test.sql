-- =============================================================================
-- Checks for migration 0051: scenario-test fixes, round 5 part 2 (business names).
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

insert into vendor (id, slug, display_name, primary_municipality_id, source)
select '00000000-0000-7000-8000-0000000051a1', 'first-name-51', 'First Name', id, 'admin_entered' from municipality limit 1;

select pg_temp.expect_equal('a business never renamed shows just its name',
  vendor_name_then('00000000-0000-7000-8000-0000000051a1', now() - interval '1 day'), 'First Name');

-- Renames happen at different moments; the trigger stamps each with now(), so set "until" by hand.
update vendor set display_name = 'Second Name' where id = '00000000-0000-7000-8000-0000000051a1';
update vendor_former_name set until = now() - interval '10 days' where vendor_id = '00000000-0000-7000-8000-0000000051a1';
update vendor set display_name = 'Third Name', tagline = 'x' where id = '00000000-0000-7000-8000-0000000051a1';
update vendor set tagline = 'y' where id = '00000000-0000-7000-8000-0000000051a1';

select pg_temp.expect_equal('each change of name is kept, and nothing else is',
  (select string_agg(name, ', ' order by until) from vendor_former_name where vendor_id = '00000000-0000-7000-8000-0000000051a1'),
  'First Name, Second Name');
select pg_temp.expect_equal('something from before the first rename: today''s name (dba the first)',
  vendor_name_then('00000000-0000-7000-8000-0000000051a1', now() - interval '20 days'), 'Third Name (dba First Name)');
select pg_temp.expect_equal('something from between the renames: (dba the second)',
  vendor_name_then('00000000-0000-7000-8000-0000000051a1', now() - interval '5 days'), 'Third Name (dba Second Name)');
select pg_temp.expect_equal('something from after the last rename: just today''s name',
  vendor_name_then('00000000-0000-7000-8000-0000000051a1', now() + interval '1 second'), 'Third Name');

-- Renamed back to an earlier name: no "(dba)" of itself.
update vendor set display_name = 'First Name' where id = '00000000-0000-7000-8000-0000000051a1';
select pg_temp.expect_equal('renamed back: something from the first name''s time shows just that name',
  vendor_name_then('00000000-0000-7000-8000-0000000051a1', now() - interval '20 days'), 'First Name');

set local role app_server;
select pg_temp.expect_equal('the site reads former names and the name then',
  (select count(*)::text from vendor_former_name where vendor_id = '00000000-0000-7000-8000-0000000051a1'), '3');
select pg_temp.expect_code('the site can''t write a former name itself',
  $q$insert into vendor_former_name (vendor_id, name) values ('00000000-0000-7000-8000-0000000051a1', 'Fake')$q$, '42501');
select pg_temp.expect_code('nor change one',
  $q$update vendor_former_name set name = 'Fake'$q$, '42501');
select pg_temp.expect_code('nor delete one',
  $q$delete from vendor_former_name$q$, '42501');
-- The site's own rename (as app_server) still keeps the earlier name.
update vendor set display_name = 'Fourth Name' where id = '00000000-0000-7000-8000-0000000051a1';
reset role;
select pg_temp.expect_equal('a rename by the site keeps the earlier name too',
  (select count(*)::text from vendor_former_name where vendor_id = '00000000-0000-7000-8000-0000000051a1' and name = 'First Name'), '2');

select pg_temp.expect_code('a save can be flagged for a new name, nothing unknown',
  $q$insert into owner_change (audit_id, vendor_id, flags) values (gen_random_uuid(), gen_random_uuid(), '{colour}')$q$, '23514');
select pg_temp.expect_equal('the "business renamed" email is a known kind',
  (select (pg_get_constraintdef(oid) like '%business_renamed%')::text from pg_constraint where conname = 'notification_kind_check'), 'true');
select pg_temp.expect_equal('owner_change flags allow name',
  (select (pg_get_constraintdef(oid) like '%name%')::text from pg_constraint where conname = 'owner_change_flags_check'), 'true');

rollback;
