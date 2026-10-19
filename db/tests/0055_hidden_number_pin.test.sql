-- =============================================================================
-- Checks for migration 0055: a hidden street number's pin is always approximate. Rolled back.
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
  ('00000000-0000-7000-8000-0000000055b1', 'test-town-55', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at,
                    address_street, hide_address_number, map_lat, map_lng, map_approximate) values
  ('00000000-0000-7000-8000-0000000055c1', 'test-55-v', 'Vee Fifty Five', '00000000-0000-7000-8000-0000000055b1', 'admin_entered', 'published', 'claimed', now(),
   'Lakeshore Road', true, 44.611, -79.412, true);

select pg_temp.expect_code('a hidden number''s pin can''t be made exact',
  $q$update vendor set map_approximate = false where id = '00000000-0000-7000-8000-0000000055c1'$q$, '23514');
update vendor set hide_address_number = false, map_approximate = false where id = '00000000-0000-7000-8000-0000000055c1';
select pg_temp.expect('…once the number isn''t hidden, an exact pin is fine',
  (select not map_approximate from vendor where id = '00000000-0000-7000-8000-0000000055c1'));
update vendor set map_lat = null, map_lng = null, hide_address_number = true where id = '00000000-0000-7000-8000-0000000055c1';
select pg_temp.expect('…and a hidden number with no pin is fine', (select hide_address_number from vendor where id = '00000000-0000-7000-8000-0000000055c1'));

rollback;
