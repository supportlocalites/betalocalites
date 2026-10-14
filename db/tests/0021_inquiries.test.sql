-- =============================================================================
-- Checks for migration 0021: Inquire, for businesses not on Localites yet (ADR-024).
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

-- People A and B ask; O owns business C (claimed); M is the team. U is not on Localites
-- yet; H is hidden; X is O's other business, not yet claimed but O is on its team.
insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000021a1', 'Person A', 'person-a-21@example.com'),
  ('00000000-0000-7000-8000-0000000021a2', 'Person B', 'person-b-21@example.com'),
  ('00000000-0000-7000-8000-0000000021a3', 'Owner O', 'owner-o-21@example.com'),
  ('00000000-0000-7000-8000-0000000021a4', 'Team M', 'team-m-21@example.com');
insert into platform_role (user_id, role) values ('00000000-0000-7000-8000-0000000021a4', 'admin');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000021b1', 'test-town-21', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000021c1', 'test-21-u', 'Twenty-one U', '00000000-0000-7000-8000-0000000021b1', 'admin_entered', 'published', 'unclaimed', now()),
  ('00000000-0000-7000-8000-0000000021c2', 'test-21-c', 'Twenty-one C', '00000000-0000-7000-8000-0000000021b1', 'admin_entered', 'published', 'claimed', now()),
  ('00000000-0000-7000-8000-0000000021c3', 'test-21-h', 'Twenty-one H', '00000000-0000-7000-8000-0000000021b1', 'admin_entered', 'unpublished', 'unclaimed', now()),
  ('00000000-0000-7000-8000-0000000021c4', 'test-21-x', 'Twenty-one X', '00000000-0000-7000-8000-0000000021b1', 'admin_entered', 'published', 'unclaimed', now());
insert into vendor_member (vendor_id, user_id, role) values
  ('00000000-0000-7000-8000-0000000021c2', '00000000-0000-7000-8000-0000000021a3', 'owner'),
  ('00000000-0000-7000-8000-0000000021c4', '00000000-0000-7000-8000-0000000021a3', 'manager');

set local role app_server;

-- A person asks about a business not on Localites yet.
select pg_temp.act('person', '00000000-0000-7000-8000-0000000021a1');
insert into vendor_interest (id, vendor_id, user_id, note, shared_event) values
  ('00000000-0000-7000-8000-000000002161', '00000000-0000-7000-8000-0000000021c1', '00000000-0000-7000-8000-0000000021a1',
   'Do you do gluten-free?', 'Birthday party · Sat 14 Nov 2026 · Test Town · about 15 guests');
select pg_temp.expect_equal('a person can ask about a business not on Localites yet; the email starts as pending', (
  select team_email_status || ' ' || (notified_joined_at is null)::text from vendor_interest
  where id = '00000000-0000-7000-8000-000000002161'), 'pending true');
select pg_temp.expect_code('…once per business', $q$
  insert into vendor_interest (vendor_id, user_id) values ('00000000-0000-7000-8000-0000000021c1', '00000000-0000-7000-8000-0000000021a1')$q$, '23505');
select pg_temp.expect_code('not about a business that''s on Localites (contact it directly)', $q$
  insert into vendor_interest (vendor_id, user_id) values ('00000000-0000-7000-8000-0000000021c2', '00000000-0000-7000-8000-0000000021a1')$q$, 'LP130');
select pg_temp.expect_code('not about a business that isn''t listed', $q$
  insert into vendor_interest (vendor_id, user_id) values ('00000000-0000-7000-8000-0000000021c3', '00000000-0000-7000-8000-0000000021a1')$q$, 'LP107');
select pg_temp.expect_code('not in someone else''s name', $q$
  insert into vendor_interest (vendor_id, user_id) values ('00000000-0000-7000-8000-0000000021c4', '00000000-0000-7000-8000-0000000021a2')$q$, 'LP101');
select pg_temp.expect_code('the database sets the times and the "told it joined" mark', $q$
  insert into vendor_interest (vendor_id, user_id, notified_joined_at) values
  ('00000000-0000-7000-8000-0000000021c4', '00000000-0000-7000-8000-0000000021a1', now())$q$, '42501');

-- The team email's outcome, and changing what was sent.
select pg_temp.expect_code('what was sent can''t be changed while the email is pending or sent', $q$
  update vendor_interest set note = 'changed' where id = '00000000-0000-7000-8000-000000002161'$q$, 'LP131');
update vendor_interest set team_email_status = 'failed', team_email_error = 'not set up' where id = '00000000-0000-7000-8000-000000002161';
update vendor_interest set note = 'Sending again', team_email_status = 'pending', team_email_error = null
where id = '00000000-0000-7000-8000-000000002161';
update vendor_interest set team_email_status = 'sent' where id = '00000000-0000-7000-8000-000000002161';
select pg_temp.expect_equal('after a failed email it can be sent again; "sent" gets its time from the database', (
  select note || ' ' || team_email_status || ' ' || (team_email_sent_at is not null)::text from vendor_interest
  where id = '00000000-0000-7000-8000-000000002161'), 'Sending again sent true');
select pg_temp.expect_code('the "told it joined" mark can''t be written', $q$
  update vendor_interest set notified_joined_at = now() where id = '00000000-0000-7000-8000-000000002161'$q$, '42501');

-- A business owner can't ask about a business they're on the team of.
select pg_temp.act('person', '00000000-0000-7000-8000-0000000021a3');
select pg_temp.expect_code('not about your own business', $q$
  insert into vendor_interest (vendor_id, user_id) values ('00000000-0000-7000-8000-0000000021c4', '00000000-0000-7000-8000-0000000021a3')$q$, 'LP108');

-- B asks too; each sees only their own.
select pg_temp.act('person', '00000000-0000-7000-8000-0000000021a2');
insert into vendor_interest (id, vendor_id, user_id) values
  ('00000000-0000-7000-8000-000000002162', '00000000-0000-7000-8000-0000000021c1', '00000000-0000-7000-8000-0000000021a2');
select pg_temp.expect_equal('another person sees only their own', (select count(*)::text from vendor_interest), '1');
update vendor_interest set team_email_status = 'failed', team_email_error = 'x' where id = '00000000-0000-7000-8000-000000002161';
select pg_temp.act('team', '00000000-0000-7000-8000-0000000021a4');
select pg_temp.expect_equal('…and can''t change someone else''s (read back as the team)', (
  select team_email_status from vendor_interest where id = '00000000-0000-7000-8000-000000002161'), 'sent');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000021a2');

-- The business itself and the team.
select pg_temp.act('business', '00000000-0000-7000-8000-0000000021a3', '00000000-0000-7000-8000-0000000021c2');
select pg_temp.expect_equal('a business sees no inquiries', (select count(*)::text from vendor_interest), '0');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000021a4');
select pg_temp.expect_equal('the team sees every inquiry', (select count(*)::text from vendor_interest), '2');
select pg_temp.expect_code('the team can''t write one', $q$
  insert into vendor_interest (vendor_id, user_id) values ('00000000-0000-7000-8000-0000000021c4', '00000000-0000-7000-8000-0000000021a4')$q$, 'LP101');
update vendor_interest set team_email_status = 'sent' where id = '00000000-0000-7000-8000-000000002162';
select pg_temp.expect_equal('…or change one', (
  select team_email_status from vendor_interest where id = '00000000-0000-7000-8000-000000002162'), 'pending');

-- When the business joins.
select pg_temp.act('person', '00000000-0000-7000-8000-0000000021a1');
select pg_temp.expect_code('only the team marks people as told the business joined', $q$
  select * from take_joined_notices('00000000-0000-7000-8000-0000000021c1')$q$, 'LP101');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000021a4');
select pg_temp.expect_equal('nobody is told while the business hasn''t joined',
  (select count(*)::text from take_joined_notices('00000000-0000-7000-8000-0000000021c1')), '0');
reset role;
update vendor set claim_status = 'claimed' where id = '00000000-0000-7000-8000-0000000021c1';
set local role app_server;
select pg_temp.act('team', '00000000-0000-7000-8000-0000000021a4');
select pg_temp.expect_equal('once it joins, everyone who asked, with their email', (
  select string_agg(email, ',' order by email) from take_joined_notices('00000000-0000-7000-8000-0000000021c1')),
  'person-a-21@example.com,person-b-21@example.com');
select pg_temp.expect_equal('…each told once', (
  select count(*)::text from take_joined_notices('00000000-0000-7000-8000-0000000021c1')), '0');

-- Deleting your account deletes your inquiries.
select pg_temp.act('person', '00000000-0000-7000-8000-0000000021a2');
select delete_my_account();
select pg_temp.act('team', '00000000-0000-7000-8000-0000000021a4');
select pg_temp.expect_equal('a deleted account''s inquiries are gone', (
  select count(*)::text from vendor_interest where user_id = '00000000-0000-7000-8000-0000000021a2'), '0');

reset role;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;
set local role anon;
do $$
begin
  perform 1 from vendor_interest;
  raise exception 'FAIL  the browser-facing role can read inquiries';
exception when insufficient_privilege then
  raise notice 'PASS  the browser-facing role can''t read inquiries';
end $$;
do $$
begin
  perform take_joined_notices('00000000-0000-7000-8000-0000000021c1');
  raise exception 'FAIL  the browser-facing role can run take_joined_notices';
exception when insufficient_privilege then
  raise notice 'PASS  the browser-facing role can''t run take_joined_notices';
end $$;

rollback;
