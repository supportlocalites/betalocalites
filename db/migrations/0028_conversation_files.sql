-- =============================================================================
-- Localites — migration 0028: files in conversations (Stage 2B, part 3)
-- =============================================================================
-- E §4.3 and §9: either side of a conversation can send a photo (JPEG or WebP) or a PDF
-- (a quote, an invoice, a menu) with a message, one file per message. Files are stored in a
-- private storage folder (`conversation-files`), never at a public address: the site checks,
-- on every request, that the person asking is one of the two sides (the same rules as the
-- messages, ADR-031), then hands the file over itself. Localites doesn't read or interpret
-- what's in a file.
--
--   person side    sends files in their own conversations, opens the files in them;
--   business side  anyone on the business's team, as for messages (never a conversation
--                  from before its team last ended, never their own);
--   team           nothing directly; a reported conversation's files only through the
--                  report (team_reported_file(), each look logged with the report).
--
-- A file goes when its message does: the author removing the message, the team hiding it,
-- or its sender deleting their account. Its storage is then deleted (the site, nightly),
-- unless the conversation had been reported while the file was there: then the team keeps
-- it with the report, as it keeps a removed message's words (0026, 0027).
--
-- A message now needs words or a file (or both); a removed one stays blank.
--
-- Not destructive: one new table; one rule on message replaced by a looser one (every
-- existing row already meets it) plus a check at the end of each step; functions and rules
-- added. To undo: a later migration drops them and restores the rule.
-- =============================================================================

set search_path = public, extensions;

create table conversation_file (
  id                 uuid primary key default gen_random_uuid(),
  message_id         uuid not null unique references message(id),   -- one file per message
  conversation_id    uuid not null references conversation(id),
  uploaded_by        uuid not null references app_user(id),
  storage_path       text not null unique,
  file_name          text not null check (char_length(file_name) between 1 and 120),
  mime_type          text not null check (mime_type in ('image/jpeg', 'image/webp', 'application/pdf')),
  byte_size          int not null check (byte_size > 0 and byte_size <= 4194304),
  width              int,
  height             int,
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz,            -- gone for both sides
  kept_for_report    boolean not null default false,   -- the team keeps it (a report covers it)
  storage_removed_at timestamptz,            -- the stored file itself deleted
  check (storage_removed_at is null or deleted_at is not null),
  check (not kept_for_report or deleted_at is not null),
  check ((mime_type = 'application/pdf') = (width is null and height is null))
);
create index conversation_file_in_conversation on conversation_file (conversation_id, created_at);
create index conversation_file_by_uploader on conversation_file (uploaded_by, created_at);
create index conversation_file_to_remove on conversation_file (deleted_at)
  where deleted_at is not null and not kept_for_report and storage_removed_at is null;
comment on table conversation_file is
  'A photo or PDF sent with one message (E §9). Stored privately; only the two sides open it, the team only through a report.';

-- -----------------------------------------------------------------------------
-- 1. A MESSAGE NEEDS WORDS OR A FILE
-- -----------------------------------------------------------------------------
alter table message drop constraint message_check;
alter table message add constraint message_removed_is_blank check (removed_at is null or char_length(body) = 0);

-- Checked at the end of the step, so the file can be added after its message.
create function check_message_has_content() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if exists (select 1 from message m where m.id = new.id and m.removed_at is null and char_length(btrim(m.body)) = 0)
     and not exists (select 1 from conversation_file f where f.message_id = new.id) then
    raise exception 'a message needs words or a file' using errcode = 'LP147';
  end if;
  return null;
end $$;
create constraint trigger message_has_content after insert on message
  deferrable initially deferred
  for each row execute function check_message_has_content();

-- -----------------------------------------------------------------------------
-- 2. WHO ADDS A FILE: the author of the message, as they write it
-- -----------------------------------------------------------------------------
create function enforce_conversation_file_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
declare
  m record;
begin
  if current_user <> 'app_server' then return new; end if;        -- owner path (taking files off)
  if tg_op = 'UPDATE' then
    raise exception 'a file can''t be changed' using errcode = 'LP100';
  end if;
  -- The message, as the acting side may see it (the message rules apply here).
  select msg.id, msg.conversation_id, msg.author_user_id, msg.created_at, msg.removed_at, msg.hidden_by_team_at into m
  from message msg where msg.id = new.message_id;
  if not found or m.author_user_id is distinct from acting_user() or new.uploaded_by is distinct from acting_user()
     or new.conversation_id is distinct from m.conversation_id then
    raise exception 'only the author of a message can add its file' using errcode = 'LP101';
  end if;
  if m.removed_at is not null or m.hidden_by_team_at is not null or m.created_at < clock_timestamp() - interval '1 minute' then
    raise exception 'a file goes with a message as it''s written' using errcode = 'LP109';
  end if;
  if new.storage_path not like 'conversations/' || new.conversation_id::text || '/%' then
    raise exception 'that isn''t this conversation''s file' using errcode = 'LP101';
  end if;
  new.created_at := clock_timestamp(); new.deleted_at := null; new.kept_for_report := false; new.storage_removed_at := null;
  return new;
end $$;
create trigger conversation_file_rules before insert or update on conversation_file
  for each row execute function enforce_conversation_file_rules();

-- -----------------------------------------------------------------------------
-- 3. A FILE GOES WITH ITS MESSAGE (kept for the team if a report covers it)
-- -----------------------------------------------------------------------------
create function take_files_off(p_where_message uuid, p_where_uploader uuid, p_hidden_by_team boolean)
returns void
language sql security definer set search_path = public, extensions as $$
  update conversation_file f set
    deleted_at = now(),
    kept_for_report = p_hidden_by_team or exists (
      select 1 from moderation_report r where r.conversation_id = f.conversation_id and r.created_at >= f.created_at)
  where f.deleted_at is null
    and (f.message_id = p_where_message or f.uploaded_by = p_where_uploader)
$$;

create function files_go_with_message() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if old.removed_at is null and new.removed_at is not null then
    perform take_files_off(new.id, null, false);
  elsif old.hidden_by_team_at is null and new.hidden_by_team_at is not null then
    perform take_files_off(new.id, null, true);
  end if;
  return null;
end $$;
create trigger message_files_go after update of removed_at, hidden_by_team_at on message
  for each row execute function files_go_with_message();

create function files_go_with_account() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    perform take_files_off(null, new.id, false);
  end if;
  return null;
end $$;
create trigger app_user_files_go after update of deleted_at on app_user
  for each row execute function files_go_with_account();

-- -----------------------------------------------------------------------------
-- 4. HOUSEKEEPING THE SITE DOES (storage it must delete; the site-wide total)
-- -----------------------------------------------------------------------------
-- Files whose storage the site must delete (it runs this nightly, and right after a removal).
create function conversation_files_to_remove(p_limit int)
returns table (id uuid, storage_path text)
language sql stable security definer set search_path = public, extensions as $$
  select f.id, f.storage_path from conversation_file f
  where f.deleted_at is not null and not f.kept_for_report and f.storage_removed_at is null
  order by f.deleted_at limit least(greatest(p_limit, 0), 50)
$$;

create function conversation_file_storage_removed(p_file uuid) returns void
language sql security definer set search_path = public, extensions as $$
  update conversation_file set storage_removed_at = now()
  where id = p_file and deleted_at is not null and not kept_for_report and storage_removed_at is null
$$;

-- What all the stored files take up, for the site-wide limit (the free plan's 1 GB is shared
-- with business photos).
create function conversation_files_stored_bytes() returns bigint
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(sum(byte_size), 0)::bigint from conversation_file where storage_removed_at is null
$$;

-- -----------------------------------------------------------------------------
-- 5. THE TEAM: a reported conversation's files, only through the report, logged
-- -----------------------------------------------------------------------------
create function reported_conversation_files_for_team(p_report uuid)
returns table (file_id uuid, message_id uuid, file_name text, mime_type text, byte_size int, gone boolean)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not acting_as_team() then
    raise exception 'only the Localites team can do this' using errcode = 'LP101';
  end if;
  return query
  select f.id, f.message_id, f.file_name, f.mime_type, f.byte_size,
         f.deleted_at is not null and not f.kept_for_report
  from moderation_report r join conversation_file f on f.conversation_id = r.conversation_id
  where r.id = p_report
  order by f.created_at;
end $$;

-- One file of a reported conversation, to open; each look is written to audit_log first.
create function team_reported_file(p_report uuid, p_file uuid)
returns table (storage_path text, mime_type text, file_name text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  f record;
begin
  if not acting_as_team() then
    raise exception 'only the Localites team can do this' using errcode = 'LP101';
  end if;
  select cf.storage_path, cf.mime_type, cf.file_name into f
  from moderation_report r join conversation_file cf on cf.conversation_id = r.conversation_id
  where r.id = p_report and cf.id = p_file and (cf.deleted_at is null or cf.kept_for_report);
  if not found then
    raise exception 'no such file in that report' using errcode = 'LP101';
  end if;
  insert into audit_log (actor_user_id, action, subject_type, subject_id, changes)
  values (acting_user(), 'conversation.report_file_view', 'moderation_report', p_report,
          jsonb_build_object('file', jsonb_build_object('from', null, 'to', p_file)));
  return query select f.storage_path, f.mime_type, f.file_name;
end $$;

-- -----------------------------------------------------------------------------
-- 6. ROW-LEVEL SECURITY, POLICIES, GRANTS
-- -----------------------------------------------------------------------------
alter table conversation_file enable row level security;
alter table conversation_file force row level security;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on conversation_file from %I', r);
    end if;
  end loop;
end $$;

-- The same two sides as the conversation's messages (0023, 0025); nothing for the team.
create policy conversation_file_person on conversation_file for all to app_server
  using (acting_side() = 'person' and exists (
    select 1 from conversation c where c.id = conversation_file.conversation_id and c.consumer_user_id = acting_user()))
  with check (acting_side() = 'person' and exists (
    select 1 from conversation c where c.id = conversation_file.conversation_id and c.consumer_user_id = acting_user()));
create policy conversation_file_business on conversation_file for all to app_server
  using (acting_in_business() and exists (
    select 1 from conversation c where c.id = conversation_file.conversation_id and c.vendor_id = acting_vendor()
      and c.consumer_user_id <> acting_user() and c.ended_reason is distinct from 'business_left'))
  with check (acting_in_business() and exists (
    select 1 from conversation c where c.id = conversation_file.conversation_id and c.vendor_id = acting_vendor()
      and c.consumer_user_id <> acting_user() and c.ended_reason is distinct from 'business_left'));

grant select (id, message_id, conversation_id, uploaded_by, storage_path, file_name, mime_type, byte_size, width, height,
              created_at, deleted_at),
      insert (id, message_id, conversation_id, uploaded_by, storage_path, file_name, mime_type, byte_size, width, height)
  on conversation_file to app_server;

revoke all on function check_message_has_content(), enforce_conversation_file_rules(), take_files_off(uuid, uuid, boolean),
  files_go_with_message(), files_go_with_account(), conversation_files_to_remove(int), conversation_file_storage_removed(uuid),
  conversation_files_stored_bytes(), reported_conversation_files_for_team(uuid), team_reported_file(uuid, uuid) from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function check_message_has_content(), take_files_off(uuid, uuid, boolean), '
                     'conversation_files_to_remove(int), conversation_file_storage_removed(uuid), '
                     'conversation_files_stored_bytes(), reported_conversation_files_for_team(uuid), '
                     'team_reported_file(uuid, uuid) from %I', r);
    end if;
  end loop;
end $$;
grant execute on function conversation_files_to_remove(int), conversation_file_storage_removed(uuid),
  conversation_files_stored_bytes(), reported_conversation_files_for_team(uuid), team_reported_file(uuid, uuid) to app_server;
