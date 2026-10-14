-- =============================================================================
-- Localites — migration 0021: Inquire, for businesses not on Localites yet (ADR-024)
-- =============================================================================
-- D-04 and D-05 (10 October 2026): a business that hasn't joined Localites shows Inquire.
-- A signed-in person can add a note and mention one of their events; we save it, email the
-- Localites team (supportlocalites@gmail.com) with the business, the person's name and
-- email and what they chose to share, and tell the person when the business joins. Nothing
-- suggests the business received a message.
--
-- 1. vendor_interest: one per person and business. The person reads and writes only their
--    own (ADR-031); the team reads all; nobody deletes, except deleting your account (§4).
--    What the person chose to share about an event is kept as it was sent (a one-line
--    summary: kind, date, town, guests), never the event's name or private details.
-- 2. take_joined_notices(): when the team approves a claim, the people who asked about that
--    business, each marked as told once.
-- 3. Deleting your account deletes your inquiries.
--
-- Not destructive: new table, functions and one trigger; nothing existing changes. To undo:
-- a later migration drops them.
-- =============================================================================

set search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- 1. INQUIRIES
-- -----------------------------------------------------------------------------
create table vendor_interest (
  id                  uuid primary key default gen_random_uuid(),
  vendor_id           uuid not null references vendor(id),
  user_id             uuid not null references app_user(id),
  note                text check (char_length(btrim(note)) between 1 and 1000),
  shared_event        text check (char_length(btrim(shared_event)) between 1 and 300),
  team_email_status   text not null default 'pending' check (team_email_status in ('pending', 'sent', 'failed')),
  team_email_sent_at  timestamptz,
  team_email_error    text check (char_length(team_email_error) <= 500),
  notified_joined_at  timestamptz,                        -- told the business joined (take_joined_notices)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (vendor_id, user_id),
  check ((team_email_status = 'sent') = (team_email_sent_at is not null)),
  check (team_email_status <> 'failed' or team_email_error is not null)
);
create index vendor_interest_recent on vendor_interest (created_at);
create index vendor_interest_person on vendor_interest (user_id, created_at);
comment on table vendor_interest is
  'Inquiries (ADR-024): a person interested in a business not on Localites. Only that person and the team read it; the business never does.';

-- Who may write what. The times and the "told it joined" mark belong to the database.
create function enforce_vendor_interest_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
begin
  if tg_op = 'UPDATE' and (new.id <> old.id or new.vendor_id <> old.vendor_id or new.user_id <> old.user_id
                           or new.created_at <> old.created_at) then
    raise exception 'an inquiry can''t be moved to another business or person' using errcode = 'LP100';
  end if;
  if current_user <> 'app_server' then return new; end if;        -- owner path (functions)

  if acting_side() is distinct from 'person' or new.user_id is distinct from acting_user() then
    raise exception 'only the person asking can send this' using errcode = 'LP101';
  end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from vendor where id = new.vendor_id and listing_status = 'published') then
      raise exception 'that business isn''t listed on Localites' using errcode = 'LP107';
    end if;
    if exists (select 1 from vendor where id = new.vendor_id and claim_status = 'claimed') then
      raise exception 'that business is on Localites: contact it directly' using errcode = 'LP130';
    end if;
    if exists (select 1 from vendor_member m where m.vendor_id = new.vendor_id
               and m.user_id = new.user_id and m.ended_at is null) then
      raise exception 'that''s your own business' using errcode = 'LP108';
    end if;
    new.created_at := now();
    new.team_email_status := 'pending'; new.team_email_sent_at := null; new.team_email_error := null;
  else
    if new.notified_joined_at is distinct from old.notified_joined_at then
      raise exception 'that can''t be changed' using errcode = 'LP100';
    end if;
    -- Sending again (only after the team email failed) may change the note and event.
    if (new.note is distinct from old.note or new.shared_event is distinct from old.shared_event)
       and old.team_email_status <> 'failed' then
      raise exception 'you''ve already told us about this business' using errcode = 'LP131';
    end if;
    new.team_email_sent_at := case when new.team_email_status = 'sent' then coalesce(old.team_email_sent_at, now()) end;
  end if;
  new.notified_joined_at := case when tg_op = 'UPDATE' then old.notified_joined_at end;
  new.updated_at := now();
  return new;
end $$;
create trigger vendor_interest_rules before insert or update on vendor_interest
  for each row execute function enforce_vendor_interest_rules();

alter table vendor_interest enable row level security;
alter table vendor_interest force row level security;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on vendor_interest from %I', r);
    end if;
  end loop;
end $$;
create policy vendor_interest_own on vendor_interest for all to app_server
  using (acting_side() = 'person' and user_id = acting_user())
  with check (acting_side() = 'person' and user_id = acting_user());
create policy vendor_interest_team on vendor_interest for select to app_server using (acting_as_team());
grant select, insert (id, vendor_id, user_id, note, shared_event) on vendor_interest to app_server;
grant update (note, shared_event, team_email_status, team_email_error) on vendor_interest to app_server;

-- -----------------------------------------------------------------------------
-- 2. TELLING PEOPLE THE BUSINESS JOINED (run by the team after approving a claim)
-- -----------------------------------------------------------------------------
-- The people who asked about this business and haven't been told, each marked as told in
-- the same step, so two approvals can't tell anyone twice. Deleted accounts are skipped.
create function take_joined_notices(p_vendor uuid)
returns table (interest_id uuid, user_id uuid, email text, name text)
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not acting_as_team() then
    raise exception 'only the Localites team can do this' using errcode = 'LP101';
  end if;
  if not exists (select 1 from vendor where id = p_vendor and claim_status = 'claimed') then
    return;
  end if;
  return query
  with told as (
    update vendor_interest vi set notified_joined_at = now()
    from app_user u
    where vi.vendor_id = p_vendor and vi.notified_joined_at is null and u.id = vi.user_id and u.deleted_at is null
    returning vi.id, vi.user_id
  )
  select t.id, t.user_id, u.email::text, u.display_name from told t join app_user u on u.id = t.user_id;
end $$;

-- -----------------------------------------------------------------------------
-- 3. DELETING YOUR ACCOUNT DELETES YOUR INQUIRIES (E §8; delete_my_account, 0014)
-- -----------------------------------------------------------------------------
create function forget_inquiries_of_deleted() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from vendor_interest where user_id = new.id;
  return new;
end $$;
create trigger app_user_forget_inquiries after update of deleted_at on app_user
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function forget_inquiries_of_deleted();

-- -----------------------------------------------------------------------------
-- 4. RIGHTS
-- -----------------------------------------------------------------------------
revoke all on function take_joined_notices(uuid), forget_inquiries_of_deleted() from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function take_joined_notices(uuid), forget_inquiries_of_deleted() from %I', r);
    end if;
  end loop;
end $$;
grant execute on function take_joined_notices(uuid) to app_server;
