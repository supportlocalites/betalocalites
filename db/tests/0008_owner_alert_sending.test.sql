-- =============================================================================
-- Checks for migration 0008 (a "check now" email being sent).
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
  ('00000000-0000-7000-8000-0000000008a1', 'Owner Eight', 'owner-8@example.com');
insert into municipality (id, slug, name, region) values
  ('00000000-0000-7000-8000-0000000008b1', 'test-town-8', 'Test Town', 'Test County');
insert into vendor (id, slug, display_name, primary_municipality_id, source) values
  ('00000000-0000-7000-8000-0000000008c1', 'test-vendor-8', 'Test Vendor 8', '00000000-0000-7000-8000-0000000008b1', 'admin_entered');
insert into audit_log (id, actor_user_id, action, subject_type, subject_id, changes) values
  ('00000000-0000-7000-8000-0000000008d1', '00000000-0000-7000-8000-0000000008a1', 'vendor.owner_edit', 'vendor',
   '00000000-0000-7000-8000-0000000008c1', '{"publicPhone": {"from": null, "to": "705 555 0100"}}');

set local role app_server;

select pg_temp.expect_accept('a flagged save waiting for its "check now" email',
  $q$insert into owner_change (audit_id, vendor_id, flags) values ('00000000-0000-7000-8000-0000000008d1', '00000000-0000-7000-8000-0000000008c1', '{phone}')$q$);
select pg_temp.expect_accept('its email''s place is taken before it is sent',
  $q$update owner_change set alert_status = 'sending' where audit_id = '00000000-0000-7000-8000-0000000008d1'$q$);
select pg_temp.expect_accept('then recorded as sent',
  $q$update owner_change set alert_status = 'sent' where audit_id = '00000000-0000-7000-8000-0000000008d1'$q$);
select pg_temp.expect_reject('an unknown email state',
  $q$update owner_change set alert_status = 'queued' where audit_id = '00000000-0000-7000-8000-0000000008d1'$q$);
reset role;

rollback;
