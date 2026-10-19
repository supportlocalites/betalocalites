-- =============================================================================
-- Checks for migration 0050: scenario-test fixes, round 5 part 1.
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

-- M22: a suggestion's connection fingerprint, kept two days.
set local session_replication_role = replica;
insert into vendor_suggestion (id, business_name, visitor_id, connection_hash, created_at) values
  ('00000000-0000-7000-8000-0000000050a1', 'Old suggestion', gen_random_uuid(), sha256('old-50'::bytea), now() - interval '3 days'),
  ('00000000-0000-7000-8000-0000000050a2', 'New suggestion', gen_random_uuid(), sha256('new-50'::bytea), now() - interval '1 hour');
set local session_replication_role = origin;
select pg_temp.expect_code('a fingerprint is 32 bytes, nothing else',
  $q$insert into vendor_suggestion (business_name, connection_hash) values ('Bad', 'short'::bytea)$q$, '23514');
set local role app_server;
select * from run_scheduled_deletions();
reset role;
select pg_temp.expect_equal('the morning run erases fingerprints over two days old, and keeps the new one',
  (select string_agg(business_name || ':' || (connection_hash is not null)::text, ' ' order by business_name) from vendor_suggestion
   where id in ('00000000-0000-7000-8000-0000000050a1', '00000000-0000-7000-8000-0000000050a2')),
  'New suggestion:true Old suggestion:false');

-- B6/M18: the column the owner's hide uses, and the new kind of email.
select pg_temp.expect_equal('vendors have owner_hidden_at, empty to begin with',
  (select count(*)::text from vendor where owner_hidden_at is not null), '0');
select pg_temp.expect_equal('the "ownership given" email is a known kind',
  (select (pg_get_constraintdef(oid) like '%ownership_given%')::text from pg_constraint where conname = 'notification_kind_check'), 'true');

rollback;
