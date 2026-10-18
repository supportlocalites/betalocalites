-- =============================================================================
-- Checks for migration 0044: the reminder for deleted accounts. Rolled back.
-- =============================================================================

begin;

create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAIL  %', label; end if;
  raise notice 'PASS  %', label;
end $$;

-- Earlier tests' rows are rolled back; start from what's there.
create temp table before as select * from deletions_to_finish();
insert into app_user (id, display_name, email, deleted_at) values
  ('00000000-0000-7000-8000-0000000044a1', 'Former Localites member', 'gone1-44@example.com', now()),
  ('00000000-0000-7000-8000-0000000044a2', 'Former Localites member', 'gone2-44@example.com', now()),
  ('00000000-0000-7000-8000-0000000044a9', 'Ann Admin', 'ann-44@example.com', null);
insert into account_deletion (user_id, requested_at) values
  ('00000000-0000-7000-8000-0000000044a1', now() - interval '20 days');
insert into account_deletion (user_id, requested_at, auth_removed_at, auth_removed_by) values
  ('00000000-0000-7000-8000-0000000044a2', now() - interval '40 days', now() - interval '35 days', '00000000-0000-7000-8000-0000000044a9');

grant select on before to app_server;
set local role app_server;
select pg_temp.expect('the morning run (acting as nobody) gets the count: finished ones aren''t counted',
  (select waiting from deletions_to_finish()) = (select waiting from before) + 1);
select pg_temp.expect('…and the oldest request''s time',
  (select oldest from deletions_to_finish()) <= now() - interval '20 days');
select pg_temp.expect('…while the table itself stays closed to it',
  (select count(*) from account_deletion) = 0);
reset role;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end $$;
set local role anon;
do $$ begin
  begin
    perform deletions_to_finish();
    raise exception 'FAIL  the browser-facing role read the count';
  exception when insufficient_privilege then
    raise notice 'PASS  the browser-facing role can''t  (42501)';
  end;
end $$;
reset role;

rollback;
