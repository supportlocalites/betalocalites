-- =============================================================================
-- Checks for migration 0025: messages, after review (Stage 2B).
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

-- People A, B and C; business V (claimed, owner O, later owner N); business W (claimed,
-- owner P, manager Q).
insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000025a1', 'Person A', 'a-25@example.com'),
  ('00000000-0000-7000-8000-0000000025a2', 'Person B', 'b-25@example.com'),
  ('00000000-0000-7000-8000-0000000025a3', 'Owner O', 'o-25@example.com'),
  ('00000000-0000-7000-8000-0000000025a4', 'New owner N', 'n-25@example.com'),
  ('00000000-0000-7000-8000-0000000025a5', 'Owner P', 'p-25@example.com'),
  ('00000000-0000-7000-8000-0000000025a6', 'Manager Q', 'q-25@example.com'),
  ('00000000-0000-7000-8000-0000000025a7', 'Person C', 'c-25@example.com');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000025b1', 'test-town-25', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000025c1', 'test-25-v', 'Twenty-five V', '00000000-0000-7000-8000-0000000025b1', 'admin_entered', 'published', 'claimed', now()),
  ('00000000-0000-7000-8000-0000000025c2', 'test-25-w', 'Twenty-five W', '00000000-0000-7000-8000-0000000025b1', 'admin_entered', 'published', 'claimed', now());
insert into vendor_member (vendor_id, user_id, role) values
  ('00000000-0000-7000-8000-0000000025c1', '00000000-0000-7000-8000-0000000025a3', 'owner'),
  ('00000000-0000-7000-8000-0000000025c2', '00000000-0000-7000-8000-0000000025a5', 'owner'),
  ('00000000-0000-7000-8000-0000000025c2', '00000000-0000-7000-8000-0000000025a6', 'manager');
insert into event (id, host_user_id, event_date, municipality_id) values
  ('00000000-0000-7000-8000-0000000025f1', '00000000-0000-7000-8000-0000000025a1', current_date + 30, '00000000-0000-7000-8000-0000000025b1');

set local role app_server;

-- A writes to V about their event; O replies.
select pg_temp.act('person', '00000000-0000-7000-8000-0000000025a1');
insert into conversation (id, consumer_user_id, vendor_id, event_id) values
  ('00000000-0000-7000-8000-000000002561', '00000000-0000-7000-8000-0000000025a1', '00000000-0000-7000-8000-0000000025c1',
   '00000000-0000-7000-8000-0000000025f1');
insert into message (id, conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002571', '00000000-0000-7000-8000-000000002561', '00000000-0000-7000-8000-0000000025a1',
   'consumer', 'My phone is 555-0100');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000025a3', '00000000-0000-7000-8000-0000000025c1');
insert into message (id, conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002572', '00000000-0000-7000-8000-000000002561', '00000000-0000-7000-8000-0000000025a3',
   'vendor', 'Thanks, we''ll call');

-- ---------------------------------------------------------------- times
select pg_temp.expect_equal('a message''s time is when it was written, not when the step began', (
  select ((select created_at from message where id = '00000000-0000-7000-8000-000000002572')
          > (select created_at from message where id = '00000000-0000-7000-8000-000000002571'))::text), 'true');
insert into conversation_read (conversation_id, user_id) values
  ('00000000-0000-7000-8000-000000002561', '00000000-0000-7000-8000-0000000025a3');
select pg_temp.expect_equal('"read up to" is when it''s marked, after the messages shown', (
  select (last_read_at >= (select max(created_at) from message))::text from conversation_read), 'true');
reset role;
insert into message (conversation_id, author_user_id, author_side, body, created_at) values
  ('00000000-0000-7000-8000-000000002561', '00000000-0000-7000-8000-0000000025a1', 'consumer', 'Older', now() - interval '1 day');
select pg_temp.expect_equal('the last-message time never goes backwards', (
  select (last_message_at = (select created_at from message where id = '00000000-0000-7000-8000-000000002572'))::text
  from conversation where id = '00000000-0000-7000-8000-000000002561'), 'true');
delete from message where body = 'Older';

-- ---------------------------------------------------------------- a new owner sees none of the last team's
-- The team removes O (Remove owner): the team ends and V is unclaimed again.
update vendor_member set ended_at = now() where user_id = '00000000-0000-7000-8000-0000000025a3';
update vendor set claim_status = 'unclaimed' where id = '00000000-0000-7000-8000-0000000025c1';
select pg_temp.expect_equal('the business''s team ends: its conversations end', (
  select ended_reason from conversation where id = '00000000-0000-7000-8000-000000002561'), 'business_left');
-- Later, N's claim is approved.
insert into vendor_member (vendor_id, user_id, role) values
  ('00000000-0000-7000-8000-0000000025c1', '00000000-0000-7000-8000-0000000025a4', 'owner');
update vendor set claim_status = 'claimed' where id = '00000000-0000-7000-8000-0000000025c1';
set local role app_server;
select pg_temp.act('business', '00000000-0000-7000-8000-0000000025a4', '00000000-0000-7000-8000-0000000025c1');
select pg_temp.expect_equal('the new owner sees none of the earlier conversations', (select count(*)::text from conversation), '0');
select pg_temp.expect_equal('…nor their messages', (select count(*)::text from message), '0');
select pg_temp.expect_equal('…nor the event summary', (
  select count(*)::text from conversation_event_for_business('00000000-0000-7000-8000-000000002561')), '0');
select pg_temp.expect_code('…and can''t write in one', $q$
  insert into message (conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002561', '00000000-0000-7000-8000-0000000025a4', 'vendor', 'Hello')$q$, 'LP101');
select pg_temp.expect_code('…nor mark one read', $q$
  insert into conversation_read (conversation_id, user_id) values
  ('00000000-0000-7000-8000-000000002561', '00000000-0000-7000-8000-0000000025a4')$q$, 'LP101');
select pg_temp.expect_code('…nor report one', $q$
  insert into moderation_report (reporter_user_id, reporter_side, conversation_id, reason) values
  ('00000000-0000-7000-8000-0000000025a4', 'vendor', '00000000-0000-7000-8000-000000002561', 'spam')$q$, 'LP101');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000025a1');
select pg_temp.expect_equal('the person keeps their copy', (select count(*)::text from message), '2');
select pg_temp.expect_code('…but can''t write in it', $q$
  insert into message (conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002561', '00000000-0000-7000-8000-0000000025a1', 'consumer', 'Hello?')$q$, 'LP140');
select pg_temp.expect_code('…or change it (in the person''s own words since 0026)', $q$
  update conversation set status = 'blocked_by_consumer' where id = '00000000-0000-7000-8000-000000002561'$q$, 'LP140');
update message set removed_at = now() where id = '00000000-0000-7000-8000-000000002571';
select pg_temp.expect_equal('…though they can still remove their own message from it', (
  select (removed_at is not null)::text from message where id = '00000000-0000-7000-8000-000000002571'), 'true');
insert into conversation (id, consumer_user_id, vendor_id) values
  ('00000000-0000-7000-8000-000000002562', '00000000-0000-7000-8000-0000000025a1', '00000000-0000-7000-8000-0000000025c1');
select pg_temp.expect_equal('the person can start a new conversation with the business under its new team', (
  select count(*)::text from conversation where ended_at is null), '1');
select pg_temp.expect_code('…still only one current one', $q$
  insert into conversation (consumer_user_id, vendor_id) values
  ('00000000-0000-7000-8000-0000000025a1', '00000000-0000-7000-8000-0000000025c1')$q$, '23505');
insert into message (conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002562', '00000000-0000-7000-8000-0000000025a1', 'consumer', 'Hello again');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000025a4', '00000000-0000-7000-8000-0000000025c1');
select pg_temp.expect_equal('the new team sees the new one', (select string_agg(id::text, ',') from conversation),
  '00000000-0000-7000-8000-000000002562');

-- Belt and braces: a business whose last owner leaves, its claim status untouched.
reset role;
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000025c3', 'test-25-x', 'Twenty-five X', '00000000-0000-7000-8000-0000000025b1', 'admin_entered', 'published', 'claimed', now());
insert into vendor_member (vendor_id, user_id, role) values
  ('00000000-0000-7000-8000-0000000025c3', '00000000-0000-7000-8000-0000000025a3', 'owner');
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000025a7');
insert into conversation (id, consumer_user_id, vendor_id) values
  ('00000000-0000-7000-8000-000000002564', '00000000-0000-7000-8000-0000000025a7', '00000000-0000-7000-8000-0000000025c3');
reset role;
update vendor_member set ended_at = now() where vendor_id = '00000000-0000-7000-8000-0000000025c3';
select pg_temp.expect_equal('the last owner leaves: its conversations end, whatever the claim status says', (
  select ended_reason from conversation where id = '00000000-0000-7000-8000-000000002564'), 'business_left');
set local role app_server;

-- ---------------------------------------------------------------- a business that isn't listed
select pg_temp.act('person', '00000000-0000-7000-8000-0000000025a2');
insert into conversation (id, consumer_user_id, vendor_id) values
  ('00000000-0000-7000-8000-000000002563', '00000000-0000-7000-8000-0000000025a2', '00000000-0000-7000-8000-0000000025c2');
insert into message (conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002563', '00000000-0000-7000-8000-0000000025a2', 'consumer', 'Hi W');
reset role;
update vendor set listing_status = 'unpublished' where id = '00000000-0000-7000-8000-0000000025c2';
set local role app_server;
select pg_temp.expect_code('taken down: the person can''t write to it', $q$
  insert into message (conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002563', '00000000-0000-7000-8000-0000000025a2', 'consumer', 'Hello?')$q$, 'LP144');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000025a6', '00000000-0000-7000-8000-0000000025c2');
select pg_temp.expect_code('…nor its team to the person', $q$
  insert into message (conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002563', '00000000-0000-7000-8000-0000000025a6', 'vendor', 'Hello')$q$, 'LP145');
select pg_temp.expect_equal('…both still read it', (select count(*)::text from message), '1');
reset role;
update vendor set listing_status = 'published' where id = '00000000-0000-7000-8000-0000000025c2';
set local role app_server;
insert into message (conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002563', '00000000-0000-7000-8000-0000000025a6', 'vendor', 'Hello B');
select pg_temp.expect_equal('listed again: messages flow again', (select count(*)::text from message), '2');

-- ---------------------------------------------------------------- your own conversation, from the business's side
-- B joins W's team (as staff): B's own conversation with W isn't theirs to read or answer as W.
reset role;
insert into vendor_member (vendor_id, user_id, role) values
  ('00000000-0000-7000-8000-0000000025c2', '00000000-0000-7000-8000-0000000025a2', 'staff');
set local role app_server;
select pg_temp.act('business', '00000000-0000-7000-8000-0000000025a2', '00000000-0000-7000-8000-0000000025c2');
select pg_temp.expect_equal('someone who joins a business''s team doesn''t see their own conversation from its side', (
  select count(*)::text from conversation), '0');
select pg_temp.expect_code('…nor reply to themselves as the business', $q$
  insert into message (conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002563', '00000000-0000-7000-8000-0000000025a2', 'vendor', 'Yes, me')$q$, 'LP101');
reset role;
update vendor_member set ended_at = now() where user_id = '00000000-0000-7000-8000-0000000025a2';
set local role app_server;

-- ---------------------------------------------------------------- emails about new messages
-- The person writes; P has read the conversation since (they had it open), Q hasn't.
reset role;
insert into conversation_read (conversation_id, user_id, last_read_at) values
  ('00000000-0000-7000-8000-000000002563', '00000000-0000-7000-8000-0000000025a6', now() - interval '1 hour');
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000025a2');
insert into message (id, conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002573', '00000000-0000-7000-8000-000000002563', '00000000-0000-7000-8000-0000000025a2',
   'consumer', 'Are you free in May?');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000025a5', '00000000-0000-7000-8000-0000000025c2');
insert into conversation_read (conversation_id, user_id) values
  ('00000000-0000-7000-8000-000000002563', '00000000-0000-7000-8000-0000000025a5');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000025a2');
select pg_temp.expect_equal('nobody who has already seen the message is emailed about it', (
  select string_agg(email, ',') from new_message_notices('00000000-0000-7000-8000-000000002573')), 'q-25@example.com');
-- The site has sent 30 message emails today: the rest are held back, and recorded as such.
reset role;
update notification set status = 'sent', sent_at = now() where status = 'queued';
insert into notification (user_id, kind, subject_type, subject_id, status, sent_at)
select '00000000-0000-7000-8000-0000000025a7', 'new_message', 'conversation', gen_random_uuid(), 'sent', now()
from generate_series(1, 30);
update conversation_read set last_read_at = now() - interval '2 hours';
update notification set created_at = now() - interval '3 hours'
where user_id in ('00000000-0000-7000-8000-0000000025a5', '00000000-0000-7000-8000-0000000025a6');
set local role app_server;
insert into message (id, conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002575', '00000000-0000-7000-8000-000000002563', '00000000-0000-7000-8000-0000000025a2',
   'consumer', 'Or July?');
select pg_temp.expect_equal('at most 30 message emails a day across the site', (
  select count(*)::text from new_message_notices('00000000-0000-7000-8000-000000002575')), '0');
reset role;
select pg_temp.expect_equal('…the ones held back are recorded, with why', (
  select string_agg(distinct status || ': ' || failure_reason, ',') from notification
  where subject_id = '00000000-0000-7000-8000-000000002563' and created_at > now() - interval '1 minute'),
  'suppressed: the site''s daily limit for message emails');

-- ---------------------------------------------------------------- a person deletes their account
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000025a2');
select delete_my_account();
reset role;
select pg_temp.expect_equal('their conversations end', (
  select ended_reason from conversation where id = '00000000-0000-7000-8000-000000002563'), 'person_left');
set local role app_server;
select pg_temp.act('business', '00000000-0000-7000-8000-0000000025a5', '00000000-0000-7000-8000-0000000025c2');
select pg_temp.expect_equal('the business keeps its copy, from a former member', (
  select string_agg(distinct u.display_name, ',') from conversation c join app_user u on u.id = c.consumer_user_id),
  'Former Localites member');
select pg_temp.expect_code('…but can''t write to them', $q$
  insert into message (conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002563', '00000000-0000-7000-8000-0000000025a5', 'vendor', 'Hello?')$q$, 'LP146');
select pg_temp.expect_code('…or block it', $q$
  update conversation set status = 'blocked_by_vendor' where id = '00000000-0000-7000-8000-000000002563'$q$, 'LP146');

reset role;
select pg_temp.expect_code('an ended conversation stays ended', $q$
  update conversation set ended_at = null, ended_reason = null where id = '00000000-0000-7000-8000-000000002563'$q$, 'LP100');
set local role app_server;
select pg_temp.expect_code('the site can''t end a conversation itself', $q$
  update conversation set ended_at = now(), ended_reason = 'person_left' where id = '00000000-0000-7000-8000-000000002562'$q$, '42501');

rollback;
