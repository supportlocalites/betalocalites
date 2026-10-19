-- =============================================================================
-- Localites — migration 0051: fixes from the scenario tests, round 5, part 2 (D-54)
-- =============================================================================
-- M20, as the product owner chose on 19 October 2026: "allow business to change their name
-- and any old data has new name with (dba [former name]) in the backets".
--   vendor_former_name  every name a business had before, and until when: kept by the
--                       database itself whenever the name changes (the owner's change or the
--                       team's), so nothing can rename a business without it.
--   vendor_name_then    a business's name as it shows on something from a given moment:
--                       today's name, plus "(dba <the name it had then>)" when that differs.
--   owner_change        a save can now be flagged 'name' (the team's "check now" email).
--   notification        one more kind of email: 'business_renamed' (the owner is told when
--                       the team renames their business).
--
-- Not destructive: one new table, two functions, a trigger, two constraints widened.
-- =============================================================================

set search_path = public, extensions;

create table vendor_former_name (
  id         uuid primary key default gen_random_uuid(),
  vendor_id  uuid not null references vendor(id),
  name       text not null check (char_length(name) between 1 and 160),
  until      timestamptz not null default now()
);
create index vendor_former_name_by_vendor on vendor_former_name (vendor_id, until);
comment on table vendor_former_name is
  'A business''s earlier names (0051), each kept by vendor_name_kept when the name changed. Read by the owner''s name page and vendor_name_then.';
alter table vendor_former_name enable row level security;
alter table vendor_former_name force row level security;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on vendor_former_name from %I', r);
    end if;
  end loop;
end $$;
-- Read only: written by the trigger below, never by the site.
create policy vendor_former_name_read on vendor_former_name for select to app_server using (true);
revoke all on vendor_former_name from app_server;
grant select on vendor_former_name to app_server;

create function vendor_name_kept() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  insert into vendor_former_name (vendor_id, name) values (old.id, old.display_name);
  return new;
end $$;
create trigger vendor_name_kept after update of display_name on vendor
  for each row when (old.display_name is distinct from new.display_name)
  execute function vendor_name_kept();

-- Today's name, then "(dba X)" when the business was called X at p_at. The name it had then is
-- the earliest one it stopped using after p_at; none means it has had today's name since.
create function vendor_name_then(p_vendor uuid, p_at timestamptz) returns text
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select v.display_name || coalesce(' (dba ' || nullif(
           (select f.name from vendor_former_name f where f.vendor_id = v.id and f.until > p_at order by f.until limit 1),
           v.display_name) || ')', '')
  from vendor v where v.id = p_vendor
$$;

revoke all on function vendor_name_kept(), vendor_name_then(uuid, timestamptz) from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function vendor_name_kept(), vendor_name_then(uuid, timestamptz) from %I', r);
    end if;
  end loop;
end $$;
grant execute on function vendor_name_then(uuid, timestamptz) to app_server;

alter table owner_change drop constraint owner_change_flags_check;
alter table owner_change add constraint owner_change_flags_check check (flags <@ array['website', 'phone', 'name']::text[]);

alter table notification drop constraint notification_kind_check;
alter table notification add constraint notification_kind_check check (kind in (
  'claim_received', 'claim_decision', 'listing_change_undone', 'owner_removed', 'new_message', 'marked_booked',
  'booking_unmarked', 'review_request', 'review_reminder', 'review_published', 'review_reply', 'vendor_joined',
  'booked_event_cancelled', 'booked_event_changed', 'booking_flagged', 'review_declined', 'review_for_business',
  'held_edit_published', 'held_edit_declined', 'suggestion_listed', 'report_outcome', 'flag_decision', 'ownership_given',
  'business_renamed'));
