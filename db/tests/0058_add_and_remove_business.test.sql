-- =============================================================================
-- Checks for migration 0058: Add my business, and asking to remove one (D-63). Rolled back.
-- =============================================================================

begin;

create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAIL  %', label; end if;
  raise notice 'PASS  %', label;
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
create function pg_temp.act(p_side text, p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('localites.side', coalesce(p_side, ''), true),
          set_config('localites.user_id', coalesce(p_user::text, ''), true),
          set_config('localites.vendor_id', '', true);
end $$;

-- Pat (a1) adds her own business; Owen (a3) owns c1, Mia (a4) manages it; Kim (a2) is a stranger.
insert into app_user (id, display_name, given_name, family_name, email) values
  ('00000000-0000-7000-8000-0000000058a1', 'Pat Q.', 'Pat', 'Quill', 'pat-58@example.com'),
  ('00000000-0000-7000-8000-0000000058a2', 'Kim R.', 'Kim', 'Reed', 'kim-58@example.com'),
  ('00000000-0000-7000-8000-0000000058a3', 'Owen S.', 'Owen', 'Stone', 'owen-58@example.com'),
  ('00000000-0000-7000-8000-0000000058a4', 'Mia T.', 'Mia', 'Tran', 'mia-58@example.com'),
  ('00000000-0000-7000-8000-0000000058a5', 'Ted U.', 'Ted', 'Ung', 'ted-58@example.com');
insert into platform_role (user_id, role) values ('00000000-0000-7000-8000-0000000058a5', 'admin');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000058b1', 'test-town-58', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at, archived_at) values
  ('00000000-0000-7000-8000-0000000058c1', 'test-58-v', 'Vee Fifty Eight', '00000000-0000-7000-8000-0000000058b1', 'admin_entered', 'published', 'claimed', now(), null),
  ('00000000-0000-7000-8000-0000000058c2', 'test-58-w', 'Wes Fifty Eight', '00000000-0000-7000-8000-0000000058b1', 'admin_entered', 'archived', 'claimed', null, now());
insert into vendor_member (vendor_id, user_id, role) values
  ('00000000-0000-7000-8000-0000000058c1', '00000000-0000-7000-8000-0000000058a3', 'owner'),
  ('00000000-0000-7000-8000-0000000058c1', '00000000-0000-7000-8000-0000000058a4', 'manager'),
  ('00000000-0000-7000-8000-0000000058c2', '00000000-0000-7000-8000-0000000058a3', 'owner');

set local role app_server;

-- ------------------------------------------------------------------ Add my business
insert into vendor_suggestion (id, business_name, contact, suggested_by, visitor_id, relationship, town, address_unit,
                               address_street, postal_code, hide_address_number, note)
values ('00000000-0000-7000-8000-0000000058d1', 'Pat''s Cakes', '705-555-0101', '00000000-0000-7000-8000-0000000058a1',
        gen_random_uuid(), 'owner', 'Orillia', null, 'Lakeshore Road', 'L3V 1A1', true, 'Call after 4');
select pg_temp.expect('their own business keeps its address, postal code and note',
  (select town = 'Orillia' and address_street = 'Lakeshore Road' and postal_code = 'L3V 1A1'
          and hide_address_number and note = 'Call after 4' and address_number is null
   from vendor_suggestion where id = '00000000-0000-7000-8000-0000000058d1'));
select pg_temp.expect_code('a private street number is never kept',
  $q$insert into vendor_suggestion (business_name, visitor_id, suggested_by, relationship, address_street, address_number, hide_address_number)
     values ('X', gen_random_uuid(), '00000000-0000-7000-8000-0000000058a1', 'owner', 'Main Street', '22', true)$q$, '23514');
select pg_temp.expect_code('a number needs its street',
  $q$insert into vendor_suggestion (business_name, visitor_id, suggested_by, relationship, address_number)
     values ('X', gen_random_uuid(), '00000000-0000-7000-8000-0000000058a1', 'owner', '22')$q$, '23514');
select pg_temp.expect_code('a public suggestion can’t carry an address',
  $q$insert into vendor_suggestion (business_name, visitor_id, address_street) values ('X', gen_random_uuid(), 'Main Street')$q$, '23514');
select pg_temp.expect_code('a postal code is as Canada Post writes it',
  $q$insert into vendor_suggestion (business_name, visitor_id, suggested_by, relationship, postal_code)
     values ('X', gen_random_uuid(), '00000000-0000-7000-8000-0000000058a1', 'owner', 'l3v1a1')$q$, '23514');
select pg_temp.expect_code('a relationship is one of the four',
  $q$insert into vendor_suggestion (business_name, visitor_id, suggested_by, relationship)
     values ('X', gen_random_uuid(), '00000000-0000-7000-8000-0000000058a1', 'cousin')$q$, '23514');

-- The yearly clean-up of declined ones (0041) erases the contact: the address and note go with it.
insert into vendor_suggestion (id, business_name, contact, suggested_by, visitor_id, relationship, town, address_street,
                               address_number, postal_code, note, status, reviewed_by, reviewed_at, decline_reason)
values ('00000000-0000-7000-8000-0000000058d2', 'Old Cakes', 'old@example.com', '00000000-0000-7000-8000-0000000058a1',
        gen_random_uuid(), 'manager', 'Orillia', 'Main Street', '9', 'L3V 2B2', 'Old note', 'declined',
        '00000000-0000-7000-8000-0000000058a3', now() - interval '2 years', 'Not in our area');
update vendor_suggestion set contact = null where id = '00000000-0000-7000-8000-0000000058d2';
select pg_temp.expect('the clean-up takes the address and note with the contact',
  (select contact is null and town is null and address_street is null and address_number is null and postal_code is null
          and note is null and business_name = 'Old Cakes' and relationship = 'manager'
   from vendor_suggestion where id = '00000000-0000-7000-8000-0000000058d2'));
-- A public suggestion's clean-up is as before.
insert into vendor_suggestion (id, business_name, contact, visitor_id, website)
values ('00000000-0000-7000-8000-0000000058d3', 'Someone Else', 'x@example.com', gen_random_uuid(), 'https://example.com');
update vendor_suggestion set contact = null where id = '00000000-0000-7000-8000-0000000058d3';
select pg_temp.expect('…a public suggestion keeps its website',
  (select website = 'https://example.com' from vendor_suggestion where id = '00000000-0000-7000-8000-0000000058d3'));

-- ------------------------------------------------------------------ Asking to remove a business
select pg_temp.expect_code('a manager can’t ask to remove it',
  $q$insert into business_removal_request (vendor_id, requested_by) values ('00000000-0000-7000-8000-0000000058c1', '00000000-0000-7000-8000-0000000058a4')$q$, 'LP582');
select pg_temp.expect_code('nor a stranger',
  $q$insert into business_removal_request (vendor_id, requested_by) values ('00000000-0000-7000-8000-0000000058c1', '00000000-0000-7000-8000-0000000058a2')$q$, 'LP582');
select pg_temp.expect_code('nor no one',
  $q$insert into business_removal_request (vendor_id) values ('00000000-0000-7000-8000-0000000058c1')$q$, 'LP582');
select pg_temp.expect_code('an archived business can’t be asked about again',
  $q$insert into business_removal_request (vendor_id, requested_by) values ('00000000-0000-7000-8000-0000000058c2', '00000000-0000-7000-8000-0000000058a3')$q$, 'LP583');
select pg_temp.expect_code('the server can’t start one as decided',
  $q$insert into business_removal_request (vendor_id, requested_by, status) values ('00000000-0000-7000-8000-0000000058c1', '00000000-0000-7000-8000-0000000058a3', 'done')$q$, '42501');
insert into business_removal_request (id, vendor_id, requested_by, reason)
values ('00000000-0000-7000-8000-0000000058e1', '00000000-0000-7000-8000-0000000058c1', '00000000-0000-7000-8000-0000000058a3', 'Closing in December');
select pg_temp.expect('the owner can ask', (select status = 'new' from business_removal_request where id = '00000000-0000-7000-8000-0000000058e1'));
select pg_temp.expect_code('one open request per business',
  $q$insert into business_removal_request (vendor_id, requested_by) values ('00000000-0000-7000-8000-0000000058c1', '00000000-0000-7000-8000-0000000058a3')$q$, '23505');
select pg_temp.expect_code('the words can’t be changed',
  $q$update business_removal_request set reason = 'Something else' where id = '00000000-0000-7000-8000-0000000058e1'$q$, '42501');
select pg_temp.expect_code('“done” only once the listing is archived',
  $q$update business_removal_request set status = 'done', decided_by = '00000000-0000-7000-8000-0000000058a5', decided_at = now()
     where id = '00000000-0000-7000-8000-0000000058e1'$q$, 'LP586');
select pg_temp.expect_code('declining needs a note',
  $q$update business_removal_request set status = 'declined', decided_by = '00000000-0000-7000-8000-0000000058a5', decided_at = now()
     where id = '00000000-0000-7000-8000-0000000058e1'$q$, '23514');
update business_removal_request set status = 'declined', decided_by = '00000000-0000-7000-8000-0000000058a5', decided_at = now(),
  decision_note = 'People have bookings with them in November'
where id = '00000000-0000-7000-8000-0000000058e1';
select pg_temp.expect_code('a decided request stays decided',
  $q$update business_removal_request set status = 'new', decided_by = null, decided_at = null where id = '00000000-0000-7000-8000-0000000058e1'$q$, 'LP585');
select pg_temp.expect_code('the server can’t delete one', $q$delete from business_removal_request$q$, '42501');
select pg_temp.expect_code('a decided request’s note can’t be rewritten',
  $q$update business_removal_request set decision_note = 'Something else' where id = '00000000-0000-7000-8000-0000000058e1'$q$, 'LP585');

insert into business_removal_request (id, vendor_id, requested_by)
values ('00000000-0000-7000-8000-0000000058e2', '00000000-0000-7000-8000-0000000058c1', '00000000-0000-7000-8000-0000000058a3');
reset role;
update vendor set listing_status = 'archived', archived_at = now() where id = '00000000-0000-7000-8000-0000000058c1';
set local role app_server;
update business_removal_request set status = 'done', decided_by = '00000000-0000-7000-8000-0000000058a5', decided_at = now()
where id = '00000000-0000-7000-8000-0000000058e2';
select pg_temp.expect('“done” once the listing is archived', (select status = 'done' from business_removal_request where id = '00000000-0000-7000-8000-0000000058e2'));

-- ------------------------------------------------------------------ Who it would affect
reset role;
insert into conversation (id, consumer_user_id, vendor_id) values
  ('00000000-0000-7000-8000-0000000058f1', '00000000-0000-7000-8000-0000000058a2', '00000000-0000-7000-8000-0000000058c1');
insert into message (conversation_id, author_user_id, author_side, body) values
  ('00000000-0000-7000-8000-0000000058f1', '00000000-0000-7000-8000-0000000058a2', 'consumer', 'Hello');
insert into event (id, host_user_id, event_date, municipality_id) values
  ('00000000-0000-7000-8000-0000000058f2', '00000000-0000-7000-8000-0000000058a2', current_date + 10, '00000000-0000-7000-8000-0000000058b1');
insert into event_vendor (event_id, host_user_id, vendor_id, status, booked_at) values
  ('00000000-0000-7000-8000-0000000058f2', '00000000-0000-7000-8000-0000000058a2', '00000000-0000-7000-8000-0000000058c1', 'booked', now());
insert into saved_vendor (user_id, vendor_id) values ('00000000-0000-7000-8000-0000000058a2', '00000000-0000-7000-8000-0000000058c1');
set local role app_server;
select pg_temp.act('team', '00000000-0000-7000-8000-0000000058a5');
select pg_temp.expect('the team sees how many conversations, upcoming bookings and saves it has',
  (select conversations = 1 and bookings = 1 and saved = 1 from removal_affects('00000000-0000-7000-8000-0000000058c1')));
select pg_temp.act('person', '00000000-0000-7000-8000-0000000058a3');
select pg_temp.expect_code('…an owner can’t', $q$select * from removal_affects('00000000-0000-7000-8000-0000000058c1')$q$, 'LP101');
select pg_temp.act(null, null);

-- ------------------------------------------------------------------ Download your data
select pg_temp.act('person', '00000000-0000-7000-8000-0000000058a1');
select pg_temp.expect('Download your data has the businesses you added, with the address',
  (select jsonb_array_length(my_data()->'businesses_you_added') = 2
          and my_data()->'businesses_you_added'->0->>'street' = 'Lakeshore Road'
          and (my_data()->'businesses_you_added'->0->>'street_number_private')::boolean));
select pg_temp.expect('…and still everything 0057 had', my_data() ? 'message_groups' and my_data() ? 'suggested_businesses');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000058a3');
select pg_temp.expect('the owner’s has their removal requests',
  (select jsonb_array_length(my_data()->'asked_to_remove') = 2 and my_data()->'asked_to_remove'->0->>'reason' = 'Closing in December'));
select pg_temp.act('person', '00000000-0000-7000-8000-0000000058a2');
select pg_temp.expect('someone else sees none of it',
  (select jsonb_array_length(my_data()->'businesses_you_added') = 0 and jsonb_array_length(my_data()->'asked_to_remove') = 0));
select pg_temp.act('team', '00000000-0000-7000-8000-0000000058a5');
select pg_temp.expect_code('only as yourself', $q$select my_data()$q$, 'LP101');
select pg_temp.expect_code('the old one is closed to the server', $q$select my_data_0057()$q$, '42501');

-- ------------------------------------------------------------------ Once their claim is decided
reset role;
insert into vendor_suggestion (id, business_name, contact, suggested_by, visitor_id, relationship, town, address_street, note,
                               status, vendor_id, reviewed_by, reviewed_at)
values ('00000000-0000-7000-8000-0000000058d4', 'Ted''s Tents', '705-555-0199', '00000000-0000-7000-8000-0000000058a2', gen_random_uuid(),
        'owner', 'Orillia', 'Main Street', 'Mornings', 'added', '00000000-0000-7000-8000-0000000058c2',
        '00000000-0000-7000-8000-0000000058a5', now());
insert into vendor_claim (id, vendor_id, claimant_user_id, relationship) values
  ('00000000-0000-7000-8000-0000000058f9', '00000000-0000-7000-8000-0000000058c2', '00000000-0000-7000-8000-0000000058a2', 'owner');
select pg_temp.expect('while the claim waits, the team still has the address',
  (select address_street = 'Main Street' from vendor_suggestion where id = '00000000-0000-7000-8000-0000000058d4'));
update vendor_claim set status = 'rejected', reviewed_by = '00000000-0000-7000-8000-0000000058a5', reviewed_at = now(), decision_note = 'Not theirs'
where id = '00000000-0000-7000-8000-0000000058f9';
select pg_temp.expect('once it’s decided, the address, contact and note go',
  (select contact is null and address_street is null and town is null and note is null and business_name = 'Ted''s Tents'
   from vendor_suggestion where id = '00000000-0000-7000-8000-0000000058d4'));

-- ------------------------------------------------------------------ An account deleted
reset role;
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000058c3', 'test-58-x', 'Ex Fifty Eight', '00000000-0000-7000-8000-0000000058b1', 'admin_entered', 'published', 'claimed', now());
insert into vendor_member (vendor_id, user_id, role) values ('00000000-0000-7000-8000-0000000058c3', '00000000-0000-7000-8000-0000000058a3', 'owner');
insert into business_removal_request (id, vendor_id, requested_by, reason)
values ('00000000-0000-7000-8000-0000000058e3', '00000000-0000-7000-8000-0000000058c3', '00000000-0000-7000-8000-0000000058a3', 'Moving away');
-- As delete_my_account() (0014): suggestions unlinked, then the account marked deleted.
update vendor_suggestion set suggested_by = null where suggested_by = '00000000-0000-7000-8000-0000000058a1';
select pg_temp.expect('Pat’s account deleted: her business’s address, contact and note go',
  (select contact is null and town is null and address_unit is null and address_street is null and postal_code is null
          and note is null and not hide_address_number and business_name = 'Pat''s Cakes'
   from vendor_suggestion where id = '00000000-0000-7000-8000-0000000058d1'));
update app_user set deleted_at = now() where id = '00000000-0000-7000-8000-0000000058a3';
select pg_temp.expect('Owen’s account deleted: his open request is withdrawn, his name and words taken off',
  (select status = 'withdrawn' and requested_by is null and reason is null from business_removal_request where id = '00000000-0000-7000-8000-0000000058e3'));
select pg_temp.expect('…and decided ones keep their outcome',
  (select bool_and(requested_by is null and reason is null) and count(*) filter (where status = 'declined') = 1
          and count(*) filter (where status = 'done') = 1
   from business_removal_request where id in ('00000000-0000-7000-8000-0000000058e1', '00000000-0000-7000-8000-0000000058e2')));

rollback;
