-- =============================================================================
-- Checks for migration 0042: the team suspends an account.
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

-- a1: an admin. a2: another admin. a3: a person. a4: another person. a5: a deleted account.
insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000042a1', 'Ann Admin', 'ann-42@example.com'),
  ('00000000-0000-7000-8000-0000000042a2', 'Al Admin', 'al-42@example.com'),
  ('00000000-0000-7000-8000-0000000042a3', 'Bo Person', 'bo-42@example.com'),
  ('00000000-0000-7000-8000-0000000042a4', 'Cy Person', 'cy-42@example.com');
insert into app_user (id, display_name, email, deleted_at) values
  ('00000000-0000-7000-8000-0000000042a5', 'Gone', 'gone-42@example.com', now());
insert into platform_role (user_id, role) values
  ('00000000-0000-7000-8000-0000000042a1', 'admin'), ('00000000-0000-7000-8000-0000000042a2', 'admin');

set local role app_server;

-- The server reads suspensions but never writes them itself.
select pg_temp.act('team', '00000000-0000-7000-8000-0000000042a1');
select pg_temp.expect_code('the app can''t insert a suspension directly', $q$
  insert into account_suspension (user_id, reason, suspended_by)
  values ('00000000-0000-7000-8000-0000000042a3', 'x', '00000000-0000-7000-8000-0000000042a1')$q$, '42501');

-- Not the team: refused.
select pg_temp.act('person', '00000000-0000-7000-8000-0000000042a4');
select pg_temp.expect_code('a person can''t suspend someone', $q$
  select suspend_account('00000000-0000-7000-8000-0000000042a3', 'spam')$q$, 'LP101');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000042a4');
select pg_temp.expect_code('a business can''t suspend someone', $q$
  select suspend_account('00000000-0000-7000-8000-0000000042a3', 'spam')$q$, 'LP101');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000042a4');
select pg_temp.expect_code('someone claiming the team side without the role can''t', $q$
  select suspend_account('00000000-0000-7000-8000-0000000042a3', 'spam')$q$, 'LP101');

-- The team: the rules.
select pg_temp.act('team', '00000000-0000-7000-8000-0000000042a1');
select pg_temp.expect_code('a reason is needed', $q$
  select suspend_account('00000000-0000-7000-8000-0000000042a3', '  ')$q$, 'LP166');
select pg_temp.expect_code('not yourself', $q$
  select suspend_account('00000000-0000-7000-8000-0000000042a1', 'test')$q$, 'LP177');
select pg_temp.expect_code('not a deleted account', $q$
  select suspend_account('00000000-0000-7000-8000-0000000042a5', 'test')$q$, 'LP178');
select pg_temp.expect_code('not another team member (remove their role first)', $q$
  select suspend_account('00000000-0000-7000-8000-0000000042a2', 'test')$q$, 'LP179');
select suspend_account('00000000-0000-7000-8000-0000000042a3', 'Spam messages');
select pg_temp.expect_equal('the team suspends a person: recorded with who and why',
  (select reason || ' by ' || suspended_by from account_suspension where user_id = '00000000-0000-7000-8000-0000000042a3'),
  'Spam messages by 00000000-0000-7000-8000-0000000042a1');
select pg_temp.expect_equal('…and written to the audit log',
  (select count(*)::text from audit_log where action = 'account.suspend' and subject_id = '00000000-0000-7000-8000-0000000042a3'), '1');
select pg_temp.expect_code('not twice', $q$
  select suspend_account('00000000-0000-7000-8000-0000000042a3', 'again')$q$, 'LP180');

-- Lifting.
select pg_temp.act('person', '00000000-0000-7000-8000-0000000042a3');
select pg_temp.expect_code('the suspended person can''t lift it', $q$
  select lift_suspension('00000000-0000-7000-8000-0000000042a3', 'please')$q$, 'LP101');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000042a2');
select lift_suspension('00000000-0000-7000-8000-0000000042a3', 'Apologised');
select pg_temp.expect_equal('another admin lifts it; recorded',
  (select count(*)::text from account_suspension where user_id = '00000000-0000-7000-8000-0000000042a3') || ' '
  || (select count(*)::text from audit_log where action = 'account.unsuspend' and subject_id = '00000000-0000-7000-8000-0000000042a3'), '0 1');
select pg_temp.expect_code('lifting one that isn''t suspended is refused', $q$
  select lift_suspension('00000000-0000-7000-8000-0000000042a3', 'again')$q$, 'LP181');
reset role;

-- Deleting the account takes the suspension with it.
set local role app_server;
select pg_temp.act('team', '00000000-0000-7000-8000-0000000042a1');
select suspend_account('00000000-0000-7000-8000-0000000042a4', 'Abuse');
reset role;
update app_user set deleted_at = now() where id = '00000000-0000-7000-8000-0000000042a4';
select pg_temp.expect_equal('a deleted account''s suspension goes with it',
  (select count(*)::text from account_suspension where user_id = '00000000-0000-7000-8000-0000000042a4'), '0');

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end $$;
set local role anon;
select pg_temp.expect_code('the browser-facing role can''t read suspensions', $q$
  select count(*) from account_suspension$q$, '42501');
select pg_temp.expect_code('…or suspend anyone', $q$
  select suspend_account('00000000-0000-7000-8000-0000000042a3', 'x')$q$, '42501');
reset role;

rollback;
