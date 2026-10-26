-- =============================================================================
-- Checks for migration 0061: Community (D-62). Rolled back.
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

-- Pat (a1) asks; Kim (a2) answers; Owen (a3) owns the business c1; Mia (a4) votes; Ted (a5) is on the team.
insert into app_user (id, display_name, given_name, family_name, email) values
  ('00000000-0000-7000-8000-0000000061a1', 'Pat Q.', 'Pat', 'Quill', 'pat-61@example.com'),
  ('00000000-0000-7000-8000-0000000061a2', 'Kim R.', 'Kim', 'Reed', 'kim-61@example.com'),
  ('00000000-0000-7000-8000-0000000061a3', 'Owen S.', 'Owen', 'Stone', 'owen-61@example.com'),
  ('00000000-0000-7000-8000-0000000061a4', 'Mia T.', 'Mia', 'Tran', 'mia-61@example.com'),
  ('00000000-0000-7000-8000-0000000061a5', 'Ted U.', 'Ted', 'Ung', 'ted-61@example.com');
insert into platform_role (user_id, role) values ('00000000-0000-7000-8000-0000000061a5', 'admin');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000061b1', 'test-town-61', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at, archived_at) values
  ('00000000-0000-7000-8000-0000000061c1', 'test-61-v', 'Vee Sixty One', '00000000-0000-7000-8000-0000000061b1', 'admin_entered', 'published', 'claimed', now(), null),
  ('00000000-0000-7000-8000-0000000061c2', 'test-61-w', 'Wes Sixty One', '00000000-0000-7000-8000-0000000061b1', 'admin_entered', 'archived', 'claimed', null, now());
insert into vendor_member (vendor_id, user_id, role) values
  ('00000000-0000-7000-8000-0000000061c1', '00000000-0000-7000-8000-0000000061a3', 'owner');

set local role app_server;

-- ------------------------------------------------------------------ Asking
select pg_temp.act('person', '00000000-0000-7000-8000-0000000061a1');
insert into community_question (id, author_user_id, title, detail)
values ('00000000-0000-7000-8000-0000000061d1', '00000000-0000-7000-8000-0000000061a1', 'Who makes the best dinosaur cakes?', 'For a 5th birthday');
select pg_temp.expect('a person asks a question, shown at once', (select status = 'shown' from community_question where id = '00000000-0000-7000-8000-0000000061d1'));
select pg_temp.expect_code('nobody asks as someone else',
  $q$insert into community_question (author_user_id, title) values ('00000000-0000-7000-8000-0000000061a2', 'Pretending to be Kim here')$q$, 'LP101');
select pg_temp.expect_code('a new question can''t start taken down',
  $q$insert into community_question (author_user_id, title, status, removed_by, removed_at) values ('00000000-0000-7000-8000-0000000061a1', 'Already gone question', 'removed', 'team', now())$q$, '42501');
select pg_temp.expect_code('a question is at least 10 letters',
  $q$insert into community_question (author_user_id, title) values ('00000000-0000-7000-8000-0000000061a1', 'Cakes?')$q$, '23514');
-- One the language check held: only Pat and the team see it.
insert into community_question (id, author_user_id, title, status, language_flag)
values ('00000000-0000-7000-8000-0000000061d2', '00000000-0000-7000-8000-0000000061a1', 'A question the check held back', 'held', 'Word list: x');
select pg_temp.expect('its author sees their held question', (select count(*) = 1 from community_question where id = '00000000-0000-7000-8000-0000000061d2'));
select pg_temp.act('person', '00000000-0000-7000-8000-0000000061a2');
select pg_temp.expect('someone else doesn''t', (select count(*) = 0 from community_question where id = '00000000-0000-7000-8000-0000000061d2'));
select pg_temp.act(null, null);
select pg_temp.expect('…nor does someone signed out, who sees the shown one', (select count(*) = 1 from community_question where id = '00000000-0000-7000-8000-0000000061d1')
  and (select count(*) = 0 from community_question where id = '00000000-0000-7000-8000-0000000061d2'));
select pg_temp.expect_code('signed out, nobody can ask',
  $q$insert into community_question (author_user_id, title) values (null, 'Anonymous question here')$q$, 'LP101');

-- ------------------------------------------------------------------ Answering
select pg_temp.act('person', '00000000-0000-7000-8000-0000000061a2');
insert into community_answer (id, question_id, author_user_id, body, vendor_id)
values ('00000000-0000-7000-8000-0000000061e1', '00000000-0000-7000-8000-0000000061d1', '00000000-0000-7000-8000-0000000061a2',
        'They made our son a T. rex and it was perfect.', '00000000-0000-7000-8000-0000000061c1');
select pg_temp.expect('Kim suggests a business on Localites, with why', (select up_votes = 0 from community_answer where id = '00000000-0000-7000-8000-0000000061e1'));
select pg_temp.expect_code('the same business twice on one question is a vote instead',
  $q$insert into community_answer (question_id, author_user_id, body, vendor_id) values ('00000000-0000-7000-8000-0000000061d1', '00000000-0000-7000-8000-0000000061a2', 'Another vote for these folks', '00000000-0000-7000-8000-0000000061c1')$q$, '23505');
select pg_temp.expect_code('a business not listed can''t be suggested by its page',
  $q$insert into community_answer (question_id, author_user_id, body, vendor_id) values ('00000000-0000-7000-8000-0000000061d1', '00000000-0000-7000-8000-0000000061a2', 'An archived one, though', '00000000-0000-7000-8000-0000000061c2')$q$, 'LP100');
select pg_temp.expect_code('a business on Localites and a typed name, not both',
  $q$insert into community_answer (question_id, author_user_id, body, vendor_id, business_name) values ('00000000-0000-7000-8000-0000000061d1', '00000000-0000-7000-8000-0000000061a2', 'Both of these at once', '00000000-0000-7000-8000-0000000061c1', 'Other Cakes')$q$, '23514');
insert into community_answer (id, question_id, author_user_id, body, business_name)
values ('00000000-0000-7000-8000-0000000061e2', '00000000-0000-7000-8000-0000000061d1', '00000000-0000-7000-8000-0000000061a2',
        'Not on Localites yet, but lovely work.', 'Maple Crumbs');
select pg_temp.expect('…or types the name of one not on Localites', (select business_name = 'Maple Crumbs' from community_answer where id = '00000000-0000-7000-8000-0000000061e2'));
select pg_temp.expect_code('nobody answers a held question',
  $q$insert into community_answer (question_id, author_user_id, body) values ('00000000-0000-7000-8000-0000000061d2', '00000000-0000-7000-8000-0000000061a2', 'Answering the held one')$q$, 'LP101');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000061a3');
update community_answer set status = 'removed', removed_by = 'author', removed_at = now()
where id = '00000000-0000-7000-8000-0000000061e1';
select pg_temp.expect('Owen can''t take down Kim''s answer (nothing changes)',
  (select status = 'shown' from community_answer where id = '00000000-0000-7000-8000-0000000061e1'));

-- ------------------------------------------------------------------ Voting
select pg_temp.act('person', '00000000-0000-7000-8000-0000000061a1');
insert into community_vote (answer_id, user_id, value) values ('00000000-0000-7000-8000-0000000061e1', '00000000-0000-7000-8000-0000000061a1', 1);
select pg_temp.act('person', '00000000-0000-7000-8000-0000000061a4');
insert into community_vote (answer_id, user_id, value) values ('00000000-0000-7000-8000-0000000061e1', '00000000-0000-7000-8000-0000000061a4', -1);
select pg_temp.expect('the answer counts one up and one down', (select up_votes = 1 and down_votes = 1 from community_answer where id = '00000000-0000-7000-8000-0000000061e1'));
select pg_temp.expect('who voted is private: Mia sees only her own vote', (select count(*) = 1 from community_vote));
update community_vote set value = 1 where answer_id = '00000000-0000-7000-8000-0000000061e1' and user_id = '00000000-0000-7000-8000-0000000061a4';
select pg_temp.expect('changing a vote moves the counts', (select up_votes = 2 and down_votes = 0 from community_answer where id = '00000000-0000-7000-8000-0000000061e1'));
delete from community_vote where answer_id = '00000000-0000-7000-8000-0000000061e1' and user_id = '00000000-0000-7000-8000-0000000061a4';
select pg_temp.expect('taking it back too', (select up_votes = 1 from community_answer where id = '00000000-0000-7000-8000-0000000061e1'));
select pg_temp.expect_code('nobody votes as someone else',
  $q$insert into community_vote (answer_id, user_id, value) values ('00000000-0000-7000-8000-0000000061e2', '00000000-0000-7000-8000-0000000061a1', 1)$q$, 'LP101');
insert into community_vote (answer_id, user_id, value) values ('00000000-0000-7000-8000-0000000061e1', '00000000-0000-7000-8000-0000000061a4', -1);
select pg_temp.expect_code('one vote each',
  $q$insert into community_vote (answer_id, user_id, value) values ('00000000-0000-7000-8000-0000000061e1', '00000000-0000-7000-8000-0000000061a4', 1)$q$, '23505');
delete from community_vote where user_id = '00000000-0000-7000-8000-0000000061a4';
select pg_temp.expect_code('nobody writes the counts themselves',
  $q$update community_answer set up_votes = 99 where id = '00000000-0000-7000-8000-0000000061e2'$q$, '42501');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000061a2');
select pg_temp.expect_code('nobody votes on their own answer',
  $q$insert into community_vote (answer_id, user_id, value) values ('00000000-0000-7000-8000-0000000061e1', '00000000-0000-7000-8000-0000000061a2', 1)$q$, 'LP100');
select pg_temp.act(null, null);
select pg_temp.expect_code('signed out, nobody votes',
  $q$insert into community_vote (answer_id, user_id, value) values ('00000000-0000-7000-8000-0000000061e1', '00000000-0000-7000-8000-0000000061a5', 1)$q$, 'LP101');

-- ------------------------------------------------------------------ Self-praise
select pg_temp.act('person', '00000000-0000-7000-8000-0000000061a3');
select pg_temp.expect_code('a business''s owner can''t suggest their own business',
  $q$insert into community_answer (question_id, author_user_id, body, vendor_id) values ('00000000-0000-7000-8000-0000000061d1', '00000000-0000-7000-8000-0000000061a3', 'We are the best, honestly!', '00000000-0000-7000-8000-0000000061c1')$q$, 'LP100');

select pg_temp.expect_code('…nor vote on an answer suggesting it',
  $q$insert into community_vote (answer_id, user_id, value) values ('00000000-0000-7000-8000-0000000061e1', '00000000-0000-7000-8000-0000000061a3', 1)$q$, 'LP100');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000061a2');
select pg_temp.expect_code('the same typed name twice on one question is a vote instead',
  $q$insert into community_answer (question_id, author_user_id, body, business_name) values ('00000000-0000-7000-8000-0000000061d1', '00000000-0000-7000-8000-0000000061a2', 'Maple crumbs again, so good', 'maple crumbs')$q$, '23505');

-- ------------------------------------------------------------------ Reports
select pg_temp.act('person', '00000000-0000-7000-8000-0000000061a3');
insert into community_report (id, answer_id, reporter_user_id, reason, details)
values ('00000000-0000-7000-8000-0000000061f1', '00000000-0000-7000-8000-0000000061e2', '00000000-0000-7000-8000-0000000061a3', 'untrue', 'Not true');
select pg_temp.expect_code('a post is reported once by each person',
  $q$insert into community_report (answer_id, reporter_user_id, reason) values ('00000000-0000-7000-8000-0000000061e2', '00000000-0000-7000-8000-0000000061a3', 'spam')$q$, '23505');
select pg_temp.expect_code('a report is about one post',
  $q$insert into community_report (question_id, answer_id, reporter_user_id, reason) values ('00000000-0000-7000-8000-0000000061d1', '00000000-0000-7000-8000-0000000061e1', '00000000-0000-7000-8000-0000000061a3', 'spam')$q$, '23514');
update community_report set decision = 'kept', decided_by = '00000000-0000-7000-8000-0000000061a3', decided_at = now()
where id = '00000000-0000-7000-8000-0000000061f1';
select pg_temp.expect('a person can''t decide a report (nothing changes)',
  (select decision is null from community_report where id = '00000000-0000-7000-8000-0000000061f1'));
select pg_temp.act('person', '00000000-0000-7000-8000-0000000061a2');
select pg_temp.expect_code('nobody reports their own post',
  $q$insert into community_report (answer_id, reporter_user_id, reason) values ('00000000-0000-7000-8000-0000000061e2', '00000000-0000-7000-8000-0000000061a2', 'spam')$q$, 'LP100');
select pg_temp.expect('Kim sees no one''s reports', (select count(*) = 0 from community_report));

-- ------------------------------------------------------------------ The team
select pg_temp.act('team', '00000000-0000-7000-8000-0000000061a5');
select pg_temp.expect('the team sees held posts and reports', (select count(*) = 2 from community_question) and (select count(*) = 1 from community_report));
update community_answer set status = 'removed', removed_by = 'team', removed_at = now() where id = '00000000-0000-7000-8000-0000000061e2';
update community_report set decision = 'removed', decided_by = '00000000-0000-7000-8000-0000000061a5', decided_at = now()
where id = '00000000-0000-7000-8000-0000000061f1';
select pg_temp.expect('the team takes an answer down and decides the report', (select status = 'removed' from community_answer where id = '00000000-0000-7000-8000-0000000061e2'));
select pg_temp.expect_code('a report is decided once',
  $q$update community_report set decision = 'kept', decided_by = '00000000-0000-7000-8000-0000000061a5', decided_at = now() where id = '00000000-0000-7000-8000-0000000061f1'$q$, 'LP100');
update community_question set status = 'shown' where id = '00000000-0000-7000-8000-0000000061d2';
select pg_temp.expect('the team can show a held question', (select status = 'shown' from community_question where id = '00000000-0000-7000-8000-0000000061d2'));
select pg_temp.act('person', '00000000-0000-7000-8000-0000000061a3');
select pg_temp.expect('a taken-down answer is gone for everyone else', (select count(*) = 0 from community_answer where id = '00000000-0000-7000-8000-0000000061e2'));
select pg_temp.act('person', '00000000-0000-7000-8000-0000000061a1');
select pg_temp.expect_code('nobody changes the words of a question',
  $q$update community_question set title = 'A different question now' where id = '00000000-0000-7000-8000-0000000061d1'$q$, '42501');
update community_question set status = 'removed', removed_by = 'author', removed_at = now() where id = '00000000-0000-7000-8000-0000000061d2';
select pg_temp.expect('an author takes their own question down', (select status = 'removed' and removed_by = 'author' from community_question where id = '00000000-0000-7000-8000-0000000061d2'));
select pg_temp.act('person', '00000000-0000-7000-8000-0000000061a2');
select pg_temp.expect('…gone for everyone else', (select count(*) = 0 from community_question where id = '00000000-0000-7000-8000-0000000061d2'));
select pg_temp.act('team', '00000000-0000-7000-8000-0000000061a5');
select pg_temp.expect_code('…and the team can''t put it back up',
  $q$update community_question set status = 'shown', removed_by = null, removed_at = null where id = '00000000-0000-7000-8000-0000000061d2'$q$, 'LP100');

-- ------------------------------------------------------------------ Loose ends
-- Kim's answer is reported, then she takes it down herself: the report closes, not left waiting.
select pg_temp.act('person', '00000000-0000-7000-8000-0000000061a4');
insert into community_report (answer_id, reporter_user_id, reason) values ('00000000-0000-7000-8000-0000000061e1', '00000000-0000-7000-8000-0000000061a4', 'spam');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000061a2');
insert into community_answer (id, question_id, author_user_id, body, business_name, status, language_flag)
values ('00000000-0000-7000-8000-0000000061e3', '00000000-0000-7000-8000-0000000061d1', '00000000-0000-7000-8000-0000000061a2',
        'A held one about Maple Crumbs', 'Maple Crumbs', 'held', 'Word list: x');
select pg_temp.expect('a held answer never blocks the same business being suggested (only shown ones count)',
  (select status = 'held' from community_answer where id = '00000000-0000-7000-8000-0000000061e3'));
update community_answer set status = 'removed', removed_by = 'author', removed_at = now() where id = '00000000-0000-7000-8000-0000000061e1';
reset role;
select pg_temp.expect('a post its author takes down: its open reports close as gone',
  (select decision = 'gone' from community_report where answer_id = '00000000-0000-7000-8000-0000000061e1'));
set local role app_server;
-- A question the team took down: its answers can't be reported any more.
select pg_temp.act('person', '00000000-0000-7000-8000-0000000061a1');
insert into community_question (id, author_user_id, title) values ('00000000-0000-7000-8000-0000000061d3', '00000000-0000-7000-8000-0000000061a1', 'Best balloon arches in town?');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000061a2');
insert into community_answer (id, question_id, author_user_id, body) values ('00000000-0000-7000-8000-0000000061e4', '00000000-0000-7000-8000-0000000061d3', '00000000-0000-7000-8000-0000000061a2', 'Ask at the party shop downtown.');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000061a5');
update community_question set status = 'removed', removed_by = 'team', removed_at = now() where id = '00000000-0000-7000-8000-0000000061d3';
select pg_temp.act('person', '00000000-0000-7000-8000-0000000061a4');
select pg_temp.expect_code('an answer under a question taken down can''t be reported',
  $q$insert into community_report (answer_id, reporter_user_id, reason) values ('00000000-0000-7000-8000-0000000061e4', '00000000-0000-7000-8000-0000000061a4', 'spam')$q$, 'LP101');

-- ------------------------------------------------------------------ Download your data, and an account deleted
select pg_temp.act('person', '00000000-0000-7000-8000-0000000061a2');
select pg_temp.expect('Download your data has Kim''s answers', (select jsonb_array_length(my_data()->'community_answers') = 4));
select pg_temp.act('person', '00000000-0000-7000-8000-0000000061a1');
select pg_temp.expect('…and Pat''s questions and vote, without the words of an answer taken down', (select jsonb_array_length(my_data()->'community_questions') = 3 and jsonb_array_length(my_data()->'community_votes') = 1
  and my_data()->'community_votes'->0->>'answer' is null));
reset role;
update app_user set deleted_at = now() where id = '00000000-0000-7000-8000-0000000061a1';
select pg_temp.expect('an account deleted: its question comes down with its words, its vote goes',
  (select status = 'removed' and removed_by = 'account_deleted' and title = 'A question from a deleted account' and detail is null
   from community_question where id = '00000000-0000-7000-8000-0000000061d1')
  and (select up_votes = 0 from community_answer where id = '00000000-0000-7000-8000-0000000061e1'));

rollback;
