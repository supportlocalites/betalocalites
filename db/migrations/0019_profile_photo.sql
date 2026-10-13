-- =============================================================================
-- Localites — migration 0019: a business's square profile photo, and its framing
-- =============================================================================
-- Product owner, 13 October 2026: each business has one square "profile photo" (its logo
-- or a photo it likes), shown beside it in every list; the photos on its own page keep
-- their own shape and are never cut.
-- 1. The profile photo is the business's vendor_media row with role 'logo' (one at most,
--    already unique since 0001). It doesn't count toward the 8 page photos.
-- 2. media_asset.crop_x/y/w/h: how the owner framed it in the square, as percentages of the
--    stored photo (left, top, width, height). A width over 100 means zoomed out to show more
--    than the photo (the rest of the square is a soft, blurred copy of it). All four are set
--    together, or none (no framing chosen: pages use the smart default).
-- Not destructive: four columns and a replaced rule function. To undo: a later migration.
-- =============================================================================

set search_path = public, extensions;

alter table media_asset
  add column crop_x real,
  add column crop_y real,
  add column crop_w real,
  add column crop_h real,
  add constraint media_asset_crop_all_or_none check (
    (crop_x is null) = (crop_y is null) and (crop_y is null) = (crop_w is null) and (crop_w is null) = (crop_h is null)),
  add constraint media_asset_crop_sensible check (
    crop_x is null or (
      crop_w > 0 and crop_w <= 500 and crop_h > 0 and crop_h <= 500
      and crop_x between -400 and 100 and crop_y between -400 and 100));

-- The 8-photo limit counts the page photos only; the profile photo is one more, at most.
create or replace function enforce_vendor_media_rules() returns trigger
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
  if tg_op = 'UPDATE' and (new.vendor_id <> old.vendor_id or new.media_asset_id <> old.media_asset_id or new.role <> old.role) then
    raise exception 'that can''t be changed' using errcode = 'LP100';
  end if;
  if tg_op = 'INSERT' then
    -- One business at a time, so two uploads at once can't both take the last place.
    perform 1 from vendor where id = new.vendor_id for update;
    if new.role = 'gallery'
       and (select count(*) from vendor_media where vendor_id = new.vendor_id and role = 'gallery') >= vendor_photo_limit() then
      raise exception 'a business can show up to % photos', vendor_photo_limit() using errcode = 'LP122';
    end if;
  end if;
  return new;
end $$;
