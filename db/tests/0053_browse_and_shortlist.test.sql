-- =============================================================================
-- Checks for migration 0053: cost level and the shortlist (D-56, D-57). Rolled back.
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
create function pg_temp.act(p_side text, p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('localites.side', coalesce(p_side, ''), true),
          set_config('localites.user_id', coalesce(p_user::text, ''), true),
          set_config('localites.vendor_id', '', true);
end $$;

insert into app_user (id, display_name, given_name, family_name, email) values
  ('00000000-0000-7000-8000-0000000053a1', 'Pat Q.', 'Pat', 'Quill', 'pat-53@example.com'),
  ('00000000-0000-7000-8000-0000000053a2', 'Kim R.', 'Kim', 'Reed', 'kim-53@example.com');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000053b1', 'test-town-53', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000053c1', 'test-53-v', 'Vee Fifty Three', '00000000-0000-7000-8000-0000000053b1', 'admin_entered', 'published', 'claimed', now()),
  ('00000000-0000-7000-8000-0000000053c2', 'test-53-w', 'Hidden Fifty Three', '00000000-0000-7000-8000-0000000053b1', 'admin_entered', 'unpublished', 'unclaimed', null);

select pg_temp.expect_code('cost is $, $$ or $$$ only', $q$update vendor set cost_level = 4 where id = '00000000-0000-7000-8000-0000000053c1'$q$, '23514');
update vendor set cost_level = 2 where id = '00000000-0000-7000-8000-0000000053c1';
select pg_temp.expect('a business''s cost can be set, and starts empty',
  (select cost_level = 2 from vendor where id = '00000000-0000-7000-8000-0000000053c1')
  and (select cost_level is null from vendor where id = '00000000-0000-7000-8000-0000000053c2'));

set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000053a1');
insert into shortlist (user_id, vendor_id) values ('00000000-0000-7000-8000-0000000053a1', '00000000-0000-7000-8000-0000000053c1');
select pg_temp.expect('Pat adds a listed business to their shortlist', (select count(*) = 1 from shortlist));
select pg_temp.expect_code('…not one that isn''t listed',
  $q$insert into shortlist (user_id, vendor_id) values ('00000000-0000-7000-8000-0000000053a1', '00000000-0000-7000-8000-0000000053c2')$q$, 'LP107');
select pg_temp.expect_code('…never to someone else''s shortlist',
  $q$insert into shortlist (user_id, vendor_id) values ('00000000-0000-7000-8000-0000000053a2', '00000000-0000-7000-8000-0000000053c1')$q$, 'LP101');
select pg_temp.expect_code('the site can''t change when it was added',
  $q$update shortlist set created_at = now() - interval '1 year'$q$, '42501');
select pg_temp.expect('Download your data has the shortlist',
  (select my_data()->'shortlist'->0->>'business' = 'Vee Fifty Three'));
select pg_temp.expect_code('the old download can''t be called by the site', 'select my_data_0052()', '42501');

select pg_temp.act('person', '00000000-0000-7000-8000-0000000053a2');
select pg_temp.expect('Kim sees nobody else''s shortlist', (select count(*) = 0 from shortlist));
with d as (delete from shortlist returning 1) select pg_temp.expect('…and can''t remove Pat''s', (select count(*) = 0 from d));
select pg_temp.act('business', '00000000-0000-7000-8000-0000000053a1');
select pg_temp.expect('the business side sees no shortlists, even Pat''s own', (select count(*) = 0 from shortlist));
select pg_temp.act('team', '00000000-0000-7000-8000-0000000053a2');
select pg_temp.expect('…nor does the team side', (select count(*) = 0 from shortlist));
select pg_temp.act('', null);
select pg_temp.expect('…nor anyone not acting', (select count(*) = 0 from shortlist));
reset role;

-- At most 30: fill Pat's to 30 directly (rules off), then the 31st is refused.
set local session_replication_role = replica;
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at)
select ('00000000-0000-7000-8000-0000000531' || lpad(i::text, 2, '0'))::uuid, 'test-53-many-' || i, 'Many ' || i,
       '00000000-0000-7000-8000-0000000053b1', 'admin_entered', 'published', 'unclaimed', now()
from generate_series(1, 30) i;
insert into shortlist (user_id, vendor_id)
select '00000000-0000-7000-8000-0000000053a1', ('00000000-0000-7000-8000-0000000531' || lpad(i::text, 2, '0'))::uuid
from generate_series(1, 29) i;
set local session_replication_role = origin;
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000053a1');
select pg_temp.expect_code('a 31st business is refused',
  $q$insert into shortlist (user_id, vendor_id) values ('00000000-0000-7000-8000-000000053130', '00000000-0000-7000-8000-000000053130')$q$, 'LP101');
select pg_temp.expect_code('…in their own shortlist too, at 30',
  $q$insert into shortlist (user_id, vendor_id) values ('00000000-0000-7000-8000-0000000053a1', '00000000-0000-7000-8000-000000053130')$q$, 'LP140');
reset role;
-- A business taken down meanwhile doesn't keep its place: one of the 30 unlisted, a new one fits.
update vendor set listing_status = 'unpublished' where id = '00000000-0000-7000-8000-000000053101';
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000053a1');
insert into shortlist (user_id, vendor_id) values ('00000000-0000-7000-8000-0000000053a1', '00000000-0000-7000-8000-000000053130');
select pg_temp.expect('only listed businesses count towards the 30', (select count(*) = 31 from shortlist));
reset role;

update app_user set deleted_at = now() where id = '00000000-0000-7000-8000-0000000053a1';
select pg_temp.expect('a deleted account''s shortlist goes with it',
  (select count(*) = 0 from shortlist where user_id = '00000000-0000-7000-8000-0000000053a1'));

rollback;
