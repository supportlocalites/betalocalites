-- =============================================================================
-- Checks for migration 0060: distances from the person's own home (D-64). Rolled back.
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

insert into app_user (id, display_name, given_name, family_name, email) values
  ('00000000-0000-7000-8000-0000000060a1', 'Pat Q.', 'Pat', 'Quill', 'pat-60@example.com'),
  ('00000000-0000-7000-8000-0000000060a2', 'Kim R.', 'Kim', 'Reed', 'kim-60@example.com');
insert into person_profile (user_id, street_address, town, province, postal_code) values
  ('00000000-0000-7000-8000-0000000060a1', '22 Lakeshore Road', 'Orillia', 'ON', 'L3V 1A1');

set local role app_server;
select pg_temp.expect('a new address is not looked up yet',
  (select home_lookup is null and home_lat is null from person_profile where user_id = '00000000-0000-7000-8000-0000000060a1'));
update person_profile set home_lat = 44.6082, home_lng = -79.4197, home_lookup = 'found', home_looked_up_at = now()
where user_id = '00000000-0000-7000-8000-0000000060a1';
select pg_temp.expect('found: the exact point is kept',
  (select home_lat = 44.6082 and home_lng = -79.4197 from person_profile where user_id = '00000000-0000-7000-8000-0000000060a1'));
select pg_temp.expect_code('a point needs both halves',
  $q$update person_profile set home_lng = null where user_id = '00000000-0000-7000-8000-0000000060a1'$q$, '23514');
select pg_temp.expect_code('"not found" has no point',
  $q$update person_profile set home_lookup = 'not_found' where user_id = '00000000-0000-7000-8000-0000000060a1'$q$, '23514');
select pg_temp.expect_code('a point far outside Ontario is refused',
  $q$update person_profile set home_lat = 10, home_lng = -79 where user_id = '00000000-0000-7000-8000-0000000060a1'$q$, '23514');
select pg_temp.expect_code('a look-up has its time',
  $q$update person_profile set home_looked_up_at = null where user_id = '00000000-0000-7000-8000-0000000060a1'$q$, '23514');

-- Saving other details keeps the point; changing the address clears it.
update person_profile set gender = 'woman' where user_id = '00000000-0000-7000-8000-0000000060a1';
select pg_temp.expect('another detail saved: the point stays',
  (select home_lookup = 'found' from person_profile where user_id = '00000000-0000-7000-8000-0000000060a1'));
update person_profile set home_tried_at = now() where user_id = '00000000-0000-7000-8000-0000000060a1';
update person_profile set street_address = '5 Mississaga Street' where user_id = '00000000-0000-7000-8000-0000000060a1';
select pg_temp.expect('a new address: the old point goes, to be looked up again',
  (select home_lat is null and home_lng is null and home_lookup is null and home_looked_up_at is null and home_tried_at is null
   from person_profile where user_id = '00000000-0000-7000-8000-0000000060a1'));
update person_profile set home_lookup = 'not_found', home_looked_up_at = now() where user_id = '00000000-0000-7000-8000-0000000060a1';
update person_profile set postal_code = 'L3V 2B2' where user_id = '00000000-0000-7000-8000-0000000060a1';
select pg_temp.expect('…and "not found" is tried again after a change',
  (select home_lookup is null from person_profile where user_id = '00000000-0000-7000-8000-0000000060a1'));

-- Download your data has it, for the person only.
reset role;
update person_profile set home_lat = 44.6, home_lng = -79.42, home_lookup = 'found', home_looked_up_at = now()
where user_id = '00000000-0000-7000-8000-0000000060a1';
set local role app_server;
select set_config('localites.side', 'person', true), set_config('localites.user_id', '00000000-0000-7000-8000-0000000060a1', true),
       set_config('localites.vendor_id', '', true);
select pg_temp.expect('Download your data includes where their home is',
  (select (my_data()->'optional_details'->>'home_lat')::float = 44.6));
select set_config('localites.user_id', '00000000-0000-7000-8000-0000000060a2', true);
select pg_temp.expect('…and someone else’s has none of it', (select my_data()->'optional_details' = 'null'::jsonb or my_data()->'optional_details' is null));

rollback;
