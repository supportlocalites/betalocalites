-- =============================================================================
-- Localites — migration 0016: business photos (screens V2 and P4; E §9)
-- =============================================================================
-- The tables were made in 0001 (media_asset, vendor_media); this adds the rules that make
-- them safe to fill from the owner's page:
-- 1. A business shows at most 8 photos, each one the business's own (media_asset owned by
--    that business, in public storage, an image, not removed) with a description of 1 to
--    200 characters for people using screen readers (design-system.md).
-- 2. A photo's file details (where it's stored, whose it is, its type and size) never change
--    after upload; a removed photo stays removed, and must be taken off the business first.
-- 3. media_asset.storage_removed_at: when the file itself was deleted from storage. A removed
--    photo whose file couldn't be deleted at once is retried every night.
-- Not destructive: one column and two checks. To undo: a later migration drops them.
-- =============================================================================

set search_path = public, extensions;

alter table media_asset add column storage_removed_at timestamptz;
alter table media_asset add constraint media_asset_removed_after_deleted
  check (storage_removed_at is null or deleted_at is not null);

/** How many photos one business can show. The app says the same (src/server/photos.server.ts). */
create function vendor_photo_limit() returns int language sql immutable as $$ select 8 $$;

create function enforce_vendor_media_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
declare
  a media_asset%rowtype;
begin
  select * into a from media_asset where id = new.media_asset_id;
  if a.owner_kind <> 'vendor' or a.owner_id is distinct from new.vendor_id or a.bucket <> 'public'
     or a.mime_type not like 'image/%' or a.deleted_at is not null then
    raise exception 'that photo can''t be shown on this business' using errcode = 'LP100';
  end if;
  if a.alt_text is null or char_length(btrim(a.alt_text)) not between 1 and 200 then
    raise exception 'a photo needs a short description' using errcode = 'LP100';
  end if;
  if tg_op = 'UPDATE' and (new.vendor_id <> old.vendor_id or new.media_asset_id <> old.media_asset_id) then
    raise exception 'that can''t be changed' using errcode = 'LP100';
  end if;
  if tg_op = 'INSERT' then
    -- One business at a time, so two uploads at once can't both take the last place.
    perform 1 from vendor where id = new.vendor_id for update;
    if (select count(*) from vendor_media where vendor_id = new.vendor_id) >= vendor_photo_limit() then
      raise exception 'a business can show up to % photos', vendor_photo_limit() using errcode = 'LP122';
    end if;
  end if;
  return new;
end $$;
create trigger vendor_media_rules before insert or update on vendor_media
  for each row execute function enforce_vendor_media_rules();

create function enforce_media_asset_rules() returns trigger
language plpgsql security invoker set search_path = public, extensions as $$
begin
  if new.owner_kind <> old.owner_kind or new.owner_id is distinct from old.owner_id or new.bucket <> old.bucket
     or new.storage_path <> old.storage_path or new.mime_type <> old.mime_type or new.byte_size <> old.byte_size
     or new.width is distinct from old.width or new.height is distinct from old.height
     or new.uploaded_by is distinct from old.uploaded_by or new.created_at <> old.created_at then
    raise exception 'a file''s details can''t be changed after upload' using errcode = 'LP100';
  end if;
  if old.deleted_at is not null and new.deleted_at is distinct from old.deleted_at then
    raise exception 'a removed file stays removed' using errcode = 'LP109';
  end if;
  if old.storage_removed_at is not null and new.storage_removed_at is distinct from old.storage_removed_at then
    raise exception 'that is already done' using errcode = 'LP109';
  end if;
  if new.deleted_at is not null and old.deleted_at is null
     and exists (select 1 from vendor_media where media_asset_id = new.id) then
    raise exception 'take the photo off the business first' using errcode = 'LP100';
  end if;
  return new;
end $$;
create trigger media_asset_rules before update on media_asset
  for each row execute function enforce_media_asset_rules();

-- Removed photos whose file still has to be deleted (the nightly retry).
create index media_asset_storage_to_remove on media_asset (deleted_at) where deleted_at is not null and storage_removed_at is null;
-- A business's photos, newest first, for the team's Photos page.
create index media_asset_vendor_created on media_asset (owner_id, created_at desc) where owner_kind = 'vendor';
