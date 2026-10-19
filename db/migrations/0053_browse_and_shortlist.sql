-- =============================================================================
-- Localites — migration 0053: Browse local, step 2 of the redesign (D-56, D-57)
-- =============================================================================
-- The product owner approved the Browse local design on 19 October 2026:
--   vendor.cost_level  "a range of $-$$$ which essentially means low cost, medium cost, high
--                      cost (this likely will be our team that embeds this...)" (D-56): set
--                      by the team only, never by a business; empty until the team sets it.
--   shortlist          the + on each card (D-57): a person's private list of businesses to
--                      contact together, kept without an event and moved onto one when they
--                      plan it ("the shortlist vendors can then be synced with an event when
--                      they finally create one"). Like saved_vendor: only the person acting as
--                      themselves reads or changes theirs (ADR-031); nobody is told; only
--                      listed businesses can be added; at most 30 listed ones. The bookmark stays the
--                      saved list (saved_vendor), now called favourites on the page.
--   my_data()          Download your data also has the shortlist (my_data_0052 kept, renamed).
--   An account deleted: its shortlist goes with it (as its saved businesses do).
--
-- Not destructive: one column, one table, a trigger, one function renamed and one added.
-- =============================================================================

set search_path = public, extensions;

alter table vendor add column cost_level smallint check (cost_level between 1 and 3);
comment on column vendor.cost_level is
  'How costly, as the team judges it (0053, D-56): 1 = $ (low), 2 = $$, 3 = $$$ (high). Set by the team only.';

create table shortlist (
  user_id     uuid not null references app_user(id),
  vendor_id   uuid not null references vendor(id),
  created_at  timestamptz not null default now(),
  primary key (user_id, vendor_id)
);
create index shortlist_by_vendor on shortlist (vendor_id);
comment on table shortlist is
  'A person''s shortlist (0053, D-57): businesses to contact together, private to them, moved onto an event when they plan one.';

create function enforce_shortlist_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
begin
  if current_user <> 'app_server' then return new; end if;
  if acting_side() is distinct from 'person' or new.user_id is distinct from acting_user() then
    raise exception 'only you can add to your shortlist' using errcode = 'LP101';
  end if;
  if not exists (select 1 from vendor where id = new.vendor_id and listing_status = 'published') then
    raise exception 'that business isn''t listed on Localites' using errcode = 'LP107';
  end if;
  -- Listed ones only: a business taken down meanwhile doesn't take a place (it's hidden).
  if (select count(*) from shortlist s join vendor v on v.id = s.vendor_id
      where s.user_id = new.user_id and v.listing_status = 'published') >= 30 then
    raise exception 'a shortlist holds at most 30 businesses' using errcode = 'LP140';
  end if;
  return new;
end $$;
create trigger shortlist_rules before insert on shortlist
  for each row execute function enforce_shortlist_rules();

alter table shortlist enable row level security;
alter table shortlist force row level security;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on shortlist from %I', r);
    end if;
  end loop;
end $$;
create policy shortlist_own on shortlist for all to app_server
  using (acting_side() = 'person' and user_id = acting_user())
  with check (acting_side() = 'person' and user_id = acting_user());
revoke all on shortlist from app_server;
grant select, insert (user_id, vendor_id), delete on shortlist to app_server;

-- An account deleted: its shortlist goes (as the other app_user_* clean-ups, 0021 to 0042).
create function shortlist_goes_with_account() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  delete from shortlist where user_id = new.id;
  return new;
end $$;
create trigger app_user_shortlist_goes after update of deleted_at on app_user
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function shortlist_goes_with_account();

-- Download your data: as 0052, plus the shortlist.
alter function my_data() rename to my_data_0052;
revoke all on function my_data_0052() from app_server;

create function my_data() returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  me uuid := acting_user();
  base jsonb := my_data_0052();   -- checks it's the person acting as themselves (LP101)
begin
  return base || jsonb_build_object(
    'shortlist', coalesce((select jsonb_agg(jsonb_build_object('business', v.display_name, 'added', s.created_at) order by s.created_at)
                           from shortlist s join vendor v on v.id = s.vendor_id where s.user_id = me), '[]'));
end $$;

revoke all on function my_data(), my_data_0052(), shortlist_goes_with_account(), enforce_shortlist_rules() from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function my_data(), my_data_0052(), shortlist_goes_with_account(), enforce_shortlist_rules() from %I', r);
    end if;
  end loop;
end $$;
grant execute on function my_data() to app_server;
