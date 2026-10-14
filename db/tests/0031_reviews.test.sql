-- =============================================================================
-- Checks for migration 0031: reviews (Stage 3, part 1). One transaction, rolled back.
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

create function pg_temp.act(p_side text, p_user uuid, p_vendor uuid default null) returns void
language plpgsql as $$
begin
  perform set_config('localites.side', coalesce(p_side, ''), true),
          set_config('localites.user_id', coalesce(p_user::text, ''), true),
          set_config('localites.vendor_id', coalesce(p_vendor::text, ''), true);
end $$;

-- A (Sarah Mitchell) and B; business V (owner O, staff S); W (owner P); M on the team.
insert into app_user (id, display_name, given_name, family_name, email) values
  ('00000000-0000-7000-8000-0000000031a1', 'Sarah Mitchell', 'Sarah', 'Mitchell', 'a-31@example.com'),
  ('00000000-0000-7000-8000-0000000031a2', 'Ben', null, null, 'b-31@example.com'),
  ('00000000-0000-7000-8000-0000000031a3', 'Owner O', 'Olive', 'Owner', 'o-31@example.com'),
  ('00000000-0000-7000-8000-0000000031a5', 'Staff S', 'Sam', 'Staff', 's-31@example.com'),
  ('00000000-0000-7000-8000-0000000031a6', 'Owner P', 'Pat', 'Owner', 'p-31@example.com'),
  ('00000000-0000-7000-8000-0000000031a7', 'Team M', 'Mo', 'Team', 'm-31@example.com');
insert into platform_role (user_id, role) values ('00000000-0000-7000-8000-0000000031a7', 'admin');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000031b1', 'test-town-31', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000031c1', 'test-31-v', 'Thirty-one V', '00000000-0000-7000-8000-0000000031b1', 'admin_entered', 'published', 'claimed', now()),
  ('00000000-0000-7000-8000-0000000031c2', 'test-31-w', 'Thirty-one W', '00000000-0000-7000-8000-0000000031b1', 'admin_entered', 'published', 'claimed', now());
insert into vendor_member (vendor_id, user_id, role) values
  ('00000000-0000-7000-8000-0000000031c1', '00000000-0000-7000-8000-0000000031a3', 'owner'),
  ('00000000-0000-7000-8000-0000000031c1', '00000000-0000-7000-8000-0000000031a5', 'staff'),
  ('00000000-0000-7000-8000-0000000031c2', '00000000-0000-7000-8000-0000000031a6', 'owner');
-- A's party 5 days ago (V booked, W only considered); A's party next month (V booked); B's
-- party 90 days ago (V booked); B's party 3 days ago (W booked, then W flagged it).
insert into event (id, host_user_id, event_date, municipality_id) values
  ('00000000-0000-7000-8000-0000000031f1', '00000000-0000-7000-8000-0000000031a1', current_date - 5, '00000000-0000-7000-8000-0000000031b1'),
  ('00000000-0000-7000-8000-0000000031f2', '00000000-0000-7000-8000-0000000031a1', current_date + 30, '00000000-0000-7000-8000-0000000031b1'),
  ('00000000-0000-7000-8000-0000000031f3', '00000000-0000-7000-8000-0000000031a2', current_date - 90, '00000000-0000-7000-8000-0000000031b1'),
  ('00000000-0000-7000-8000-0000000031f4', '00000000-0000-7000-8000-0000000031a2', current_date - 3, '00000000-0000-7000-8000-0000000031b1');
insert into event_vendor (id, event_id, host_user_id, vendor_id, status, booked_at) values
  ('00000000-0000-7000-8000-0000000031e1', '00000000-0000-7000-8000-0000000031f1', '00000000-0000-7000-8000-0000000031a1', '00000000-0000-7000-8000-0000000031c1', 'booked', now() - interval '20 days'),
  ('00000000-0000-7000-8000-0000000031e2', '00000000-0000-7000-8000-0000000031f1', '00000000-0000-7000-8000-0000000031a1', '00000000-0000-7000-8000-0000000031c2', 'considering', null),
  ('00000000-0000-7000-8000-0000000031e3', '00000000-0000-7000-8000-0000000031f2', '00000000-0000-7000-8000-0000000031a1', '00000000-0000-7000-8000-0000000031c1', 'booked', now() - interval '1 day'),
  ('00000000-0000-7000-8000-0000000031e4', '00000000-0000-7000-8000-0000000031f3', '00000000-0000-7000-8000-0000000031a2', '00000000-0000-7000-8000-0000000031c1', 'booked', now() - interval '100 days'),
  ('00000000-0000-7000-8000-0000000031e5', '00000000-0000-7000-8000-0000000031f4', '00000000-0000-7000-8000-0000000031a2', '00000000-0000-7000-8000-0000000031c2', 'booked', now() - interval '10 days');
update event_vendor set vendor_flagged_at = now() - interval '1 day', vendor_flagged_by = '00000000-0000-7000-8000-0000000031a6'
where id = '00000000-0000-7000-8000-0000000031e5';

set local role app_server;

-- ---------------------------------------------------------------- who may review
select pg_temp.act('person', '00000000-0000-7000-8000-0000000031a1');
insert into review (id, event_vendor_id, author_user_id, rating, body) values
  ('00000000-0000-7000-8000-000000003191', '00000000-0000-7000-8000-0000000031e1', '00000000-0000-7000-8000-0000000031a1', 5, 'Wonderful cakes, on time.');
select pg_temp.expect_equal('the host reviews a business they booked, after the event: it waits for the team', (
  select status || ' ' || vendor_id::text || ' ' || event_date::text from review),
  'pending 00000000-0000-7000-8000-0000000031c1 ' || (current_date - 5)::text);
select pg_temp.expect_code('one review per booking', $q$
  insert into review (event_vendor_id, author_user_id, rating, body) values
  ('00000000-0000-7000-8000-0000000031e1', '00000000-0000-7000-8000-0000000031a1', 4, 'Again')$q$, '23505');
select pg_temp.expect_code('not a business only considered', $q$
  insert into review (event_vendor_id, author_user_id, rating, body) values
  ('00000000-0000-7000-8000-0000000031e2', '00000000-0000-7000-8000-0000000031a1', 4, 'Hmm')$q$, 'LP150');
select pg_temp.expect_code('not before the event has happened', $q$
  insert into review (event_vendor_id, author_user_id, rating, body) values
  ('00000000-0000-7000-8000-0000000031e3', '00000000-0000-7000-8000-0000000031a1', 4, 'Early')$q$, 'LP151');
select pg_temp.expect_code('not someone else''s booking', $q$
  insert into review (event_vendor_id, author_user_id, rating, body) values
  ('00000000-0000-7000-8000-0000000031e4', '00000000-0000-7000-8000-0000000031a1', 1, 'Not mine')$q$, 'LP101');
select pg_temp.expect_code('not in someone else''s name', $q$
  insert into review (event_vendor_id, author_user_id, rating, body) values
  ('00000000-0000-7000-8000-0000000031e1', '00000000-0000-7000-8000-0000000031a2', 1, 'Pretend')$q$, 'LP101');
select pg_temp.expect_code('a rating from 1 to 5', $q$
  update review set rating = 6 where id = '00000000-0000-7000-8000-000000003191'$q$, '23514');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000031a2');
select pg_temp.expect_code('not after 60 days', $q$
  insert into review (event_vendor_id, author_user_id, rating, body) values
  ('00000000-0000-7000-8000-0000000031e4', '00000000-0000-7000-8000-0000000031a2', 3, 'Late')$q$, 'LP152');
select pg_temp.expect_code('not a booking the business says isn''t real', $q$
  insert into review (event_vendor_id, author_user_id, rating, body) values
  ('00000000-0000-7000-8000-0000000031e5', '00000000-0000-7000-8000-0000000031a2', 1, 'Flagged')$q$, 'LP153');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000031a3', '00000000-0000-7000-8000-0000000031c1');
select pg_temp.expect_code('a business can''t write a review', $q$
  insert into review (event_vendor_id, author_user_id, rating, body) values
  ('00000000-0000-7000-8000-0000000031e1', '00000000-0000-7000-8000-0000000031a3', 5, 'Self')$q$, 'LP101');

-- ---------------------------------------------------------------- while it waits
select pg_temp.expect_equal('the business doesn''t see a waiting review', (select count(*)::text from review), '0');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000031a2');
select pg_temp.expect_equal('another person doesn''t either', (select count(*)::text from review), '0');
select pg_temp.expect_equal('…nor the public', (
  select count(*)::text from published_reviews('00000000-0000-7000-8000-0000000031c1')), '0');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000031a1');
update review set rating = 4, body = 'Lovely cakes, on time.' where id = '00000000-0000-7000-8000-000000003191';
select pg_temp.expect_equal('the author changes it while it waits', (select rating::text || ' ' || body from review), '4 Lovely cakes, on time.');
select pg_temp.expect_code('…but can''t publish it', $q$
  update review set status = 'published' where id = '00000000-0000-7000-8000-000000003191'$q$, 'LP100');

-- ---------------------------------------------------------------- the team decides
select pg_temp.act('team', '00000000-0000-7000-8000-0000000031a7');
select pg_temp.expect_code('the team never changes the words', $q$
  update review set body = 'Edited' where id = '00000000-0000-7000-8000-000000003191'$q$, 'LP100');
select pg_temp.expect_code('declining needs a reason', $q$
  update review set status = 'declined' where id = '00000000-0000-7000-8000-000000003191'$q$, 'LP157');
update review set status = 'published' where id = '00000000-0000-7000-8000-000000003191';
select pg_temp.expect_equal('the team publishes it; the database records who and when', (
  select status || ' ' || (decided_by = '00000000-0000-7000-8000-0000000031a7')::text || ' ' || (published_at is not null)::text from review),
  'published true true');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000031a1');
select pg_temp.expect_code('once checked, the author can''t change it', $q$
  update review set body = 'Changed my mind' where id = '00000000-0000-7000-8000-000000003191'$q$, 'LP155');

-- ---------------------------------------------------------------- the public and the business
select pg_temp.act(null, null);
select pg_temp.expect_equal('the public sees it with the author as "Sarah M.", the month, and how it was planned', (
  select author || ' | ' || rating::text || ' | ' || event_month::text || ' | ' || planned_on_localites::text || ' | ' || living_local::text
  from published_reviews('00000000-0000-7000-8000-0000000031c1')),
  'Sarah M. | 4 | ' || date_trunc('month', current_date - 5)::date::text || ' | false | false');
select pg_temp.expect_equal('…no average until 3 reviews', (
  select review_count::text || ' ' || coalesce(average::text, 'none') from vendor_rating('00000000-0000-7000-8000-0000000031c1')), '1 none');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000031a5', '00000000-0000-7000-8000-0000000031c1');
select pg_temp.expect_equal('anyone on the business''s team reads its published reviews', (select count(*)::text from review), '1');
update review set vendor_reply = 'Thank you!' where id = '00000000-0000-7000-8000-000000003191';
select pg_temp.expect_equal('staff can''t reply', (select coalesce(vendor_reply, 'none') from review), 'none');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000031a6', '00000000-0000-7000-8000-0000000031c2');
select pg_temp.expect_equal('another business sees nothing', (select count(*)::text from review), '0');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000031a3', '00000000-0000-7000-8000-0000000031c1');
update review set vendor_reply = 'Thank you, Sarah!' where id = '00000000-0000-7000-8000-000000003191';
select pg_temp.expect_equal('the owner replies, recorded with who and when', (
  select vendor_reply || ' ' || (vendor_replied_by = '00000000-0000-7000-8000-0000000031a3')::text from review), 'Thank you, Sarah! true');
select pg_temp.expect_code('once', $q$
  update review set vendor_reply = 'Again' where id = '00000000-0000-7000-8000-000000003191'$q$, 'LP156');
select pg_temp.expect_code('the business can''t touch the rating', $q$
  update review set rating = 5 where id = '00000000-0000-7000-8000-000000003191'$q$, 'LP100');
select pg_temp.act(null, null);
select pg_temp.expect_equal('the public sees the reply', (
  select reply from published_reviews('00000000-0000-7000-8000-0000000031c1')), 'Thank you, Sarah!');

-- ---------------------------------------------------------------- the team removes
select pg_temp.act('team', '00000000-0000-7000-8000-0000000031a7');
select pg_temp.expect_code('removing a reply needs a reason', $q$
  update review set reply_removed_at = now() where id = '00000000-0000-7000-8000-000000003191'$q$, 'LP157');
update review set reply_removed_at = now(), reply_removed_reason = 'Personal details' where id = '00000000-0000-7000-8000-000000003191';
select pg_temp.act(null, null);
select pg_temp.expect_equal('a removed reply isn''t shown', (
  select coalesce(reply, 'none') from published_reviews('00000000-0000-7000-8000-0000000031c1')), 'none');

-- ---------------------------------------------------------------- the average from 3
reset role;
insert into review (vendor_id, author_user_id, event_date, rating, body, status, decided_at, decided_by, published_at) values
  ('00000000-0000-7000-8000-0000000031c1', '00000000-0000-7000-8000-0000000031a2', current_date - 10, 5, 'Great', 'published', now(), '00000000-0000-7000-8000-0000000031a7', now()),
  ('00000000-0000-7000-8000-0000000031c1', '00000000-0000-7000-8000-0000000031a6', current_date - 12, 3, 'Fine', 'published', now(), '00000000-0000-7000-8000-0000000031a7', now());
set local role app_server;
select pg_temp.act(null, null);
select pg_temp.expect_equal('from 3 published reviews, the average shows', (
  select review_count::text || ' ' || average::text from vendor_rating('00000000-0000-7000-8000-0000000031c1')), '3 4.0');
select pg_temp.expect_equal('a reviewer without a last name: just the first name', (
  select string_agg(author, ',' order by author) from published_reviews('00000000-0000-7000-8000-0000000031c1')), 'Ben,Pat O.,Sarah M.');
select pg_temp.expect_equal('Living Local: nobody yet (fewer than 100 reviewers)', (
  select count(*)::text from published_reviews('00000000-0000-7000-8000-0000000031c1') where living_local), '0');

-- ---------------------------------------------------------------- a person deletes their account
select pg_temp.act('person', '00000000-0000-7000-8000-0000000031a1');
select delete_my_account();
reset role;
select pg_temp.expect_equal('their published review stays, from "A Localites member", its booking gone', (
  select author || ' ' || coalesce((select event_vendor_id::text from review where id = '00000000-0000-7000-8000-000000003191'), 'none')
  from published_reviews('00000000-0000-7000-8000-0000000031c1') where id = '00000000-0000-7000-8000-000000003191'),
  'A Localites member none');

-- ---------------------------------------------------------------- nobody else
set local role app_server;
select pg_temp.act(null, null);
select pg_temp.expect_equal('nobody acting reads the table', (select count(*)::text from review), '0');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000031a7');
select pg_temp.expect_code('the site can''t set how it was planned', $q$
  update review set planned_on_localites = true$q$, '42501');

rollback;
