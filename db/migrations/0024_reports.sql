-- =============================================================================
-- Localites — migration 0024: reporting a conversation or message (Stage 2B, part 2)
-- =============================================================================
-- E §4.3 and §6: either side of a conversation can report it, or one message in it, to the
-- Localites team. Staff read a conversation only through a report, and each look is logged
-- with the report (E §6: "Platform staff snoop" row). The team can then block the
-- conversation or hide a message, and closes the report as dealt with or dismissed.
--
--   person side    reports their own conversations, or a message in one;
--   business side  anyone on the business's team reports the business's conversations;
--   team           reads reports, reads a reported conversation through
--                  reported_conversation_for_team() (each call logged in audit_log), and
--                  decides; nobody else reads reports, not even the reporter's other side.
--
-- Not destructive: one new table; the conversation's status gains 'blocked_by_team' and the
-- message gains hidden_by_team_at (both start unset); functions and rules added. To undo: a
-- later migration drops them.
-- =============================================================================

set search_path = public, extensions;

create table moderation_report (
  id                uuid primary key default gen_random_uuid(),
  reporter_user_id  uuid not null references app_user(id),
  reporter_side     text not null check (reporter_side in ('consumer', 'vendor')),
  conversation_id   uuid not null references conversation(id),
  message_id        uuid references message(id),      -- one message, or null: the whole conversation
  reason            text not null check (reason in ('spam', 'harassment', 'scam_or_fraud', 'inappropriate', 'other')),
  details           text check (char_length(btrim(details)) between 1 and 2000),
  status            text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  reviewed_by       uuid references app_user(id),
  reviewed_at       timestamptz,
  decision_note     text check (char_length(btrim(decision_note)) between 1 and 1000),
  team_email_status text not null default 'pending' check (team_email_status in ('pending', 'sent', 'failed')),
  created_at        timestamptz not null default now(),
  check ((status = 'open') = (reviewed_at is null)),
  check ((status = 'open') = (reviewed_by is null)),
  check (status = 'open' or decision_note is not null)
);
create index moderation_report_open on moderation_report (created_at) where status = 'open';
create index moderation_report_conversation on moderation_report (conversation_id, created_at);
comment on table moderation_report is
  'Reports of a conversation or message (E §4.3). The reporter writes it; only the team reads it.';

-- The team can block a conversation, and hide a single message (kept, but no longer shown).
alter table conversation drop constraint conversation_status_check;
alter table conversation add constraint conversation_status_check
  check (status in ('open', 'blocked_by_consumer', 'blocked_by_vendor', 'blocked_by_team'));
alter table message add column hidden_by_team_at timestamptz;

-- Who may report what, and what the team may decide.
create function enforce_report_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
begin
  if current_user <> 'app_server' then return new; end if;        -- owner path (functions)
  if tg_op = 'INSERT' then
    if new.reporter_user_id is distinct from acting_user() then
      raise exception 'only you can report in your own name' using errcode = 'LP101';
    end if;
    if acting_side() = 'person' then
      if new.reporter_side <> 'consumer' then
        raise exception 'only you can report in your own name' using errcode = 'LP101';
      end if;
    elsif acting_side() = 'business' then
      if new.reporter_side <> 'vendor' then
        raise exception 'only you can report in your own name' using errcode = 'LP101';
      end if;
    else
      raise exception 'only the people in this conversation can report it' using errcode = 'LP101';
    end if;
    -- The conversation (and the message, if any) as this side may see them.
    if not exists (select 1 from conversation c where c.id = new.conversation_id) then
      raise exception 'only the people in this conversation can report it' using errcode = 'LP101';
    end if;
    if new.message_id is not null and not exists (
         select 1 from message m where m.id = new.message_id and m.conversation_id = new.conversation_id) then
      raise exception 'only the people in this conversation can report it' using errcode = 'LP101';
    end if;
    new.status := 'open'; new.reviewed_by := null; new.reviewed_at := null; new.decision_note := null;
    new.team_email_status := 'pending'; new.created_at := now();
    return new;
  end if;

  -- UPDATE: the reporter records the team email's outcome; the team decides, once.
  if new.id <> old.id or new.reporter_user_id <> old.reporter_user_id or new.reporter_side <> old.reporter_side
     or new.conversation_id <> old.conversation_id or new.message_id is distinct from old.message_id
     or new.reason <> old.reason or new.details is distinct from old.details or new.created_at <> old.created_at then
    raise exception 'a report can''t be changed' using errcode = 'LP100';
  end if;
  if new.status is distinct from old.status or new.decision_note is distinct from old.decision_note then
    if not acting_as_team() then
      raise exception 'only the Localites team decides on reports' using errcode = 'LP101';
    end if;
    if old.status <> 'open' then
      raise exception 'this report was already dealt with' using errcode = 'LP109';
    end if;
    new.reviewed_by := acting_user(); new.reviewed_at := now();
  else
    if old.reporter_user_id is distinct from acting_user()
       or (old.team_email_status <> 'pending' and new.team_email_status is distinct from old.team_email_status) then
      raise exception 'that can''t be changed' using errcode = 'LP100';
    end if;
    new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at;
  end if;
  return new;
end $$;
create trigger moderation_report_rules before insert or update on moderation_report
  for each row execute function enforce_report_rules();

alter table moderation_report enable row level security;
alter table moderation_report force row level security;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on moderation_report from %I', r);
    end if;
  end loop;
end $$;
-- The reporter writes the report and records its email; only the team reads reports.
create policy moderation_report_write on moderation_report for insert to app_server
  with check (reporter_user_id = acting_user() and acting_side() in ('person', 'business'));
create policy moderation_report_email on moderation_report for update to app_server
  using (reporter_user_id = acting_user() and acting_side() in ('person', 'business'))
  with check (reporter_user_id = acting_user() and acting_side() in ('person', 'business'));
create policy moderation_report_team on moderation_report for select to app_server using (acting_as_team());
create policy moderation_report_decide on moderation_report for update to app_server
  using (acting_as_team()) with check (acting_as_team());
-- (The reporter's own update policy needs to find the row: an UPDATE needs a SELECT policy too.)
create policy moderation_report_own on moderation_report for select to app_server
  using (reporter_user_id = acting_user() and acting_side() in ('person', 'business'));
grant select, insert (id, reporter_user_id, reporter_side, conversation_id, message_id, reason, details) on moderation_report to app_server;

-- The team sees which conversation a report is about (who, which business, its status), only
-- for reported ones; never its messages, which it reads only through
-- reported_conversation_for_team() below, logged.
create policy conversation_team_reported on conversation for select to app_server
  using (acting_as_team() and exists (select 1 from moderation_report r where r.conversation_id = conversation.id));
grant update (status, decision_note, team_email_status) on moderation_report to app_server;

-- A reported conversation, as the team sees it: who, the business, every message (including
-- removed and hidden ones, as they were), and the event summary. Each call is written to
-- audit_log with the report, first. Only through an open or closed report of that conversation.
create function reported_conversation_for_team(p_report uuid)
returns table (message_id uuid, author_side text, author_name text, body text, created_at timestamptz,
               removed boolean, hidden boolean, reported boolean)
language plpgsql security definer set search_path = public, extensions as $$
declare
  r record;
begin
  if not acting_as_team() then
    raise exception 'only the Localites team can do this' using errcode = 'LP101';
  end if;
  select mr.id, mr.conversation_id, mr.message_id into r from moderation_report mr where mr.id = p_report;
  if not found then
    raise exception 'no such report' using errcode = 'LP101';
  end if;
  insert into audit_log (actor_user_id, action, subject_type, subject_id, changes)
  values (acting_user(), 'conversation.report_view', 'moderation_report', p_report,
          jsonb_build_object('conversation', jsonb_build_object('from', null, 'to', r.conversation_id)));
  return query
  select m.id, m.author_side, u.display_name, m.body, m.created_at, m.removed_at is not null,
         m.hidden_by_team_at is not null, m.id = r.message_id
  from message m join app_user u on u.id = m.author_user_id
  where m.conversation_id = r.conversation_id
  order by m.created_at, m.id;
end $$;

-- The team's two actions on a reported conversation, each through its report.
create function team_block_reported(p_report uuid, p_block boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_conversation uuid;
begin
  if not acting_as_team() then
    raise exception 'only the Localites team can do this' using errcode = 'LP101';
  end if;
  select conversation_id into v_conversation from moderation_report where id = p_report;
  if not found then
    raise exception 'no such report' using errcode = 'LP101';
  end if;
  update conversation set
    status = case when p_block then 'blocked_by_team' else 'open' end,
    blocked_at = case when p_block then now() end,
    blocked_by = case when p_block then acting_user() end
  where id = v_conversation and (status = 'blocked_by_team') <> p_block
    and (p_block or status = 'blocked_by_team');
  insert into audit_log (actor_user_id, action, subject_type, subject_id, changes)
  values (acting_user(), case when p_block then 'conversation.team_block' else 'conversation.team_unblock' end,
          'moderation_report', p_report, jsonb_build_object('conversation', jsonb_build_object('from', null, 'to', v_conversation)));
end $$;

create function team_hide_reported_message(p_report uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_message uuid;
begin
  if not acting_as_team() then
    raise exception 'only the Localites team can do this' using errcode = 'LP101';
  end if;
  select message_id into v_message from moderation_report where id = p_report;
  if v_message is null then
    raise exception 'this report isn''t about one message' using errcode = 'LP109';
  end if;
  update message set hidden_by_team_at = now() where id = v_message and hidden_by_team_at is null;
  insert into audit_log (actor_user_id, action, subject_type, subject_id, changes)
  values (acting_user(), 'message.team_hide', 'moderation_report', p_report,
          jsonb_build_object('message', jsonb_build_object('from', null, 'to', v_message)));
end $$;

revoke all on function reported_conversation_for_team(uuid), team_block_reported(uuid, boolean),
  team_hide_reported_message(uuid) from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function reported_conversation_for_team(uuid), team_block_reported(uuid, boolean), '
                     'team_hide_reported_message(uuid) from %I', r);
    end if;
  end loop;
end $$;
grant execute on function reported_conversation_for_team(uuid), team_block_reported(uuid, boolean),
  team_hide_reported_message(uuid) to app_server;
