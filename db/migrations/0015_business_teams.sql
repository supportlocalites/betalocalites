-- =============================================================================
-- Localites — migration 0015: a business owner adds their own team (screen V4, E §3)
-- =============================================================================
-- 1. vendor_invite: the owner invites someone by email as a manager or staff. The link in
--    the email carries a secret; only its SHA-256 fingerprint is stored. It works once, for
--    7 days, and only for the person whose account has that email address.
-- 2. When a business's owner leaves (the team's Remove owner, D-34/ADR-029, or the owner
--    deleting their account, migration 0014), everyone else on its team leaves too and open
--    invitations are cancelled: nobody keeps running a business that has no owner.
-- Roles (E §3): a manager does everything the owner does except the team and ownership; staff
-- will read and reply to the business's messages (Stage 2B).
-- Not destructive: one new table and one trigger. To undo: a later migration drops them.
-- =============================================================================

set search_path = public, extensions;

create table vendor_invite (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid not null references vendor(id),
  email         citext not null check (char_length(email::text) between 3 and 254),
  role          text not null check (role in ('manager', 'staff')),
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by    uuid not null references app_user(id),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '7 days',
  accepted_at   timestamptz,
  accepted_by   uuid references app_user(id),
  revoked_at    timestamptz,
  email_status  text not null default 'pending' check (email_status in ('pending', 'sent', 'failed')),
  email_failure text,
  check ((accepted_at is null) = (accepted_by is null)),
  check (accepted_at is null or revoked_at is null)
);
-- One open invitation per business and address.
create unique index vendor_invite_open on vendor_invite (vendor_id, email) where accepted_at is null and revoked_at is null;
create index vendor_invite_by_vendor on vendor_invite (vendor_id, created_at);

-- Access: the app role only, as the other business tables (ADR-004); the server checks the
-- owner on every request, as owner editing does (ADR-029).
alter table vendor_invite enable row level security;
alter table vendor_invite force row level security;
create policy app_server_all on vendor_invite to app_server using (true) with check (true);
grant select, insert on vendor_invite to app_server;
grant update (accepted_at, accepted_by, revoked_at, email_status, email_failure) on vendor_invite to app_server;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on vendor_invite from %I', r);
    end if;
  end loop;
end $$;

-- When the last owner leaves, the rest of the team leaves too, and invitations are cancelled.
create function end_team_without_owner() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if old.role = 'owner' and old.ended_at is null and new.ended_at is not null
     and not exists (select 1 from vendor_member m where m.vendor_id = new.vendor_id and m.role = 'owner' and m.ended_at is null) then
    update vendor_member set ended_at = new.ended_at where vendor_id = new.vendor_id and ended_at is null;
    update vendor_invite set revoked_at = now()
    where vendor_id = new.vendor_id and accepted_at is null and revoked_at is null;
  end if;
  return null;
end $$;
create trigger vendor_member_team_without_owner after update of ended_at on vendor_member
  for each row execute function end_team_without_owner();
revoke all on function end_team_without_owner() from public;
