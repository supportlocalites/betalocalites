-- =============================================================================
-- Localites — migration 0005: personal details (D-36)
-- =============================================================================
-- Asked for when someone creates an account, and editable on "Your account". Only the
-- name is required (it stays on app_user). Gender, date of birth and street address are
-- not required and live in their own table, so that:
--   - businesses never see them (they see only totals, D-30);
--   - they're kept apart from records many pages read, and easy to erase with the account;
--   - no row exists for someone who gave none of them.
-- Anyone may create an account (D-36), so this can hold children's details: see E §7.
-- Not destructive: one new table.
-- =============================================================================

set search_path = public, extensions;

create table person_profile (
  user_id                uuid primary key references app_user(id),
  gender                 text check (gender in ('woman', 'man', 'non_binary', 'self_described', 'prefer_not_to_say')),
  gender_self_described  text check (char_length(gender_self_described) between 1 and 60),
  date_of_birth          date check (date_of_birth >= date '1900-01-01'),
  street_address         text check (char_length(street_address) between 1 and 200),
  unit                   text check (char_length(unit) between 1 and 40),
  town                   text check (char_length(town) between 1 and 100),
  province               text check (province in ('AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT')),
  postal_code            text check (postal_code ~ '^[A-Z][0-9][A-Z] [0-9][A-Z][0-9]$'),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- Words of their own only when they chose to describe it themselves.
  check ((gender = 'self_described') = (gender_self_described is not null))
);
create trigger person_profile_updated before update on person_profile
  for each row execute function set_updated_at();

-- Access: the app role only, same rules as every other table (ADR-004).
alter table person_profile enable row level security;
alter table person_profile force row level security;
create policy app_server_all on person_profile to app_server using (true) with check (true);
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on person_profile from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on person_profile from authenticated;
  end if;
end $$;

-- Delete: a person may clear their details, and erasing an account removes them.
grant select, insert, update, delete on person_profile to app_server;
