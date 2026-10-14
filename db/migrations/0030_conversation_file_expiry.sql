-- =============================================================================
-- Localites — migration 0030: files in conversations end (D-47)
-- =============================================================================
-- The owner's rule (D-47, 14 October 2026):
--   - a file in a conversation about an event is deleted 30 days after the event's date
--     (never sooner than 30 days after it was sent: a file sent after that still gets 30 days);
--   - a file in any other conversation is deleted 1 year after it was sent;
--   - a file kept as evidence for a report stays with the report (both sides see it expired).
-- Both sides then see "This file has expired". The site runs expire_conversation_files()
-- nightly, then deletes the storage (conversation_files_to_remove(), 0028).
--
-- Not destructive for existing data beyond the rule itself: one new column (empty until a
-- file expires) and one function. To undo: a later migration drops them.
-- =============================================================================

set search_path = public, extensions;

alter table conversation_file add column expired_at timestamptz;
alter table conversation_file add constraint conversation_file_expired_is_gone
  check (expired_at is null or deleted_at is not null);
grant select (expired_at) on conversation_file to app_server;

-- When a file ends: by the conversation's event, or a year after it was sent.
create function conversation_file_ends(p_file uuid) returns timestamptz
language sql stable security definer set search_path = public, extensions as $$
  select case
           when e.event_date is not null
             then greatest((e.event_date + 30)::timestamp at time zone 'America/Toronto', f.created_at + interval '30 days')
           else f.created_at + interval '1 year'
         end
  from conversation_file f join conversation c on c.id = f.conversation_id
  left join event e on e.id = c.event_id
  where f.id = p_file
$$;

-- Nightly: files past their end are taken off (kept for the team if a report covers them).
create function expire_conversation_files(p_limit int) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  n int;
begin
  with due as (
    select f.id from conversation_file f
    where f.deleted_at is null and conversation_file_ends(f.id) <= now()
    order by f.created_at limit least(greatest(p_limit, 0), 500)
  )
  update conversation_file f set
    deleted_at = now(),
    expired_at = now(),
    kept_for_report = exists (
      select 1 from moderation_report r where r.conversation_id = f.conversation_id and r.created_at >= f.created_at)
  from due where f.id = due.id;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function conversation_file_ends(uuid), expire_conversation_files(int) from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function conversation_file_ends(uuid), expire_conversation_files(int) from %I', r);
    end if;
  end loop;
end $$;
grant execute on function expire_conversation_files(int) to app_server;
