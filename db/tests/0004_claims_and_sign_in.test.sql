-- =============================================================================
-- Checks for migration 0004 (claims, notification log, sign-in code limits).
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

-- ---------------------------------------------------------------- fixtures ---
insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000004a1', 'Claimant A', 'a@example.com'),
  ('00000000-0000-7000-8000-0000000004a2', 'Claimant B', 'b@example.com'),
  ('00000000-0000-7000-8000-0000000004a3', 'Test Admin 4', 'admin4@example.com');
insert into municipality (id, slug, name, region) values
  ('00000000-0000-7000-8000-0000000004b1', 'test-town-4', 'Test Town', 'Test County');
insert into vendor (id, slug, display_name, primary_municipality_id, source) values
  ('00000000-0000-7000-8000-0000000004c1', 'test-vendor-4', 'Test Vendor 4', '00000000-0000-7000-8000-0000000004b1', 'admin_entered');

-- ------------------------------------------------------------------ claims ---
select pg_temp.expect_accept('a claim records how the person is connected to the business',
  $q$insert into vendor_claim (id, vendor_id, claimant_user_id, relationship, claimant_note)
     values ('00000000-0000-7000-8000-0000000004d1', '00000000-0000-7000-8000-0000000004c1',
             '00000000-0000-7000-8000-0000000004a1', 'owner', 'Test note')$q$);
select pg_temp.expect_reject('a made-up connection to the business',
  $q$insert into vendor_claim (vendor_id, claimant_user_id, relationship)
     values ('00000000-0000-7000-8000-0000000004c1', '00000000-0000-7000-8000-0000000004a2', 'cousin')$q$);
select pg_temp.expect_reject('a declined claim with no reason',
  $q$update vendor_claim set status = 'rejected', reviewed_by = '00000000-0000-7000-8000-0000000004a3', reviewed_at = now()
     where id = '00000000-0000-7000-8000-0000000004d1'$q$);
select pg_temp.expect_accept('a declined claim with its reason',
  $q$update vendor_claim set status = 'rejected', reviewed_by = '00000000-0000-7000-8000-0000000004a3', reviewed_at = now(),
            decision_note = 'We could not confirm this with the business.'
     where id = '00000000-0000-7000-8000-0000000004d1'$q$);

-- ------------------------------------------------------------ one owner ---
select pg_temp.expect_accept('a business gets its owner',
  $q$insert into vendor_member (vendor_id, user_id, role)
     values ('00000000-0000-7000-8000-0000000004c1', '00000000-0000-7000-8000-0000000004a1', 'owner')$q$);
select pg_temp.expect_reject('a second active owner for the same business',
  $q$insert into vendor_member (vendor_id, user_id, role)
     values ('00000000-0000-7000-8000-0000000004c1', '00000000-0000-7000-8000-0000000004a2', 'owner')$q$);
select pg_temp.expect_accept('a new owner once the old ownership has ended',
  $q$update vendor_member set ended_at = now() where vendor_id = '00000000-0000-7000-8000-0000000004c1' and role = 'owner';
     insert into vendor_member (vendor_id, user_id, role)
     values ('00000000-0000-7000-8000-0000000004c1', '00000000-0000-7000-8000-0000000004a2', 'owner')$q$);

-- ----------------------------------------------------------- notifications ---
select pg_temp.expect_reject('an email marked sent with no send time',
  $q$insert into notification (user_id, kind, subject_type, subject_id, status)
     values ('00000000-0000-7000-8000-0000000004a1', 'claim_decision', 'vendor_claim', '00000000-0000-7000-8000-0000000004d1', 'sent')$q$);
select pg_temp.expect_reject('an email marked failed with no reason',
  $q$insert into notification (user_id, kind, subject_type, subject_id, status)
     values ('00000000-0000-7000-8000-0000000004a1', 'claim_decision', 'vendor_claim', '00000000-0000-7000-8000-0000000004d1', 'failed')$q$);
select pg_temp.expect_accept('an email that couldn’t be sent, with the honest reason',
  $q$insert into notification (user_id, kind, subject_type, subject_id, status, failure_reason)
     values ('00000000-0000-7000-8000-0000000004a1', 'claim_received', 'vendor_claim', '00000000-0000-7000-8000-0000000004d1', 'failed', 'Email isn''t set up yet')$q$);
select pg_temp.expect_reject('a kind of email Localites doesn’t send',
  $q$insert into notification (user_id, kind, subject_type, subject_id)
     values ('00000000-0000-7000-8000-0000000004a1', 'newsletter', 'vendor', '00000000-0000-7000-8000-0000000004c1')$q$);

-- -------------------------------------------------------- sign-in code limits ---
select pg_temp.expect_reject('a sign-in code event that stores the address itself',
  $q$insert into sign_in_code_event (email_hash, kind) values ('a@example.com', 'sent')$q$);
select pg_temp.expect_accept('a sign-in code event with a hashed address',
  $q$insert into sign_in_code_event (email_hash, kind) values (encode(sha256('a@example.com'::bytea), 'hex'), 'sent')$q$);

-- ------------------------------------------------------------- app role ---
set local role app_server;
select pg_temp.expect_accept('app role records and clears sign-in code events',
  $q$insert into sign_in_code_event (email_hash, kind) values (encode(sha256('b@example.com'::bytea), 'hex'), 'wrong_code');
     delete from sign_in_code_event where created_at < now() - interval '2 days'$q$);
select pg_temp.expect_accept('app role records an email to a person',
  $q$insert into notification (user_id, kind, subject_type, subject_id)
     values ('00000000-0000-7000-8000-0000000004a2', 'claim_received', 'vendor_claim', '00000000-0000-7000-8000-0000000004d1')$q$);
select pg_temp.expect_reject('app role cannot delete the email record',
  $q$delete from notification$q$);
select pg_temp.expect_reject('app role still cannot delete a claim',
  $q$delete from vendor_claim$q$);
select pg_temp.expect_reject('app role still cannot delete a membership',
  $q$delete from vendor_member$q$);
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
    select count(*) into n from notification;
  exception when insufficient_privilege then n := 0;
  end;
  if n <> 0 then raise exception 'FAIL  anon role read % notifications', n; end if;
  begin
    select count(*) into n from sign_in_code_event;
  exception when insufficient_privilege then n := 0;
  end;
  if n <> 0 then raise exception 'FAIL  anon role read % sign-in events', n; end if;
  raise notice 'PASS  browser-facing role reads no emails or sign-in events';
end $$;
reset role;

rollback;
