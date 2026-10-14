-- =============================================================================
-- Localites — migration 0034: the host changes a guest's reply; the guest is emailed (D-49)
-- =============================================================================
-- D-49 (amends D-08: Localites now emails a guest in one case). The host can set any guest's
-- reply (yes, maybe or no, and how many). The reply records who set it last, and the guest's
-- invitation says so. If the host gave the guest's email and the event isn't over, the guest
-- is emailed about the change with their link, within limits so it can't be used to send mail
-- to strangers: 10 a day per host, 3 a day per guest, 30 a day across the site; the rest are
-- recorded as held back. The email never carries the host's email address.
--
-- Not destructive: a new column (existing replies were the guest's own), a new table, functions.
-- =============================================================================

set search_path = public, extensions;

alter table guest add column reply_by text check (reply_by in ('guest', 'host'));
update guest set reply_by = 'guest' where response is not null;
alter table guest add constraint guest_reply_by_check2 check ((response is null) = (reply_by is null));

-- The guest's own reply records that it was theirs.
create or replace function invitation_reply(p_token_hash bytea, p_response text, p_party_size smallint, p_note text)
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
                   reply_by = 'guest',
                   first_opened_at = coalesce(first_opened_at, now())
  where id = g.id;
end $$;

-- The invitation also says who set the reply last.
drop function invitation_for(bytea);
create function invitation_for(p_token_hash bytea)
returns table (guest_name text, title text, event_date date, start_time time, end_time time, town text,
               venue_note text, message text, host_name text, status text, response text, party_size smallint,
               reply_note text, reply_by text, timezone text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  g record;
begin
  select gu.id, gu.name, e.event_date, e.start_time, e.end_time, e.timezone, e.status as estatus, event_ends_at(e) as ends,
         m.name as town, p.title, p.venue_note, p.guest_message, u.given_name as host,  -- first name only, or none
         gu.response, gu.party_size, gu.reply_note, gu.reply_by
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
    g.response, g.party_size, g.reply_note, g.reply_by, g.timezone;
end $$;

-- -----------------------------------------------------------------------------
-- Emails to guests (D-49): only about a reply the host changed.
-- -----------------------------------------------------------------------------
create table guest_email (
  id              uuid primary key default gen_random_uuid(),
  guest_id        uuid not null references guest(id) on delete cascade,
  host_user_id    uuid not null references app_user(id),
  kind            text not null default 'reply_changed' check (kind in ('reply_changed')),
  status          text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'suppressed')),
  failure_reason  text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  check ((status = 'sent') = (sent_at is not null)),
  check (status not in ('failed', 'suppressed') or failure_reason is not null)
);
create index guest_email_host on guest_email (host_user_id, created_at);
create index guest_email_guest on guest_email (guest_id, created_at);
create index guest_email_day on guest_email (created_at) where status in ('sent', 'queued');
comment on table guest_email is
  'Emails to a guest about a reply their host changed (D-49). The host reads and records its own; nothing else.';

alter table guest_email enable row level security;
alter table guest_email force row level security;
create policy guest_email_host on guest_email for select to app_server
  using (acting_side() = 'person' and host_user_id = acting_user());
create policy guest_email_host_record on guest_email for update to app_server
  using (acting_side() = 'person' and host_user_id = acting_user() and status = 'queued')
  with check (acting_side() = 'person' and host_user_id = acting_user() and status in ('sent', 'failed'));
grant select, update (status, failure_reason, sent_at) on guest_email to app_server;

-- The host sets one guest's reply. Returns the email to send, if one is due (queued here,
-- recorded by the host's request after sending), or nothing.
create function host_set_reply(p_guest uuid, p_response text, p_party_size smallint)
returns table (email_id uuid, email text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  g record;
  v_email uuid;
  v_why text;
begin
  if acting_side() is distinct from 'person' then
    raise exception 'only the person planning this event can change its guests' using errcode = 'LP101';
  end if;
  select gu.id, gu.email, gu.response, gu.party_size, e.status as estatus, event_ends_at(e) as ends into g
  from guest gu join event e on e.id = gu.event_id
  where gu.id = p_guest and gu.host_user_id = acting_user() and e.host_user_id = acting_user()
  for update of gu;
  if not found then
    raise exception 'only the person planning this event can change its guests' using errcode = 'LP101';
  end if;
  if g.estatus = 'cancelled' then
    raise exception 'a cancelled event can''t be changed' using errcode = 'LP102';
  end if;
  if p_response not in ('yes', 'no', 'maybe') then
    raise exception 'choose yes, no or maybe' using errcode = 'LP100';
  end if;
  if p_response <> 'no' and (p_party_size is null or p_party_size not between 1 and 20) then
    raise exception 'how many: from 1 to 20' using errcode = 'LP165';
  end if;
  -- Nothing changed: nothing written, nobody emailed.
  if g.response is not distinct from p_response
     and g.party_size is not distinct from (case when p_response = 'no' then null else p_party_size end) then
    return;
  end if;
  update guest set response = p_response,
                   party_size = case when p_response = 'no' then null else p_party_size end,
                   replied_at = now(), reply_by = 'host'
  where id = g.id;

  if g.email is null or g.ends < now() then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('localites.guest-email', 0));
  v_why := case
    when (select count(*) from guest_email x where x.host_user_id = acting_user()
          and x.status in ('sent', 'queued') and x.created_at > now() - interval '1 day') >= 10
      then 'the day''s limit of guest emails for this host'
    when (select count(*) from guest_email x where x.guest_id = g.id
          and x.status in ('sent', 'queued') and x.created_at > now() - interval '1 day') >= 3
      then 'the day''s limit of emails to this guest'
    when (select count(*) from guest_email x
          where x.status in ('sent', 'queued') and x.created_at > now() - interval '1 day') >= 30
      then 'the site''s daily limit of guest emails'
  end;
  insert into guest_email (guest_id, host_user_id, status, failure_reason)
  values (g.id, acting_user(), case when v_why is null then 'queued' else 'suppressed' end, v_why)
  returning id into v_email;
  if v_why is null then
    return query select v_email, g.email;
  end if;
end $$;

revoke all on function host_set_reply(uuid, text, smallint), invitation_for(bytea) from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on guest_email from %I', r);
      execute format('revoke all on function host_set_reply(uuid, text, smallint), invitation_for(bytea) from %I', r);
    end if;
  end loop;
end $$;
grant execute on function host_set_reply(uuid, text, smallint), invitation_for(bytea) to app_server;
