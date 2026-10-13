-- =============================================================================
-- Localites — migration 0014: a person deletes their own account (E §8, D-10)
-- =============================================================================
-- 1. delete_my_account(): run by the app as the person themselves (side 'person', ADR-031).
--    In one transaction it:
--      - deletes their events, plans (and any flag notes on them) and saved businesses (D-10);
--      - ends their place on any business's team; a business left with no owner goes back
--        to unclaimed, as Remove owner does (D-35), recorded in status_change;
--      - withdraws their open claims and erases the notes they wrote on claims;
--      - deletes their personal details (person_profile) and sign-in code fingerprints;
--      - unlinks them from activity records (unlink_person, E §7a) and from suggestions;
--      - erases their name and email on app_user (the row stays, as "Former Localites
--        member", because history such as status_change and audit_log points at it);
--      - records the request for the team (account_deletion) and in audit_log.
--    A member of the Localites team can't: another admin removes their team role first.
-- 2. account_deletion: what the team still has to do by hand: remove the person's sign-in
--    record in Supabase (the site doesn't hold Supabase's admin key), within 30 days (E §8).
-- Not destructive to anyone else's data: only the person's own rows change. To undo the
-- function: a later migration drops it (deleted data can't come back, by design).
-- =============================================================================

set search_path = public, extensions;

create table account_deletion (
  user_id          uuid primary key references app_user(id),
  requested_at     timestamptz not null default now(),
  auth_removed_at  timestamptz,                         -- the team removed the Supabase sign-in record
  auth_removed_by  uuid references app_user(id),
  check ((auth_removed_at is null) = (auth_removed_by is null))
);
comment on table account_deletion is
  'People who deleted their account. Our data is erased at once; the team removes the Supabase sign-in record by hand within 30 days (runbook).';

alter table account_deletion enable row level security;
alter table account_deletion force row level security;
create policy account_deletion_team_read on account_deletion for select to app_server using (acting_as_team());
create policy account_deletion_team_done on account_deletion for update to app_server
  using (acting_as_team()) with check (acting_as_team());
grant select on account_deletion to app_server;
grant update (auth_removed_at, auth_removed_by) on account_deletion to app_server;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on account_deletion from %I', r);
    end if;
  end loop;
end $$;

-- The team marks a sign-in record removed in its own name, once.
create function enforce_account_deletion_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
begin
  if new.user_id <> old.user_id or new.requested_at <> old.requested_at then
    raise exception 'that can''t be changed' using errcode = 'LP100';
  end if;
  if old.auth_removed_at is not null then
    raise exception 'that is already done' using errcode = 'LP109';
  end if;
  if current_user = 'app_server' and new.auth_removed_at is not null then
    new.auth_removed_at := now();
    new.auth_removed_by := acting_user();
  end if;
  return new;
end $$;
create trigger account_deletion_rules before update on account_deletion
  for each row execute function enforce_account_deletion_rules();

create function delete_my_account() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  me uuid := acting_user();
  v_email text;
  v record;
begin
  if acting_side() is distinct from 'person' or me is null then
    raise exception 'only you can delete your own account' using errcode = 'LP101';
  end if;
  select email::text into v_email from app_user where id = me and deleted_at is null for update;
  if not found then
    raise exception 'this account is already closed' using errcode = 'LP109';
  end if;
  if exists (select 1 from platform_role where user_id = me and revoked_at is null) then
    raise exception 'a member of the Localites team can''t delete their account here' using errcode = 'LP121';
  end if;

  -- Their events and plans, and saved businesses (D-10).
  delete from event_vendor_flag_note n using event_vendor ev where n.event_vendor_id = ev.id and ev.host_user_id = me;
  delete from event_vendor where host_user_id = me;
  delete from event_private where host_user_id = me;
  delete from event where host_user_id = me;
  delete from saved_vendor where user_id = me;

  -- Their place on businesses' teams; a business left without an owner is unclaimed again.
  for v in
    update vendor_member set ended_at = now() where user_id = me and ended_at is null
    returning vendor_id, role
  loop
    if v.role = 'owner' and not exists (
         select 1 from vendor_member m where m.vendor_id = v.vendor_id and m.role = 'owner' and m.ended_at is null) then
      insert into status_change (subject_type, subject_id, field, from_status, to_status, actor_user_id, actor_kind, reason)
      select 'vendor', x.id, 'claim_status', x.claim_status, 'unclaimed', me, 'consumer', 'The owner deleted their Localites account.'
      from vendor x where x.id = v.vendor_id and x.claim_status <> 'unclaimed';
      update vendor set claim_status = 'unclaimed' where id = v.vendor_id and claim_status <> 'unclaimed';
    end if;
  end loop;

  -- Their claims: open ones withdrawn, and the words they wrote erased.
  update vendor_claim set status = 'withdrawn' where claimant_user_id = me and status = 'submitted';
  update vendor_claim set claimant_note = null where claimant_user_id = me and claimant_note is not null;

  -- Personal details, sign-in code fingerprints, and links to activity and suggestions.
  delete from person_profile where user_id = me;
  delete from sign_in_code_event where email_hash = encode(sha256(convert_to(lower(btrim(v_email)), 'UTF8')), 'hex');
  perform unlink_person(me);
  update vendor_suggestion set suggested_by = null where suggested_by = me;

  -- The account row stays (history points at it) but holds nothing personal.
  update app_user
  set display_name = 'Former Localites member', email = 'deleted-' || id::text || '@deleted.invalid',
      given_name = null, family_name = null, deleted_at = now()
  where id = me;

  insert into account_deletion (user_id) values (me);
  insert into audit_log (actor_user_id, action, subject_type, subject_id)
  values (me, 'account.delete', 'app_user', me);
end $$;

revoke all on function delete_my_account() from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function delete_my_account() from %I', r);
    end if;
  end loop;
end $$;
grant execute on function delete_my_account() to app_server;
