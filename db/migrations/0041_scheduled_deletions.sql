-- =============================================================================
-- Localites — migration 0041: the deletions the privacy policy promises (E §8)
-- =============================================================================
-- The product owner, 18 October 2026 ("add all of them"): the privacy policy draft (PO-07)
-- promises these, so they run every morning before it's published:
--   * records of emails sent (notification): deleted 1 year after they were made;
--   * the team's record of changes (audit_log): deleted after 2 years, except a row that a
--     business page's own history points at (owner_change, and the latest change of each
--     business's analytics switch), kept while that history is;
--   * conversations: deleted 3 years after the last message (or after starting, if none), with
--     their messages, read markers and file records. Not a conversation that has a report:
--     it's kept with the report. Not one whose stored file hasn't been removed yet: the nightly
--     file clean-up runs first, and the next morning takes it;
--   * a declined suggestion's phone number or email: erased 1 year after the team declined it.
-- run_scheduled_deletions() does all four, up to 2,000 rows of each a run (the rest the next
-- morning), and returns how many. For the server only.
--
-- audit_log stays append-only: its rule now lets exactly one thing through, this function
-- deleting a row older than 2 years. Nobody else can (the server has no delete right on it at
-- all, and the rule checks the function's own setting and age).
--
-- Destructive by design (it deletes old personal information, as promised). Recovery: the
-- nightly backups keep 30 days; nothing is deleted that's younger than its period.
-- =============================================================================

set search_path = public, extensions;

-- 1. audit_log: append-only, except old rows deleted by run_scheduled_deletions ------------
create function audit_log_append_only() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('localites.retention', true) = 'on'
     and current_user <> 'app_server' and old.created_at < now() - interval '2 years' then
    return old;
  end if;
  raise exception '% is append-only', tg_table_name;
end $$;
drop trigger audit_log_append_only on audit_log;
create trigger audit_log_append_only before update or delete on audit_log
  for each row execute function audit_log_append_only();

-- The sender of "it's on Localites" emails (D-25) looks for its earlier email so it never sends
-- twice; once that record is deleted after a year, a suggestion decided over a year ago isn't
-- emailed about (src/server/suggestions.server.ts checks the same).
create index notification_made on notification (created_at);
create index audit_log_made on audit_log (created_at);
create index conversation_last on conversation ((coalesce(last_message_at, created_at)));

-- 2. The morning run ------------------------------------------------------------------------
create function run_scheduled_deletions()
returns table (emails int, audit int, conversations int, suggestions int)
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_batch constant int := 2000;
  v_convs uuid[];
begin
  perform set_config('localites.retention', 'on', true);

  -- Each kind on its own: one that fails (-1, logged by the morning run) doesn't stop the rest.
  begin
    with gone as (
      delete from notification where id in (
        select id from notification where created_at < now() - interval '1 year'
        order by created_at limit v_batch)
      returning 1)
    select count(*)::int into emails from gone;
  exception when others then
    emails := -1;
    raise warning 'scheduled deletions: email records: %', sqlerrm;
  end;

  begin
    with gone as (
      delete from audit_log a where a.id in (
        select l.id from audit_log l
        where l.created_at < now() - interval '2 years'
          and not exists (select 1 from owner_change o where o.audit_id = l.id or o.undo_audit_id = l.id)
          and not exists (select 1 from vendor_analytics c where c.audit_id = l.id)
        order by l.created_at limit v_batch)
      returning 1)
    select count(*)::int into audit from gone;
  exception when others then
    audit := -1;
    raise warning 'scheduled deletions: change log: %', sqlerrm;
  end;

  begin
    select coalesce(array_agg(c.id), '{}') into v_convs from (
      select c.id from conversation c
      where coalesce(c.last_message_at, c.created_at) < now() - interval '3 years'
        and not exists (select 1 from moderation_report r where r.conversation_id = c.id)
        and not exists (select 1 from conversation_file f where f.conversation_id = c.id and f.storage_removed_at is null)
      order by coalesce(c.last_message_at, c.created_at) limit v_batch
      for update of c skip locked) c;
    delete from conversation_file where conversation_id = any(v_convs);
    delete from reported_message_text t using message m where m.id = t.message_id and m.conversation_id = any(v_convs);
    delete from conversation_read where conversation_id = any(v_convs);
    delete from message where conversation_id = any(v_convs);
    delete from conversation where id = any(v_convs);
    conversations := cardinality(v_convs);
  exception when others then
    conversations := -1;
    raise warning 'scheduled deletions: conversations: %', sqlerrm;
  end;

  begin
    with erased as (
      update vendor_suggestion set contact = null where id in (
        select id from vendor_suggestion
        where status = 'declined' and contact is not null and reviewed_at < now() - interval '1 year'
        limit v_batch)
      returning 1)
    select count(*)::int into suggestions from erased;
  exception when others then
    suggestions := -1;
    raise warning 'scheduled deletions: suggestions: %', sqlerrm;
  end;

  perform set_config('localites.retention', 'off', true);
  return next;
end $$;

revoke all on function run_scheduled_deletions() from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function run_scheduled_deletions() from %I', r);
    end if;
  end loop;
end $$;
grant execute on function run_scheduled_deletions() to app_server;
