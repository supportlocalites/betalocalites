-- =============================================================================
-- Checks for migration 0062: the same business suggested by more than one person. Rolled back.
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

-- Pat (a1) asks; Kim (a2) and Mia (a4) both suggest the same business c1; Owen (a3) runs it.
insert into app_user (id, display_name, given_name, family_name, email) values
  ('00000000-0000-7000-8000-0000000062a1', 'Pat Q.', 'Pat', 'Quill', 'pat-62@example.com'),
  ('00000000-0000-7000-8000-0000000062a2', 'Kim R.', 'Kim', 'Reed', 'kim-62@example.com'),
  ('00000000-0000-7000-8000-0000000062a3', 'Owen S.', 'Owen', 'Stone', 'owen-62@example.com'),
  ('00000000-0000-7000-8000-0000000062a4', 'Mia T.', 'Mia', 'Tran', 'mia-62@example.com');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000062b1', 'test-town-62', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000062c1', 'test-62-v', 'Vee Sixty Two', '00000000-0000-7000-8000-0000000062b1', 'admin_entered', 'published', 'claimed', now());
insert into vendor_member (vendor_id, user_id, role) values
  ('00000000-0000-7000-8000-0000000062c1', '00000000-0000-7000-8000-0000000062a3', 'owner');

set local role app_server;

select pg_temp.act('person', '00000000-0000-7000-8000-0000000062a1');
insert into community_question (id, author_user_id, title)
values ('00000000-0000-7000-8000-0000000062d1', '00000000-0000-7000-8000-0000000062a1', 'Who makes the best unicorn cakes?');

select pg_temp.act('person', '00000000-0000-7000-8000-0000000062a2');
insert into community_answer (question_id, author_user_id, body, vendor_id)
values ('00000000-0000-7000-8000-0000000062d1', '00000000-0000-7000-8000-0000000062a2', 'Lovely cakes, right on time.', '00000000-0000-7000-8000-0000000062c1');
insert into community_answer (question_id, author_user_id, body, business_name)
values ('00000000-0000-7000-8000-0000000062d1', '00000000-0000-7000-8000-0000000062a2', 'Not on Localites, but great.', 'Maple Crumbs');
select pg_temp.expect_code('Kim can''t suggest the same business twice on one question',
  $q$insert into community_answer (question_id, author_user_id, body, vendor_id) values ('00000000-0000-7000-8000-0000000062d1', '00000000-0000-7000-8000-0000000062a2', 'Again, these folks!', '00000000-0000-7000-8000-0000000062c1')$q$, '23505');
select pg_temp.expect_code('…nor the same typed name twice',
  $q$insert into community_answer (question_id, author_user_id, body, business_name) values ('00000000-0000-7000-8000-0000000062d1', '00000000-0000-7000-8000-0000000062a2', 'Maple again, so good', 'maple crumbs')$q$, '23505');

select pg_temp.act('person', '00000000-0000-7000-8000-0000000062a4');
insert into community_answer (question_id, author_user_id, body, vendor_id)
values ('00000000-0000-7000-8000-0000000062d1', '00000000-0000-7000-8000-0000000062a4', 'Best buttercream in town.', '00000000-0000-7000-8000-0000000062c1');
insert into community_answer (question_id, author_user_id, body, business_name)
values ('00000000-0000-7000-8000-0000000062d1', '00000000-0000-7000-8000-0000000062a4', 'Their crumble bars too.', 'Maple Crumbs');
select pg_temp.expect('Mia suggests the same business, and the same typed name: each its own answer',
  (select count(*) = 2 from community_answer where question_id = '00000000-0000-7000-8000-0000000062d1' and vendor_id = '00000000-0000-7000-8000-0000000062c1')
  and (select count(*) = 2 from community_answer where question_id = '00000000-0000-7000-8000-0000000062d1' and lower(business_name) = 'maple crumbs'));

select pg_temp.act('person', '00000000-0000-7000-8000-0000000062a3');
select pg_temp.expect_code('the business''s owner still can''t suggest it, however many others have',
  $q$insert into community_answer (question_id, author_user_id, body, vendor_id) values ('00000000-0000-7000-8000-0000000062d1', '00000000-0000-7000-8000-0000000062a3', 'We are great, truly!', '00000000-0000-7000-8000-0000000062c1')$q$, 'LP100');

-- Kim takes hers down; she may suggest it again (only shown answers count).
select pg_temp.act('person', '00000000-0000-7000-8000-0000000062a2');
update community_answer set status = 'removed', removed_by = 'author', removed_at = now()
where question_id = '00000000-0000-7000-8000-0000000062d1' and author_user_id = '00000000-0000-7000-8000-0000000062a2' and vendor_id is not null;
insert into community_answer (question_id, author_user_id, body, vendor_id)
values ('00000000-0000-7000-8000-0000000062d1', '00000000-0000-7000-8000-0000000062a2', 'Trying again with better words.', '00000000-0000-7000-8000-0000000062c1');
select pg_temp.expect('after taking hers down, Kim can suggest it again',
  (select count(*) = 1 from community_answer where question_id = '00000000-0000-7000-8000-0000000062d1'
     and author_user_id = '00000000-0000-7000-8000-0000000062a2' and vendor_id is not null and status = 'shown'));

rollback;
