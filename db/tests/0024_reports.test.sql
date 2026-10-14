-- =============================================================================
-- Checks for migration 0024: reporting a conversation or message (Stage 2B, part 2).
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

-- A talks to business V (staff S); B is another person; M is the team.
insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000024a1', 'Person A', 'a-24@example.com'),
  ('00000000-0000-7000-8000-0000000024a2', 'Person B', 'b-24@example.com'),
  ('00000000-0000-7000-8000-0000000024a3', 'Staff S', 's-24@example.com'),
  ('00000000-0000-7000-8000-0000000024a4', 'Team M', 'm-24@example.com');
insert into platform_role (user_id, role) values ('00000000-0000-7000-8000-0000000024a4', 'admin');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000024b1', 'test-town-24', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000024c1', 'test-24-v', 'Twenty-four V', '00000000-0000-7000-8000-0000000024b1', 'admin_entered', 'published', 'claimed', now());
insert into vendor_member (vendor_id, user_id, role) values
  ('00000000-0000-7000-8000-0000000024c1', '00000000-0000-7000-8000-0000000024a3', 'staff');
insert into conversation (id, consumer_user_id, vendor_id) values
  ('00000000-0000-7000-8000-000000002461', '00000000-0000-7000-8000-0000000024a1', '00000000-0000-7000-8000-0000000024c1');
insert into message (id, conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002471', '00000000-0000-7000-8000-000000002461', '00000000-0000-7000-8000-0000000024a1', 'consumer', 'Hi'),
  ('00000000-0000-7000-8000-000000002472', '00000000-0000-7000-8000-000000002461', '00000000-0000-7000-8000-0000000024a3', 'vendor', 'Pay me by gift card');

set local role app_server;

-- ---------------------------------------------------------------- reporting
select pg_temp.act('person', '00000000-0000-7000-8000-0000000024a1');
insert into moderation_report (id, reporter_user_id, reporter_side, conversation_id, message_id, reason, details) values
  ('00000000-0000-7000-8000-000000002481', '00000000-0000-7000-8000-0000000024a1', 'consumer', '00000000-0000-7000-8000-000000002461',
   '00000000-0000-7000-8000-000000002472', 'scam_or_fraud', 'Asked for gift cards');
select pg_temp.expect_equal('the person reports a message in their conversation; it starts open', (
  select status from moderation_report where id = '00000000-0000-7000-8000-000000002481'), 'open');
select pg_temp.expect_code('not as the business', $q$
  insert into moderation_report (reporter_user_id, reporter_side, conversation_id, reason) values
  ('00000000-0000-7000-8000-0000000024a1', 'vendor', '00000000-0000-7000-8000-000000002461', 'spam')$q$, 'LP101');
select pg_temp.expect_code('the reporter can''t decide it', $q$
  update moderation_report set status = 'dismissed', decision_note = 'x' where id = '00000000-0000-7000-8000-000000002481'$q$, 'LP101');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000024a2');
select pg_temp.expect_code('another person can''t report a conversation that isn''t theirs', $q$
  insert into moderation_report (reporter_user_id, reporter_side, conversation_id, reason) values
  ('00000000-0000-7000-8000-0000000024a2', 'consumer', '00000000-0000-7000-8000-000000002461', 'spam')$q$, 'LP101');
select pg_temp.expect_equal('…or see any report', (select count(*)::text from moderation_report), '0');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000024a3', '00000000-0000-7000-8000-0000000024c1');
insert into moderation_report (id, reporter_user_id, reporter_side, conversation_id, reason) values
  ('00000000-0000-7000-8000-000000002482', '00000000-0000-7000-8000-0000000024a3', 'vendor', '00000000-0000-7000-8000-000000002461', 'harassment');
select pg_temp.expect_equal('staff report the whole conversation; each side sees only its own reports', (
  select string_agg(id::text, ',') from moderation_report), '00000000-0000-7000-8000-000000002482');

-- ---------------------------------------------------------------- the team
select pg_temp.act('team', '00000000-0000-7000-8000-0000000024a4');
select pg_temp.expect_equal('the team sees which conversation was reported, never its messages directly', (
  select count(*)::text || '/' || (select count(*) from message)::text from conversation), '1/0');
select pg_temp.expect_equal('…only through a report, which shows every message and marks the reported one', (
  select string_agg(author_name || ':' || reported::text, ',' order by created_at, message_id)
  from reported_conversation_for_team('00000000-0000-7000-8000-000000002481')), 'Person A:false,Staff S:true');
select pg_temp.expect_equal('…and each look is written to the audit log, with the report', (
  select count(*)::text from audit_log where action = 'conversation.report_view'
    and subject_id = '00000000-0000-7000-8000-000000002481'), '1');
select team_hide_reported_message('00000000-0000-7000-8000-000000002481');
select team_block_reported('00000000-0000-7000-8000-000000002481', true);
update moderation_report set status = 'actioned', decision_note = 'Hid the message and blocked the conversation.'
where id = '00000000-0000-7000-8000-000000002481';
select pg_temp.expect_equal('the team hides the message (kept, marked hidden)', (
  select string_agg(hidden::text, ',' order by created_at, message_id)
  from reported_conversation_for_team('00000000-0000-7000-8000-000000002481')), 'false,true');
select pg_temp.expect_equal('…and closes the report, in its own name', (
  select status || ' ' || (reviewed_by = '00000000-0000-7000-8000-0000000024a4')::text
  from moderation_report where id = '00000000-0000-7000-8000-000000002481'), 'actioned true');
select pg_temp.expect_code('a closed report can''t be decided again', $q$
  update moderation_report set status = 'dismissed', decision_note = 'again' where id = '00000000-0000-7000-8000-000000002481'$q$, 'LP109');
select pg_temp.expect_code('closing needs a note', $q$
  update moderation_report set status = 'dismissed' where id = '00000000-0000-7000-8000-000000002482'$q$, '23514');

select pg_temp.act('person', '00000000-0000-7000-8000-0000000024a1');
select pg_temp.expect_code('blocked by the team: the person can''t write', $q$
  insert into message (conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002461', '00000000-0000-7000-8000-0000000024a1', 'consumer', 'Hello?')$q$, 'LP143');
select pg_temp.expect_code('…or undo the team''s block', $q$
  update conversation set status = 'open' where id = '00000000-0000-7000-8000-000000002461'$q$, 'LP109');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000024a2');
select pg_temp.expect_code('only the team reads a reported conversation', $q$
  select * from reported_conversation_for_team('00000000-0000-7000-8000-000000002481')$q$, 'LP101');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000024a4');
select team_block_reported('00000000-0000-7000-8000-000000002481', false);
select pg_temp.expect_equal('the team can unblock', (
  select status from conversation where id = '00000000-0000-7000-8000-000000002461'), 'open');

reset role;
select pg_temp.expect_equal('…(read back by the owner)', (
  select status from conversation where id = '00000000-0000-7000-8000-000000002461'), 'open');
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;
set local role anon;
do $$
begin
  perform 1 from moderation_report;
  raise exception 'FAIL  the browser-facing role can read reports';
exception when insufficient_privilege then
  raise notice 'PASS  the browser-facing role can''t read reports';
end $$;

rollback;
