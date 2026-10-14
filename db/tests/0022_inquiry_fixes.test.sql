-- =============================================================================
-- Checks for migration 0022: Inquire, made honest about its emails (review fixes).
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

-- A, B and C ask about U (not on Localites yet); M is the team. C later joins U's team.
insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000220a1', 'Person A', 'a-220@example.com'),
  ('00000000-0000-7000-8000-0000000220a2', 'Person B', 'b-220@example.com'),
  ('00000000-0000-7000-8000-0000000220a3', 'Person C', 'c-220@example.com'),
  ('00000000-0000-7000-8000-0000000220a4', 'Team M', 'm-220@example.com');
insert into platform_role (user_id, role) values ('00000000-0000-7000-8000-0000000220a4', 'admin');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000220b1', 'test-town-220', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000220c1', 'test-220-u', 'Twenty-two-oh U', '00000000-0000-7000-8000-0000000220b1',
   'admin_entered', 'published', 'unclaimed', now());

set local role app_server;

-- ---------------------------------------------------------------- the email's status, step by step
select pg_temp.act('person', '00000000-0000-7000-8000-0000000220a1');
insert into vendor_interest (id, vendor_id, user_id, note) values
  ('00000000-0000-7000-8000-000000022061', '00000000-0000-7000-8000-0000000220c1', '00000000-0000-7000-8000-0000000220a1', 'Hi');
update vendor_interest set team_email_status = 'sent' where id = '00000000-0000-7000-8000-000000022061';
select pg_temp.expect_code('"sent" is final: it can''t become failed', $q$
  update vendor_interest set team_email_status = 'failed', team_email_error = 'x' where id = '00000000-0000-7000-8000-000000022061'$q$, 'LP131');
select pg_temp.expect_code('…or be sent again', $q$
  update vendor_interest set team_email_status = 'pending' where id = '00000000-0000-7000-8000-000000022061'$q$, 'LP131');

select pg_temp.act('person', '00000000-0000-7000-8000-0000000220a2');
insert into vendor_interest (id, vendor_id, user_id, note) values
  ('00000000-0000-7000-8000-000000022062', '00000000-0000-7000-8000-0000000220c1', '00000000-0000-7000-8000-0000000220a2', 'Hello');
select pg_temp.expect_code('a pending email can''t be sent again straight away', $q$
  update vendor_interest set note = 'again', team_email_status = 'pending' where id = '00000000-0000-7000-8000-000000022062'$q$, 'LP131');
select pg_temp.expect_code('the outcome can''t change what was sent', $q$
  update vendor_interest set note = 'changed', team_email_status = 'sent' where id = '00000000-0000-7000-8000-000000022062'$q$, 'LP131');
reset role;
update vendor_interest set updated_at = now() - interval '11 minutes' where id = '00000000-0000-7000-8000-000000022062';
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000220a2');
update vendor_interest set note = 'Again, after 11 minutes', team_email_status = 'pending' where id = '00000000-0000-7000-8000-000000022062';
select pg_temp.expect_equal('after 10 minutes stuck at pending, it can be sent again', (
  select note from vendor_interest where id = '00000000-0000-7000-8000-000000022062'), 'Again, after 11 minutes');
update vendor_interest set team_email_status = 'failed', team_email_error = 'down' where id = '00000000-0000-7000-8000-000000022062';
select pg_temp.expect_code('failed can''t jump straight to sent (it''s sent again first)', $q$
  update vendor_interest set team_email_status = 'sent' where id = '00000000-0000-7000-8000-000000022062'$q$, 'LP131');
update vendor_interest set team_email_status = 'pending' where id = '00000000-0000-7000-8000-000000022062';
update vendor_interest set team_email_status = 'sent' where id = '00000000-0000-7000-8000-000000022062';
select pg_temp.expect_equal('sent: the database sets the time and clears the old error', (
  select (team_email_sent_at is not null)::text || ' ' || coalesce(team_email_error, 'none') from vendor_interest
  where id = '00000000-0000-7000-8000-000000022062'), 'true none');

-- ---------------------------------------------------------------- the site-wide count, and stale emails
select pg_temp.expect_equal('inquiry emails to the team today, across the site', inquiry_emails_today()::text, '2');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000220a3');
insert into vendor_interest (id, vendor_id, user_id) values
  ('00000000-0000-7000-8000-000000022063', '00000000-0000-7000-8000-0000000220c1', '00000000-0000-7000-8000-0000000220a3');
reset role;
update vendor_interest set updated_at = now() - interval '2 hours' where id = '00000000-0000-7000-8000-000000022063';
set local role app_server;
select pg_temp.expect_equal('the nightly run records an email stuck at pending as failed', close_stale_inquiry_emails()::text, '1');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000220a4');
select pg_temp.expect_equal('…with the reason', (
  select team_email_status || ': ' || team_email_error from vendor_interest where id = '00000000-0000-7000-8000-000000022063'),
  'failed: Not known whether it was sent: the sending was interrupted.');

-- ---------------------------------------------------------------- when the business joins
reset role;
update vendor set claim_status = 'claimed' where id = '00000000-0000-7000-8000-0000000220c1';
insert into vendor_member (vendor_id, user_id, role) values
  ('00000000-0000-7000-8000-0000000220c1', '00000000-0000-7000-8000-0000000220a3', 'manager');
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000220a3');
select pg_temp.expect_code('a failed email can''t be sent again once the business has joined', $q$
  update vendor_interest set team_email_status = 'pending' where id = '00000000-0000-7000-8000-000000022063'$q$, 'LP130');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000220a4');
create temp table joined_now as select * from take_joined_notices('00000000-0000-7000-8000-0000000220c1');
select pg_temp.expect_equal('joined: everyone who asked, except its own team, each with a queued email record', (
  select string_agg(t.email || ':' || n.status || ':' || n.kind, ',' order by t.email)
  from joined_now t join notification n on n.id = t.notification_id),
  'a-220@example.com:queued:vendor_joined,b-220@example.com:queued:vendor_joined');
select pg_temp.expect_equal('…each once', (
  select count(*)::text from take_joined_notices('00000000-0000-7000-8000-0000000220c1')), '0');

-- The business stops being claimed: people will be told again if it rejoins.
reset role;
update vendor set claim_status = 'unclaimed' where id = '00000000-0000-7000-8000-0000000220c1';
update vendor set claim_status = 'claimed' where id = '00000000-0000-7000-8000-0000000220c1';
set local role app_server;
select pg_temp.act('team', '00000000-0000-7000-8000-0000000220a4');
select pg_temp.expect_equal('a business that left and rejoined: people are told again', (
  select count(*)::text from take_joined_notices('00000000-0000-7000-8000-0000000220c1')), '2');

reset role;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;
set local role anon;
do $$
begin
  perform inquiry_emails_today();
  raise exception 'FAIL  the browser-facing role can run inquiry_emails_today';
exception when insufficient_privilege then
  raise notice 'PASS  the browser-facing role can''t run the inquiry functions';
end $$;

rollback;
