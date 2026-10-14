-- =============================================================================
-- Checks for migration 0033: guests and replies (Stage 4, part 1). One transaction, rolled back.
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

-- A hosts a party in 10 days (V booked) and had one 100 days ago; B is another person; O owns V; M is on the team.
insert into app_user (id, display_name, given_name, family_name, email) values
  ('00000000-0000-7000-8000-0000000033a1', 'Ann Host', 'Ann', 'Host', 'a-33@example.com'),
  ('00000000-0000-7000-8000-0000000033a2', 'Bo Other', 'Bo', 'Other', 'b-33@example.com'),
  ('00000000-0000-7000-8000-0000000033a3', 'Owner O', 'Olive', 'Owner', 'o-33@example.com'),
  ('00000000-0000-7000-8000-0000000033a7', 'Team M', 'Mo', 'Team', 'm-33@example.com');
insert into platform_role (user_id, role) values ('00000000-0000-7000-8000-0000000033a7', 'admin');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000033b1', 'test-town-33', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000033c1', 'test-33-v', 'Thirty-three V', '00000000-0000-7000-8000-0000000033b1', 'admin_entered', 'published', 'claimed', now());
insert into vendor_member (vendor_id, user_id, role) values
  ('00000000-0000-7000-8000-0000000033c1', '00000000-0000-7000-8000-0000000033a3', 'owner');
insert into event (id, host_user_id, event_date, municipality_id) values
  ('00000000-0000-7000-8000-0000000033f1', '00000000-0000-7000-8000-0000000033a1', current_date + 10, '00000000-0000-7000-8000-0000000033b1'),
  ('00000000-0000-7000-8000-0000000033f2', '00000000-0000-7000-8000-0000000033a1', current_date - 100, '00000000-0000-7000-8000-0000000033b1');
insert into event_private (event_id, host_user_id, title, venue_note, budget_cents, guest_message) values
  ('00000000-0000-7000-8000-0000000033f1', '00000000-0000-7000-8000-0000000033a1', 'Sam''s 8th', 'Our backyard', 50000, 'Bring a swimsuit!'),
  ('00000000-0000-7000-8000-0000000033f2', '00000000-0000-7000-8000-0000000033a1', 'Old party', null, null, null);
insert into event_vendor (event_id, host_user_id, vendor_id, status, booked_at) values
  ('00000000-0000-7000-8000-0000000033f1', '00000000-0000-7000-8000-0000000033a1', '00000000-0000-7000-8000-0000000033c1', 'booked', now());
-- A guest of the old party (before the 90 days rule could run), with contact details.
insert into guest (id, event_id, host_user_id, name, email, phone, token_hash) values
  ('00000000-0000-7000-8000-0000000033d9', '00000000-0000-7000-8000-0000000033f2', '00000000-0000-7000-8000-0000000033a1',
   'Old guest', 'old@example.com', '705-555-0100', pg_temp.h('old-token'));

set local role app_server;

-- ---------------------------------------------------------------- the host's list
select pg_temp.act('person', '00000000-0000-7000-8000-0000000033a1');
insert into guest (id, event_id, host_user_id, name, phone, token_hash) values
  ('00000000-0000-7000-8000-0000000033d1', '00000000-0000-7000-8000-0000000033f1', '00000000-0000-7000-8000-0000000033a1',
   'Grandma Jo', '705-555-0101', pg_temp.h('tok-1'));
insert into guest (id, event_id, host_user_id, name, token_hash) values
  ('00000000-0000-7000-8000-0000000033d2', '00000000-0000-7000-8000-0000000033f1', '00000000-0000-7000-8000-0000000033a1',
   'Uncle Rob', pg_temp.h('tok-2'));
select pg_temp.expect_equal('the host adds guests to their own event', (
  select string_agg(name, ',' order by name) from guest where event_id = '00000000-0000-7000-8000-0000000033f1'), 'Grandma Jo,Uncle Rob');
select pg_temp.expect_code('…not to an event that''s over', $q$
  insert into guest (id, event_id, host_user_id, name, token_hash) values
  (gen_random_uuid(), '00000000-0000-7000-8000-0000000033f2', '00000000-0000-7000-8000-0000000033a1', 'Late', sha256('late'::bytea))$q$, 'LP161');
select pg_temp.expect_code('the host can''t write a guest''s reply', $q$
  update guest set response = 'yes', party_size = 2, replied_at = now() where id = '00000000-0000-7000-8000-0000000033d1'$q$, '42501');
select pg_temp.expect_code('a new link must be the next version', $q$
  update guest set token_hash = sha256('tok-x'::bytea), link_version = 5 where id = '00000000-0000-7000-8000-0000000033d1'$q$, 'LP100');
update guest set token_hash = pg_temp.h('tok-1b'), link_version = 2 where id = '00000000-0000-7000-8000-0000000033d1';
select pg_temp.expect_equal('…a new link replaces the old one', (
  select link_version::text from guest where id = '00000000-0000-7000-8000-0000000033d1'), '2');

select pg_temp.act('person', '00000000-0000-7000-8000-0000000033a2');
select pg_temp.expect_equal('another person sees no guests', (select count(*)::text from guest), '0');
select pg_temp.expect_code('…and can''t add one to someone else''s event', $q$
  insert into guest (id, event_id, host_user_id, name, token_hash) values
  (gen_random_uuid(), '00000000-0000-7000-8000-0000000033f1', '00000000-0000-7000-8000-0000000033a2', 'Sneak', sha256('s'::bytea))$q$, 'LP101');
select pg_temp.expect_code('…or in the host''s name', $q$
  insert into guest (id, event_id, host_user_id, name, token_hash) values
  (gen_random_uuid(), '00000000-0000-7000-8000-0000000033f1', '00000000-0000-7000-8000-0000000033a1', 'Sneak', sha256('s'::bytea))$q$, 'LP101');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000033a3', '00000000-0000-7000-8000-0000000033c1');
select pg_temp.expect_equal('a booked business sees no guests', (select count(*)::text from guest), '0');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000033a7');
select pg_temp.expect_equal('nor does the Localites team', (select count(*)::text from guest), '0');
select pg_temp.act(null, null);
select pg_temp.expect_equal('nor anyone not acting', (select count(*)::text from guest), '0');

-- ---------------------------------------------------------------- a guest's link
select pg_temp.expect_equal('the old link stops working once replaced', (
  select count(*)::text from invitation_for(pg_temp.h('tok-1'))), '0');
select pg_temp.expect_equal('a guest''s link shows their invitation: never the budget or the businesses', (
  select guest_name || ' | ' || title || ' | ' || town || ' | ' || venue_note || ' | ' || message || ' | ' || host_name || ' | ' || status
  from invitation_for(pg_temp.h('tok-1b'))),
  'Grandma Jo | Sam''s 8th | Test Town | Our backyard | Bring a swimsuit! | Ann | open');
reset role;
select pg_temp.expect_equal('…and the host sees it was opened', (
  select (first_opened_at is not null)::text from guest where id = '00000000-0000-7000-8000-0000000033d1'), 'true');
set local role app_server;
select pg_temp.act(null, null);
select invitation_reply(pg_temp.h('tok-1b'), 'yes', 2::smallint, '  Can''t wait!  ');
select pg_temp.expect_equal('the guest replies: yes, 2 people, a note', (
  select response || ' ' || party_size::text || ' ' || reply_note from invitation_for(pg_temp.h('tok-1b'))), 'yes 2 Can''t wait!');
select invitation_reply(pg_temp.h('tok-1b'), 'no', 3::smallint, '');
select pg_temp.expect_equal('…changes it (latest wins; no party size for "no")', (
  select response || ' ' || coalesce(party_size::text, '-') || ' ' || coalesce(reply_note, '-') from invitation_for(pg_temp.h('tok-1b'))), 'no - -');
select pg_temp.expect_code('a made-up link replies nothing', $q$
  select invitation_reply(sha256('guess'::bytea), 'yes', 1::smallint, null)$q$, 'LP101');
select pg_temp.expect_code('a reply must be yes, no or maybe', $q$
  select invitation_reply(pg_temp.h('tok-2'), 'perhaps', 1::smallint, null)$q$, 'LP100');
select pg_temp.expect_code('a party of 50 is refused', $q$
  select invitation_reply(pg_temp.h('tok-2'), 'yes', 50::smallint, null)$q$, '23514');
select pg_temp.expect_equal('the old party''s link: over 30 days after, it no longer opens', (
  select count(*)::text from invitation_for(pg_temp.h('old-token'))), '0');

-- Replies close when the event is over; a cancelled event says so.
reset role;
update event set event_date = current_date - 1 where id = '00000000-0000-7000-8000-0000000033f1';
set local role app_server;
select pg_temp.expect_equal('the day after: the invitation still opens, replies closed', (
  select status from invitation_for(pg_temp.h('tok-2'))), 'closed');
select pg_temp.expect_code('…and a reply is refused', $q$
  select invitation_reply(pg_temp.h('tok-2'), 'yes', 1::smallint, null)$q$, 'LP164');
reset role;
update event set event_date = current_date + 10, status = 'cancelled', cancelled_at = now() where id = '00000000-0000-7000-8000-0000000033f1';
set local role app_server;
select pg_temp.expect_equal('cancelled: the guest is told', (select status from invitation_for(pg_temp.h('tok-2'))), 'cancelled');
select pg_temp.expect_code('…and can''t reply', $q$
  select invitation_reply(pg_temp.h('tok-2'), 'yes', 1::smallint, null)$q$, 'LP102');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000033a1');
select pg_temp.expect_code('no guests are added to a cancelled event', $q$
  insert into guest (id, event_id, host_user_id, name, token_hash) values
  (gen_random_uuid(), '00000000-0000-7000-8000-0000000033f1', '00000000-0000-7000-8000-0000000033a1', 'Late', sha256('late2'::bytea))$q$, 'LP102');

-- ---------------------------------------------------------------- 90 days after
select pg_temp.act(null, null);
select pg_temp.expect_equal('the morning job erases phone numbers and emails 90 days after the event', (
  select erase_guest_contacts()::text), '1');
reset role;
select pg_temp.expect_equal('…the name stays', (
  select name || ' ' || coalesce(email, '-') || ' ' || coalesce(phone, '-') from guest where id = '00000000-0000-7000-8000-0000000033d9'),
  'Old guest - -');
set local role app_server;
select pg_temp.act('person', '00000000-0000-7000-8000-0000000033a1');
select pg_temp.expect_code('…and they can''t be put back', $q$
  update guest set phone = '705-555-0199' where id = '00000000-0000-7000-8000-0000000033d9'$q$, 'LP163');

reset role;
update app_user set given_name = null, family_name = null where id = '00000000-0000-7000-8000-0000000033a1';
set local role app_server;
select pg_temp.act(null, null);
select pg_temp.expect_equal('a host with no first name given: no name shown (never a full or email-derived name)', (
  select coalesce(host_name, 'none') from invitation_for(pg_temp.h('tok-2'))), 'none');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000033a1');

-- ---------------------------------------------------------------- the host deletes their account
select delete_my_account();
reset role;
select pg_temp.expect_equal('the guest list goes with the events', (
  select count(*)::text from guest where host_user_id = '00000000-0000-7000-8000-0000000033a1'), '0');

rollback;
