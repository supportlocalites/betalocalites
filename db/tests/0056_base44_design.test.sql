-- =============================================================================
-- Checks for migration 0056: the new kinds of business, the profile's details, reply times.
-- Rolled back.
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

-- The kinds ---------------------------------------------------------------------------------
select pg_temp.expect('six new main kinds, all showing',
  (select count(*) from category where parent_id is null and is_active) = 6);
select pg_temp.expect('42 new kinds within them',
  (select count(*) from category c join category p on p.id = c.parent_id
   where p.is_active and c.is_active) = 42);
select pg_temp.expect('the old kinds are hidden, not deleted',
  (select count(*) from category where slug::text in ('venue', 'sweets', 'face-painting', 'photographers') and not is_active) = 4);
select pg_temp.expect('Hair sits in Beauty & Personal Care',
  (select p.name from category c join category p on p.id = c.parent_id where c.slug = 'hair') = 'Beauty & Personal Care');

-- (Moving businesses that already had old kinds was checked on a copy holding the test and sample
-- businesses: every one got its new main kind, none was left without one; see G, 22 October 2026.)
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000056b1', 'test-town-56', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000056c1', 'test-56-v', 'Vee', '00000000-0000-7000-8000-0000000056b1', 'admin_entered', 'published', 'claimed', now()),
  ('00000000-0000-7000-8000-0000000056c2', 'test-56-w', 'Wee', '00000000-0000-7000-8000-0000000056b1', 'admin_entered', 'published', 'claimed', now());

-- The new columns ------------------------------------------------------------------------
update vendor set neighbourhood = 'West Ridge', tags = array['Seats 80', 'Nut free'], curator_note = 'Book the morning slot.'
where id = '00000000-0000-7000-8000-0000000056c1';
select pg_temp.expect('neighbourhood, tags and a note are kept',
  (select neighbourhood = 'West Ridge' and tags = array['Seats 80', 'Nut free'] and curator_note is not null
   from vendor where id = '00000000-0000-7000-8000-0000000056c1'));
select pg_temp.expect('no tags by default', (select tags = '{}' from vendor where id = '00000000-0000-7000-8000-0000000056c2'));
select pg_temp.expect_code('seven tags are too many',
  $q$update vendor set tags = array['a','b','c','d','e','f','g'] where id = '00000000-0000-7000-8000-0000000056c1'$q$, '23514');
select pg_temp.expect_code('a tag longer than 24 letters',
  $q$update vendor set tags = array['abcdefghijklmnopqrstuvwxyz'] where id = '00000000-0000-7000-8000-0000000056c1'$q$, '23514');
select pg_temp.expect_code('the same tag twice (any capitals)',
  $q$update vendor set tags = array['Nut free', 'nut free'] where id = '00000000-0000-7000-8000-0000000056c1'$q$, '23514');
select pg_temp.expect_code('an empty tag',
  $q$update vendor set tags = array[''] where id = '00000000-0000-7000-8000-0000000056c1'$q$, '23514');
select pg_temp.expect_code('a tag with spaces round it',
  $q$update vendor set tags = array[' Garden'] where id = '00000000-0000-7000-8000-0000000056c1'$q$, '23514');
select pg_temp.expect_code('a note over 280 letters',
  $q$update vendor set curator_note = repeat('a', 281) where id = '00000000-0000-7000-8000-0000000056c1'$q$, '23514');
select pg_temp.expect_code('an empty neighbourhood',
  $q$update vendor set neighbourhood = '' where id = '00000000-0000-7000-8000-0000000056c1'$q$, '23514');

-- Reply times -------------------------------------------------------------------------------
insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000056a1', 'A', 'a-56@example.com'),
  ('00000000-0000-7000-8000-0000000056a2', 'B', 'b-56@example.com'),
  ('00000000-0000-7000-8000-0000000056a3', 'C', 'c-56@example.com'),
  ('00000000-0000-7000-8000-0000000056a9', 'Owner', 'o-56@example.com');
insert into vendor_member (vendor_id, user_id, role) values
  ('00000000-0000-7000-8000-0000000056c1', '00000000-0000-7000-8000-0000000056a9', 'owner'),
  ('00000000-0000-7000-8000-0000000056c2', '00000000-0000-7000-8000-0000000056a9', 'owner');

-- Rules on the tables would stop setting times in the past: written as the database owner, rules off.
set local session_replication_role = replica;
-- V answered three people, after 60, 120 and 180 minutes; W answered two.
insert into conversation (id, consumer_user_id, vendor_id, created_at) values
  ('00000000-0000-7000-8000-0000000056d1', '00000000-0000-7000-8000-0000000056a1', '00000000-0000-7000-8000-0000000056c1', now() - interval '3 days'),
  ('00000000-0000-7000-8000-0000000056d2', '00000000-0000-7000-8000-0000000056a2', '00000000-0000-7000-8000-0000000056c1', now() - interval '3 days'),
  ('00000000-0000-7000-8000-0000000056d3', '00000000-0000-7000-8000-0000000056a3', '00000000-0000-7000-8000-0000000056c1', now() - interval '3 days'),
  ('00000000-0000-7000-8000-0000000056d4', '00000000-0000-7000-8000-0000000056a1', '00000000-0000-7000-8000-0000000056c2', now() - interval '3 days'),
  ('00000000-0000-7000-8000-0000000056d5', '00000000-0000-7000-8000-0000000056a2', '00000000-0000-7000-8000-0000000056c2', now() - interval '3 days');
insert into message (conversation_id, author_user_id, author_side, body, created_at) values
  ('00000000-0000-7000-8000-0000000056d1', '00000000-0000-7000-8000-0000000056a1', 'consumer', 'Hi', now() - interval '3 days'),
  ('00000000-0000-7000-8000-0000000056d1', '00000000-0000-7000-8000-0000000056a9', 'vendor', 'Hello', now() - interval '3 days' + interval '60 minutes'),
  ('00000000-0000-7000-8000-0000000056d2', '00000000-0000-7000-8000-0000000056a2', 'consumer', 'Hi', now() - interval '3 days'),
  ('00000000-0000-7000-8000-0000000056d2', '00000000-0000-7000-8000-0000000056a9', 'vendor', 'Hello', now() - interval '3 days' + interval '120 minutes'),
  ('00000000-0000-7000-8000-0000000056d3', '00000000-0000-7000-8000-0000000056a3', 'consumer', 'Hi', now() - interval '3 days'),
  ('00000000-0000-7000-8000-0000000056d3', '00000000-0000-7000-8000-0000000056a9', 'vendor', 'Hello', now() - interval '3 days' + interval '180 minutes'),
  ('00000000-0000-7000-8000-0000000056d4', '00000000-0000-7000-8000-0000000056a1', 'consumer', 'Hi', now() - interval '3 days'),
  ('00000000-0000-7000-8000-0000000056d4', '00000000-0000-7000-8000-0000000056a9', 'vendor', 'Hello', now() - interval '3 days' + interval '5 minutes'),
  ('00000000-0000-7000-8000-0000000056d5', '00000000-0000-7000-8000-0000000056a2', 'consumer', 'Hi', now() - interval '3 days'),
  ('00000000-0000-7000-8000-0000000056d5', '00000000-0000-7000-8000-0000000056a9', 'vendor', 'Hello', now() - interval '3 days' + interval '5 minutes');
set local session_replication_role = origin;

set local role app_server;
select pg_temp.expect('the server reads V''s usual reply time: the middle one, 120 minutes',
  (select reply_minutes from published_reply_times() where vendor_id = '00000000-0000-7000-8000-0000000056c1') = 120);
select pg_temp.expect('W answered only two people: no reply time yet',
  not exists (select 1 from published_reply_times() where vendor_id = '00000000-0000-7000-8000-0000000056c2'));
reset role;

update vendor set listing_status = 'unpublished' where id = '00000000-0000-7000-8000-0000000056c1';
select pg_temp.expect('a business that isn''t listed has no reply time shown',
  not exists (select 1 from published_reply_times() where vendor_id = '00000000-0000-7000-8000-0000000056c1'));

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end $$;
set local role anon;
do $$ begin
  begin
    perform published_reply_times();
    raise exception 'FAIL  the browser-facing role read reply times';
  exception when insufficient_privilege then
    raise notice 'PASS  the browser-facing role can''t read them  (42501)';
  end;
end $$;
reset role;

rollback;
