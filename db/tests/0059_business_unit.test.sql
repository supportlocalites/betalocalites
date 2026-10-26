-- =============================================================================
-- Checks for migration 0059: a unit or suite in a business's address (D-63). Rolled back.
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

insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000059b1', 'test-town-59', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000059c1', 'test-59-v', 'Vee Fifty Nine', '00000000-0000-7000-8000-0000000059b1', 'admin_entered', 'published', 'claimed', now());

set local role app_server;
update vendor set address_street = 'Lakeshore Road', address_number = '22', address_unit = 'Suite 200'
where id = '00000000-0000-7000-8000-0000000059c1';
select pg_temp.expect('a unit is kept with the street',
  (select address_unit = 'Suite 200' from vendor where id = '00000000-0000-7000-8000-0000000059c1'));
select pg_temp.expect_code('a unit needs a street',
  $q$update vendor set address_street = null, address_number = null where id = '00000000-0000-7000-8000-0000000059c1'$q$, '23514');
select pg_temp.expect_code('a private number means no unit kept either',
  $q$update vendor set address_number = null, hide_address_number = true where id = '00000000-0000-7000-8000-0000000059c1'$q$, '23514');
select pg_temp.expect_code('a unit is letters and numbers, not markup',
  $q$update vendor set address_unit = '<b>2</b>' where id = '00000000-0000-7000-8000-0000000059c1'$q$, '23514');
select pg_temp.expect_code('…and short',
  $q$update vendor set address_unit = repeat('1', 31) where id = '00000000-0000-7000-8000-0000000059c1'$q$, '23514');
update vendor set address_number = null, address_unit = null, hide_address_number = true where id = '00000000-0000-7000-8000-0000000059c1';
select pg_temp.expect('kept private: the number and unit go together',
  (select hide_address_number and address_number is null and address_unit is null from vendor where id = '00000000-0000-7000-8000-0000000059c1'));

select pg_temp.expect_code('Add my business: a private number means no unit kept either',
  $q$insert into vendor_suggestion (business_name, relationship, address_street, address_unit, hide_address_number)
     values ('X', 'owner', 'Main Street', '4', true)$q$, '23514');

rollback;
