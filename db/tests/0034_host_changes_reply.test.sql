-- =============================================================================
-- Checks for migration 0034: the host changes a guest's reply; the guest is emailed (D-49).
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

create function pg_temp.act(p_side text, p_user uuid, p_vendor uuid default null) returns void
language plpgsql as $$
begin
  perform set_config('localites.side', coalesce(p_side, ''), true),
          set_config('localites.user_id', coalesce(p_user::text, ''), true),
          set_config('localites.vendor_id', coalesce(p_vendor::text, ''), true);
end $$;

create function pg_temp.h(t text) returns bytea language sql as $$ select sha256(convert_to(t, 'UTF8')) $$;

insert into app_user (id, display_name, given_name, family_name, email) values
  ('00000000-0000-7000-8000-0000000034a1', 'Ann Host', 'Ann', 'Host', 'a-34@example.com'),
  ('00000000-0000-7000-8000-0000000034a2', 'Bo Other', 'Bo', 'Other', 'b-34@example.com');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000034b1', 'test-town-34', 'Test Town', 'Test County', true);
insert into event (id, host_user_id, event_date, municipality_id) values
  ('00000000-0000-7000-8000-0000000034f1', '00000000-0000-7000-8000-0000000034a1', current_date + 10, '00000000-0000-7000-8000-0000000034b1');
insert into event_private (event_id, host_user_id, title) values
  ('00000000-0000-7000-8000-0000000034f1', '00000000-0000-7000-8000-0000000034a1', 'Party');
insert into guest (id, event_id, host_user_id, name, email, token_hash) values
  ('00000000-0000-7000-8000-0000000034d1', '00000000-0000-7000-8000-0000000034f1', '00000000-0000-7000-8000-0000000034a1', 'Jo', 'jo@example.com', pg_temp.h('t1')),
  ('00000000-0000-7000-8000-0000000034d2', '00000000-0000-7000-8000-0000000034f1', '00000000-0000-7000-8000-0000000034a1', 'Rob', null, pg_temp.h('t2'));

set local role app_server;

select pg_temp.act(null, null);
select invitation_reply(pg_temp.h('t1'), 'no', null, 'Busy');
select pg_temp.expect_equal('a guest''s own reply is marked as theirs', (
  select response || ' ' || reply_by from invitation_for(pg_temp.h('t1'))), 'no guest');

select pg_temp.act('person', '00000000-0000-7000-8000-0000000034a1');
select pg_temp.expect_equal('the host changes Jo''s reply: an email is due to Jo', (
  select email from host_set_reply('00000000-0000-7000-8000-0000000034d1', 'yes', 2::smallint)), 'jo@example.com');
select pg_temp.expect_equal('…the reply is marked as the host''s; Jo''s note stays', (
  select response || ' ' || party_size || ' ' || reply_by || ' ' || reply_note from guest where id = '00000000-0000-7000-8000-0000000034d1'),
  'yes 2 host Busy');
select pg_temp.expect_equal('…the same again: nothing written, no email', (
  select count(*)::text from host_set_reply('00000000-0000-7000-8000-0000000034d1', 'yes', 2::smallint)), '0');
select pg_temp.expect_equal('a guest with no email: changed, no email', (
  select count(*)::text from host_set_reply('00000000-0000-7000-8000-0000000034d2', 'maybe', 1::smallint)), '0');
select pg_temp.expect_code('how many must be 1 to 20', $q$
  select * from host_set_reply('00000000-0000-7000-8000-0000000034d2', 'yes', 40::smallint)$q$, 'LP165');
select pg_temp.expect_code('the host can''t write reply_by directly', $q$
  update guest set reply_by = 'guest' where id = '00000000-0000-7000-8000-0000000034d1'$q$, '42501');
select host_set_reply('00000000-0000-7000-8000-0000000034d1', 'no', null);
select host_set_reply('00000000-0000-7000-8000-0000000034d1', 'maybe', 1::smallint);
select pg_temp.expect_equal('at most 3 emails a day to one guest; the rest held back, with why', (
  select string_agg(status, ',' order by created_at, status) from guest_email), 'queued,queued,queued');
select host_set_reply('00000000-0000-7000-8000-0000000034d1', 'yes', 3::smallint);
select pg_temp.expect_equal('…the fourth is held back', (
  select status || ': ' || failure_reason from guest_email order by created_at desc, status desc limit 1),
  'suppressed: the day''s limit of emails to this guest');
update guest_email set status = 'sent', sent_at = now() where status = 'queued';
select pg_temp.expect_equal('the host records how its emails went', (
  select count(*)::text from guest_email where status = 'sent'), '3');

select pg_temp.act('person', '00000000-0000-7000-8000-0000000034a2');
select pg_temp.expect_code('another person can''t change a guest''s reply', $q$
  select * from host_set_reply('00000000-0000-7000-8000-0000000034d1', 'no', null)$q$, 'LP101');
select pg_temp.expect_equal('…nor see the emails', (select count(*)::text from guest_email), '0');
select pg_temp.act(null, null);
select pg_temp.expect_code('nobody acting can either', $q$
  select * from host_set_reply('00000000-0000-7000-8000-0000000034d1', 'no', null)$q$, 'LP101');

reset role;
update event set status = 'cancelled', cancelled_at = now() where id = '00000000-0000-7000-8000-0000000034f1';
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000034a1');
select pg_temp.expect_code('not on a cancelled event', $q$
  select * from host_set_reply('00000000-0000-7000-8000-0000000034d2', 'no', null)$q$, 'LP102');

rollback;
