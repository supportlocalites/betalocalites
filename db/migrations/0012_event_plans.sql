-- =============================================================================
-- Localites — migration 0012: plan an event (Stage 2, slice 2A)
-- D-13 (one account, two sides; R3 notice, R4 flag, R5 what a business sees), D-18, D-29,
-- D-39–D-43; ADR-004, ADR-017, ADR-021, ADR-022, ADR-031 (who is acting, in the database)
-- =============================================================================
-- 1. Who is acting: the server tells the database, inside each transaction, which person
--    is acting and for which side (person, business or team). Unset means no rows.
-- 2. Event types: the team's list of kinds of event (starting list below, D-39; the team
--    can change it from Admin → Event types without a developer). Choosing one is optional.
-- 3. event: only what a booked business may know (date, town, guest estimate), plus the
--    optional type, times and lifecycle. event_private: the host's own details (the event's
--    name, which is required, where, ages, budget, notes) — never a business, never the team.
-- 4. event_vendor: a business on a plan. Only the host changes its status; only the
--    business flags it (flag_booking; its note is team-only). The database sets the times
--    and writes status_change.
-- 5. saved_vendor: a private bookmark; nobody is told.
-- 6. Ideas per type (D-43): the kinds of business suggested for each type, and businesses
--    the team features for a type between two dates. No money is recorded anywhere
--    (D-16, D-24, ADR-025): Localites only records that a placement exists and its dates.
-- 7. Counts for the Localites team only (D-42): saves, adds to plans and "marked booked"
--    per business, and events per type. Totals only; never who, never which event.
-- 8. Three more kinds of email: to a business (event cancelled, event changed) and to the
--    person (a business says it isn't booked, D-41).
-- 9. Row-level security with per-person rules on the eight new tables; minimal grants. A
--    business reaches its bookings only through two functions (section 6c), never the tables.
-- Not destructive: new functions, tables, policies and grants; one check list widened;
-- event types and their suggested kinds of business seeded; no existing row changes.
-- To undo: a later migration drops the new tables and functions and narrows the
-- notification kinds back.
-- =============================================================================

set search_path = public, extensions;

-- The team-only counts (section 7) and the featured list (section 6) are read by
-- functions that run as this migration's role and must see past row-level security.
-- Supabase's postgres role can; refuse to half-build otherwise.
do $$
begin
  if not (select rolsuper or rolbypassrls from pg_roles where rolname = current_user) then
    raise exception 'migration 0012 must be run by a role that bypasses row-level security (Supabase''s postgres role does)';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. WHO IS ACTING (ADR-031). Set by src/server/acting.server.ts with
--    set_config(..., true): ends with the transaction, safe with Hyperdrive and the pooler.
-- -----------------------------------------------------------------------------
create function acting_user() returns uuid
language sql stable security invoker set search_path = public, extensions as $$
  select nullif(current_setting('localites.user_id', true), '')::uuid
$$;

create function acting_side() returns text
language sql stable security invoker set search_path = public, extensions as $$
  select case current_setting('localites.side', true)
           when 'person' then 'person' when 'business' then 'business' when 'team' then 'team' end
$$;

create function acting_vendor() returns uuid
language sql stable security invoker set search_path = public, extensions as $$
  select nullif(current_setting('localites.vendor_id', true), '')::uuid
$$;

-- Acting for a business: a current owner or manager of it, and it isn't archived
-- (E §3: bookings marked are for owners and managers; D-29: only owners exist today).
create function acting_for_business() returns boolean
language sql stable security invoker set search_path = public, extensions as $$
  select coalesce(acting_side() = 'business' and exists (
    select 1 from vendor_member m join vendor v on v.id = m.vendor_id
    where m.vendor_id = acting_vendor() and m.user_id = acting_user()
      and m.role in ('owner', 'manager') and m.ended_at is null
      and v.listing_status <> 'archived'), false)
$$;

create function acting_as_team() returns boolean
language sql stable security invoker set search_path = public, extensions as $$
  select coalesce(acting_side() = 'team' and exists (
    select 1 from platform_role r join app_user u on u.id = r.user_id
    where r.user_id = acting_user() and r.role = 'admin' and r.revoked_at is null
      and u.deleted_at is null), false)
$$;

-- -----------------------------------------------------------------------------
-- 2. EVENT TYPES (X12)
-- -----------------------------------------------------------------------------
create table event_type (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique check (key ~ '^[a-z][a-z0-9_]{1,62}$'),   -- never changes (no grant)
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  is_active   boolean not null default true,          -- hidden types stay on events that use them
  sort_order  int not null default 0 check (sort_order between 0 and 9999),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index event_type_name on event_type (lower(name));
create trigger event_type_updated before update on event_type
  for each row execute function set_updated_at();

-- Starting list: owner decision D-39 (revised 12 October 2026). The team may rename,
-- reorder, hide or add types at /admin/event-types at any time; no code depends on these rows.
insert into event_type (key, name, sort_order) values
  ('kids_birthday',  'Children''s birthday party', 10),
  ('birthday',       'Birthday party',             20),
  ('baby_shower',    'Baby shower',                30),
  ('wedding',        'Wedding',                    40),
  ('wedding_shower', 'Wedding shower',             50),
  ('graduation',     'Graduation',                 60),
  ('anniversary',    'Anniversary',                70),
  ('retirement',     'Retirement party',           80),
  ('work_event',     'Work or team event',         90),
  ('fundraiser',     'Fundraiser',                 100),
  ('other',          'Something else',             999);

-- -----------------------------------------------------------------------------
-- 3. EVENT (what a booked business may know) and EVENT_PRIVATE (host only)
-- -----------------------------------------------------------------------------
create table event (
  id                    uuid primary key default gen_random_uuid(),
  host_user_id          uuid not null references app_user(id),
  event_type_id         uuid references event_type(id),                 -- optional, one tap (D-39)
  event_date            date not null,
  start_time            time,
  end_time              time,
  timezone              text not null default 'America/Toronto'
                        check (timezone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$'),
  municipality_id       uuid not null references municipality(id),       -- C2: town required
  guest_count_estimate  int check (guest_count_estimate between 1 and 5000),
  status                text not null default 'planning'
                        check (status in ('planning', 'cancelled', 'archived')),
  cancelled_at          timestamptz,
  archived_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (id, host_user_id),                                -- target of the composite keys
  check (end_time is null or start_time is not null),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check ((status = 'archived') = (archived_at is not null))
);
create trigger event_updated before update on event
  for each row execute function set_updated_at();
create index event_host on event (host_user_id, event_date);
comment on column event.event_type_id is
  'Optional (D-39). Used for ideas on the host''s own plan and the team''s totals; a business never sees it (D-40).';

-- When an event is over: its end time if given (next day if it runs past midnight),
-- otherwise the end of its date, in the event's own time zone. "Completed" is never
-- stored; it is a fact calculated from the date.
create function event_ends_at(e event) returns timestamptz
language sql stable security invoker set search_path = public, extensions as $$
  select ((e.event_date
           + case when e.end_time is not null and e.start_time is not null
                       and e.end_time < e.start_time then 1 else 0 end)
          + coalesce(e.end_time, time '23:59:59')) at time zone e.timezone
$$;

create table event_private (
  event_id       uuid primary key,
  host_user_id   uuid not null,
  title          text not null check (char_length(btrim(title)) between 1 and 120),  -- "Sam's party"; no child's full name needed (E §7)
  venue_note     text check (char_length(btrim(venue_note)) between 1 and 200),
  age_range_min  smallint check (age_range_min between 0 and 120),
  age_range_max  smallint check (age_range_max between 0 and 120),
  budget_cents   int check (budget_cents between 0 and 100000000),           -- private planning figure
  notes          text check (char_length(btrim(notes)) between 1 and 5000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  foreign key (event_id, host_user_id) references event (id, host_user_id),
  check (age_range_min is null or age_range_max is null or age_range_min <= age_range_max)
);
create trigger event_private_updated before update on event_private
  for each row execute function set_updated_at();
comment on table event_private is
  'The host''s own details, including the event''s name. Only the host can read or write them: never a business, never the team (E §4.2).';

-- -----------------------------------------------------------------------------
-- 4. EVENT_VENDOR
-- -----------------------------------------------------------------------------
create table event_vendor (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null,
  host_user_id       uuid not null,                 -- copy of event.host_user_id, held by the FK
  vendor_id          uuid not null references vendor(id),
  status             text not null default 'considering'
                     check (status in ('considering', 'booked', 'removed')),
  booked_at          timestamptz,
  removed_at         timestamptz,
  vendor_flagged_at  timestamptz,
  vendor_flagged_by  uuid references app_user(id),   -- the business's note is in event_vendor_flag_note (team only)
  flag_resolved_at   timestamptz,                    -- Stage 3 (X16)
  flag_outcome       text check (flag_outcome in ('booking_stands', 'booking_not_real')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (event_id, host_user_id) references event (id, host_user_id),
  unique (event_id, vendor_id),
  check ((status = 'booked') = (booked_at is not null)),
  check ((status = 'removed') = (removed_at is not null)),
  check ((vendor_flagged_at is null) = (vendor_flagged_by is null)),
  check ((flag_resolved_at is null) = (flag_outcome is null)),
  check (flag_resolved_at is null or vendor_flagged_at is not null)
);
create trigger event_vendor_updated before update on event_vendor
  for each row execute function set_updated_at();
create index event_vendor_by_vendor on event_vendor (vendor_id, status);
create index event_vendor_by_host on event_vendor (host_user_id);
create index event_vendor_open_flags on event_vendor (vendor_flagged_at)
  where vendor_flagged_at is not null and flag_resolved_at is null;
comment on column event_vendor.host_user_id is
  'Same as the event''s host (composite foreign key). Lets the rules check the host without reading event.';
comment on column event_vendor.vendor_flagged_at is
  'When the business last said this booking isn''t right. It counts for the current marking only when it is at or after booked_at (a person may un-mark and mark again).';

-- The business's note with a flag (D-41): for the Localites team only. Its own table, so
-- the person's rules on event_vendor can never reach it. Written only by flag_booking().
create table event_vendor_flag_note (
  event_vendor_id  uuid primary key references event_vendor(id),
  note             text not null check (char_length(btrim(note)) between 1 and 1000),
  updated_at       timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 5. SAVED_VENDOR (C6): a private bookmark (B §4: nobody is told)
-- -----------------------------------------------------------------------------
create table saved_vendor (
  user_id     uuid not null references app_user(id),
  vendor_id   uuid not null references vendor(id),
  created_at  timestamptz not null default now(),
  primary key (user_id, vendor_id)
);
create index saved_vendor_by_vendor on saved_vendor (vendor_id);

-- -----------------------------------------------------------------------------
-- 6. IDEAS PER TYPE (D-43): suggested kinds of business, and featured businesses
-- -----------------------------------------------------------------------------
-- Reference data, chosen by the team: "Businesses people often need" for each type.
create table event_type_category (
  event_type_id  uuid not null references event_type(id),
  category_id    uuid not null references category(id),
  sort_order     int not null default 0 check (sort_order between 0 and 9999),
  primary key (event_type_id, category_id)
);
create index event_type_category_by_category on event_type_category (category_id);

-- A sensible start, using only the categories of migration 0002; the team can change it.
-- A category renamed or retired since then is simply left out.
insert into event_type_category (event_type_id, category_id, sort_order)
select t.id, c.id, m.sort_order
from (values
  ('kids_birthday',  'party-rooms', 10), ('kids_birthday', 'indoor-play', 20), ('kids_birthday', 'custom-cakes', 30),
  ('kids_birthday',  'cupcakes', 40), ('kids_birthday', 'bouncy-castles', 50), ('kids_birthday', 'balloons', 60),
  ('kids_birthday',  'face-painting', 70), ('kids_birthday', 'magicians', 80), ('kids_birthday', 'characters', 90),
  ('birthday',       'party-rooms', 10), ('birthday', 'event-spaces', 20), ('birthday', 'caterers', 30),
  ('birthday',       'custom-cakes', 40), ('birthday', 'decor', 50), ('birthday', 'djs-and-music', 60),
  ('birthday',       'photographers', 70),
  ('baby_shower',    'event-spaces', 10), ('baby_shower', 'party-trays', 20), ('baby_shower', 'cupcakes', 30),
  ('baby_shower',    'dessert-tables', 40), ('baby_shower', 'balloons', 50), ('baby_shower', 'decor', 60),
  ('baby_shower',    'photographers', 70),
  ('wedding',        'halls', 10), ('wedding', 'event-spaces', 20), ('wedding', 'caterers', 30),
  ('wedding',        'mobile-bars', 40), ('wedding', 'custom-cakes', 50), ('wedding', 'tents-tables-chairs', 60),
  ('wedding',        'decor', 70), ('wedding', 'djs-and-music', 80), ('wedding', 'photographers', 90),
  ('wedding',        'videographers', 100),
  ('wedding_shower', 'event-spaces', 10), ('wedding_shower', 'party-trays', 20), ('wedding_shower', 'dessert-tables', 30),
  ('wedding_shower', 'custom-cakes', 40), ('wedding_shower', 'decor', 50), ('wedding_shower', 'photo-booths', 60),
  ('graduation',     'halls', 10), ('graduation', 'caterers', 20), ('graduation', 'food-trucks', 30),
  ('graduation',     'custom-cakes', 40), ('graduation', 'tents-tables-chairs', 50), ('graduation', 'photo-booths', 60),
  ('graduation',     'djs-and-music', 70), ('graduation', 'photographers', 80),
  ('anniversary',    'event-spaces', 10), ('anniversary', 'caterers', 20), ('anniversary', 'custom-cakes', 30),
  ('anniversary',    'decor', 40), ('anniversary', 'djs-and-music', 50), ('anniversary', 'photographers', 60),
  ('retirement',     'halls', 10), ('retirement', 'caterers', 20), ('retirement', 'party-trays', 30),
  ('retirement',     'mobile-bars', 40), ('retirement', 'custom-cakes', 50), ('retirement', 'djs-and-music', 60),
  ('work_event',     'event-spaces', 10), ('work_event', 'activity-centres', 20), ('work_event', 'caterers', 30),
  ('work_event',     'food-trucks', 40), ('work_event', 'party-trays', 50), ('work_event', 'photo-booths', 60),
  ('fundraiser',     'halls', 10), ('fundraiser', 'caterers', 20), ('fundraiser', 'food-trucks', 30),
  ('fundraiser',     'tents-tables-chairs', 40), ('fundraiser', 'djs-and-music', 50), ('fundraiser', 'photographers', 60),
  ('other',          'venue', 10), ('other', 'food-and-beverage', 20), ('other', 'sweets', 30),
  ('other',          'rentals-and-decor', 40), ('other', 'activities', 50), ('other', 'photography', 60)
) as m(type_key, category_slug, sort_order)
join event_type t on t.key = m.type_key
join category c on c.slug = m.category_slug;

-- The team features a business for a kind of event between two dates. Clearly labelled
-- where shown; never changes search results or reviews. Deliberately no money columns:
-- any arrangement for it happens outside Localites (D-16, D-24, ADR-025).
create table featured_placement (
  id             uuid primary key default gen_random_uuid(),
  vendor_id      uuid not null references vendor(id),
  event_type_id  uuid not null references event_type(id),
  starts_on      date not null,                     -- Toronto dates, both included
  ends_on        date not null,
  note           text check (char_length(btrim(note)) between 1 and 500),   -- team only
  created_by     uuid not null references app_user(id),
  created_at     timestamptz not null default now(),
  ended_at       timestamptz,                       -- ended early by the team
  ended_by       uuid references app_user(id),
  check (ends_on >= starts_on),
  check ((ended_at is null) = (ended_by is null))
);
create index featured_placement_by_type on featured_placement (event_type_id, starts_on) where ended_at is null;
create index featured_placement_by_vendor on featured_placement (vendor_id);
comment on table featured_placement is
  'Team only. People see at most 3 current placements of published businesses, through featured_for_type(), never the note.';

-- -----------------------------------------------------------------------------
-- RULES (triggers). "App path" means current_user = 'app_server'; any other role is the
-- owner path (migrations, a superuser in tests, support work in the SQL editor), where
-- only the "everyone" rules and the table checks apply. Errors carry an LPnnn code that
-- the server turns into plain words:
--   LP100 that can't be changed · LP101 not yours, or the wrong side · LP102 the event is
--   cancelled · LP103 that kind of event isn't offered · LP104 that town isn't offered ·
--   LP105 the date is outside the window · LP107 the business isn't listed · LP108 it's
--   your own business · LP109 that change isn't possible · LP110 already flagged
-- -----------------------------------------------------------------------------
create function enforce_event_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
declare
  today date := (now() at time zone 'America/Toronto')::date;
begin
  if tg_op = 'UPDATE' then                                         -- everyone
    if new.host_user_id <> old.host_user_id or new.created_at <> old.created_at
       or new.timezone <> old.timezone then
      raise exception 'the host and time zone of an event can''t be changed' using errcode = 'LP100';
    end if;
  end if;
  if current_user <> 'app_server' then return new; end if;        -- owner path

  if acting_side() is distinct from 'person' or new.host_user_id is distinct from acting_user() then
    raise exception 'only the person planning this event can change it' using errcode = 'LP101';
  end if;
  if tg_op = 'INSERT' and new.status <> 'planning' then
    raise exception 'a new event starts as planning' using errcode = 'LP109';
  end if;
  if tg_op = 'UPDATE' and old.status <> 'planning' then
    raise exception 'a cancelled event can''t be changed' using errcode = 'LP102';
  end if;
  -- The type is optional (D-39); when one is chosen, it must be one that's offered.
  if new.event_type_id is not null and (tg_op = 'INSERT' or new.event_type_id is distinct from old.event_type_id) then
    if not exists (select 1 from event_type where id = new.event_type_id and is_active) then
      raise exception 'that kind of event isn''t offered' using errcode = 'LP103';
    end if;
  end if;
  if tg_op = 'INSERT' or new.municipality_id <> old.municipality_id then
    if not exists (select 1 from municipality where id = new.municipality_id and is_active) then
      raise exception 'that town isn''t offered' using errcode = 'LP104';
    end if;
  end if;
  if tg_op = 'INSERT' or new.event_date <> old.event_date then
    if new.event_date < today - 60 or new.event_date > (today + interval '3 years')::date then
      raise exception 'the date must be within the last 60 days or the next 3 years' using errcode = 'LP105';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.status <> old.status then
    if new.status = 'cancelled' then new.cancelled_at := now();     -- the only change in 2A
    else raise exception 'that change to an event isn''t possible' using errcode = 'LP109';
    end if;
  end if;
  return new;
end $$;
create trigger event_rules before insert or update on event
  for each row execute function enforce_event_rules();

-- Every event has a name (D-39): its private row is written in the same transaction,
-- checked when the transaction commits.
create function enforce_event_has_name() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
begin
  if current_user <> 'app_server' then return null; end if;       -- owner path
  if not exists (select 1 from event_private where event_id = new.id) then
    raise exception 'an event needs a name' using errcode = 'LP109';
  end if;
  return null;
end $$;
create constraint trigger event_has_name after insert on event
  deferrable initially deferred
  for each row execute function enforce_event_has_name();

create function enforce_event_private_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
declare
  v_event_status text;
begin
  if tg_op = 'UPDATE' and (new.event_id <> old.event_id or new.host_user_id <> old.host_user_id) then
    raise exception 'private details can''t be moved to another event' using errcode = 'LP100';
  end if;
  if current_user <> 'app_server' then return new; end if;
  if acting_side() is distinct from 'person' or new.host_user_id is distinct from acting_user() then
    raise exception 'only the person planning this event can change it' using errcode = 'LP101';
  end if;
  -- Visible only through the host's own policy; another person's event reads as missing.
  select status into v_event_status from event where id = new.event_id;
  if v_event_status is null then
    raise exception 'only the person planning this event can change it' using errcode = 'LP101';
  elsif v_event_status <> 'planning' then
    raise exception 'a cancelled event can''t be changed' using errcode = 'LP102';
  end if;
  return new;
end $$;
create trigger event_private_rules before insert or update on event_private
  for each row execute function enforce_event_private_rules();

create function enforce_event_vendor_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
declare
  v_side text := acting_side();
  v_event_status text;
begin
  -- Everyone: links don't move; status follows B §4.
  if tg_op = 'UPDATE' then
    if new.event_id <> old.event_id or new.vendor_id <> old.vendor_id
       or new.host_user_id <> old.host_user_id or new.created_at <> old.created_at then
      raise exception 'a business on a plan can''t be moved to another event or business' using errcode = 'LP100';
    end if;
    if new.status <> old.status and (old.status, new.status) not in (
         ('considering', 'booked'), ('booked', 'considering'), ('considering', 'removed'),
         ('booked', 'removed'), ('removed', 'considering')) then
      raise exception 'that change to a plan isn''t possible' using errcode = 'LP109';
    end if;
  end if;
  if current_user <> 'app_server' then return new; end if;        -- owner path

  if tg_op = 'UPDATE' and (new.flag_resolved_at is distinct from old.flag_resolved_at
                            or new.flag_outcome is distinct from old.flag_outcome) then
    raise exception 'deciding on flags comes later' using errcode = 'LP101';
  end if;

  if v_side = 'person' then
    if new.host_user_id is distinct from acting_user() then
      raise exception 'only the person planning this event can change its plan' using errcode = 'LP101';
    end if;
    if tg_op = 'UPDATE' and (new.vendor_flagged_at is distinct from old.vendor_flagged_at
                              or new.vendor_flagged_by is distinct from old.vendor_flagged_by) then
      raise exception 'only the business can say a booking isn''t right' using errcode = 'LP101';
    end if;
    select status into v_event_status from event where id = new.event_id;   -- host policy
    if v_event_status is null then
      raise exception 'only the person planning this event can change its plan' using errcode = 'LP101';
    elsif v_event_status <> 'planning' then
      raise exception 'a cancelled event''s plan can''t be changed' using errcode = 'LP102';
    end if;
    if tg_op = 'INSERT' then
      if new.status <> 'considering' then
        raise exception 'a business joins a plan as considering' using errcode = 'LP109';
      end if;
      if not exists (select 1 from vendor where id = new.vendor_id and listing_status = 'published') then
        raise exception 'that business isn''t listed on Localites' using errcode = 'LP107';
      end if;
    end if;
    if new.status in ('considering', 'booked') and (tg_op = 'INSERT' or new.status <> old.status) then
      if exists (select 1 from vendor_member m where m.vendor_id = new.vendor_id
                 and m.user_id = new.host_user_id and m.ended_at is null) then
        raise exception 'you can''t put your own business on your own event plan' using errcode = 'LP108';
      end if;
      if exists (select 1 from vendor where id = new.vendor_id and listing_status = 'archived') then
        raise exception 'that business isn''t listed on Localites' using errcode = 'LP107';
      end if;
      -- Putting a removed business back is like adding it again: it must be listed now.
      if tg_op = 'UPDATE' and old.status = 'removed'
         and not exists (select 1 from vendor where id = new.vendor_id and listing_status = 'published') then
        raise exception 'that business isn''t listed on Localites' using errcode = 'LP107';
      end if;
    end if;
    -- The database owns the times; the app has no grant on them.
    if tg_op = 'INSERT' then
      new.booked_at := null; new.removed_at := null;
    elsif new.status <> old.status then
      new.booked_at  := case when new.status = 'booked'  then now() end;
      new.removed_at := case when new.status = 'removed' then now() end;
    end if;
    return new;

  end if;

  -- A business never writes plan rows directly: it flags through flag_booking() (owner path).
  raise exception 'no one is acting for a person or a business' using errcode = 'LP101';
end $$;
create trigger event_vendor_rules before insert or update on event_vendor
  for each row execute function enforce_event_vendor_rules();

create function enforce_saved_vendor_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
begin
  if current_user <> 'app_server' then return new; end if;
  if acting_side() is distinct from 'person' or new.user_id is distinct from acting_user() then
    raise exception 'only you can save to your list' using errcode = 'LP101';
  end if;
  if not exists (select 1 from vendor where id = new.vendor_id and listing_status = 'published') then
    raise exception 'that business isn''t listed on Localites' using errcode = 'LP107';
  end if;
  return new;
end $$;
create trigger saved_vendor_rules before insert on saved_vendor
  for each row execute function enforce_saved_vendor_rules();

-- Featured placements: added by a team member in their own name, for a listed business,
-- not already over; afterwards they can only be ended early, once. The database sets
-- when and by whom. (Who may write at all is the policies' job: the team only.)
create function enforce_featured_placement_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
begin
  if tg_op = 'UPDATE' then                                         -- everyone
    if new.vendor_id <> old.vendor_id or new.event_type_id <> old.event_type_id
       or new.starts_on <> old.starts_on or new.ends_on <> old.ends_on
       or new.note is distinct from old.note or new.created_by <> old.created_by
       or new.created_at <> old.created_at then
      raise exception 'a featured placement can''t be changed, only ended' using errcode = 'LP100';
    end if;
    if old.ended_at is not null and new.ended_at is distinct from old.ended_at then
      raise exception 'that placement has already ended' using errcode = 'LP109';
    end if;
  end if;
  if current_user <> 'app_server' then return new; end if;        -- owner path

  if tg_op = 'INSERT' then
    if new.created_by is distinct from acting_user() then
      raise exception 'a placement is added in your own name' using errcode = 'LP101';
    end if;
    if not exists (select 1 from vendor where id = new.vendor_id and listing_status = 'published') then
      raise exception 'that business isn''t listed on Localites' using errcode = 'LP107';
    end if;
    if new.ends_on < (now() at time zone 'America/Toronto')::date then
      raise exception 'that placement would already be over' using errcode = 'LP105';
    end if;
    new.ended_at := null; new.ended_by := null;
  elsif old.ended_at is null and new.ended_at is not null then
    new.ended_at := now();                     -- whatever value was sent
    new.ended_by := acting_user();
  end if;
  return new;
end $$;
create trigger featured_placement_rules before insert or update on featured_placement
  for each row execute function enforce_featured_placement_rules();

-- ADR-017: every status change and every flag is recorded by the database itself.
-- The reason column is never filled: status_change is kept for the team, so no private
-- text goes in.
create function record_plan_change() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
declare
  v_kind text := case acting_side() when 'person' then 'consumer' when 'business' then 'vendor'
                                    when 'team' then 'admin' else 'system' end;
  v_who  uuid := acting_user();
begin
  if tg_table_name = 'event' then
    if new.status <> old.status then
      insert into status_change (subject_type, subject_id, field, from_status, to_status, actor_user_id, actor_kind)
      values ('event', new.id, 'status', old.status, new.status, v_who, v_kind);
    end if;
  elsif tg_op = 'INSERT' then
    insert into status_change (subject_type, subject_id, field, from_status, to_status, actor_user_id, actor_kind)
    values ('event_vendor', new.id, 'status', null, new.status, v_who, v_kind);
  else
    if new.status <> old.status then
      insert into status_change (subject_type, subject_id, field, from_status, to_status, actor_user_id, actor_kind)
      values ('event_vendor', new.id, 'status', old.status, new.status, v_who, v_kind);
    end if;
    if new.vendor_flagged_at is not null and new.vendor_flagged_at is distinct from old.vendor_flagged_at then
      insert into status_change (subject_type, subject_id, field, from_status, to_status, actor_user_id, actor_kind)
      values ('event_vendor', new.id, 'vendor_flag', null, 'flagged', v_who, v_kind);
    end if;
    if new.flag_outcome is distinct from old.flag_outcome then
      insert into status_change (subject_type, subject_id, field, from_status, to_status, actor_user_id, actor_kind)
      values ('event_vendor', new.id, 'flag_outcome', old.flag_outcome, coalesce(new.flag_outcome, 'cleared'), v_who, v_kind);
    end if;
  end if;
  return null;
end $$;
create trigger event_history after update of status on event
  for each row execute function record_plan_change();
create trigger event_vendor_history after insert or update on event_vendor
  for each row execute function record_plan_change();

-- -----------------------------------------------------------------------------
-- 6b. WHAT PEOPLE SEE OF FEATURED BUSINESSES (D-43). Runs as this migration's role, so
--     the person side needs no policy on featured_placement: it gets only which current,
--     published businesses are featured for a type (at most 3), never the note or who added it.
-- -----------------------------------------------------------------------------
create function featured_for_type(p_type uuid) returns table (vendor_id uuid)
language sql stable security definer set search_path = public, extensions as $$
  select f.vendor_id
  from featured_placement f
  join vendor v on v.id = f.vendor_id and v.listing_status = 'published'
  where f.event_type_id = p_type and f.ended_at is null
    and (now() at time zone 'America/Toronto')::date between f.starts_on and f.ends_on
  group by f.vendor_id
  order by min(f.starts_on), min(f.created_at)
  limit 3
$$;

-- -----------------------------------------------------------------------------
-- 6c. THE BUSINESS'S SIDE (V8, D-40, D-41). A business has no policy on event or event_vendor:
--     it sees its bookings only through bookings_for_business(), which returns exactly the
--     summary D-40 allows (the person's name, the date, the town, about how many guests) and
--     never the event's name, kind, times or private details; and it flags only through
--     flag_booking(). Both run as this migration's role and act only for the business that
--     acting_for_business() confirms (an active owner or manager, not archived).
-- -----------------------------------------------------------------------------
create function bookings_for_business()
returns table (row_id uuid, person text, event_date date, town text, guests int, cancelled boolean,
               booked_at timestamptz, flagged_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select ev.id, u.display_name, e.event_date, mu.name, e.guest_count_estimate, e.status = 'cancelled',
         ev.booked_at, case when ev.vendor_flagged_at >= ev.booked_at then ev.vendor_flagged_at end
  from event_vendor ev
  join event e on e.id = ev.event_id
  join municipality mu on mu.id = e.municipality_id
  join app_user u on u.id = e.host_user_id
  where acting_for_business() and ev.vendor_id = acting_vendor() and ev.status = 'booked'
$$;

-- "This isn't right" (D-41). Only for a booking marked booked for this business, on an
-- event that isn't cancelled, and not already flagged for this marking. Returns what the
-- emails need (the event's id and date, and who marked it, to be told politely), or raises
-- an LP code. The note goes to the team-only table.
create function flag_booking(p_row uuid, p_note text)
returns table (event_id uuid, event_date date, host_user_id uuid)
language plpgsql security definer set search_path = public, extensions as $$
declare
  r record;
begin
  if not acting_for_business() then
    raise exception 'only the business itself can say this' using errcode = 'LP101';
  end if;
  select ev.id, ev.status, ev.booked_at, ev.vendor_flagged_at, e.status as event_status,
         e.id as eid, e.event_date as edate, e.host_user_id as host into r
  from event_vendor ev join event e on e.id = ev.event_id
  where ev.id = p_row and ev.vendor_id = acting_vendor()
  for update of ev;
  if not found or r.status <> 'booked' then
    raise exception 'only the business itself can say this' using errcode = 'LP101';
  end if;
  if r.event_status <> 'planning' then
    raise exception 'that event is cancelled' using errcode = 'LP102';
  end if;
  if r.vendor_flagged_at is not null and r.vendor_flagged_at >= r.booked_at then
    raise exception 'you''ve already told us about this booking' using errcode = 'LP110';
  end if;
  update event_vendor set vendor_flagged_at = now(), vendor_flagged_by = acting_user() where id = p_row;
  if nullif(btrim(coalesce(p_note, '')), '') is null then
    delete from event_vendor_flag_note where event_vendor_id = p_row;
  else
    insert into event_vendor_flag_note (event_vendor_id, note) values (p_row, btrim(p_note))
    on conflict (event_vendor_id) do update set note = excluded.note, updated_at = now();
  end if;
  return query select r.eid, r.edate, r.host;
end $$;

-- -----------------------------------------------------------------------------
-- 7. COUNTS FOR THE LOCALITES TEAM ONLY (D-42). Never on a business's own Analytics page.
--    Toronto days [p_from, p_to). Aggregates only: never who, never which event. Runs as
--    this migration's role (the team side can't read unflagged plans, by design) and
--    refuses anyone not acting as the team.
-- -----------------------------------------------------------------------------
-- Per business: saved (current saves made in the period; one later un-saved isn't
-- counted, because un-saving deletes it), added to an event plan, and marked booked
-- (different plan rows marked booked in the period, from status_change).
create function plan_counts_for_team(p_from date, p_to date)
returns table (vendor_id uuid, saved int, added int, marked_booked int)
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  lo timestamptz := p_from::timestamp at time zone 'America/Toronto';
  hi timestamptz := p_to::timestamp at time zone 'America/Toronto';
begin
  if not acting_as_team() then
    raise exception 'only the Localites team sees these counts' using errcode = 'LP101';
  end if;
  return query
  select x.vendor_id, sum(x.saved)::int, sum(x.added)::int, count(distinct x.booked_row)::int
  from (
    select sv.vendor_id, 1 as saved, 0 as added, null::uuid as booked_row from saved_vendor sv
    where sv.created_at >= lo and sv.created_at < hi
    union all
    select ev.vendor_id, 0, 1, null from event_vendor ev
    where ev.created_at >= lo and ev.created_at < hi
    union all
    select ev.vendor_id, 0, 0, ev.id
    from status_change sc join event_vendor ev on ev.id = sc.subject_id
    where sc.subject_type = 'event_vendor' and sc.field = 'status' and sc.to_status = 'booked'
      and sc.created_at >= lo and sc.created_at < hi
  ) x
  group by x.vendor_id;
end $$;

-- Per kind of event (null: no type given): events planned (created in the period, even if
-- later cancelled) and businesses marked booked for events of that type in the period.
create function plan_type_counts_for_team(p_from date, p_to date)
returns table (event_type_id uuid, events_planned int, marked_booked int)
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  lo timestamptz := p_from::timestamp at time zone 'America/Toronto';
  hi timestamptz := p_to::timestamp at time zone 'America/Toronto';
begin
  if not acting_as_team() then
    raise exception 'only the Localites team sees these counts' using errcode = 'LP101';
  end if;
  return query
  select x.event_type_id, sum(x.planned)::int, count(distinct x.booked_row)::int
  from (
    select e.event_type_id, 1 as planned, null::uuid as booked_row from event e
    where e.created_at >= lo and e.created_at < hi
    union all
    select e.event_type_id, 0, ev.id
    from status_change sc join event_vendor ev on ev.id = sc.subject_id join event e on e.id = ev.event_id
    where sc.subject_type = 'event_vendor' and sc.field = 'status' and sc.to_status = 'booked'
      and sc.created_at >= lo and sc.created_at < hi
  ) x
  group by x.event_type_id;
end $$;

-- -----------------------------------------------------------------------------
-- 8. NOTIFICATION KINDS
-- -----------------------------------------------------------------------------
alter table notification drop constraint notification_kind_check;
alter table notification add constraint notification_kind_check check (kind in (
  'claim_received', 'claim_decision', 'listing_change_undone', 'owner_removed',
  'new_message', 'marked_booked', 'booking_unmarked', 'review_request',
  'review_reminder', 'review_published', 'review_reply', 'vendor_joined',
  -- 2A: to a booked business when the event is cancelled or its date or town changes;
  -- to the person when a business says it isn't booked (D-41).
  'booked_event_cancelled', 'booked_event_changed', 'booking_flagged'));
-- For the "already told today?" check before each booking email.
create index notification_subject on notification (subject_type, subject_id, created_at);

-- -----------------------------------------------------------------------------
-- 9. ROW-LEVEL SECURITY, POLICIES, GRANTS
-- -----------------------------------------------------------------------------
do $$
declare t text; r text;
begin
  foreach t in array array['event_type', 'event', 'event_private', 'event_vendor', 'saved_vendor',
                           'event_type_category', 'featured_placement', 'event_vendor_flag_note'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on %I from %I', t, r);
      end if;
    end loop;
  end loop;
end $$;
-- Deliberately NO app_server_all policy on these eight tables. Each rule is written out.

-- Reference data: everyone reads; the team writes.
create policy event_type_read   on event_type for select to app_server using (true);
create policy event_type_add    on event_type for insert to app_server with check (acting_as_team());
create policy event_type_change on event_type for update to app_server
  using (acting_as_team()) with check (acting_as_team());

create policy event_type_category_read   on event_type_category for select to app_server using (true);
create policy event_type_category_add    on event_type_category for insert to app_server with check (acting_as_team());
create policy event_type_category_change on event_type_category for update to app_server
  using (acting_as_team()) with check (acting_as_team());
create policy event_type_category_remove on event_type_category for delete to app_server using (acting_as_team());

-- Featured placements: the team only. People see them through featured_for_type().
create policy featured_placement_team on featured_placement for select to app_server using (acting_as_team());
create policy featured_placement_add  on featured_placement for insert to app_server with check (acting_as_team());
create policy featured_placement_end  on featured_placement for update to app_server
  using (acting_as_team()) with check (acting_as_team());

create policy event_host on event for all to app_server
  using (acting_side() = 'person' and host_user_id = acting_user())
  with check (acting_side() = 'person' and host_user_id = acting_user());
create policy event_flag_team on event for select to app_server
  using (acting_as_team() and exists (
    select 1 from event_vendor ev where ev.event_id = event.id and ev.vendor_flagged_at is not null));

create policy event_private_host on event_private for all to app_server     -- and nothing else, ever
  using (acting_side() = 'person' and host_user_id = acting_user())
  with check (acting_side() = 'person' and host_user_id = acting_user());

create policy event_vendor_host on event_vendor for all to app_server
  using (acting_side() = 'person' and host_user_id = acting_user())
  with check (acting_side() = 'person' and host_user_id = acting_user());
-- No business policy on event or event_vendor: see bookings_for_business() and flag_booking().
create policy event_vendor_flag_note_team on event_vendor_flag_note for select to app_server
  using (acting_as_team());
create policy event_vendor_flag_team on event_vendor for select to app_server
  using (acting_as_team() and vendor_flagged_at is not null);

create policy saved_vendor_own on saved_vendor for all to app_server
  using (acting_side() = 'person' and user_id = acting_user())
  with check (acting_side() = 'person' and user_id = acting_user());

-- Minimal grants. No delete except the private bookmark and a type's suggested kinds of
-- business. Times the database sets, the host, the key, who added a placement and the
-- flag decision columns are not granted for update.
grant select, insert (id, key, name, is_active, sort_order) on event_type to app_server;
grant update (name, is_active, sort_order) on event_type to app_server;
grant select, insert (id, host_user_id, event_type_id, event_date, start_time, end_time,
                      municipality_id, guest_count_estimate) on event to app_server;
grant update (event_type_id, event_date, start_time, end_time, municipality_id,
              guest_count_estimate, status) on event to app_server;
grant select, insert (event_id, host_user_id, title, venue_note, age_range_min, age_range_max,
                      budget_cents, notes) on event_private to app_server;
grant update (title, venue_note, age_range_min, age_range_max, budget_cents, notes) on event_private to app_server;
grant select, insert (id, event_id, host_user_id, vendor_id) on event_vendor to app_server;
grant update (status) on event_vendor to app_server;
grant select on event_vendor_flag_note to app_server;
grant select, insert (user_id, vendor_id), delete on saved_vendor to app_server;
grant select, insert (event_type_id, category_id, sort_order), delete on event_type_category to app_server;
grant update (sort_order) on event_type_category to app_server;
grant select, insert (id, vendor_id, event_type_id, starts_on, ends_on, note, created_by) on featured_placement to app_server;
grant update (ended_at) on featured_placement to app_server;

-- Functions: as 0009 — nobody but the app role runs them.
revoke all on function acting_user(), acting_side(), acting_vendor(), acting_for_business(),
  acting_as_team(), event_ends_at(event), featured_for_type(uuid), bookings_for_business(), flag_booking(uuid, text),
  plan_counts_for_team(date, date), plan_type_counts_for_team(date, date) from public;
do $$
declare r text;
begin
  -- Supabase grants new functions to these roles by default; take that back (as 0003).
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function acting_user(), acting_side(), acting_vendor(), '
                     'acting_for_business(), acting_as_team(), event_ends_at(event), featured_for_type(uuid), '
                     'bookings_for_business(), flag_booking(uuid, text), '
                     'plan_counts_for_team(date, date), plan_type_counts_for_team(date, date) from %I', r);
    end if;
  end loop;
end $$;
grant execute on function acting_user(), acting_side(), acting_vendor(), acting_for_business(),
  acting_as_team(), event_ends_at(event), featured_for_type(uuid), bookings_for_business(), flag_booking(uuid, text),
  plan_counts_for_team(date, date), plan_type_counts_for_team(date, date) to app_server;
-- Trigger functions follow 0001's set_updated_at (they can't be called directly).
