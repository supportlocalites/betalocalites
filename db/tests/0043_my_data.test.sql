-- =============================================================================
-- Checks for migration 0043: Download my data. Rolled back.
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

-- Pat (the person), Kim (someone else), Ann (owns V).
insert into app_user (id, display_name, given_name, family_name, email) values
  ('00000000-0000-7000-8000-0000000043a1', 'Pat Q.', 'Pat', 'Quill', 'pat-43@example.com'),
  ('00000000-0000-7000-8000-0000000043a2', 'Kim R.', 'Kim', 'Reed', 'kim-43@example.com'),
  ('00000000-0000-7000-8000-0000000043a9', 'Ann O.', 'Ann', 'Owner', 'ann-43@example.com');
insert into person_profile (user_id, town, province) values ('00000000-0000-7000-8000-0000000043a1', 'Orillia', 'ON');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000043b1', 'test-town-43', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000043c1', 'test-43-v', 'Vee Cakes', '00000000-0000-7000-8000-0000000043b1', 'admin_entered', 'published', 'claimed', now());
insert into vendor_member (vendor_id, user_id, role) values
  ('00000000-0000-7000-8000-0000000043c1', '00000000-0000-7000-8000-0000000043a9', 'owner');

-- Written as the database owner, rules off (the plan's own rules are checked elsewhere).
set local session_replication_role = replica;
insert into event (id, host_user_id, event_date, start_time, municipality_id) values
  ('00000000-0000-7000-8000-0000000043d1', '00000000-0000-7000-8000-0000000043a1', current_date - 10, '14:00', '00000000-0000-7000-8000-0000000043b1'),
  ('00000000-0000-7000-8000-0000000043d2', '00000000-0000-7000-8000-0000000043a2', current_date + 10, '14:00', '00000000-0000-7000-8000-0000000043b1');
insert into event_private (event_id, host_user_id, title, notes, budget_cents) values
  ('00000000-0000-7000-8000-0000000043d1', '00000000-0000-7000-8000-0000000043a1', 'Pat party', 'Pat notes', 50000),
  ('00000000-0000-7000-8000-0000000043d2', '00000000-0000-7000-8000-0000000043a2', 'Kim secret', 'Kim notes', null);
insert into event_vendor (id, event_id, host_user_id, vendor_id, status, booked_at, vendor_flagged_at, vendor_flagged_by) values
  ('00000000-0000-7000-8000-0000000043e1', '00000000-0000-7000-8000-0000000043d1', '00000000-0000-7000-8000-0000000043a1', '00000000-0000-7000-8000-0000000043c1', 'booked', now(), now(), '00000000-0000-7000-8000-0000000043a9');
insert into event_vendor_flag_note (event_vendor_id, note) values ('00000000-0000-7000-8000-0000000043e1', 'Business private note');
insert into guest (id, event_id, host_user_id, name, email, token_hash) values
  ('00000000-0000-7000-8000-000000004371', '00000000-0000-7000-8000-0000000043d1', '00000000-0000-7000-8000-0000000043a1', 'Grandma Jo', 'jo@example.com', sha256('43'::bytea));
insert into conversation (id, consumer_user_id, vendor_id, last_message_at) values
  ('00000000-0000-7000-8000-0000000043f1', '00000000-0000-7000-8000-0000000043a1', '00000000-0000-7000-8000-0000000043c1', now());
insert into message (id, conversation_id, author_user_id, author_side, body, hidden_by_team_at) values
  ('00000000-0000-7000-8000-000000004381', '00000000-0000-7000-8000-0000000043f1', '00000000-0000-7000-8000-0000000043a1', 'consumer', 'Pat asks', null),
  ('00000000-0000-7000-8000-000000004382', '00000000-0000-7000-8000-0000000043f1', '00000000-0000-7000-8000-0000000043a9', 'vendor', 'Vee answers', null),
  ('00000000-0000-7000-8000-000000004383', '00000000-0000-7000-8000-0000000043f1', '00000000-0000-7000-8000-0000000043a9', 'vendor', 'Hidden by team', now());
insert into review (id, event_vendor_id, vendor_id, author_user_id, event_date, rating, body, status, decided_at, decided_by, decision_reason) values
  ('00000000-0000-7000-8000-000000004391', '00000000-0000-7000-8000-0000000043e1', '00000000-0000-7000-8000-0000000043c1', '00000000-0000-7000-8000-0000000043a1', current_date - 10, 2, 'Denied words', 'declined', now(), '00000000-0000-7000-8000-0000000043a9', 'Denied by the team');
-- A family computer (browser S) both Pat and Kim signed in on, and Pat's phone (browser P).
insert into visitor_account (visitor_id, user_id) values
  ('00000000-0000-7000-8000-000000004351', '00000000-0000-7000-8000-0000000043a1'),
  ('00000000-0000-7000-8000-000000004351', '00000000-0000-7000-8000-0000000043a2'),
  ('00000000-0000-7000-8000-000000004361', '00000000-0000-7000-8000-0000000043a1');
insert into activity_event (kind, vendor_id, user_id, visitor_id, device, visitor_town) values
  ('profile_view', '00000000-0000-7000-8000-0000000043c1', '00000000-0000-7000-8000-0000000043a1', '00000000-0000-7000-8000-000000004351', 'computer', 'PatSignedIn'),
  ('profile_view', '00000000-0000-7000-8000-0000000043c1', '00000000-0000-7000-8000-0000000043a2', '00000000-0000-7000-8000-000000004351', 'computer', 'KimSignedIn'),
  ('profile_view', '00000000-0000-7000-8000-0000000043c1', null, '00000000-0000-7000-8000-000000004351', 'computer', 'SharedSignedOut'),
  ('profile_view', '00000000-0000-7000-8000-0000000043c1', null, '00000000-0000-7000-8000-000000004361', 'phone', 'PatPhoneSignedOut');
insert into search_record (id, visitor_id, placement, words, words_norm, result_count) values
  (gen_random_uuid(), '00000000-0000-7000-8000-000000004351', 'search', 'family computer words', 'family computer words', 1),
  (gen_random_uuid(), '00000000-0000-7000-8000-000000004361', 'search', 'pat phone words', 'pat phone words', 1);
set local session_replication_role = origin;

set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000043a1');
create temp table got as select my_data()::text as d;
select pg_temp.expect('Pat gets their account, details, event (with private notes and budget), guest, booking and messages',
  (select d like '%pat-43@example.com%' and d like '%Orillia%' and d like '%Pat party%' and d like '%Pat notes%' and d like '%500.00%'
          and d like '%Grandma Jo%' and d like '%Vee Cakes%' and d like '%Pat asks%' and d like '%Vee answers%' from got));
select pg_temp.expect('…never someone else''s event or account',
  (select d not like '%Kim secret%' and d not like '%kim-43@example.com%' from got));
select pg_temp.expect('…nor the business''s private note, a message the team hid, or a denied review (D-51)',
  (select d not like '%Business private note%' and d not like '%Hidden by team%' and d not like '%Denied words%' from got));

select pg_temp.expect('activity: what Pat did signed in, and signed out on a browser only Pat uses',
  (select d like '%PatSignedIn%' and d like '%PatPhoneSignedOut%' and d like '%pat phone words%' from got));
select pg_temp.expect('…never Kim''s activity on the shared computer, nor anything signed out or searched there',
  (select d not like '%KimSignedIn%' and d not like '%SharedSignedOut%' and d not like '%family computer words%' from got));

select pg_temp.act('business', '00000000-0000-7000-8000-0000000043a1');
select pg_temp.expect_code('only as the person (not the business side)', 'select my_data()', 'LP101');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000043a9');
select pg_temp.expect_code('…not the team side', 'select my_data()', 'LP101');
select pg_temp.act('', null);
select pg_temp.expect_code('…not without anyone acting', 'select my_data()', 'LP101');
reset role;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end $$;
set local role anon;
select pg_temp.expect_code('the browser-facing role can''t run it', 'select my_data()', '42501');
reset role;

rollback;
