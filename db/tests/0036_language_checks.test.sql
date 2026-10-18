-- =============================================================================
-- Checks for migration 0036: words checked before they show (D-50). One transaction, rolled back.
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

-- A reviews V (owner O, staff S); M on the team.
insert into app_user (id, display_name, given_name, family_name, email) values
  ('00000000-0000-7000-8000-0000000036a1', 'Ann Person', 'Ann', 'Person', 'a-36@example.com'),
  ('00000000-0000-7000-8000-0000000036a3', 'Owner O', 'Olive', 'Owner', 'o-36@example.com'),
  ('00000000-0000-7000-8000-0000000036a5', 'Staff S', 'Sam', 'Staff', 's-36@example.com'),
  ('00000000-0000-7000-8000-0000000036a7', 'Team M', 'Mo', 'Team', 'm-36@example.com');
insert into platform_role (user_id, role) values ('00000000-0000-7000-8000-0000000036a7', 'admin');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000036b1', 'test-town-36', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000036c1', 'test-36-v', 'Thirty-six V', '00000000-0000-7000-8000-0000000036b1', 'admin_entered', 'published', 'claimed', now());
insert into vendor_member (vendor_id, user_id, role) values
  ('00000000-0000-7000-8000-0000000036c1', '00000000-0000-7000-8000-0000000036a3', 'owner'),
  ('00000000-0000-7000-8000-0000000036c1', '00000000-0000-7000-8000-0000000036a5', 'staff');
insert into event (id, host_user_id, event_date, municipality_id) values
  ('00000000-0000-7000-8000-0000000036f1', '00000000-0000-7000-8000-0000000036a1', current_date - 5, '00000000-0000-7000-8000-0000000036b1');
insert into event_vendor (id, event_id, host_user_id, vendor_id, status, booked_at) values
  ('00000000-0000-7000-8000-0000000036e1', '00000000-0000-7000-8000-0000000036f1', '00000000-0000-7000-8000-0000000036a1',
   '00000000-0000-7000-8000-0000000036c1', 'booked', now() - interval '20 days');

set local role app_server;

-- ------------------------------------------------------------------ owners' held saves
insert into owner_edit_hold (id, vendor_id, user_id, base, submitted, changes, flag_reason) values
  ('00000000-0000-7000-8000-000000003601', '00000000-0000-7000-8000-0000000036c1', '00000000-0000-7000-8000-0000000036a3',
   '{}', '{}', '{"tagline": {"from": null, "to": "x"}}', 'Words: x');
select pg_temp.expect_equal('a held save waits, emailed status pending', (
  select status || ' ' || team_email_status || ' ' || (decided_at is null)::text from owner_edit_hold), 'waiting pending true');
select pg_temp.expect_code('only one waiting per business', $q$
  insert into owner_edit_hold (vendor_id, user_id, base, submitted, changes, flag_reason) values
  ('00000000-0000-7000-8000-0000000036c1', '00000000-0000-7000-8000-0000000036a3', '{}', '{}', '{}', 'Words: y')$q$, '23505');
select pg_temp.expect_code('a reason for holding it is needed', $q$
  insert into owner_edit_hold (vendor_id, user_id, base, submitted, changes, flag_reason) values
  ('00000000-0000-7000-8000-0000000036c1', '00000000-0000-7000-8000-0000000036a3', '{}', '{}', '{}', ' ')$q$, '23514');
select pg_temp.expect_code('what was saved can''t be rewritten', $q$
  update owner_edit_hold set submitted = '{"tagline": "nice"}' where id = '00000000-0000-7000-8000-000000003601'$q$, '42501');
select pg_temp.expect_code('declining needs a reason', $q$
  update owner_edit_hold set status = 'declined', decided_by = '00000000-0000-7000-8000-0000000036a7'
  where id = '00000000-0000-7000-8000-000000003601'$q$, '23514');
select pg_temp.expect_code('putting it live records who', $q$
  update owner_edit_hold set status = 'published' where id = '00000000-0000-7000-8000-000000003601'$q$, '23514');
update owner_edit_hold set status = 'published', decided_by = '00000000-0000-7000-8000-0000000036a7'
where id = '00000000-0000-7000-8000-000000003601';
select pg_temp.expect_equal('put live: the database records when', (
  select status || ' ' || (decided_at is not null)::text from owner_edit_hold where id = '00000000-0000-7000-8000-000000003601'),
  'published true');
select pg_temp.expect_code('a decision is final', $q$
  update owner_edit_hold set status = 'withdrawn' where id = '00000000-0000-7000-8000-000000003601'$q$, 'LP171');
select pg_temp.expect_code('…and its reason can''t be added afterwards', $q$
  update owner_edit_hold set decision_reason = 'later' where id = '00000000-0000-7000-8000-000000003601'$q$, 'LP100');
insert into owner_edit_hold (id, vendor_id, user_id, base, submitted, changes, flag_reason) values
  ('00000000-0000-7000-8000-000000003602', '00000000-0000-7000-8000-0000000036c1', '00000000-0000-7000-8000-0000000036a3',
   '{}', '{}', '{}', 'AI checker: hate');
update owner_edit_hold set status = 'withdrawn', decided_by = '00000000-0000-7000-8000-0000000036a7', decision_reason = 'x'
where id = '00000000-0000-7000-8000-000000003602';
select pg_temp.expect_equal('withdrawn by the owner: nobody else is recorded as deciding', (
  select status || ' ' || coalesce(decided_by::text, 'none') || ' ' || coalesce(decision_reason, 'none')
  from owner_edit_hold where id = '00000000-0000-7000-8000-000000003602'), 'withdrawn none none');
select pg_temp.expect_code('a held save can''t be deleted', $q$
  delete from owner_edit_hold$q$, '42501');
reset role;
select pg_temp.expect_code('what was saved can''t be rewritten, even by the database owner (the rule, not only the rights)', $q$
  update owner_edit_hold set submitted = '{"tagline": "nice"}' where id = '00000000-0000-7000-8000-000000003602'$q$, 'LP100');
set local role app_server;

-- ------------------------------------------------------------------ a review's finding
select pg_temp.act('person', '00000000-0000-7000-8000-0000000036a1');
insert into review (id, event_vendor_id, author_user_id, rating, body, language_flag) values
  ('00000000-0000-7000-8000-000000003691', '00000000-0000-7000-8000-0000000036e1', '00000000-0000-7000-8000-0000000036a1',
   1, 'Rude words here', 'Words: rude');
select pg_temp.expect_equal('a review keeps the check''s finding for the team', (
  select status || ' ' || language_flag from review), 'pending Words: rude');
update review set body = 'Kinder now', language_flag = null where id = '00000000-0000-7000-8000-000000003691';
select pg_temp.expect_equal('the author rewrites it while it waits: checked again', (
  select coalesce(language_flag, 'clear') from review), 'clear');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000036a7');
update review set status = 'published' where id = '00000000-0000-7000-8000-000000003691';
select pg_temp.expect_code('the team can''t change a review''s finding', $q$
  update review set language_flag = 'Words: team' where id = '00000000-0000-7000-8000-000000003691'$q$, 'LP100');
select pg_temp.act('business', '00000000-0000-7000-8000-0000000036a3', '00000000-0000-7000-8000-0000000036c1');
select pg_temp.expect_code('the business can''t set a review''s finding', $q$
  update review set language_flag = 'Words: business' where id = '00000000-0000-7000-8000-000000003691'$q$, 'LP100');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000036a1');
select pg_temp.expect_code('once the team has looked, the finding stays as it was', $q$
  update review set language_flag = 'x' where id = '00000000-0000-7000-8000-000000003691'$q$, 'LP100');

-- ------------------------------------------------------------------ a held reply
select pg_temp.act('business', '00000000-0000-7000-8000-0000000036a3', '00000000-0000-7000-8000-0000000036c1');
update review set vendor_reply = 'Rude reply', reply_held_reason = 'Words: rude' where id = '00000000-0000-7000-8000-000000003691';
select pg_temp.expect_equal('a flagged reply is held, the database sets when', (
  select reply_held_reason || ' ' || (reply_held_at is not null)::text from review), 'Words: rude true');
select pg_temp.expect_equal('…and the business page doesn''t show it', (
  select coalesce(reply, 'no reply') from published_reviews('00000000-0000-7000-8000-0000000036c1')), 'no reply');
select pg_temp.expect_code('the business can''t release its own held reply', $q$
  update review set reply_held_reason = null where id = '00000000-0000-7000-8000-000000003691'$q$, 'LP100');
select pg_temp.act('person', '00000000-0000-7000-8000-0000000036a1');
select pg_temp.expect_code('the reviewer can''t release it either', $q$
  update review set reply_held_reason = null where id = '00000000-0000-7000-8000-000000003691'$q$, 'LP100');
select pg_temp.act('team', '00000000-0000-7000-8000-0000000036a7');
update review set reply_held_reason = null where id = '00000000-0000-7000-8000-000000003691';
select pg_temp.expect_equal('the team puts it live: shown on the business page', (
  select reply from published_reviews('00000000-0000-7000-8000-0000000036c1')), 'Rude reply');
select pg_temp.expect_code('once live, it can''t be held again', $q$
  update review set reply_held_reason = 'again' where id = '00000000-0000-7000-8000-000000003691'$q$, 'LP100');
select pg_temp.expect_code('Localites still never changes what people wrote', $q$
  update review set vendor_reply = 'Nicer' where id = '00000000-0000-7000-8000-000000003691'$q$, 'LP100');
reset role;

rollback;
