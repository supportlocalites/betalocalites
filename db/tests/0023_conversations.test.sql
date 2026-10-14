-- =============================================================================
-- Checks for migration 0023: messages between people and businesses (Stage 2B, part 1).
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

-- People A and B; business V (claimed) with owner O, manager G and staff S; business W
-- (claimed, owner P); business U (not on Localites); M on the Localites team.
insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000022a1', 'Person A', 'a-22@example.com'),
  ('00000000-0000-7000-8000-0000000022a2', 'Person B', 'b-22@example.com'),
  ('00000000-0000-7000-8000-0000000022a3', 'Owner O', 'o-22@example.com'),
  ('00000000-0000-7000-8000-0000000022a4', 'Manager G', 'g-22@example.com'),
  ('00000000-0000-7000-8000-0000000022a5', 'Staff S', 's-22@example.com'),
  ('00000000-0000-7000-8000-0000000022a6', 'Owner P', 'p-22@example.com'),
  ('00000000-0000-7000-8000-0000000022a7', 'Team M', 'm-22@example.com');
insert into platform_role (user_id, role) values ('00000000-0000-7000-8000-0000000022a7', 'admin');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000022b1', 'test-town-22', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000022c1', 'test-22-v', 'Twenty-two V', '00000000-0000-7000-8000-0000000022b1', 'admin_entered', 'published', 'claimed', now()),
  ('00000000-0000-7000-8000-0000000022c2', 'test-22-w', 'Twenty-two W', '00000000-0000-7000-8000-0000000022b1', 'admin_entered', 'published', 'claimed', now()),
  ('00000000-0000-7000-8000-0000000022c3', 'test-22-u', 'Twenty-two U', '00000000-0000-7000-8000-0000000022b1', 'admin_entered', 'published', 'unclaimed', now());
insert into vendor_member (vendor_id, user_id, role) values
  ('00000000-0000-7000-8000-0000000022c1', '00000000-0000-7000-8000-0000000022a3', 'owner'),
  ('00000000-0000-7000-8000-0000000022c1', '00000000-0000-7000-8000-0000000022a4', 'manager'),
  ('00000000-0000-7000-8000-0000000022c1', '00000000-0000-7000-8000-0000000022a5', 'staff'),
  ('00000000-0000-7000-8000-0000000022c2', '00000000-0000-7000-8000-0000000022a6', 'owner');
insert into event (id, host_user_id, event_date, municipality_id) values
  ('00000000-0000-7000-8000-0000000022f1', '00000000-0000-7000-8000-0000000022a1', current_date + 30, '00000000-0000-7000-8000-0000000022b1'),
  ('00000000-0000-7000-8000-0000000022f2', '00000000-0000-7000-8000-0000000022a2', current_date + 30, '00000000-0000-7000-8000-0000000022b1');
insert into event_private (event_id, host_user_id, title) values
  ('00000000-0000-7000-8000-0000000022f1', '00000000-0000-7000-8000-0000000022a1', 'A''s party'),
  ('00000000-0000-7000-8000-0000000022f2', '00000000-0000-7000-8000-0000000022a2', 'B''s party');

set local role app_server;

-- ---------------------------------------------------------------- starting
select pg_temp.act('person', '00000000-0000-7000-8000-0000000022a1');
insert into conversation (id, consumer_user_id, vendor_id, event_id) values
  ('00000000-0000-7000-8000-000000002261', '00000000-0000-7000-8000-0000000022a1', '00000000-0000-7000-8000-0000000022c1',
   '00000000-0000-7000-8000-0000000022f1');
select pg_temp.expect_equal('a person starts a conversation with a business that has joined, about their own event',
  (select status from conversation where id = '00000000-0000-7000-8000-000000002261'), 'open');
select pg_temp.expect_code('one conversation per person and business', $q$
  insert into conversation (consumer_user_id, vendor_id) values ('00000000-0000-7000-8000-0000000022a1', '00000000-0000-7000-8000-0000000022c1')$q$, '23505');
select pg_temp.expect_code('not with a business that hasn''t joined', $q$
  insert into conversation (consumer_user_id, vendor_id) values ('00000000-0000-7000-8000-0000000022a1', '00000000-0000-7000-8000-0000000022c3')$q$, 'LP140');
select pg_temp.expect_code('not in someone else''s name', $q$
  insert into conversation (consumer_user_id, vendor_id) values ('00000000-0000-7000-8000-0000000022a2', '00000000-0000-7000-8000-0000000022c2')$q$, 'LP101');
select pg_temp.expect_code('not about someone else''s event', $q$
  insert into conversation (consumer_user_id, vendor_id, event_id) values ('00000000-0000-7000-8000-0000000022a1',
  '00000000-0000-7000-8000-0000000022c2', '00000000-0000-7000-8000-0000000022f2')$q$, 'LP101');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000022a3');
select pg_temp.expect_code('not with your own business', $q$
  insert into conversation (consumer_user_id, vendor_id) values ('00000000-0000-7000-8000-0000000022a3', '00000000-0000-7000-8000-0000000022c1')$q$, 'LP108');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000022a3', '00000000-0000-7000-8000-0000000022c1');
select pg_temp.expect_code('a business can''t start a conversation', $q$
  insert into conversation (consumer_user_id, vendor_id) values ('00000000-0000-7000-8000-0000000022a2', '00000000-0000-7000-8000-0000000022c1')$q$, 'LP142');

-- ---------------------------------------------------------------- writing
select pg_temp.expect_code('the business can''t write first', $q$
  insert into message (conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002261', '00000000-0000-7000-8000-0000000022a3', 'vendor', 'Hello!')$q$, 'LP142');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000022a1');
insert into message (id, conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002271', '00000000-0000-7000-8000-000000002261', '00000000-0000-7000-8000-0000000022a1',
   'consumer', 'Do you have Saturday the 14th free?');
select pg_temp.expect_equal('the person writes; the database records the time on the conversation',
  (select (last_message_at is not null)::text from conversation where id = '00000000-0000-7000-8000-000000002261'), 'true');
select pg_temp.expect_code('an empty message is refused', $q$
  insert into message (conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002261', '00000000-0000-7000-8000-0000000022a1', 'consumer', '   ')$q$, '23514');
select pg_temp.expect_code('the person can''t write as the business', $q$
  insert into message (conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002261', '00000000-0000-7000-8000-0000000022a1', 'vendor', 'x')$q$, 'LP101');
select pg_temp.expect_code('…or change the time of the last message', $q$
  update conversation set last_message_at = now() - interval '1 year' where id = '00000000-0000-7000-8000-000000002261'$q$, '42501');

-- Staff reply; another business and another person see nothing.
select pg_temp.act('business', '00000000-0000-7000-8000-0000000022a5', '00000000-0000-7000-8000-0000000022c1');
insert into message (id, conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002272', '00000000-0000-7000-8000-000000002261', '00000000-0000-7000-8000-0000000022a5',
   'vendor', 'Yes, we''re free that day.');
select pg_temp.expect_equal('staff read the conversation and reply for the business',
  (select count(*)::text from message where conversation_id = '00000000-0000-7000-8000-000000002261'), '2');
select pg_temp.expect_code('staff can''t write in another person''s name', $q$
  insert into message (conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002261', '00000000-0000-7000-8000-0000000022a4', 'vendor', 'x')$q$, 'LP101');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000022a6', '00000000-0000-7000-8000-0000000022c2');
select pg_temp.expect_equal('another business sees nothing', (
  select count(*)::text || '/' || (select count(*) from message)::text from conversation), '0/0');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000022a6', '00000000-0000-7000-8000-0000000022c1');
select pg_temp.expect_equal('someone not on the business''s team, claiming to act for it, sees nothing', (
  select count(*)::text from conversation), '0');
select pg_temp.expect_code('…and can''t write', $q$
  insert into message (conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002261', '00000000-0000-7000-8000-0000000022a6', 'vendor', 'x')$q$, 'LP101');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000022a2');
select pg_temp.expect_equal('another person sees nothing', (
  select count(*)::text || '/' || (select count(*) from message)::text from conversation), '0/0');
select pg_temp.expect_code('…and can''t write in it', $q$
  insert into message (conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002261', '00000000-0000-7000-8000-0000000022a2', 'consumer', 'x')$q$, 'LP101');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000022a7');
select pg_temp.expect_equal('the Localites team sees nothing (only through a report, next part)', (
  select count(*)::text || '/' || (select count(*) from message)::text from conversation), '0/0');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000022a1', '00000000-0000-7000-8000-0000000022c1');
select pg_temp.expect_equal('the person, pretending to be on the business''s team, sees nothing that way', (
  select count(*)::text from conversation), '0');

-- ---------------------------------------------------------------- the event, as the business sees it
select pg_temp.act('business', '00000000-0000-7000-8000-0000000022a5', '00000000-0000-7000-8000-0000000022c1');
select pg_temp.expect_equal('the business sees only the date, town, guests and whether it''s cancelled (D-40)', (
  select (event_date = current_date + 30)::text || ' ' || town || ' ' || coalesce(guests::text, 'none') || ' ' || cancelled::text
  from conversation_event_for_business('00000000-0000-7000-8000-000000002261')), 'true Test Town none false');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000022a6', '00000000-0000-7000-8000-0000000022c2');
select pg_temp.expect_equal('…another business sees nothing of it', (
  select count(*)::text from conversation_event_for_business('00000000-0000-7000-8000-000000002261')), '0');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000022a2');
select pg_temp.expect_equal('…nor does another person', (
  select count(*)::text from conversation_event_for_business('00000000-0000-7000-8000-000000002261')), '0');

-- ---------------------------------------------------------------- messages are never rewritten
select pg_temp.act('person', '00000000-0000-7000-8000-0000000022a1');
select pg_temp.expect_code('a message can''t be rewritten', $q$
  update message set body = 'changed' where id = '00000000-0000-7000-8000-000000002271'$q$, '42501');
select pg_temp.expect_code('…or removed by anyone but its author', $q$
  update message set removed_at = now() where id = '00000000-0000-7000-8000-000000002272'$q$, 'LP101');
update message set removed_at = now() where id = '00000000-0000-7000-8000-000000002271';
select pg_temp.expect_equal('the author removes it: blanked, and it shows it was there', (
  select '"' || body || '" ' || (removed_at is not null)::text from message where id = '00000000-0000-7000-8000-000000002271'), '"" true');

-- ---------------------------------------------------------------- unread positions
insert into conversation_read (conversation_id, user_id) values
  ('00000000-0000-7000-8000-000000002261', '00000000-0000-7000-8000-0000000022a1');
select pg_temp.expect_code('only your own place', $q$
  insert into conversation_read (conversation_id, user_id) values
  ('00000000-0000-7000-8000-000000002261', '00000000-0000-7000-8000-0000000022a3')$q$, 'LP101');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000022a2');
select pg_temp.expect_code('not in a conversation that isn''t yours', $q$
  insert into conversation_read (conversation_id, user_id) values
  ('00000000-0000-7000-8000-000000002261', '00000000-0000-7000-8000-0000000022a2')$q$, 'LP101');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000022a3', '00000000-0000-7000-8000-0000000022c1');
insert into conversation_read (conversation_id, user_id) values
  ('00000000-0000-7000-8000-000000002261', '00000000-0000-7000-8000-0000000022a3');
select pg_temp.expect_equal('each sees only their own place, never the other side''s (no read receipts)', (
  select string_agg(user_id::text, ',') from conversation_read), '00000000-0000-7000-8000-0000000022a3');

-- ---------------------------------------------------------------- emails about new messages
select pg_temp.act('person', '00000000-0000-7000-8000-0000000022a1');
insert into message (id, conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002273', '00000000-0000-7000-8000-000000002261', '00000000-0000-7000-8000-0000000022a1',
   'consumer', 'Great, how much for 30 people?');
select pg_temp.expect_equal('a person''s message: each member of the business''s team is emailed', (
  select string_agg(email, ',' order by email) from new_message_notices('00000000-0000-7000-8000-000000002273')),
  'g-22@example.com,o-22@example.com,s-22@example.com');
insert into message (id, conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002274', '00000000-0000-7000-8000-000000002261', '00000000-0000-7000-8000-0000000022a1',
   'consumer', 'And do you deliver?');
select pg_temp.expect_equal('…but not again until they''ve read it', (
  select count(*)::text from new_message_notices('00000000-0000-7000-8000-000000002274')), '0');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000022a2');
select pg_temp.expect_code('only the author asks who to email', $q$
  select * from new_message_notices('00000000-0000-7000-8000-000000002274')$q$, 'LP101');

-- ---------------------------------------------------------------- blocking
select pg_temp.act('business', '00000000-0000-7000-8000-0000000022a5', '00000000-0000-7000-8000-0000000022c1');
update conversation set status = 'blocked_by_vendor' where id = '00000000-0000-7000-8000-000000002261';
select pg_temp.expect_equal('staff can''t block (owners and managers do)', (
  select status from conversation where id = '00000000-0000-7000-8000-000000002261'), 'open');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000022a4', '00000000-0000-7000-8000-0000000022c1');
update conversation set status = 'blocked_by_vendor' where id = '00000000-0000-7000-8000-000000002261';
select pg_temp.expect_equal('a manager blocks; the database records who and when', (
  select status || ' ' || (blocked_by = '00000000-0000-7000-8000-0000000022a4')::text || ' ' || (blocked_at is not null)::text
  from conversation where id = '00000000-0000-7000-8000-000000002261'), 'blocked_by_vendor true true');
select pg_temp.expect_code('the business can''t change the event', $q$
  update conversation set event_id = null where id = '00000000-0000-7000-8000-000000002261'$q$, 'LP100');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000022a1');
select pg_temp.expect_code('blocked: the person can''t write', $q$
  insert into message (conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002261', '00000000-0000-7000-8000-0000000022a1', 'consumer', 'Hello?')$q$, 'LP143');
select pg_temp.expect_code('…or undo the business''s block', $q$
  update conversation set status = 'open' where id = '00000000-0000-7000-8000-000000002261'$q$, 'LP109');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000022a3', '00000000-0000-7000-8000-0000000022c1');
select pg_temp.expect_code('blocked: the business can''t write either', $q$
  insert into message (conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002261', '00000000-0000-7000-8000-0000000022a3', 'vendor', 'x')$q$, 'LP143');
update conversation set status = 'open' where id = '00000000-0000-7000-8000-000000002261';
select pg_temp.act('person', '00000000-0000-7000-8000-0000000022a1');
update conversation set status = 'blocked_by_consumer' where id = '00000000-0000-7000-8000-000000002261';
update conversation set status = 'open', event_id = null where id = '00000000-0000-7000-8000-000000002261';
select pg_temp.expect_equal('the owner unblocks; the person blocks and unblocks, and changes the event', (
  select status || ' ' || coalesce(event_id::text, 'none') from conversation where id = '00000000-0000-7000-8000-000000002261'), 'open none');

-- ---------------------------------------------------------------- leaving
reset role;
update vendor_member set ended_at = now() where user_id = '00000000-0000-7000-8000-0000000022a5';
set local role app_server;
select pg_temp.act('business', '00000000-0000-7000-8000-0000000022a5', '00000000-0000-7000-8000-0000000022c1');
select pg_temp.expect_equal('someone who leaves the team loses access at once', (select count(*)::text from conversation), '0');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000022a1');
select pg_temp.expect_equal('…their past messages stay, attributed to the business', (
  select author_side from message where id = '00000000-0000-7000-8000-000000002272'), 'vendor');
reset role;
update vendor set listing_status = 'archived', archived_at = now() where id = '00000000-0000-7000-8000-0000000022c1';
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000022a1');
select pg_temp.expect_equal('a business that leaves: the person keeps their copy', (select count(*)::text from message), '4');
select pg_temp.expect_code('…but can''t send', $q$
  insert into message (conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-000000002261', '00000000-0000-7000-8000-0000000022a1', 'consumer', 'Hello?')$q$, 'LP140');

reset role;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;
set local role anon;
do $$
begin
  perform 1 from message;
  raise exception 'FAIL  the browser-facing role can read messages';
exception when insufficient_privilege then
  raise notice 'PASS  the browser-facing role can''t read messages';
end $$;

rollback;
