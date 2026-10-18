-- =============================================================================
-- Localites — migration 0042: the team can suspend an account
-- =============================================================================
-- The product owner, 18 October 2026 ("add all of them"): the team can lock out someone who
-- keeps causing trouble. Until now it could deny a review, act on a report or remove a photo,
-- and people could block each other in messages, but nothing stopped the person.
--   account_suspension: one row while an account is suspended (who, why, when). The server
--   reads it on every signed-in page (memberGate) and turns the person away; it can't write it.
--   suspend_account(user, reason) / lift_suspension(user, reason): the team only (acting as the
--   team, ADR-031), each writing audit_log in the same transaction. Not yourself, not a member
--   of the team (remove their role first), not a deleted account.
-- A suspended person's events, messages and reviews stay as they are; the team deals with any of
-- those as before. Lifting the suspension removes the row; the record stays in audit_log.
-- A suspension isn't a ban: the person can still delete their account (privacy law), which
-- frees their email, and then join again as a new account. The team suspends that one too.
--
-- Not destructive: one table and two functions.
-- =============================================================================

set search_path = public, extensions;

create table account_suspension (
  user_id       uuid primary key references app_user(id),
  reason        text not null check (char_length(btrim(reason)) between 1 and 300),
  suspended_by  uuid not null references app_user(id),
  suspended_at  timestamptz not null default now()
);
comment on table account_suspension is
  'Accounts the team has suspended. Written only by suspend_account / lift_suspension; the server reads it on every signed-in page.';
alter table account_suspension enable row level security;
create policy account_suspension_server_reads on account_suspension for select to app_server using (true);
grant select on account_suspension to app_server;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on account_suspension from %I', r);
    end if;
  end loop;
end $$;

create function suspend_account(p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  -- The team-role lock: someone can't be added to the team and suspended at the same moment.
  perform pg_advisory_xact_lock(hashtextextended('localites.platform-role', 0));
  if not acting_as_team() then
    raise exception 'only the Localites team can suspend an account' using errcode = 'LP101';
  end if;
  if char_length(v_reason) not between 1 and 300 then
    raise exception 'say why, in up to 300 characters' using errcode = 'LP166';
  end if;
  if p_user = acting_user() then
    raise exception 'you can''t suspend your own account' using errcode = 'LP177';
  end if;
  if not exists (select 1 from app_user where id = p_user and deleted_at is null) then
    raise exception 'there''s no such account (it may have been deleted)' using errcode = 'LP178';
  end if;
  if exists (select 1 from platform_role where user_id = p_user and revoked_at is null) then
    raise exception 'that person is on the Localites team: remove their team role first' using errcode = 'LP179';
  end if;
  insert into account_suspension (user_id, reason, suspended_by) values (p_user, v_reason, acting_user())
  on conflict (user_id) do nothing;
  if not found then
    raise exception 'that account is already suspended' using errcode = 'LP180';
  end if;
  insert into audit_log (actor_user_id, action, subject_type, subject_id, reason)
  values (acting_user(), 'account.suspend', 'app_user', p_user, v_reason);
end $$;

create function lift_suspension(p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform pg_advisory_xact_lock(hashtextextended('localites.platform-role', 0));
  if not acting_as_team() then
    raise exception 'only the Localites team can lift a suspension' using errcode = 'LP101';
  end if;
  if char_length(v_reason) not between 1 and 300 then
    raise exception 'say why, in up to 300 characters' using errcode = 'LP166';
  end if;
  delete from account_suspension where user_id = p_user;
  if not found then
    raise exception 'that account isn''t suspended (someone may have just lifted it)' using errcode = 'LP181';
  end if;
  insert into audit_log (actor_user_id, action, subject_type, subject_id, reason)
  values (acting_user(), 'account.unsuspend', 'app_user', p_user, v_reason);
end $$;

-- A deleted account's suspension goes with it (nothing is left to suspend).
create function account_suspension_goes() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  delete from account_suspension where user_id = new.id;
  return new;
end $$;
create trigger app_user_suspension_goes after update of deleted_at on app_user
  for each row when (new.deleted_at is not null and old.deleted_at is null)
  execute function account_suspension_goes();

revoke all on function suspend_account(uuid, text), lift_suspension(uuid, text), account_suspension_goes() from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function suspend_account(uuid, text), lift_suspension(uuid, text) from %I', r);
    end if;
  end loop;
end $$;
grant execute on function suspend_account(uuid, text), lift_suspension(uuid, text) to app_server;
