-- =============================================================================
-- Checks for migration 0027: messages, after a third review (Stage 2B).
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

create function pg_temp.act(p_side text, p_user uuid, p_vendor uuid default null) returns void
language plpgsql as $$
begin
  perform set_config('localites.side', coalesce(p_side, ''), true),
          set_config('localites.user_id', coalesce(p_user::text, ''), true),
          set_config('localites.vendor_id', coalesce(p_vendor::text, ''), true);
end $$;

-- Person A; business V (owner O); M on the Localites team.
insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000027a1', 'Person A', 'a-27@example.com'),
  ('00000000-0000-7000-8000-0000000027a3', 'Owner O', 'o-27@example.com'),
  ('00000000-0000-7000-8000-0000000027a7', 'Team M', 'm-27@example.com');
insert into platform_role (user_id, role) values ('00000000-0000-7000-8000-0000000027a7', 'admin');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000027b1', 'test-town-27', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000027c1', 'test-27-v', 'Twenty-seven V', '00000000-0000-7000-8000-0000000027b1', 'admin_entered', 'published', 'claimed', now());
insert into vendor_member (vendor_id, user_id, role, created_at) values
  ('00000000-0000-7000-8000-0000000027c1', '00000000-0000-7000-8000-0000000027a3', 'owner', now() - interval '1 day');

set local role app_server;

-- ---------------------------------------------------------------- read, don't reply, and the next message
select pg_temp.act('person', '00000000-0000-7000-8000-0000000027a1');
insert into conversation (id, consumer_user_id, vendor_id) values
  ('00000000-0000-7000-8000-000000002761', '00000000-0000-7000-8000-0000000027a1', '00000000-0000-7000-8000-0000000027c1');
insert into message (id, conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002771', '00000000-0000-7000-8000-000000002761', '00000000-0000-7000-8000-0000000027a1',
   'consumer', 'First');
select pg_temp.expect_equal('the first message: the owner is emailed', (
  select string_agg(email, ',') from new_message_notices('00000000-0000-7000-8000-000000002771')), 'o-27@example.com');
-- The owner opens it (read up to the newest message shown), and doesn't reply.
select pg_temp.act('business', '00000000-0000-7000-8000-0000000027a3', '00000000-0000-7000-8000-0000000027c1');
insert into conversation_read (conversation_id, user_id, last_read_at)
select '00000000-0000-7000-8000-000000002761', '00000000-0000-7000-8000-0000000027a3', max(created_at) from message;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000027a1');
insert into message (id, conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002772', '00000000-0000-7000-8000-000000002761', '00000000-0000-7000-8000-0000000027a1',
   'consumer', 'Second');
select pg_temp.expect_equal('read without replying, then a new message: emailed again', (
  select string_agg(email, ',') from new_message_notices('00000000-0000-7000-8000-000000002772')), 'o-27@example.com');
insert into message (id, conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002773', '00000000-0000-7000-8000-000000002761', '00000000-0000-7000-8000-0000000027a1',
   'consumer', 'Third');
select pg_temp.expect_equal('…but not again before they''ve read that one', (
  select count(*)::text from new_message_notices('00000000-0000-7000-8000-000000002773')), '0');

-- ---------------------------------------------------------------- which removed words are kept
-- A message from before the report, the report, then a message written after it.
-- (A second conversation with V: the first one is ended to make room, one current per pair.)
reset role;
update conversation set ended_at = now(), ended_reason = 'business_left' where id = '00000000-0000-7000-8000-000000002761';
insert into conversation (id, consumer_user_id, vendor_id) values
  ('00000000-0000-7000-8000-000000002763', '00000000-0000-7000-8000-0000000027a1', '00000000-0000-7000-8000-0000000027c1');
insert into message (id, conversation_id, author_user_id, author_side, body, created_at) values
  ('00000000-0000-7000-8000-000000002774', '00000000-0000-7000-8000-000000002763', '00000000-0000-7000-8000-0000000027a1',
   'consumer', 'Hello', now() - interval '2 hours'),
  ('00000000-0000-7000-8000-000000002775', '00000000-0000-7000-8000-000000002763', '00000000-0000-7000-8000-0000000027a3',
   'vendor', 'Pay by gift card', now() - interval '1 hour'),
  ('00000000-0000-7000-8000-000000002776', '00000000-0000-7000-8000-000000002763', '00000000-0000-7000-8000-0000000027a1',
   'consumer', 'My home address is 1 Test Street', now() - interval '10 minutes');
insert into moderation_report (id, reporter_user_id, reporter_side, conversation_id, reason, created_at) values
  ('00000000-0000-7000-8000-000000002781', '00000000-0000-7000-8000-0000000027a1', 'consumer',
   '00000000-0000-7000-8000-000000002763', 'scam_or_fraud', now() - interval '30 minutes');
set local role app_server;
select pg_temp.act('business', '00000000-0000-7000-8000-0000000027a3', '00000000-0000-7000-8000-0000000027c1');
update message set removed_at = now() where id = '00000000-0000-7000-8000-000000002775';
select pg_temp.act('person', '00000000-0000-7000-8000-0000000027a1');
update message set removed_at = now() where id = '00000000-0000-7000-8000-000000002776';
select pg_temp.act('team', '00000000-0000-7000-8000-0000000027a7');
select pg_temp.expect_equal('removed after the report: the words there when it was reported are kept for the team', (
  select body from reported_conversation_for_team('00000000-0000-7000-8000-000000002781')
  where message_id = '00000000-0000-7000-8000-000000002775'), 'Pay by gift card');
select pg_temp.expect_equal('…but not anything written after the report', (
  select '"' || body || '"' from reported_conversation_for_team('00000000-0000-7000-8000-000000002781')
  where message_id = '00000000-0000-7000-8000-000000002776'), '""');

rollback;
