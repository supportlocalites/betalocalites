-- =============================================================================
-- Localites — migration 0017: the team looks after kinds of business and towns (X6, X8)
-- =============================================================================
-- From the team pages (Admin → Categories and towns), the team adds, renames, reorders and
-- hides kinds of business (category) and towns (municipality). These rules keep that safe:
-- 1. A web address part (slug) never changes once made: links such as /search?category=…
--    and saved searches keep working. Names can change freely.
-- 2. Kinds of business have two levels only: a main kind (Sweets) and kinds within it
--    (Custom cakes). A kind within can move to another main kind; a main kind that has
--    kinds within it can't become one itself.
-- 3. No two kinds with the same name under the same main kind (any capitals), and no two
--    towns with the same name in the same region.
-- Hiding, never deleting: businesses and events that use a hidden kind or town keep it.
-- Not destructive: two triggers and two unique indexes. If the indexes found duplicates
-- already there, the migration would stop and change nothing (the team would rename first).
-- =============================================================================

set search_path = public, extensions;

create function enforce_category_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
begin
  if tg_op = 'UPDATE' and new.slug <> old.slug then
    raise exception 'a kind of business keeps its web address' using errcode = 'LP100';
  end if;
  if new.parent_id is not null then
    if exists (select 1 from category where id = new.parent_id and parent_id is not null) then
      raise exception 'kinds of business have two levels only' using errcode = 'LP100';
    end if;
    if tg_op = 'UPDATE' and exists (select 1 from category where parent_id = new.id) then
      raise exception 'this kind has kinds within it, so it stays a main kind' using errcode = 'LP100';
    end if;
  end if;
  return new;
end $$;
create trigger category_rules before insert or update on category
  for each row execute function enforce_category_rules();

create function enforce_municipality_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
begin
  if new.slug <> old.slug then
    raise exception 'a town keeps its web address' using errcode = 'LP100';
  end if;
  return new;
end $$;
create trigger municipality_rules before update on municipality
  for each row execute function enforce_municipality_rules();

create unique index category_name_per_parent on category (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
create unique index municipality_name_per_region on municipality (lower(region), lower(name));
