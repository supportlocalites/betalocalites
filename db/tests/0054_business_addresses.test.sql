-- =============================================================================
-- Checks for migration 0054: business addresses and the map (D-56, D-57). Rolled back.
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
  ('00000000-0000-7000-8000-0000000054b1', 'test-town-54', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000054c1', 'test-54-v', 'Vee Fifty Four', '00000000-0000-7000-8000-0000000054b1', 'admin_entered', 'published', 'claimed', now());

select pg_temp.expect('a new listing has no address and isn''t on the map',
  (select address_street is null and address_number is null and not hide_address_number and map_lat is null and not map_approximate
   from vendor where id = '00000000-0000-7000-8000-0000000054c1'));

update vendor set address_street = 'Lakeshore Road', address_number = '22A', map_lat = 44.61, map_lng = -79.42
where id = '00000000-0000-7000-8000-0000000054c1';
select pg_temp.expect('a street, a number and a pin are kept',
  (select address_number = '22A' and map_lat = 44.61 from vendor where id = '00000000-0000-7000-8000-0000000054c1'));
update vendor set address_number = '10-12' where id = '00000000-0000-7000-8000-0000000054c1';
select pg_temp.expect('a range of numbers is fine', (select address_number = '10-12' from vendor where id = '00000000-0000-7000-8000-0000000054c1'));
update vendor set address_street = 'St. Mary’s Lane' where id = '00000000-0000-7000-8000-0000000054c1';
select pg_temp.expect('a street with a full stop and an apostrophe is fine', true);

select pg_temp.expect_code('a number that isn''t one is refused',
  $q$update vendor set address_number = '22; drop' where id = '00000000-0000-7000-8000-0000000054c1'$q$, '23514');
select pg_temp.expect_code('a street with a web address''s characters is refused',
  $q$update vendor set address_street = 'visit http://x.example' where id = '00000000-0000-7000-8000-0000000054c1'$q$, '23514');
select pg_temp.expect_code('a street over 120 characters is refused',
  $q$update vendor set address_street = repeat('a', 121) where id = '00000000-0000-7000-8000-0000000054c1'$q$, '23514');
select pg_temp.expect_code('a number without a street is refused',
  $q$update vendor set address_street = null where id = '00000000-0000-7000-8000-0000000054c1'$q$, '23514');
select pg_temp.expect_code('a hidden number can''t be kept (never on Localites)',
  $q$update vendor set hide_address_number = true where id = '00000000-0000-7000-8000-0000000054c1'$q$, '23514');
update vendor set hide_address_number = true, address_number = null, map_approximate = true
where id = '00000000-0000-7000-8000-0000000054c1';
select pg_temp.expect('hidden: the street stays, the number goes, the pin is approximate',
  (select address_street is not null and address_number is null and map_approximate from vendor where id = '00000000-0000-7000-8000-0000000054c1'));
select pg_temp.expect_code('…and a number can''t come back while it''s hidden',
  $q$update vendor set address_number = '22' where id = '00000000-0000-7000-8000-0000000054c1'$q$, '23514');
select pg_temp.expect_code('…nor an exact pin while it''s hidden',
  $q$update vendor set map_approximate = false where id = '00000000-0000-7000-8000-0000000054c1'$q$, '23514');
select pg_temp.expect_code('half a pin is refused',
  $q$update vendor set map_lng = null where id = '00000000-0000-7000-8000-0000000054c1'$q$, '23514');
select pg_temp.expect_code('a pin far from Ontario is refused',
  $q$update vendor set map_lat = 10 where id = '00000000-0000-7000-8000-0000000054c1'$q$, '23514');
select pg_temp.expect_code('"approximate" without a pin is refused',
  $q$update vendor set map_lat = null, map_lng = null where id = '00000000-0000-7000-8000-0000000054c1'$q$, '23514');
update vendor set map_lat = null, map_lng = null, map_approximate = false where id = '00000000-0000-7000-8000-0000000054c1';
select pg_temp.expect('no pin: listed by its town only', (select map_lat is null from vendor where id = '00000000-0000-7000-8000-0000000054c1'));

rollback;
