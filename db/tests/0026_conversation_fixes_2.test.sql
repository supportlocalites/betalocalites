-- =============================================================================
-- Checks for migration 0026: messages, after a second review (Stage 2B).
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

-- Person A; business V (owner O, later owner N, later staff S); M on the Localites team.
insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000026a1', 'Person A', 'a-26@example.com'),
  ('00000000-0000-7000-8000-0000000026a3', 'Owner O', 'o-26@example.com'),
  ('00000000-0000-7000-8000-0000000026a4', 'New owner N', 'n-26@example.com'),
  ('00000000-0000-7000-8000-0000000026a5', 'Staff S', 's-26@example.com'),
  ('00000000-0000-7000-8000-0000000026a7', 'Team M', 'm-26@example.com');
insert into platform_role (user_id, role) values ('00000000-0000-7000-8000-0000000026a7', 'admin');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000026b1', 'test-town-26', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000026c1', 'test-26-v', 'Twenty-six V', '00000000-0000-7000-8000-0000000026b1', 'admin_entered', 'published', 'claimed', now());
insert into vendor_member (vendor_id, user_id, role, created_at) values
  ('00000000-0000-7000-8000-0000000026c1', '00000000-0000-7000-8000-0000000026a3', 'owner', now() - interval '1 day');

set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000026a1');
insert into conversation (id, consumer_user_id, vendor_id) values
  ('00000000-0000-7000-8000-000000002661', '00000000-0000-7000-8000-0000000026a1', '00000000-0000-7000-8000-0000000026c1');
insert into message (id, conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002671', '00000000-0000-7000-8000-000000002661', '00000000-0000-7000-8000-0000000026a1',
   'consumer', 'For O only');

-- ---------------------------------------------------------------- "read up to"
select pg_temp.act('business', '00000000-0000-7000-8000-0000000026a3', '00000000-0000-7000-8000-0000000026c1');
insert into conversation_read (conversation_id, user_id, last_read_at) values
  ('00000000-0000-7000-8000-000000002661', '00000000-0000-7000-8000-0000000026a3', now() - interval '1 hour');
select pg_temp.expect_equal('"read up to" can be the newest message the page showed', (
  select (last_read_at = now() - interval '1 hour')::text from conversation_read), 'true');
update conversation_read set last_read_at = now() - interval '2 hours';
select pg_temp.expect_equal('…never going back', (
  select (last_read_at = now() - interval '1 hour')::text from conversation_read), 'true');
update conversation_read set last_read_at = now() + interval '1 day';
select pg_temp.expect_equal('…never later than now', (select (last_read_at <= clock_timestamp())::text from conversation_read), 'true');
update conversation_read set last_read_at = null;
select pg_temp.expect_equal('…or now, when not given', (select (last_read_at > now())::text from conversation_read), 'true');

-- ---------------------------------------------------------------- a new team never inherits
-- The race the review found: the conversation stays current although O was removed (as if
-- the person's step had passed its check just before the removal was saved).
reset role;
alter table vendor_member disable trigger vendor_member_end_conversations;
alter table vendor disable trigger vendor_end_conversations;
update vendor_member set ended_at = clock_timestamp() where user_id = '00000000-0000-7000-8000-0000000026a3';
update vendor set claim_status = 'unclaimed' where id = '00000000-0000-7000-8000-0000000026c1';
alter table vendor_member enable trigger vendor_member_end_conversations;
alter table vendor enable trigger vendor_end_conversations;
select pg_temp.expect_equal('(set-up: the conversation slipped through, still current)', (
  select coalesce(ended_reason, 'current') from conversation where id = '00000000-0000-7000-8000-000000002661'), 'current');
-- N's claim is approved: a new team forms, and nothing current passes to it.
insert into vendor_member (vendor_id, user_id, role, created_at) values
  ('00000000-0000-7000-8000-0000000026c1', '00000000-0000-7000-8000-0000000026a4', 'owner', clock_timestamp());
update vendor set claim_status = 'claimed' where id = '00000000-0000-7000-8000-0000000026c1';
select pg_temp.expect_equal('a new team forms: anything still current ends first', (
  select ended_reason from conversation where id = '00000000-0000-7000-8000-000000002661'), 'business_left');
set local role app_server;
select pg_temp.act('business', '00000000-0000-7000-8000-0000000026a4', '00000000-0000-7000-8000-0000000026c1');
select pg_temp.expect_equal('…so the new owner reads none of it', (select count(*)::text from message), '0');

-- Before 0025 a new team could already have inherited one: the one-off clean-up ends it.
reset role;
alter table conversation disable trigger conversation_rules;
update conversation set ended_at = null, ended_reason = null where id = '00000000-0000-7000-8000-000000002661';
alter table conversation enable trigger conversation_rules;
select pg_temp.expect_equal('the clean-up ends conversations a new team had already inherited', (
  select end_inherited_conversations()::text), '1');
select pg_temp.expect_equal('…as the business having left', (
  select ended_reason from conversation where id = '00000000-0000-7000-8000-000000002661'), 'business_left');
-- A person's current conversation under N is left alone.
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000026a1');
insert into conversation (id, consumer_user_id, vendor_id) values
  ('00000000-0000-7000-8000-000000002662', '00000000-0000-7000-8000-0000000026a1', '00000000-0000-7000-8000-0000000026c1');
insert into message (id, conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002672', '00000000-0000-7000-8000-000000002662', '00000000-0000-7000-8000-0000000026a1',
   'consumer', 'Hello N');
reset role;
-- (Its real start, after N joined: inside one test step "now" never moves.)
alter table conversation disable trigger conversation_rules;
update conversation set created_at = clock_timestamp() where id = '00000000-0000-7000-8000-000000002662';
alter table conversation enable trigger conversation_rules;
select pg_temp.expect_equal('…and leaves the current team''s own conversations alone', (
  select end_inherited_conversations()::text), '0');
select pg_temp.expect_code('the site can''t run the clean-up', $q$
  set local role app_server; select end_inherited_conversations()$q$, '42501');
reset role;

-- ---------------------------------------------------------------- emails about a person's message
-- S joins N's team after A's message: S isn't emailed about it.
insert into vendor_member (vendor_id, user_id, role, created_at) values
  ('00000000-0000-7000-8000-0000000026c1', '00000000-0000-7000-8000-0000000026a5', 'staff', clock_timestamp());
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000026a1');
select pg_temp.expect_equal('only people on the team when it was written are emailed about it', (
  select string_agg(email, ',') from new_message_notices('00000000-0000-7000-8000-000000002672')), 'n-26@example.com');
-- An email that got stuck "being sent" more than 10 minutes ago doesn't hold the next one back.
reset role;
update notification set created_at = now() - interval '1 hour' where subject_id = '00000000-0000-7000-8000-000000002662';
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000026a1');
insert into message (id, conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002673', '00000000-0000-7000-8000-000000002662', '00000000-0000-7000-8000-0000000026a1',
   'consumer', 'Hello again N');
select pg_temp.expect_equal('an email stuck "being sent" for over 10 minutes doesn''t hold the next back', (
  select string_agg(email, ',' order by email) from new_message_notices('00000000-0000-7000-8000-000000002673')),
  'n-26@example.com,s-26@example.com');
-- Never about a conversation that has ended (the team ended while the email waited).
reset role;
update vendor_member set ended_at = now() where vendor_id = '00000000-0000-7000-8000-0000000026c1' and role = 'owner';
update notification set created_at = now() - interval '1 hour' where subject_id = '00000000-0000-7000-8000-000000002662';
insert into vendor_member (vendor_id, user_id, role) values
  ('00000000-0000-7000-8000-0000000026c1', '00000000-0000-7000-8000-0000000026a3', 'owner');
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000026a1');
select pg_temp.expect_equal('never to a business about a conversation that has ended', (
  select count(*)::text from new_message_notices('00000000-0000-7000-8000-000000002673')), '0');

-- ---------------------------------------------------------------- changing an ended conversation
select pg_temp.expect_code('the person is refused in their own words', $q$
  update conversation set status = 'blocked_by_consumer' where id = '00000000-0000-7000-8000-000000002662'$q$, 'LP140');

-- ---------------------------------------------------------------- a reported conversation's removed message
reset role;
insert into conversation (id, consumer_user_id, vendor_id) values
  ('00000000-0000-7000-8000-000000002663', '00000000-0000-7000-8000-0000000026a1', '00000000-0000-7000-8000-0000000026c1');
insert into message (id, conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002674', '00000000-0000-7000-8000-000000002663', '00000000-0000-7000-8000-0000000026a1',
   'consumer', 'Hello O'),
  ('00000000-0000-7000-8000-000000002675', '00000000-0000-7000-8000-000000002663', '00000000-0000-7000-8000-0000000026a3',
   'vendor', 'Send a gift card first'),
  ('00000000-0000-7000-8000-000000002676', '00000000-0000-7000-8000-000000002663', '00000000-0000-7000-8000-0000000026a3',
   'vendor', 'Thanks');
set local role app_server;
select pg_temp.act('business', '00000000-0000-7000-8000-0000000026a3', '00000000-0000-7000-8000-0000000026c1');
update message set removed_at = now() where id = '00000000-0000-7000-8000-000000002676';
select pg_temp.act('person', '00000000-0000-7000-8000-0000000026a1');
insert into moderation_report (id, reporter_user_id, reporter_side, conversation_id, message_id, reason) values
  ('00000000-0000-7000-8000-000000002681', '00000000-0000-7000-8000-0000000026a1', 'consumer',
   '00000000-0000-7000-8000-000000002663', '00000000-0000-7000-8000-000000002675', 'scam_or_fraud');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000026a3', '00000000-0000-7000-8000-0000000026c1');
update message set removed_at = now() where id = '00000000-0000-7000-8000-000000002675';
select pg_temp.expect_equal('removed after a report: both sides see it removed', (
  select '"' || body || '"' from message where id = '00000000-0000-7000-8000-000000002675'), '""');
select pg_temp.expect_code('…neither side can read the kept words', $q$
  select body from reported_message_text$q$, '42501');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000026a7');
select pg_temp.expect_equal('…the team still reads them, through the report', (
  select body || ' ' || removed::text from reported_conversation_for_team('00000000-0000-7000-8000-000000002681')
  where message_id = '00000000-0000-7000-8000-000000002675'), 'Send a gift card first true');
select pg_temp.expect_equal('…a message removed before any report is gone for everyone', (
  select '"' || body || '"' from reported_conversation_for_team('00000000-0000-7000-8000-000000002681')
  where message_id = '00000000-0000-7000-8000-000000002676'), '""');
select pg_temp.expect_code('…and the team can''t write the kept words itself', $q$
  insert into reported_message_text (message_id, body) values ('00000000-0000-7000-8000-000000002674', 'made up')$q$, '42501');

rollback;
