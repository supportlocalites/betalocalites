-- =============================================================================
-- Localites — migration 0033: guests and replies (Stage 4, part 1)
-- =============================================================================
-- D-08, D-10, E §4.6, §5 and §8, roadmap Stage 4.
--
--   the host       keeps a guest list for their own event (a name; a phone number or email
--                  only to share the invitation from their own phone); sees who opened
--                  their link and who replied; writes a message for guests.
--   a guest        has no account. Their personal link opens only their own invitation and
--                  reply, through invitation_for() and invitation_reply(); nothing else.
--   businesses     never see guests. The Localites team doesn't either.
--
-- Links: the site makes each guest's link from a key only the site has (INVITE_KEY) and the
-- guest's id, so the host can share it again any time; only its hash is stored here (a copy
-- of the database alone opens nothing). A new link replaces the old one. Links stop working 30
-- days after the event; replies close when the event is over. Phone numbers and emails are
-- erased 90 days after the event (D-10); names and replies stay with the event.
--
-- Not destructive: a new table, a new column, functions and rules. To undo: a later migration
-- drops them.
-- =============================================================================

set search_path = public, extensions;

-- What the host tells guests on the invitation (optional).
alter table event_private add column guest_message text
  check (char_length(btrim(guest_message)) between 1 and 1000);
grant insert (guest_message), update (guest_message) on event_private to app_server;

create table guest (
  id                 uuid primary key,                    -- set by the site: the link is made from it
  event_id           uuid not null,
  host_user_id       uuid not null,
  name               text not null check (char_length(btrim(name)) between 1 and 80),
  email              text check (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone              text check (phone ~ '^\+?[0-9 ().-]{7,20}$'),
  contact_erased_at  timestamptz,                         -- 90 days after the event (D-10)
  link_version       int not null default 1 check (link_version >= 1),
  token_hash         bytea not null unique check (octet_length(token_hash) = 32),
  first_opened_at    timestamptz,
  last_opened_at     timestamptz,
  response           text check (response in ('yes', 'no', 'maybe')),
  party_size         smallint check (party_size between 1 and 20),
  reply_note         text check (char_length(btrim(reply_note)) between 1 and 500),
  replied_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (event_id, host_user_id) references event (id, host_user_id) on delete cascade,
  check ((response is null) = (replied_at is null)),
  check (case when response in ('yes', 'maybe') then party_size is not null else party_size is null end),
  check (contact_erased_at is null or (email is null and phone is null))
);
create index guest_event on guest (event_id, created_at);
comment on table guest is
  'A host''s guest (Stage 4, D-08). Not a user. Only the host reads the list; the guest reaches their own row by their link only.';

-- -----------------------------------------------------------------------------
-- 1. THE HOST'S RULES
-- -----------------------------------------------------------------------------
create function enforce_guest_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
declare
  ev record;
begin
  if tg_op = 'UPDATE' and (new.id <> old.id or new.event_id <> old.event_id or new.host_user_id <> old.host_user_id
                           or new.created_at <> old.created_at) then
    raise exception 'a guest can''t be moved to another event' using errcode = 'LP100';
  end if;
  if current_user <> 'app_server' then
    new.updated_at := now();
    return new;                                                    -- owner path (functions)
  end if;
  if acting_side() is distinct from 'person' or new.host_user_id is distinct from acting_user() then
    raise exception 'only the person planning this event can change its guests' using errcode = 'LP101';
  end if;
  -- Visible only through the host's own policy; another person's event reads as missing.
  select e.status, event_ends_at(e) as ends into ev from event e where e.id = new.event_id;
  if not found then
    raise exception 'only the person planning this event can change its guests' using errcode = 'LP101';
  end if;

  if tg_op = 'INSERT' then
    if ev.status <> 'planning' then
      raise exception 'a cancelled event can''t be changed' using errcode = 'LP102';
    end if;
    if ev.ends < now() then
      raise exception 'guests can''t be added once the event is over' using errcode = 'LP161';
    end if;
    if (select count(*) from guest g where g.event_id = new.event_id) >= 300 then
      raise exception 'an event can have up to 300 guests' using errcode = 'LP162';
    end if;
    new.link_version := 1; new.contact_erased_at := null;
    new.first_opened_at := null; new.last_opened_at := null;
    new.response := null; new.party_size := null; new.reply_note := null; new.replied_at := null;
    new.created_at := now(); new.updated_at := now();
    return new;
  end if;

  -- UPDATE by the host: the name, the contact details, a new link. Never the guest's reply.
  if (new.response, new.party_size, new.reply_note, new.replied_at, new.first_opened_at, new.last_opened_at, new.contact_erased_at)
     is distinct from (old.response, old.party_size, old.reply_note, old.replied_at, old.first_opened_at, old.last_opened_at, old.contact_erased_at) then
    raise exception 'that can''t be changed' using errcode = 'LP100';
  end if;
  if new.token_hash is distinct from old.token_hash and new.link_version <> old.link_version + 1 then
    raise exception 'that can''t be changed' using errcode = 'LP100';
  end if;
  if new.token_hash is not distinct from old.token_hash and new.link_version <> old.link_version then
    raise exception 'that can''t be changed' using errcode = 'LP100';
  end if;
  if old.contact_erased_at is not null and (new.email is not null or new.phone is not null) then
    raise exception 'phone numbers and emails aren''t kept after 90 days' using errcode = 'LP163';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger guest_rules before insert or update on guest
  for each row execute function enforce_guest_rules();

alter table guest enable row level security;
alter table guest force row level security;
create policy guest_host on guest for all to app_server
  using (acting_side() = 'person' and host_user_id = acting_user())
  with check (acting_side() = 'person' and host_user_id = acting_user());
grant select, insert (id, event_id, host_user_id, name, email, phone, token_hash), delete on guest to app_server;
grant update (name, email, phone, token_hash, link_version) on guest to app_server;

-- -----------------------------------------------------------------------------
-- 2. THE GUEST'S LINK (no account)
-- -----------------------------------------------------------------------------
-- What a guest's own link shows: their name, the event's name, date, times, town, where, the
-- host's message and first name, and their own reply. Nothing about other guests, the plan,
-- businesses or budget. Nothing once the link has been replaced or 30 days after the event.
-- Records when the link was opened (the host sees "Opened").
create function invitation_for(p_token_hash bytea)
returns table (guest_name text, title text, event_date date, start_time time, end_time time, town text,
               venue_note text, message text, host_name text, status text, response text, party_size smallint,
               reply_note text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  g record;
begin
  select gu.id, gu.name, e.event_date, e.start_time, e.end_time, e.status as estatus, event_ends_at(e) as ends,
         m.name as town, p.title, p.venue_note, p.guest_message, coalesce(u.given_name, u.display_name) as host,
         gu.response, gu.party_size, gu.reply_note
  into g
  from guest gu
    join event e on e.id = gu.event_id
    join event_private p on p.event_id = e.id
    join municipality m on m.id = e.municipality_id
    join app_user u on u.id = e.host_user_id and u.deleted_at is null
  where gu.token_hash = p_token_hash
    and e.event_date + 30 >= (now() at time zone 'America/Toronto')::date;
  if not found then
    return;
  end if;
  update guest set first_opened_at = coalesce(first_opened_at, now()), last_opened_at = now() where id = g.id;
  return query select g.name, g.title, g.event_date, g.start_time, g.end_time, g.town, g.venue_note, g.guest_message,
    g.host, case when g.estatus = 'cancelled' then 'cancelled' when g.ends < now() then 'closed' else 'open' end,
    g.response, g.party_size, g.reply_note;
end $$;

-- A guest's reply, by their own link only. Latest wins; replies close when the event is over.
create function invitation_reply(p_token_hash bytea, p_response text, p_party_size smallint, p_note text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  g record;
begin
  select gu.id, e.status as estatus, event_ends_at(e) as ends into g
  from guest gu join event e on e.id = gu.event_id join app_user u on u.id = e.host_user_id and u.deleted_at is null
  where gu.token_hash = p_token_hash and e.event_date + 30 >= (now() at time zone 'America/Toronto')::date
  for update of gu;
  if not found then
    raise exception 'this invitation link isn''t valid' using errcode = 'LP101';
  end if;
  if g.estatus = 'cancelled' then
    raise exception 'this event was cancelled' using errcode = 'LP102';
  end if;
  if g.ends < now() then
    raise exception 'replies are closed: the event is over' using errcode = 'LP164';
  end if;
  if p_response not in ('yes', 'no', 'maybe') then
    raise exception 'choose yes, no or maybe' using errcode = 'LP100';
  end if;
  update guest set response = p_response,
                   party_size = case when p_response = 'no' then null else p_party_size end,
                   reply_note = nullif(btrim(p_note), ''),
                   replied_at = now(),
                   first_opened_at = coalesce(first_opened_at, now())
  where id = g.id;
end $$;

-- The morning job: guests' phone numbers and emails, 90 days after the event (D-10).
create function erase_guest_contacts() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  n int;
begin
  update guest g set email = null, phone = null, contact_erased_at = now()
  from event e
  where e.id = g.event_id and g.contact_erased_at is null
    and e.event_date + 90 < (now() at time zone 'America/Toronto')::date;
  get diagnostics n = row_count;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- 3. PERMISSIONS
-- -----------------------------------------------------------------------------
revoke all on function enforce_guest_rules(), invitation_for(bytea), invitation_reply(bytea, text, smallint, text),
  erase_guest_contacts() from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on guest from %I', r);
      execute format('revoke all on function invitation_for(bytea), invitation_reply(bytea, text, smallint, text), erase_guest_contacts() from %I', r);
    end if;
  end loop;
end $$;
grant execute on function invitation_for(bytea), invitation_reply(bytea, text, smallint, text), erase_guest_contacts()
  to app_server;
