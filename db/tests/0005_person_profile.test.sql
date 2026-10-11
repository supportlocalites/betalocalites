-- =============================================================================
-- Checks for migration 0005 (personal details, D-36).
-- One transaction, rolled back. Obviously fake data.
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

insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000005a1', 'Person A', 'person-a@example.com'),
  ('00000000-0000-7000-8000-0000000005a2', 'Person B', 'person-b@example.com');

set local role app_server;

select pg_temp.expect_accept('full details: gender, date of birth, street address',
  $q$insert into person_profile (user_id, gender, date_of_birth, street_address, unit, town, province, postal_code)
     values ('00000000-0000-7000-8000-0000000005a1', 'woman', '1988-04-12', '1 Example Street', 'Unit 2', 'Orillia', 'ON', 'L3V 1A1')$q$);
select pg_temp.expect_accept('the person can change and clear their details',
  $q$update person_profile set gender = null, street_address = null where user_id = '00000000-0000-7000-8000-0000000005a1'$q$);
select pg_temp.expect_accept('gender in their own words',
  $q$insert into person_profile (user_id, gender, gender_self_described)
     values ('00000000-0000-7000-8000-0000000005a2', 'self_described', 'Two-spirit')$q$);
select pg_temp.expect_reject('"own words" without choosing to describe it themselves',
  $q$update person_profile set gender = 'man' where user_id = '00000000-0000-7000-8000-0000000005a2'$q$);
select pg_temp.expect_reject('"describe it myself" with no words',
  $q$update person_profile set gender_self_described = null where user_id = '00000000-0000-7000-8000-0000000005a2'$q$);
select pg_temp.expect_reject('an unknown gender value',
  $q$update person_profile set gender = 'other' where user_id = '00000000-0000-7000-8000-0000000005a1'$q$);
select pg_temp.expect_reject('a date of birth before 1900',
  $q$update person_profile set date_of_birth = '1850-01-01' where user_id = '00000000-0000-7000-8000-0000000005a1'$q$);
select pg_temp.expect_reject('a postal code in the wrong shape',
  $q$update person_profile set postal_code = 'l3v1a1' where user_id = '00000000-0000-7000-8000-0000000005a1'$q$);
select pg_temp.expect_reject('an unknown province',
  $q$update person_profile set province = 'XX' where user_id = '00000000-0000-7000-8000-0000000005a1'$q$);
select pg_temp.expect_reject('details for someone who has no account',
  $q$insert into person_profile (user_id, town) values ('00000000-0000-7000-8000-0000000005ff', 'Orillia')$q$);
select pg_temp.expect_reject('a second row of details for the same person',
  $q$insert into person_profile (user_id, town) values ('00000000-0000-7000-8000-0000000005a1', 'Orillia')$q$);
select pg_temp.expect_accept('erasing an account can remove its details',
  $q$delete from person_profile where user_id = '00000000-0000-7000-8000-0000000005a2'$q$);
reset role;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end $$;
set local role anon;
do $$
declare n int;
begin
  begin
    select count(*) into n from person_profile;
  exception when insufficient_privilege then n := 0;
  end;
  if n <> 0 then raise exception 'FAIL  anon role read % personal details', n; end if;
  raise notice 'PASS  browser-facing role reads no personal details';
end $$;
reset role;

rollback;
