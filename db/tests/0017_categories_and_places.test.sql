-- =============================================================================
-- Checks for migration 0017: the team looks after kinds of business and towns (X6, X8).
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

set local role app_server;
insert into category (id, slug, name, sort_order) values
  ('00000000-0000-7000-8000-0000000017a1', 'test-17-main', 'Test Main 17', 90),
  ('00000000-0000-7000-8000-0000000017a2', 'test-17-other', 'Test Other 17', 91);
insert into category (id, parent_id, slug, name, sort_order) values
  ('00000000-0000-7000-8000-0000000017b1', '00000000-0000-7000-8000-0000000017a1', 'test-17-sub', 'Test Sub 17', 1);

select pg_temp.expect_reject('a kind of business keeps its web address',
  $q$update category set slug = 'test-17-renamed' where id = '00000000-0000-7000-8000-0000000017a1'$q$);
update category set name = 'Test Main 17 renamed', description = 'New words' where id = '00000000-0000-7000-8000-0000000017a1';
select pg_temp.expect_equal('…but its name can change', (select name from category where id = '00000000-0000-7000-8000-0000000017a1'), 'Test Main 17 renamed');
select pg_temp.expect_reject('three levels: a kind can''t go under a kind within',
  $q$insert into category (parent_id, slug, name) values ('00000000-0000-7000-8000-0000000017b1', 'test-17-deep', 'Deep')$q$);
select pg_temp.expect_reject('a main kind with kinds within it can''t become one itself',
  $q$update category set parent_id = '00000000-0000-7000-8000-0000000017a2' where id = '00000000-0000-7000-8000-0000000017a1'$q$);
update category set parent_id = '00000000-0000-7000-8000-0000000017a2' where id = '00000000-0000-7000-8000-0000000017b1';
select pg_temp.expect_equal('a kind within can move to another main kind',
  (select parent_id::text from category where id = '00000000-0000-7000-8000-0000000017b1'), '00000000-0000-7000-8000-0000000017a2');
select pg_temp.expect_reject('two kinds with the same name under one main kind (any capitals)',
  $q$insert into category (parent_id, slug, name) values ('00000000-0000-7000-8000-0000000017a2', 'test-17-sub-2', 'TEST SUB 17')$q$);
insert into category (parent_id, slug, name) values ('00000000-0000-7000-8000-0000000017a1', 'test-17-sub-3', 'Test Sub 17');
select pg_temp.expect_equal('…the same name under another main kind is fine',
  (select count(*)::text from category where lower(name) = 'test sub 17'), '2');
select pg_temp.expect_reject('the app can''t delete a kind of business (it is hidden instead)',
  $q$delete from category where id = '00000000-0000-7000-8000-0000000017a2'$q$);

insert into municipality (id, slug, name, region) values
  ('00000000-0000-7000-8000-0000000017c1', 'test-17-town', 'Test Town 17', 'Test County');
select pg_temp.expect_reject('a town keeps its web address',
  $q$update municipality set slug = 'test-17-elsewhere' where id = '00000000-0000-7000-8000-0000000017c1'$q$);
select pg_temp.expect_reject('two towns with the same name in one region',
  $q$insert into municipality (slug, name, region) values ('test-17-town-2', 'test town 17', 'TEST COUNTY')$q$);
insert into municipality (slug, name, region) values ('test-17-town-3', 'Test Town 17', 'Another County');
select pg_temp.expect_equal('…the same name in another region is fine',
  (select count(*)::text from municipality where name = 'Test Town 17'), '2');
update municipality set name = 'Test Town 17 renamed', is_active = true, sort_order = 50 where id = '00000000-0000-7000-8000-0000000017c1';
select pg_temp.expect_equal('a town can be renamed, shown and reordered',
  (select name || ' ' || is_active || ' ' || sort_order from municipality where id = '00000000-0000-7000-8000-0000000017c1'), 'Test Town 17 renamed true 50');
select pg_temp.expect_reject('the app can''t delete a town',
  $q$delete from municipality where id = '00000000-0000-7000-8000-0000000017c1'$q$);

rollback;
