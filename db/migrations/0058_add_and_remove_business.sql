-- =============================================================================
-- Localites — migration 0058: Add my business, and asking to remove one (D-63)
-- =============================================================================
-- The product owner approved Edit profile Style C on 26 October 2026, with:
--   "if they create we need to ask for the basic details and then when submitted our team will
--   reach out to confirm/create" and "yes" to it going through the same confirmation as a claim;
--   "full address capabilities (unit, street number and address) have the option to be able to
--   'hide' street number if a business choses to"; and "Is there a way to delete business account
--   from Localites? I think this requires approval from our team ... then mention that our team
--   will be in touch to facilitate".
--
--   vendor_suggestion   + how the person is connected (relationship: set only when it's their own
--                       business), the town, unit, street number, street, postal code, "keep my
--                       street number private" (then the number is never kept, as 0054 for a
--                       listing) and a note for the team. Only for their own business: a public
--                       suggestion stays name, website and contact only.
--                       Cleared once their claim on it is decided, with the contact a year after
--                       it's declined (0041's clean-up), and when the person deletes their account.
--   business_removal_request
--                       an owner asks the team to take their business off Localites. Nothing
--                       changes until the team has checked who it affects; "done" only once the
--                       listing is archived. One open request per business; only its active
--                       owner can ask (checked here as well as on the server).
--   removal_affects()   for the team: how many conversations, upcoming bookings and saves a
--                       business has (counts only; the team can't read those themselves).
--   my_data()           Download your data also has both (my_data_0057 kept, renamed).
--
-- Not destructive: columns added (all empty), one table added, triggers and functions added.
-- =============================================================================

set search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- Add my business
-- -----------------------------------------------------------------------------
alter table vendor_suggestion
  add column relationship text check (relationship in ('owner', 'manager', 'employee', 'other')),
  add column town text check (char_length(town) between 1 and 100),
  add column address_unit text check (char_length(address_unit) between 1 and 40),
  add column address_number text check (address_number ~ '^[0-9]{1,6}[A-Za-z]?(-[0-9]{1,6}[A-Za-z]?)?$'),
  add column address_street text check (address_street ~ '^[[:alnum:]][[:alnum:] .,''’&/-]{0,119}$'),
  add column postal_code text check (postal_code ~ '^[A-Z][0-9][A-Z] [0-9][A-Z][0-9]$'),
  add column hide_address_number boolean not null default false,
  add column note text check (char_length(note) between 1 and 1000);

alter table vendor_suggestion
  add constraint vendor_suggestion_number_needs_street check (address_number is null or address_street is not null),
  add constraint vendor_suggestion_hidden_number_not_kept check (not hide_address_number or address_number is null),
  add constraint vendor_suggestion_details_only_own check (
    relationship is not null or (town is null and address_unit is null and address_number is null and address_street is null
                                 and postal_code is null and note is null and not hide_address_number));

create index vendor_suggestion_own_by_person on vendor_suggestion (suggested_by, created_at) where relationship is not null;

comment on column vendor_suggestion.relationship is
  'Set when the person added their own business (0058, D-63): how they''re connected, as a claim''s. The team''s listing from it starts a claim for them.';
comment on column vendor_suggestion.hide_address_number is
  'They keep their street number private (0058): the number is never kept, as a listing''s (0054).';
comment on column vendor_suggestion.note is 'Their note for the team (0058). Team only.';

-- The address and note go with the contact (the yearly clean-up of declined ones, 0041), and with
-- the person (their account deleted, 0014): what's left is a public suggestion's name and website.
create function own_suggestion_cleanup() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
begin
  if new.relationship is not null
     and ((old.contact is not null and new.contact is null)
          or (old.suggested_by is not null and new.suggested_by is null)) then
    new.contact := null;
    new.note := null;
    new.town := null;
    new.address_unit := null;
    new.address_number := null;
    new.address_street := null;
    new.postal_code := null;
    new.hide_address_number := false;
  end if;
  return new;
end $$;
create trigger vendor_suggestion_own_cleanup before update of contact, suggested_by on vendor_suggestion
  for each row execute function own_suggestion_cleanup();

-- -----------------------------------------------------------------------------
-- Asking to remove a business
-- -----------------------------------------------------------------------------
create table business_removal_request (
  id             uuid primary key default gen_random_uuid(),
  vendor_id      uuid not null references vendor(id),
  requested_by   uuid references app_user(id),
  reason         text check (char_length(reason) between 1 and 1000),
  status         text not null default 'new' check (status in ('new', 'done', 'declined', 'withdrawn')),
  decided_by     uuid references app_user(id),
  decided_at     timestamptz,
  decision_note  text check (char_length(decision_note) between 1 and 500),
  created_at     timestamptz not null default now(),
  check ((status in ('done', 'declined')) = (decided_by is not null and decided_at is not null)),
  check (status <> 'declined' or decision_note is not null)
);
create unique index business_removal_one_open on business_removal_request (vendor_id) where status = 'new';
create index business_removal_open on business_removal_request (created_at) where status = 'new';
create index business_removal_by_vendor on business_removal_request (vendor_id, created_at);
create index business_removal_by_person on business_removal_request (requested_by) where requested_by is not null;
comment on table business_removal_request is
  'An owner asks the team to take their business off Localites (0058, D-63). The team checks who it affects first.';

-- Reads the team and the listing as they are (definer), whoever is writing.
create function business_removal_rules() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'new' or new.decided_by is not null or new.decided_at is not null or new.decision_note is not null then
      raise exception 'a removal request starts as new' using errcode = 'LP581';
    end if;
    if new.requested_by is null or not exists (
         select 1 from vendor_member m
         where m.vendor_id = new.vendor_id and m.user_id = new.requested_by and m.role = 'owner' and m.ended_at is null) then
      raise exception 'only the business''s owner can ask to remove it' using errcode = 'LP582';
    end if;
    if exists (select 1 from vendor v where v.id = new.vendor_id and v.listing_status = 'archived') then
      raise exception 'this business is already off Localites' using errcode = 'LP583';
    end if;
    return new;
  end if;
  if new.vendor_id <> old.vendor_id or new.created_at <> old.created_at
     or (new.requested_by is distinct from old.requested_by and new.requested_by is not null)
     or (new.reason is distinct from old.reason and new.reason is not null) then
    raise exception 'a removal request''s business, person and words don''t change' using errcode = 'LP584';
  end if;
  -- Decided or withdrawn: its outcome stays as it was (only the person and words can go, 0014).
  if old.status <> 'new' and (new.status <> old.status or new.decided_by is distinct from old.decided_by
       or new.decided_at is distinct from old.decided_at or new.decision_note is distinct from old.decision_note) then
    raise exception 'this request was already dealt with' using errcode = 'LP585';
  end if;
  if new.status <> old.status then
    if new.status = 'done' and not exists (select 1 from vendor v where v.id = new.vendor_id and v.listing_status = 'archived') then
      raise exception 'archive the listing before marking the request done' using errcode = 'LP586';
    end if;
  end if;
  return new;
end $$;
create trigger business_removal_rules before insert or update on business_removal_request
  for each row execute function business_removal_rules();

alter table business_removal_request enable row level security;
alter table business_removal_request force row level security;
create policy app_server_all on business_removal_request to app_server using (true) with check (true);
grant select, insert (id, vendor_id, requested_by, reason) on business_removal_request to app_server;
grant update (status, decided_by, decided_at, decision_note) on business_removal_request to app_server;

-- An account deleted: an open request is withdrawn, and the person and their words are taken off.
create function removal_requests_go_with_account() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  update business_removal_request
  set status = case when status = 'new' then 'withdrawn' else status end, requested_by = null, reason = null
  where requested_by = new.id;
  return new;
end $$;
create trigger app_user_removal_requests_go after update of deleted_at on app_user
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function removal_requests_go_with_account();

-- Who taking a business off would affect, for the team's Removal requests page: counts only.
-- The team can't read conversations, events or saved businesses themselves (ADR-031).
create function removal_affects(p_vendor uuid)
returns table (conversations int, bookings int, saved int)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
begin
  if not acting_as_team() then
    raise exception 'only the Localites team sees these counts' using errcode = 'LP101';
  end if;
  return query select
    (select count(*) from conversation c where c.vendor_id = p_vendor
       and exists (select 1 from message x where x.conversation_id = c.id and x.created_at > now() - interval '90 days'))::int,
    (select count(*) from event_vendor ev join event e on e.id = ev.event_id
       where ev.vendor_id = p_vendor and ev.status = 'booked' and e.event_date >= current_date)::int,
    (select count(*) from saved_vendor sv where sv.vendor_id = p_vendor)::int;
end $$;

-- Their claim on the business they added is decided (or withdrawn): the team has confirmed it,
-- so its address, contact and note aren't needed any more and go (the listing has its own).
create function own_suggestion_done_with_claim() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  update vendor_suggestion set contact = null, note = null, town = null, address_unit = null, address_number = null,
                               address_street = null, postal_code = null, hide_address_number = false
  where vendor_id = new.vendor_id and suggested_by = new.claimant_user_id and relationship is not null
    and status in ('added', 'duplicate')
    and (contact is not null or note is not null or town is not null or address_street is not null or address_unit is not null
         or postal_code is not null);
  return new;
end $$;
create trigger vendor_claim_own_suggestion_done after update of status on vendor_claim
  for each row when (old.status = 'submitted' and new.status <> 'submitted')
  execute function own_suggestion_done_with_claim();

-- -----------------------------------------------------------------------------
-- Download your data: as 0057, plus both
-- -----------------------------------------------------------------------------
alter function my_data() rename to my_data_0057;
revoke all on function my_data_0057() from app_server;

create function my_data() returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  me uuid := acting_user();
  base jsonb := my_data_0057();   -- checks it's the person acting as themselves (LP101)
begin
  return base || jsonb_build_object(
    'businesses_you_added', coalesce((
      select jsonb_agg(jsonb_build_object(
               'business', s.business_name, 'how_you_are_connected', s.relationship, 'town', s.town,
               'unit', s.address_unit, 'street_number', s.address_number, 'street', s.address_street,
               'postal_code', s.postal_code, 'street_number_private', s.hide_address_number,
               'phone_or_email', s.contact, 'website', s.website, 'note', s.note, 'status', s.status, 'sent', s.created_at)
             order by s.created_at)
      from vendor_suggestion s where s.suggested_by = me and s.relationship is not null), '[]'),
    'asked_to_remove', coalesce((
      select jsonb_agg(jsonb_build_object('business', v.display_name, 'reason', r.reason, 'status', r.status,
                                          'asked', r.created_at, 'decided', r.decided_at)
             order by r.created_at)
      from business_removal_request r join vendor v on v.id = r.vendor_id where r.requested_by = me), '[]'));
end $$;

revoke all on function my_data(), my_data_0057(), own_suggestion_cleanup(), business_removal_rules(),
  removal_requests_go_with_account(), removal_affects(uuid), own_suggestion_done_with_claim() from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function my_data(), my_data_0057(), own_suggestion_cleanup(), business_removal_rules(), removal_requests_go_with_account(), removal_affects(uuid), own_suggestion_done_with_claim() from %I', r);
    end if;
  end loop;
end $$;
grant execute on function my_data(), removal_affects(uuid) to app_server;
