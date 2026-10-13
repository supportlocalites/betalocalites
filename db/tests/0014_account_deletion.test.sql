-- =============================================================================
-- Checks for migration 0014: a person deletes their own account (E §8, D-10).
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

create function pg_temp.today() returns date
language sql stable as $$ select (now() at time zone 'America/Toronto')::date $$;

create function pg_temp.expect_rows(label text, stmt text, want int) returns void
language plpgsql as $$
declare n int;
begin
  execute stmt;
  get diagnostics n = row_count;
  if n <> want then
    raise exception 'FAIL  %: % rows, want %', label, n, want;
  end if;
  raise notice 'PASS  %  (% rows)', label, want;
end $$;

-- Person P: an event with a booked business (flagged, with a note), a save, personal
-- details, an open claim with a note, a business P owns, a sign-in code fingerprint, a
-- linked browser and a suggestion. Person Q: an event of her own. Admin A.
insert into app_user (id, display_name, email, given_name, family_name) values
  ('00000000-0000-7000-8000-0000000014a1', 'Pat Person', 'Pat.Person-14@Example.com', 'Pat', 'Person'),
  ('00000000-0000-7000-8000-0000000014a2', 'Quinn Q', 'quinn-14@example.com', 'Quinn', 'Q'),
  ('00000000-0000-7000-8000-0000000014a3', 'Admin A', 'admin-a-14@example.com', 'Admin', 'A'),
  ('00000000-0000-7000-8000-0000000014a4', 'Owner V', 'owner-v-14@example.com', 'Owner', 'V');
insert into platform_role (user_id, role) values ('00000000-0000-7000-8000-0000000014a3', 'admin');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000014b1', 'test-town-14', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000014c1', 'test-fourteen-v', 'Fourteen V', '00000000-0000-7000-8000-0000000014b1', 'admin_entered', 'published', 'claimed', now()),
  ('00000000-0000-7000-8000-0000000014c2', 'test-fourteen-p', 'Fourteen P', '00000000-0000-7000-8000-0000000014b1', 'admin_entered', 'published', 'claimed', now()),
  ('00000000-0000-7000-8000-0000000014c3', 'test-fourteen-u', 'Fourteen U', '00000000-0000-7000-8000-0000000014b1', 'admin_entered', 'published', 'unclaimed', now());
insert into vendor_member (vendor_id, user_id, role) values
  ('00000000-0000-7000-8000-0000000014c1', '00000000-0000-7000-8000-0000000014a4', 'owner'),
  ('00000000-0000-7000-8000-0000000014c2', '00000000-0000-7000-8000-0000000014a1', 'owner');
insert into event (id, host_user_id, event_date, municipality_id) values
  ('00000000-0000-7000-8000-0000000014f1', '00000000-0000-7000-8000-0000000014a1', pg_temp.today() + 20, '00000000-0000-7000-8000-0000000014b1'),
  ('00000000-0000-7000-8000-0000000014f2', '00000000-0000-7000-8000-0000000014a2', pg_temp.today() + 20, '00000000-0000-7000-8000-0000000014b1');
insert into event_private (event_id, host_user_id, title, notes) values
  ('00000000-0000-7000-8000-0000000014f1', '00000000-0000-7000-8000-0000000014a1', 'Pat''s party', 'Private notes'),
  ('00000000-0000-7000-8000-0000000014f2', '00000000-0000-7000-8000-0000000014a2', 'Quinn''s party', null);
insert into event_vendor (id, event_id, host_user_id, vendor_id, status, booked_at, vendor_flagged_at, vendor_flagged_by) values
  ('00000000-0000-7000-8000-000000001461', '00000000-0000-7000-8000-0000000014f1', '00000000-0000-7000-8000-0000000014a1',
   '00000000-0000-7000-8000-0000000014c1', 'booked', now(), now(), '00000000-0000-7000-8000-0000000014a4'),
  ('00000000-0000-7000-8000-000000001462', '00000000-0000-7000-8000-0000000014f2', '00000000-0000-7000-8000-0000000014a2',
   '00000000-0000-7000-8000-0000000014c1', 'booked', now(), null, null);
insert into event_vendor_flag_note (event_vendor_id, note) values ('00000000-0000-7000-8000-000000001461', 'Never heard of them');
insert into saved_vendor (user_id, vendor_id) values
  ('00000000-0000-7000-8000-0000000014a1', '00000000-0000-7000-8000-0000000014c1'),
  ('00000000-0000-7000-8000-0000000014a2', '00000000-0000-7000-8000-0000000014c1');
insert into person_profile (user_id, street_address, town) values ('00000000-0000-7000-8000-0000000014a1', '1 Test Street', 'Test Town');
insert into vendor_claim (vendor_id, claimant_user_id, claimant_note) values
  ('00000000-0000-7000-8000-0000000014c3', '00000000-0000-7000-8000-0000000014a1', 'I run it with my sister');
insert into sign_in_code_event (email_hash, kind) values
  (encode(sha256(convert_to('pat.person-14@example.com', 'UTF8')), 'hex'), 'sent');
insert into visitor_account (visitor_id, user_id) values ('00000000-0000-7000-8000-0000000014e1', '00000000-0000-7000-8000-0000000014a1');
insert into vendor_suggestion (business_name, suggested_by) values ('Test Fourteen Suggestion', '00000000-0000-7000-8000-0000000014a1');

set local role app_server;
select pg_temp.act(null, null);
select pg_temp.expect_code('nobody acting: refused', $q$select delete_my_account()$q$, 'LP101');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000014a1', '00000000-0000-7000-8000-0000000014c2');
select pg_temp.expect_code('acting for a business: refused (only the person side)', $q$select delete_my_account()$q$, 'LP101');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000014a3');
select pg_temp.expect_code('a team member can''t delete their account here', $q$select delete_my_account()$q$, 'LP121');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000014a1');
select delete_my_account();
reset role;

select pg_temp.expect_equal('P''s events, private details, plan rows, flag notes and saves are gone', (
  select ((select count(*) from event where host_user_id = '00000000-0000-7000-8000-0000000014a1')
        + (select count(*) from event_private where host_user_id = '00000000-0000-7000-8000-0000000014a1')
        + (select count(*) from event_vendor where host_user_id = '00000000-0000-7000-8000-0000000014a1')
        + (select count(*) from event_vendor_flag_note where event_vendor_id = '00000000-0000-7000-8000-000000001461')
        + (select count(*) from saved_vendor where user_id = '00000000-0000-7000-8000-0000000014a1'))::text), '0');
select pg_temp.expect_equal('Q''s event, plan and save are untouched', (
  select ((select count(*) from event where id = '00000000-0000-7000-8000-0000000014f2')
        + (select count(*) from event_vendor where id = '00000000-0000-7000-8000-000000001462')
        + (select count(*) from saved_vendor where user_id = '00000000-0000-7000-8000-0000000014a2'))::text), '3');
select pg_temp.expect_equal('P''s account row holds nothing personal', (
  select display_name || ' ' || email::text || ' ' || coalesce(given_name, '-') || coalesce(family_name, '-') || ' ' || (deleted_at is not null)::text
  from app_user where id = '00000000-0000-7000-8000-0000000014a1'),
  'Former Localites member deleted-00000000-0000-7000-8000-0000000014a1@deleted.invalid -- true');
select pg_temp.expect_equal('personal details and the sign-in code fingerprint are gone', (
  select ((select count(*) from person_profile where user_id = '00000000-0000-7000-8000-0000000014a1')
        + (select count(*) from sign_in_code_event where email_hash = encode(sha256(convert_to('pat.person-14@example.com', 'UTF8')), 'hex')))::text), '0');
select pg_temp.expect_equal('the open claim is withdrawn and its note erased', (
  select status || ' ' || coalesce(claimant_note, 'erased') from vendor_claim where claimant_user_id = '00000000-0000-7000-8000-0000000014a1'),
  'withdrawn erased');
select pg_temp.expect_equal('P left the team of the business P owned, which is unclaimed again (recorded)', (
  select (select (ended_at is not null)::text from vendor_member where user_id = '00000000-0000-7000-8000-0000000014a1')
      || ' ' || (select claim_status from vendor where id = '00000000-0000-7000-8000-0000000014c2')
      || ' ' || (select count(*)::text from status_change where subject_id = '00000000-0000-7000-8000-0000000014c2' and to_status = 'unclaimed')),
  'true unclaimed 1');
select pg_temp.expect_equal('another business (V, owned by someone else) is untouched', (
  select claim_status from vendor where id = '00000000-0000-7000-8000-0000000014c1'), 'claimed');
select pg_temp.expect_equal('P is unlinked from browsers and suggestions', (
  select ((select count(*) from visitor_account where user_id = '00000000-0000-7000-8000-0000000014a1')
        + (select count(*) from vendor_suggestion where suggested_by = '00000000-0000-7000-8000-0000000014a1'))::text), '0');
select pg_temp.expect_equal('the team has it on its list, and it is in the audit log', (
  select (select count(*) from account_deletion where user_id = '00000000-0000-7000-8000-0000000014a1' and auth_removed_at is null)::text || ' '
      || (select count(*) from audit_log where action = 'account.delete' and subject_id = '00000000-0000-7000-8000-0000000014a1')::text), '1 1');

set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000014a1');
select pg_temp.expect_code('deleting twice: refused', $q$select delete_my_account()$q$, 'LP109');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000014a2');
select pg_temp.expect_equal('another person can''t see the team''s list', (select count(*)::text from account_deletion), '0');
select pg_temp.expect_rows('…nor mark it done',
  $q$update account_deletion set auth_removed_at = now() where user_id = '00000000-0000-7000-8000-0000000014a1'$q$, 0);
select pg_temp.act('team', '00000000-0000-7000-8000-0000000014a3');
select pg_temp.expect_equal('the team sees it', (
  select count(*)::text from account_deletion where user_id = '00000000-0000-7000-8000-0000000014a1'), '1');
select pg_temp.expect_rows('the team marks the Supabase sign-in record removed',
  $q$update account_deletion set auth_removed_at = '2000-01-01' where user_id = '00000000-0000-7000-8000-0000000014a1'$q$, 1);
select pg_temp.expect_equal('…stamped by the database: now, by the admin', (
  select (auth_removed_at = now())::text || ' ' || (auth_removed_by = '00000000-0000-7000-8000-0000000014a3')::text
  from account_deletion where user_id = '00000000-0000-7000-8000-0000000014a1'), 'true true');
select pg_temp.expect_code('…only once', $q$update account_deletion set auth_removed_at = now() where user_id = '00000000-0000-7000-8000-0000000014a1'$q$, 'LP109');

reset role;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;
set local role anon;
do $$
begin
  perform delete_my_account();
  raise exception 'FAIL  the browser-facing role can run delete_my_account';
exception when insufficient_privilege then
  raise notice 'PASS  the browser-facing role can''t run delete_my_account';
end $$;

rollback;
