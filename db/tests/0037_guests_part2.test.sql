-- =============================================================================
-- Checks for migration 0037: guests, part 2 (group link, group replies, questions, updates).
-- One transaction, rolled back.
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

create function pg_temp.act(p_side text, p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('localites.side', coalesce(p_side, ''), true),
          set_config('localites.user_id', coalesce(p_user::text, ''), true),
          set_config('localites.vendor_id', '', true);
end $$;

create function pg_temp.h(t text) returns bytea language sql as $$ select sha256(convert_to(t, 'UTF8')) $$;

-- Ann hosts a party in 10 days; Bo is someone else; M is on the team.
insert into app_user (id, display_name, given_name, family_name, email) values
  ('00000000-0000-7000-8000-0000000037a1', 'Ann Host', 'Ann', 'Host', 'a-37@example.com'),
  ('00000000-0000-7000-8000-0000000037a2', 'Bo Other', 'Bo', 'Other', 'b-37@example.com'),
  ('00000000-0000-7000-8000-0000000037a7', 'Team M', 'Mo', 'Team', 'm-37@example.com');
insert into platform_role (user_id, role) values ('00000000-0000-7000-8000-0000000037a7', 'admin');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000037b1', 'test-town-37', 'Test Town', 'Test County', true);
insert into event (id, host_user_id, event_date, municipality_id) values
  ('00000000-0000-7000-8000-0000000037f1', '00000000-0000-7000-8000-0000000037a1', current_date + 10, '00000000-0000-7000-8000-0000000037b1');
insert into event_private (event_id, host_user_id, title) values
  ('00000000-0000-7000-8000-0000000037f1', '00000000-0000-7000-8000-0000000037a1', 'Party');
insert into guest (id, event_id, host_user_id, name, token_hash) values
  ('00000000-0000-7000-8000-0000000037d1', '00000000-0000-7000-8000-0000000037f1', '00000000-0000-7000-8000-0000000037a1', 'Jo', pg_temp.h('jo'));

set local role app_server;

-- ------------------------------------------------------------------ the group link
select pg_temp.act('person', '00000000-0000-7000-8000-0000000037a2');
select pg_temp.expect_code('someone else can''t make the event''s group link', $q$
  insert into event_group_link (event_id, host_user_id, token_hash) values
  ('00000000-0000-7000-8000-0000000037f1', '00000000-0000-7000-8000-0000000037a1', sha256('g1'::bytea))$q$, 'LP101');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000037a1');
insert into event_group_link (event_id, host_user_id, token_hash) values
  ('00000000-0000-7000-8000-0000000037f1', '00000000-0000-7000-8000-0000000037a1', pg_temp.h('g1'));
select pg_temp.expect_equal('the host makes a group link: version 1', (select version::text from event_group_link), '1');
select pg_temp.expect_code('a new link must be the next version', $q$
  update event_group_link set token_hash = sha256('g9'::bytea) where event_id = '00000000-0000-7000-8000-0000000037f1'$q$, 'LP100');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000037a2');
select pg_temp.expect_equal('someone else sees no group link', (select count(*)::text from event_group_link), '0');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000037a7');
select pg_temp.expect_equal('…nor does the team', (select count(*)::text from event_group_link), '0');
select pg_temp.act(null, null);

-- ------------------------------------------------------------------ the host's questions and updates
select pg_temp.act('person', '00000000-0000-7000-8000-0000000037a1');
insert into event_question (id, event_id, host_user_id, question) values
  ('00000000-0000-7000-8000-0000000037c1', '00000000-0000-7000-8000-0000000037f1', '00000000-0000-7000-8000-0000000037a1', 'Any allergies?');
insert into event_question (event_id, host_user_id, question)
  select '00000000-0000-7000-8000-0000000037f1', '00000000-0000-7000-8000-0000000037a1', 'Q' || n from generate_series(2, 5) n;
select pg_temp.expect_code('up to 5 questions', $q$
  insert into event_question (event_id, host_user_id, question) values
  ('00000000-0000-7000-8000-0000000037f1', '00000000-0000-7000-8000-0000000037a1', 'Sixth?')$q$, 'LP172');
select pg_temp.expect_code('a question isn''t rewritten (answers were to its words)', $q$
  update event_question set question = 'Changed' where id = '00000000-0000-7000-8000-0000000037c1'$q$, '42501');
insert into event_update (event_id, host_user_id, body) values
  ('00000000-0000-7000-8000-0000000037f1', '00000000-0000-7000-8000-0000000037a1', 'We moved to 3 pm');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000037a2');
select pg_temp.expect_code('someone else can''t post an update', $q$
  insert into event_update (event_id, host_user_id, body) values
  ('00000000-0000-7000-8000-0000000037f1', '00000000-0000-7000-8000-0000000037a1', 'Party cancelled lol')$q$, 'LP101');
select pg_temp.expect_code('…or add a question in the host''s name', $q$
  insert into event_question (event_id, host_user_id, question) values
  ('00000000-0000-7000-8000-0000000037f1', '00000000-0000-7000-8000-0000000037a1', 'Bank details?')$q$, 'LP101');

-- ------------------------------------------------------------------ a guest by the group link (no account)
select pg_temp.act(null, null);
select pg_temp.expect_equal('the group link opens the invitation, with no name and no reply yet', (
  select title || ' ' || status || ' ' || coalesce(reply_name, 'none') from group_invitation_for(pg_temp.h('g1'), pg_temp.h('browser-1'))),
  'Party open none');
select pg_temp.expect_equal('a wrong group link opens nothing', (
  select count(*)::text from group_invitation_for(pg_temp.h('nope'), pg_temp.h('browser-1'))), '0');
select pg_temp.expect_code('a name is needed', $q$
  select group_invitation_reply(sha256(convert_to('g1', 'UTF8')), sha256(convert_to('browser-1', 'UTF8')), '  ', 'yes', 2::smallint, null, '{}')$q$, 'LP175');
select group_invitation_reply(pg_temp.h('g1'), pg_temp.h('browser-1'), 'Sam Smith', 'yes', 2::smallint, 'Can''t wait',
  jsonb_build_object('00000000-0000-7000-8000-0000000037c1', 'Peanuts'));
select pg_temp.expect_equal('…their reply is shown back to the same browser only', (
  select reply_name || ' ' || response || ' ' || party_size from group_invitation_for(pg_temp.h('g1'), pg_temp.h('browser-1'))),
  'Sam Smith yes 2');
select pg_temp.expect_equal('another browser sees no one''s reply', (
  select coalesce(reply_name, 'none') from group_invitation_for(pg_temp.h('g1'), pg_temp.h('browser-2'))), 'none');
select pg_temp.expect_equal('the questions and the update show, with this browser''s own answer', (
  select string_agg(kind || ':' || body || coalesce('=' || answer, ''), ' | ' order by kind, at, body)
  from invitation_extras(pg_temp.h('g1'), pg_temp.h('browser-1')) where body in ('Any allergies?', 'We moved to 3 pm')),
  'question:Any allergies?=Peanuts | update:We moved to 3 pm');
select pg_temp.expect_equal('another browser doesn''t see that answer', (
  select coalesce(answer, 'none') from invitation_extras(pg_temp.h('g1'), pg_temp.h('browser-2')) where body = 'Any allergies?'), 'none');
select group_invitation_reply(pg_temp.h('g1'), pg_temp.h('browser-1'), 'Sam Smith', 'maybe', 1::smallint, null,
  jsonb_build_object('00000000-0000-7000-8000-0000000037c1', ''));
reset role;
select pg_temp.expect_equal('the same browser changes its reply (and removes its answer): still one reply', (
  select count(*) || ' ' || max(response) || ' ' || (select count(*) from guest_answer) from group_reply), '1 maybe 0');
set local role app_server;
select pg_temp.expect_code('the guest can''t write a group reply directly', $q$
  insert into group_reply (event_id, host_user_id, browser_hash, name, response) values
  ('00000000-0000-7000-8000-0000000037f1', '00000000-0000-7000-8000-0000000037a1', sha256('x'::bytea), 'X', 'no')$q$, '42501');

-- ------------------------------------------------------------------ a guest by their own link answers
select invitation_answers(pg_temp.h('jo'), jsonb_build_object('00000000-0000-7000-8000-0000000037c1', 'None', 'not-a-question', 'x'));
select pg_temp.expect_equal('Jo answers by her own link (unknown questions ignored)', (
  select answer from invitation_extras(pg_temp.h('jo'), null) where body = 'Any allergies?'), 'None');
select pg_temp.expect_code('a wrong link can''t answer', $q$
  select invitation_answers(sha256('nope'::bytea), '{}')$q$, 'LP101');

-- ------------------------------------------------------------------ the host sees and matches
select pg_temp.act('person', '00000000-0000-7000-8000-0000000037a2');
select pg_temp.expect_equal('someone else sees no group replies, questions, answers or updates', (
  select (select count(*) from group_reply) + (select count(*) from event_question) + (select count(*) from guest_answer)
         + (select count(*) from event_update))::text, '0');
select pg_temp.expect_code('…and can''t match a reply', $q$
  select match_group_reply((select id from group_reply limit 1), '00000000-0000-7000-8000-0000000037d1')$q$, 'LP101');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000037a1');
select pg_temp.expect_code('the host can''t change a guest''s group reply', $q$
  update group_reply set response = 'no'$q$, '42501');
select pg_temp.expect_code('…or write an answer for a guest', $q$
  insert into guest_answer (question_id, host_user_id, guest_id, answer) values
  ('00000000-0000-7000-8000-0000000037c1', '00000000-0000-7000-8000-0000000037a1', '00000000-0000-7000-8000-0000000037d1', 'x')$q$, '42501');
select match_group_reply((select id from group_reply limit 1), '00000000-0000-7000-8000-0000000037d1');
select pg_temp.expect_equal('the host matches Sam''s reply to Jo: Jo shows it, as the guest''s own', (
  select response || ' ' || party_size || ' ' || reply_by from guest where id = '00000000-0000-7000-8000-0000000037d1'), 'maybe 1 guest');
select pg_temp.expect_code('a reply is matched once', $q$
  select match_group_reply((select id from group_reply limit 1), '00000000-0000-7000-8000-0000000037d1')$q$, 'LP174');
select pg_temp.act(null, null);
select group_invitation_reply(pg_temp.h('g1'), pg_temp.h('browser-1'), 'Sam Smith', 'no', null, null,
  jsonb_build_object('00000000-0000-7000-8000-0000000037c1', 'Shellfish'));
select pg_temp.act('person', '00000000-0000-7000-8000-0000000037a1');
select pg_temp.expect_equal('a matched reply changed later: the guest follows, answers too', (
  select g.response || ' ' || (select answer from guest_answer a where a.guest_id = g.id)
  from guest g where g.id = '00000000-0000-7000-8000-0000000037d1'), 'no Shellfish');

-- ------------------------------------------------------------------ switching the link off
update event_group_link set token_hash = null where event_id = '00000000-0000-7000-8000-0000000037f1';
select pg_temp.act(null, null);
select pg_temp.expect_equal('switched off: the old link opens nothing', (
  select count(*)::text from group_invitation_for(pg_temp.h('g1'), pg_temp.h('browser-1'))), '0');
select pg_temp.expect_code('…and takes no replies', $q$
  select group_invitation_reply(sha256(convert_to('g1', 'UTF8')), sha256(convert_to('browser-3', 'UTF8')), 'Late', 'yes', 1::smallint, null, '{}')$q$, 'LP101');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000037a1');
update event_group_link set token_hash = sha256(convert_to('g2', 'UTF8')), version = 2 where event_id = '00000000-0000-7000-8000-0000000037f1';
select pg_temp.act(null, null);
select pg_temp.expect_equal('a new link (version 2) works', (
  select count(*)::text from group_invitation_for(pg_temp.h('g2'), pg_temp.h('browser-1'))), '1');

-- ------------------------------------------------------------------ a cancelled event
reset role;
update event set status = 'cancelled', cancelled_at = now() where id = '00000000-0000-7000-8000-0000000037f1';
set local role app_server;
select pg_temp.expect_equal('cancelled: the invitation says so', (
  select status from group_invitation_for(pg_temp.h('g2'), pg_temp.h('browser-1'))), 'cancelled');
select pg_temp.expect_code('…and takes no replies', $q$
  select group_invitation_reply(sha256(convert_to('g2', 'UTF8')), sha256(convert_to('browser-4', 'UTF8')), 'Late', 'yes', 1::smallint, null, '{}')$q$, 'LP102');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000037a1');
select pg_temp.expect_code('…and no new updates', $q$
  insert into event_update (event_id, host_user_id, body) values
  ('00000000-0000-7000-8000-0000000037f1', '00000000-0000-7000-8000-0000000037a1', 'Hi')$q$, 'LP102');

reset role;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end $$;
set local role anon;
select pg_temp.expect_code('the browser-facing role can''t open a group invitation', $q$
  select * from group_invitation_for(sha256('g2'::bytea), sha256('b'::bytea))$q$, '42501');
reset role;

rollback;
