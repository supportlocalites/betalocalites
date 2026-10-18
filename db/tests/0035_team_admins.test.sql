-- =============================================================================
-- Checks for migration 0035: the team adds and removes admins (X10, Users & roles).
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

-- a1: an admin. a2: a signed-in person. a3: another person. a4: deleted account.
insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000035a1', 'Ann Admin', 'ann-35@example.com'),
  ('00000000-0000-7000-8000-0000000035a2', 'Bo Person', 'bo-35@example.com'),
  ('00000000-0000-7000-8000-0000000035a3', 'Cy Person', 'cy-35@example.com');
insert into app_user (id, display_name, email, deleted_at) values
  ('00000000-0000-7000-8000-0000000035a4', 'Gone', 'gone-35@example.com', now());
insert into platform_role (user_id, role) values ('00000000-0000-7000-8000-0000000035a1', 'admin');

set local role app_server;

-- The app can't write the role table itself any more.
select pg_temp.act('team', '00000000-0000-7000-8000-0000000035a1');
select pg_temp.expect_code('the app can''t insert an admin role directly', $q$
  insert into platform_role (user_id, role) values ('00000000-0000-7000-8000-0000000035a2', 'admin')$q$, '42501');
select pg_temp.expect_code('the app can''t end an admin role directly', $q$
  update platform_role set revoked_at = now()$q$, '42501');

-- Not the team: refused, whatever side.
select pg_temp.act('person', '00000000-0000-7000-8000-0000000035a2');
select pg_temp.expect_code('a person can''t make themselves an admin', $q$
  select grant_team_admin('bo-35@example.com', 'me')$q$, 'LP101');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000035a2');
select pg_temp.expect_code('claiming the team side without the role is refused', $q$
  select grant_team_admin('bo-35@example.com', 'me')$q$, 'LP101');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000035a1');
select pg_temp.expect_code('an admin acting as a person can''t add admins', $q$
  select grant_team_admin('bo-35@example.com', 'help')$q$, 'LP101');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000035a2');
select pg_temp.expect_code('a person can''t remove an admin', $q$
  select revoke_team_admin('00000000-0000-7000-8000-0000000035a1', 'x')$q$, 'LP101');

-- The team adds an admin.
select pg_temp.act('team', '00000000-0000-7000-8000-0000000035a1');
select pg_temp.expect_code('a reason is needed', $q$
  select grant_team_admin('bo-35@example.com', '  ')$q$, 'LP166');
select pg_temp.expect_code('an email with no account is refused', $q$
  select grant_team_admin('nobody-35@example.com', 'help')$q$, 'LP167');
select pg_temp.expect_code('a deleted account is refused', $q$
  select grant_team_admin('gone-35@example.com', 'help')$q$, 'LP167');
select pg_temp.expect_equal('an admin adds Bo (email in any case, spaces trimmed)',
  grant_team_admin('  BO-35@example.com ', 'Helping with claims')::text, '00000000-0000-7000-8000-0000000035a2');
select pg_temp.expect_code('adding Bo twice is refused', $q$
  select grant_team_admin('bo-35@example.com', 'again')$q$, 'LP168');

-- The new admin acts as the team at once.
select pg_temp.act('team', '00000000-0000-7000-8000-0000000035a2');
select pg_temp.expect_equal('Bo now acts as the team', acting_as_team()::text, 'true');

-- Removing.
select pg_temp.expect_code('nobody removes themselves', $q$
  select revoke_team_admin('00000000-0000-7000-8000-0000000035a2', 'leaving')$q$, 'LP169');
select pg_temp.expect_code('removing someone not on the team is refused', $q$
  select revoke_team_admin('00000000-0000-7000-8000-0000000035a3', 'x')$q$, 'LP170');
select pg_temp.expect_code('a reason is needed to remove', $q$
  select revoke_team_admin('00000000-0000-7000-8000-0000000035a1', '')$q$, 'LP166');
select revoke_team_admin('00000000-0000-7000-8000-0000000035a1', 'Stepping back');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000035a1');
select pg_temp.expect_equal('Ann, removed, no longer acts as the team', acting_as_team()::text, 'false');
select pg_temp.expect_code('…and can''t remove Bo back', $q$
  select revoke_team_admin('00000000-0000-7000-8000-0000000035a2', 'revenge')$q$, 'LP101');
select pg_temp.expect_code('…or add herself back', $q$
  select grant_team_admin('ann-35@example.com', 'back')$q$, 'LP101');

-- Ann can be added again later; her old role stays in the history.
select pg_temp.act('team', '00000000-0000-7000-8000-0000000035a2');
select pg_temp.expect_equal('Bo adds Ann back', grant_team_admin('ann-35@example.com', 'Back from leave')::text,
  '00000000-0000-7000-8000-0000000035a1');
reset role;

select pg_temp.expect_equal('Ann''s roles: one ended, one active', (
  select count(*) filter (where revoked_at is not null) || ' ' || count(*) filter (where revoked_at is null)
  from platform_role where user_id = '00000000-0000-7000-8000-0000000035a1'), '1 1');
select pg_temp.expect_equal('each grant records who granted it', (
  select granted_by::text from platform_role where user_id = '00000000-0000-7000-8000-0000000035a2'),
  '00000000-0000-7000-8000-0000000035a1');
select pg_temp.expect_equal('every add and removal is in the audit log, with who and why', (
  select string_agg(actor_user_id::text || ' ' || action || ':' || reason, ', ' order by reason) from audit_log
  where subject_type = 'app_user' and subject_id in ('00000000-0000-7000-8000-0000000035a1', '00000000-0000-7000-8000-0000000035a2')),
  '00000000-0000-7000-8000-0000000035a2 platform_role.grant:Back from leave, '
  '00000000-0000-7000-8000-0000000035a1 platform_role.grant:Helping with claims, '
  '00000000-0000-7000-8000-0000000035a2 platform_role.revoke:Stepping back');
select pg_temp.expect_equal('nothing was recorded for the refused attempts', (
  select count(*)::text from audit_log where action like 'platform_role.%'
    and subject_id in ('00000000-0000-7000-8000-0000000035a1', '00000000-0000-7000-8000-0000000035a2',
                       '00000000-0000-7000-8000-0000000035a3', '00000000-0000-7000-8000-0000000035a4')), '3');

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end $$;
set local role anon;
select pg_temp.expect_code('the browser-facing role can''t run either function', $q$
  select grant_team_admin('bo-35@example.com', 'x')$q$, '42501');
reset role;

rollback;
