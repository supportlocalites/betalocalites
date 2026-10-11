-- =============================================================================
-- Checks for migration 0007 (owner editing: review state and daily note).
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
  ('00000000-0000-7000-8000-0000000007a1', 'Owner Seven', 'owner-7@example.com'),
  ('00000000-0000-7000-8000-0000000007a2', 'Admin Seven', 'admin-7@example.com');
insert into municipality (id, slug, name, region) values
  ('00000000-0000-7000-8000-0000000007b1', 'test-town-7', 'Test Town', 'Test County');
insert into vendor (id, slug, display_name, primary_municipality_id, source) values
  ('00000000-0000-7000-8000-0000000007c1', 'test-vendor-7', 'Test Vendor 7', '00000000-0000-7000-8000-0000000007b1', 'admin_entered');
insert into audit_log (id, actor_user_id, action, subject_type, subject_id, changes) values
  ('00000000-0000-7000-8000-0000000007d1', '00000000-0000-7000-8000-0000000007a1', 'vendor.owner_edit', 'vendor',
   '00000000-0000-7000-8000-0000000007c1', '{"tagline": {"from": null, "to": "Cakes"}}'),
  ('00000000-0000-7000-8000-0000000007d2', '00000000-0000-7000-8000-0000000007a2', 'vendor.owner_edit.undo', 'vendor',
   '00000000-0000-7000-8000-0000000007c1', '{"tagline": {"from": "Cakes", "to": null}}'),
  ('00000000-0000-7000-8000-0000000007d3', '00000000-0000-7000-8000-0000000007a1', 'vendor.owner_edit', 'vendor',
   '00000000-0000-7000-8000-0000000007c1', '{"websiteUrl": {"from": null, "to": "https://example.com"}}');

set local role app_server;

select pg_temp.expect_accept('an owner save is recorded for the team',
  $q$insert into owner_change (audit_id, vendor_id) values ('00000000-0000-7000-8000-0000000007d1', '00000000-0000-7000-8000-0000000007c1')$q$);
select pg_temp.expect_accept('a flagged save with its "check now" email sent',
  $q$insert into owner_change (audit_id, vendor_id, flags, alert_status)
     values ('00000000-0000-7000-8000-0000000007d3', '00000000-0000-7000-8000-0000000007c1', '{website}', 'sent')$q$);
select pg_temp.expect_reject('a save recorded twice',
  $q$insert into owner_change (audit_id, vendor_id) values ('00000000-0000-7000-8000-0000000007d1', '00000000-0000-7000-8000-0000000007c1')$q$);
select pg_temp.expect_reject('a save with no audit record behind it',
  $q$insert into owner_change (audit_id, vendor_id) values ('00000000-0000-7000-8000-0000000007ff', '00000000-0000-7000-8000-0000000007c1')$q$);
select pg_temp.expect_reject('an unknown flag',
  $q$update owner_change set flags = '{name}' where audit_id = '00000000-0000-7000-8000-0000000007d1'$q$);
select pg_temp.expect_reject('an alert marked failed with no reason',
  $q$update owner_change set alert_status = 'failed' where audit_id = '00000000-0000-7000-8000-0000000007d3'$q$);
select pg_temp.expect_reject('an alert for a save with nothing to check',
  $q$update owner_change set alert_status = 'sent' where audit_id = '00000000-0000-7000-8000-0000000007d1'$q$);
select pg_temp.expect_reject('undone without saying who undid it and how',
  $q$update owner_change set undone_at = now() where audit_id = '00000000-0000-7000-8000-0000000007d1'$q$);
select pg_temp.expect_accept('undone, with who and the undo''s own audit record',
  $q$update owner_change set undone_at = now(), undone_by = '00000000-0000-7000-8000-0000000007a2',
       undo_audit_id = '00000000-0000-7000-8000-0000000007d2' where audit_id = '00000000-0000-7000-8000-0000000007d1'$q$);
select pg_temp.expect_reject('the app can''t re-point a save to another business',
  $q$update owner_change set vendor_id = vendor_id where audit_id = '00000000-0000-7000-8000-0000000007d1'$q$);
select pg_temp.expect_reject('the app can''t change what flagged a save',
  $q$update owner_change set flags = '{}' where audit_id = '00000000-0000-7000-8000-0000000007d3'$q$);
select pg_temp.expect_reject('the app can''t delete a save''s record',
  $q$delete from owner_change$q$);
select pg_temp.expect_reject('the audit log is still append-only',
  $q$update audit_log set reason = 'edited' where id = '00000000-0000-7000-8000-0000000007d1'$q$);

select pg_temp.expect_accept('the day''s note is claimed once',
  $q$insert into team_digest (day, status) values ('2026-10-11', 'sending')$q$);
select pg_temp.expect_reject('a second note for the same day',
  $q$insert into team_digest (day, status) values ('2026-10-11', 'sending')$q$);
select pg_temp.expect_reject('a note marked sent without when',
  $q$update team_digest set status = 'sent' where day = '2026-10-11'$q$);
select pg_temp.expect_reject('a note marked failed with no reason',
  $q$update team_digest set status = 'failed' where day = '2026-10-11'$q$);
select pg_temp.expect_reject('"nothing to report" that counted changes',
  $q$update team_digest set status = 'empty', change_count = 2 where day = '2026-10-11'$q$);
select pg_temp.expect_accept('a sent note, and the saves it listed',
  $q$with s as (update team_digest set status = 'sent', sent_at = now(), change_count = 2 where day = '2026-10-11' returning day)
     update owner_change set digest_day = (select day from s) where vendor_id = '00000000-0000-7000-8000-0000000007c1'$q$);
select pg_temp.expect_reject('the app can''t delete a day''s note',
  $q$delete from team_digest$q$);
select pg_temp.expect_accept('the new email kinds are allowed',
  $q$insert into notification (user_id, kind, subject_type, subject_id)
     values ('00000000-0000-7000-8000-0000000007a1', 'listing_change_undone', 'owner_change', '00000000-0000-7000-8000-0000000007d1'),
            ('00000000-0000-7000-8000-0000000007a1', 'owner_removed', 'vendor', '00000000-0000-7000-8000-0000000007c1')$q$);
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
    select count(*) into n from owner_change;
  exception when insufficient_privilege then n := 0;
  end;
  if n <> 0 then raise exception 'FAIL  anon role read % owner saves', n; end if;
  begin
    select count(*) into n from team_digest;
  exception when insufficient_privilege then n := 0;
  end;
  if n <> 0 then raise exception 'FAIL  anon role read % daily notes', n; end if;
  raise notice 'PASS  browser-facing role reads no owner saves or daily notes';
end $$;
reset role;

rollback;
