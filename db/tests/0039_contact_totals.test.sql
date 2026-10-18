-- =============================================================================
-- Checks for migration 0039: messages and inquiries in a business's numbers (D-52). Rolled back.
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

-- V (claimed) and W; people A, B, C; Ann owns V.
insert into app_user (id, display_name, email) values
  ('00000000-0000-7000-8000-0000000039a1', 'A', 'a-39@example.com'),
  ('00000000-0000-7000-8000-0000000039a2', 'B', 'b-39@example.com'),
  ('00000000-0000-7000-8000-0000000039a3', 'C', 'c-39@example.com'),
  ('00000000-0000-7000-8000-0000000039a9', 'Ann', 'o-39@example.com');
insert into municipality (id, slug, name, region, is_active) values
  ('00000000-0000-7000-8000-0000000039b1', 'test-town-39', 'Test Town', 'Test County', true);
insert into vendor (id, slug, display_name, primary_municipality_id, source, listing_status, claim_status, published_at) values
  ('00000000-0000-7000-8000-0000000039c1', 'test-39-v', 'V', '00000000-0000-7000-8000-0000000039b1', 'admin_entered', 'published', 'claimed', now()),
  ('00000000-0000-7000-8000-0000000039c2', 'test-39-w', 'W', '00000000-0000-7000-8000-0000000039b1', 'admin_entered', 'published', 'claimed', now());
insert into vendor_member (vendor_id, user_id, role) values
  ('00000000-0000-7000-8000-0000000039c1', '00000000-0000-7000-8000-0000000039a9', 'owner');

-- Rules on the tables would stop setting times in the past: written as the database owner, rules off.
set local session_replication_role = replica;
-- Two inquiries about V (before it joined), one about W.
insert into vendor_interest (vendor_id, user_id, created_at) values
  ('00000000-0000-7000-8000-0000000039c1', '00000000-0000-7000-8000-0000000039a1', now() - interval '2 days'),
  ('00000000-0000-7000-8000-0000000039c1', '00000000-0000-7000-8000-0000000039a2', now() - interval '3 days'),
  ('00000000-0000-7000-8000-0000000039c2', '00000000-0000-7000-8000-0000000039a1', now() - interval '2 days');
-- A: replied to after 60 minutes. B: replied to after 180 minutes. C: no reply. An old team's
-- conversation (ended when the business left) doesn't count; nor does one with W.
insert into conversation (id, consumer_user_id, vendor_id, created_at, ended_at, ended_reason) values
  ('00000000-0000-7000-8000-0000000039d1', '00000000-0000-7000-8000-0000000039a1', '00000000-0000-7000-8000-0000000039c1', now() - interval '2 days', null, null),
  ('00000000-0000-7000-8000-0000000039d2', '00000000-0000-7000-8000-0000000039a2', '00000000-0000-7000-8000-0000000039c1', now() - interval '2 days', null, null),
  ('00000000-0000-7000-8000-0000000039d3', '00000000-0000-7000-8000-0000000039a3', '00000000-0000-7000-8000-0000000039c1', now() - interval '1 day', null, null),
  ('00000000-0000-7000-8000-0000000039d4', '00000000-0000-7000-8000-0000000039a3', '00000000-0000-7000-8000-0000000039c1', now() - interval '3 days', now() - interval '1 day', 'business_left'),
  ('00000000-0000-7000-8000-0000000039d5', '00000000-0000-7000-8000-0000000039a1', '00000000-0000-7000-8000-0000000039c2', now() - interval '2 days', null, null);
insert into message (conversation_id, author_user_id, author_side, body, created_at, removed_at) values
  ('00000000-0000-7000-8000-0000000039d1', '00000000-0000-7000-8000-0000000039a1', 'consumer', 'Hi', now() - interval '2 days', null),
  ('00000000-0000-7000-8000-0000000039d1', '00000000-0000-7000-8000-0000000039a9', 'vendor', 'Hello', now() - interval '2 days' + interval '60 minutes', null),
  ('00000000-0000-7000-8000-0000000039d2', '00000000-0000-7000-8000-0000000039a2', 'consumer', 'Hi', now() - interval '2 days', null),
  ('00000000-0000-7000-8000-0000000039d2', '00000000-0000-7000-8000-0000000039a2', 'consumer', '', now() - interval '2 days' + interval '5 minutes', now()),
  ('00000000-0000-7000-8000-0000000039d2', '00000000-0000-7000-8000-0000000039a9', 'vendor', 'Hello', now() - interval '2 days' + interval '180 minutes', null),
  ('00000000-0000-7000-8000-0000000039d3', '00000000-0000-7000-8000-0000000039a3', 'consumer', 'Anyone?', now() - interval '1 day', null),
  ('00000000-0000-7000-8000-0000000039d4', '00000000-0000-7000-8000-0000000039a3', 'consumer', 'Old team', now() - interval '3 days', null),
  ('00000000-0000-7000-8000-0000000039d5', '00000000-0000-7000-8000-0000000039a1', 'consumer', 'Other business', now() - interval '2 days', null);
set local session_replication_role = origin;

set local role app_server;
select pg_temp.expect_equal('V''s last week: 2 inquiries, 3 conversations, 3 messages, 2 replied, median 120 minutes', (
  select inquiries || ' ' || conversations || ' ' || messages || ' ' || replied || ' ' || median_reply_minutes
  from vendor_contact_totals('00000000-0000-7000-8000-0000000039c1', current_date - 7, current_date + 1)),
  '2 3 3 2 120');
select pg_temp.expect_equal('a period with nothing: all zero, no reply time', (
  select inquiries || ' ' || conversations || ' ' || messages || ' ' || replied || ' ' || coalesce(median_reply_minutes::text, 'none')
  from vendor_contact_totals('00000000-0000-7000-8000-0000000039c1', current_date - 60, current_date - 30)),
  '0 0 0 0 none');
select pg_temp.expect_equal('W''s own numbers only', (
  select inquiries || ' ' || conversations || ' ' || messages
  from vendor_contact_totals('00000000-0000-7000-8000-0000000039c2', current_date - 7, current_date + 1)),
  '1 1 1');
reset role;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end $$;
set local role anon;
do $$ begin
  begin
    perform vendor_contact_totals('00000000-0000-7000-8000-0000000039c1', current_date - 7, current_date + 1);
    raise exception 'FAIL  the browser-facing role read a business''s totals';
  exception when insufficient_privilege then
    raise notice 'PASS  the browser-facing role can''t read them  (42501)';
  end;
end $$;
reset role;

rollback;
