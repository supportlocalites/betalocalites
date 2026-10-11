-- =============================================================================
-- Checks for migration 0006 (first and last name). One transaction, rolled back.
-- =============================================================================

begin;

create function pg_temp.expect_reject(label text, stmt text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'PASS  %  (rejected: %)', label, sqlerrm;
    return;
  end;
  raise exception 'FAIL  %: statement was accepted but must be rejected', label;
end $$;

create function pg_temp.expect_accept(label text, stmt text) returns void
language plpgsql as $$
begin
  execute stmt;
  raise notice 'PASS  %  (accepted)', label;
end $$;

set local role app_server;
select pg_temp.expect_accept('a new person with a first and last name',
  $q$insert into app_user (id, display_name, given_name, family_name, email)
     values ('00000000-0000-7000-8000-0000000006a1', 'Alex Example', 'Alex', 'Example', 'alex-6@example.com')$q$);
select pg_temp.expect_accept('an older account with neither (the team''s)',
  $q$insert into app_user (id, display_name, email) values ('00000000-0000-7000-8000-0000000006a2', 'Team', 'team-6@example.com')$q$);
select pg_temp.expect_reject('a first name without a last name',
  $q$insert into app_user (id, display_name, given_name, email) values ('00000000-0000-7000-8000-0000000006a3', 'Sam', 'Sam', 'sam-6@example.com')$q$);
select pg_temp.expect_reject('an empty last name',
  $q$update app_user set family_name = '' where id = '00000000-0000-7000-8000-0000000006a1'$q$);
select pg_temp.expect_reject('removing one part of the name only',
  $q$update app_user set given_name = null where id = '00000000-0000-7000-8000-0000000006a1'$q$);
reset role;

rollback;
