-- =============================================================================
-- Checks for migration 0040: booking emails wait for the daily summary (D-53). Rolled back.
-- =============================================================================

begin;

insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000040a1', 'Ann', 'a-40@example.com');

set local role app_server;

insert into notification (user_id, kind, subject_type, subject_id, status, summary_line) values
  ('00000000-0000-7000-8000-0000000040a1', 'marked_booked', 'event_vendor', gen_random_uuid(), 'waiting', 'Sam marked you as booked for 3 May.');
do $$ begin
  if (select count(*) from notification where user_id = '00000000-0000-7000-8000-0000000040a1' and status = 'waiting') <> 1 then
    raise exception 'FAIL  the server can''t keep an email waiting with its line';
  end if;
  raise notice 'PASS  the server keeps an email waiting, with its line';
end $$;

do $$ begin
  begin
    insert into notification (user_id, kind, subject_type, subject_id, status)
    values ('00000000-0000-7000-8000-0000000040a1', 'marked_booked', 'event_vendor', gen_random_uuid(), 'waiting');
    raise exception 'FAIL  an email waited with no line to show';
  exception when check_violation then
    raise notice 'PASS  a waiting email needs its line  (23514)';
  end;
end $$;

do $$ begin
  begin
    insert into notification (user_id, kind, subject_type, subject_id, status, summary_line)
    values ('00000000-0000-7000-8000-0000000040a1', 'marked_booked', 'event_vendor', gen_random_uuid(), 'waiting', '');
    raise exception 'FAIL  an empty line was kept';
  exception when check_violation then
    raise notice 'PASS  the line can''t be empty  (23514)';
  end;
end $$;

do $$ begin
  begin
    insert into notification (user_id, kind, subject_type, subject_id, status, summary_line)
    values ('00000000-0000-7000-8000-0000000040a1', 'marked_booked', 'event_vendor', gen_random_uuid(), 'parked', 'x');
    raise exception 'FAIL  an unknown status was kept';
  exception when check_violation then
    raise notice 'PASS  an unknown status is refused  (23514)';
  end;
end $$;

-- Sent from the summary: the usual rule (sent means a send time) still holds.
update notification set status = 'sent', sent_at = now()
 where user_id = '00000000-0000-7000-8000-0000000040a1' and status = 'waiting';
do $$ begin
  if exists (select 1 from notification where user_id = '00000000-0000-7000-8000-0000000040a1' and status = 'waiting') then
    raise exception 'FAIL  the waiting email couldn''t be marked sent';
  end if;
  raise notice 'PASS  a waiting email is marked sent when the summary goes';
end $$;
reset role;

-- Still on the team? Ann owns V (claimed); Ben was a manager and left; Cal is staff; W is archived.
insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000040a2', 'Ben', 'b-40@example.com'),
  ('00000000-0000-7000-8000-0000000040a3', 'Cal', 'c-40@example.com'),
  ('00000000-0000-7000-8000-0000000040a4', 'Host', 'h-40@example.com');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000040b1', 'test-town-40', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at, archived_at) values
  ('00000000-0000-7000-8000-0000000040c1', 'test-40-v', 'V', '00000000-0000-7000-8000-0000000040b1', 'admin_entered', 'published', 'claimed', now(), null),
  ('00000000-0000-7000-8000-0000000040c2', 'test-40-w', 'W', '00000000-0000-7000-8000-0000000040b1', 'admin_entered', 'archived', 'claimed', now(), now());
insert into vendor_member (vendor_id, user_id, role, ended_at) values
  ('00000000-0000-7000-8000-0000000040c1', '00000000-0000-7000-8000-0000000040a1', 'owner', null),
  ('00000000-0000-7000-8000-0000000040c1', '00000000-0000-7000-8000-0000000040a2', 'manager', now()),
  ('00000000-0000-7000-8000-0000000040c1', '00000000-0000-7000-8000-0000000040a3', 'staff', null),
  ('00000000-0000-7000-8000-0000000040c2', '00000000-0000-7000-8000-0000000040a1', 'owner', null);
-- The plan's own rules are checked elsewhere: written as the database owner, rules off.
set local session_replication_role = replica;
insert into event (id, host_user_id, event_date, start_time, municipality_id) values
  ('00000000-0000-7000-8000-0000000040d1', '00000000-0000-7000-8000-0000000040a4', current_date + 14, '14:00', '00000000-0000-7000-8000-0000000040b1');
insert into event_vendor (id, event_id, host_user_id, vendor_id, status, booked_at) values
  ('00000000-0000-7000-8000-0000000040e1', '00000000-0000-7000-8000-0000000040d1', '00000000-0000-7000-8000-0000000040a4', '00000000-0000-7000-8000-0000000040c1', 'booked', now()),
  ('00000000-0000-7000-8000-0000000040e2', '00000000-0000-7000-8000-0000000040d1', '00000000-0000-7000-8000-0000000040a4', '00000000-0000-7000-8000-0000000040c2', 'booked', now());
set local session_replication_role = origin;

set local role app_server;
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAIL  %', label; end if;
  raise notice 'PASS  %', label;
end $$;
select pg_temp.expect('the owner of a claimed business is still on its team',
  booking_still_theirs('00000000-0000-7000-8000-0000000040a1', '00000000-0000-7000-8000-0000000040e1'));
select pg_temp.expect('a manager who left isn''t',
  not booking_still_theirs('00000000-0000-7000-8000-0000000040a2', '00000000-0000-7000-8000-0000000040e1'));
select pg_temp.expect('staff aren''t (they were never told)',
  not booking_still_theirs('00000000-0000-7000-8000-0000000040a3', '00000000-0000-7000-8000-0000000040e1'));
select pg_temp.expect('an archived business''s owner isn''t',
  not booking_still_theirs('00000000-0000-7000-8000-0000000040a1', '00000000-0000-7000-8000-0000000040e2'));
select pg_temp.expect('a booking that''s gone isn''t anyone''s',
  not booking_still_theirs('00000000-0000-7000-8000-0000000040a1', gen_random_uuid()));
reset role;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end $$;
set local role anon;
do $$ begin
  begin
    perform booking_still_theirs('00000000-0000-7000-8000-0000000040a1', '00000000-0000-7000-8000-0000000040e1');
    raise exception 'FAIL  the browser-facing role asked who is on a business''s team';
  exception when insufficient_privilege then
    raise notice 'PASS  the browser-facing role can''t ask  (42501)';
  end;
end $$;
reset role;

rollback;
