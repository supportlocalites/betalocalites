import { sql } from 'drizzle-orm';
import { checkImage, IMAGE_EXTENSION, type CheckedImage } from '@/lib/image-file';
import { addressProblem, tidyLine } from '@/lib/owner-text';
import type { Frame } from '@/lib/photo-frame';
import { DESCRIPTION_MAX, PHOTO_LIMIT } from '@/lib/photo-terms';
import { errorCode } from './acting.server';
import { audit } from './admin/audit.server';
import type { Admin } from './auth/admin.server';
import { type Db, withDb } from './db.server';
import type { ServerEnv } from './env';
import { findOwnedBySlug } from './owner-listing.server';
import { deleteFiles, type Photo, readPhotos, readProfilePhoto, smallPath, storeFile, toPhotos, uploadsOn } from './photo-store.server';

/**
 * Business photos (screen V2, E §9; migration 0016). The business's owner or a manager adds,
 * describes, orders and removes them; the Localites team can remove any. Every request
 * checks in the database that this person is on the business's team as owner or manager
 * (nothing from the page is trusted for that), and every change goes to audit_log.
 * Photos go live at once, like the owner's other changes (D-34); the team sees each new
 * one on Admin → Photos.
 */

/** Photos one business may add in a day, so storage can't be churned. */
export const UPLOADS_PER_DAY = 30;
/** What the server accepts. The owner's browser makes photos well inside these. */
export const LARGE_IMAGE = { maxSide: 2048, maxBytes: 1024 * 1024 };
export const SMALL_IMAGE = { maxSide: 800, maxBytes: 256 * 1024 };

export class PhotoRefused extends Error {}
/** Not (or no longer) the owner or a manager of this business: the page answers "not found". */
export class NotOnTeam extends Error {}

/** The tidied description, or why it can't be used. */
export function checkDescription(raw: string): { ok: true; text: string } | { ok: false; error: string } {
  const text = tidyLine(raw);
  if (!text) return { ok: false, error: 'Please describe the photo in a few words, for people who can’t see it.' };
  if (text.length > DESCRIPTION_MAX) return { ok: false, error: `Please keep the description to ${DESCRIPTION_MAX} characters.` };
  const address = addressProblem(text);
  return address ? { ok: false, error: address } : { ok: true, text };
}

/** A whole upload, refused before it is read when it is clearly too big. */
export const MAX_UPLOAD_BYTES = LARGE_IMAGE.maxBytes + SMALL_IMAGE.maxBytes + 64 * 1024;

type Limits = { maxSide: number; maxBytes: number };
async function readImage(value: FormDataEntryValue | null, limits: Limits): Promise<CheckedImage | string | null> {
  if (!value || typeof value === 'string' || value.size === 0) return null;
  if (value.size > limits.maxBytes) return 'That photo is too large. Please choose a smaller one (under 1 MB).';
  const checked = checkImage(new Uint8Array(await value.arrayBuffer()));
  if (!checked) return 'That file isn’t a photo Localites can use. Please choose a JPEG or WebP photo.';
  // Only possible without the page's script (the browser turns photos upright itself).
  if (checked.turned) return 'That photo is stored on its side. Please turn it in your photo app and save it, then try again.';
  if (checked.width > limits.maxSide || checked.height > limits.maxSide) {
    return `That photo is too large. Please choose one no more than ${limits.maxSide} pixels wide and tall.`;
  }
  return checked;
}

/**
 * The photo from the form: two sizes made by the page's script ("large" and "small"), or,
 * when the browser runs no scripts, the file as chosen ("file"), used for both if it is
 * already small enough. Each is checked from its contents and has its hidden details removed.
 */
export async function readUpload(
  form: FormData,
): Promise<{ ok: true; large: CheckedImage; small: CheckedImage } | { ok: false; error: string }> {
  const sent = form.get('large') ? form.get('large') : form.get('file');
  const large = await readImage(sent, LARGE_IMAGE);
  if (large === null) return { ok: false, error: 'Please choose a photo.' };
  if (typeof large === 'string') return { ok: false, error: large };
  const small = form.get('large') ? await readImage(form.get('small'), SMALL_IMAGE) : large;
  if (small === null || typeof small === 'string' || small.type !== large.type) {
    return { ok: false, error: 'Something went wrong preparing the photo. Please try again.' };
  }
  return { ok: true, large, small };
}

export type OwnerPhotos = {
  vendor: { id: string; slug: string; name: string; town: string; tagline: string | null; published: boolean };
  /** The page photos, in order (the first leads the page). */
  photos: Photo[];
  /** The square profile photo beside the business in lists, if it has one. */
  profile: Photo | null;
  uploadsOn: boolean;
};

export async function photosFor(env: ServerEnv, userId: string, slug: string): Promise<OwnerPhotos | { renamedTo: string } | null> {
  return withDb(env, async (db) => {
    const v = await findOwnedBySlug(db, userId, slug);
    if (!v) return null;
    if (v.slug !== slug) return { renamedTo: v.slug };
    const [[where], photos, profile] = await Promise.all([
      db.execute<{ town: string }>(sql`
        select m.name as town from vendor v join municipality m on m.id = v.primary_municipality_id where v.id = ${v.id}`),
      readPhotos(db, v.id),
      readProfilePhoto(db, v.id),
    ]);
    return {
      vendor: { id: v.id, slug: v.slug, name: v.name, town: where?.town ?? '', tagline: v.tagline, published: v.status === 'published' },
      photos: toPhotos(env, photos),
      profile: toPhotos(env, profile)[0] ?? null,
      uploadsOn: uploadsOn(env),
    };
  });
}

async function countsFor(db: Db, vendorId: string): Promise<{ shown: number; today: number }> {
  const [c] = await db.execute<{ shown: number; today: number }>(sql`
    select (select count(*)::int from vendor_media where vendor_id = ${vendorId} and role = 'gallery') as shown,
           (select count(*)::int from media_asset where owner_kind = 'vendor' and owner_id = ${vendorId}
              and created_at > now() - interval '1 day') as today`);
  return c ?? { shown: 0, today: 0 };
}

const FULL = `Your business already shows ${PHOTO_LIMIT} photos, the most it can. Remove one first.`;

/**
 * Stores a checked photo (both sizes) and adds it to the business: a page photo (last in
 * order) or the square profile photo (replacing the one before, whose files are returned to
 * be deleted). The files are stored first and the photo recorded after; if recording fails,
 * the files are deleted.
 */
export async function addPhoto(
  env: ServerEnv,
  userId: string,
  slug: string,
  photo: { large: CheckedImage; small: CheckedImage; description: string; role?: 'gallery' | 'logo' },
): Promise<{ id: string; replaced: { id: string; path: string } | null }> {
  const role = photo.role ?? 'gallery';
  let replaced: { id: string; path: string; alt: string } | null = null;
  if (!uploadsOn(env)) throw new PhotoRefused('Adding photos isn’t switched on yet. Please try again later.');
  const vendor = await withDb(env, async (db) => {
    const v = await findOwnedBySlug(db, userId, slug);
    if (!v) throw new NotOnTeam();
    const c = await countsFor(db, v.id);
    if (role === 'gallery' && c.shown >= PHOTO_LIMIT) throw new PhotoRefused(FULL);
    if (c.today >= UPLOADS_PER_DAY) throw new PhotoRefused('That’s a lot of photos for one day. Please add more tomorrow.');
    return v;
  });

  const id = crypto.randomUUID();
  const path = `vendors/${vendor.id}/${id}.${IMAGE_EXTENSION[photo.large.type]}`;
  // Files stored for a photo that wasn't saved: deleted now, or else noted as removed so the
  // nightly retry deletes them (nothing else knows their random names).
  const abandon = async () => {
    if (await deleteFiles(env, path)) return;
    await withDb(env, (db) =>
      db.execute(sql`
        insert into media_asset (id, owner_kind, owner_id, bucket, storage_path, mime_type, byte_size, alt_text, uploaded_by, deleted_at)
        values (${id}, 'vendor', ${vendor.id}, 'public', ${path}, ${photo.large.type}, ${photo.large.bytes.length}, 'Not saved', ${userId}, now())
        on conflict do nothing`),
    ).catch((err: unknown) => console.error('photo files left in storage', path, err instanceof Error ? err.message : err));
  };
  const stored = await Promise.all([
    storeFile(env, path, photo.large.bytes, photo.large.type),
    storeFile(env, smallPath(path), photo.small.bytes, photo.small.type),
  ]);
  if (!stored.every(Boolean)) {
    await abandon();
    throw new PhotoRefused('The photo couldn’t be saved just now. Please try again in a few minutes.');
  }

  try {
    await withDb(env, (db) =>
      db.transaction(async (tx) => {
        const v = await findOwnedBySlug(tx, userId, vendor.slug, true);
        if (!v || v.id !== vendor.id) throw new NotOnTeam();
        await tx.execute(sql`
          insert into media_asset (id, owner_kind, owner_id, bucket, storage_path, mime_type, byte_size, width, height, alt_text, uploaded_by)
          values (${id}, 'vendor', ${v.id}, 'public', ${path}, ${photo.large.type}, ${photo.large.bytes.length},
                  ${photo.large.width}, ${photo.large.height}, ${photo.description}, ${userId})`);
        if (role === 'logo') {
          // One profile photo: the one before comes off (its files are deleted afterwards).
          // (Not one the team removed at this same moment: that one is already off.)
          const [old] = await tx.execute<{ id: string; path: string; alt: string }>(sql`
            select a.id, a.storage_path as path, a.alt_text as alt from vendor_media vm join media_asset a on a.id = vm.media_asset_id
            where vm.vendor_id = ${v.id} and vm.role = 'logo' and a.deleted_at is null for update of a`);
          if (old) {
            await takeOff(tx, old.id);
            replaced = old;
          }
        }
        await tx.execute(sql`
          insert into vendor_media (vendor_id, media_asset_id, role, sort_order)
          values (${v.id}, ${id}, ${role},
                  (select coalesce(max(sort_order) + 1, 0) from vendor_media where vendor_id = ${v.id} and role = 'gallery'))`);
        await audit(tx, {
          actor: userId,
          action: role === 'logo' ? 'vendor_photo.profile' : 'vendor_photo.add',
          subjectType: 'vendor',
          subjectId: v.id,
          changes: {
            photo: { from: replaced && { id: replaced.id, description: replaced.alt }, to: { id, description: photo.description } },
          },
        });
      }),
    );
  } catch (err) {
    await abandon();
    if (errorCode(err) === 'LP122') throw new PhotoRefused(FULL);
    throw err;
  }
  return { id, replaced };
}

/** Runs a change to one of this business's photos, as its owner or a manager. */
async function changePhoto(
  env: ServerEnv,
  userId: string,
  slug: string,
  photoId: string,
  work: (tx: Db, vendorId: string, current: { alt: string; path: string; role: string }) => Promise<void>,
): Promise<void> {
  await withDb(env, (db) =>
    db.transaction(async (tx) => {
      const v = await findOwnedBySlug(tx, userId, slug, true);
      if (!v) throw new NotOnTeam();
      const [p] = await tx.execute<{ alt: string; path: string; role: string }>(sql`
        select a.alt_text as alt, a.storage_path as path, vm.role from vendor_media vm join media_asset a on a.id = vm.media_asset_id
        where vm.vendor_id = ${v.id} and a.id = ${photoId} and a.deleted_at is null
        for update of a`); // waits for the team removing the same photo, then finds it gone
      if (!p) throw new PhotoRefused('That photo isn’t on your business any more.');
      await work(tx, v.id, p);
    }),
  );
}

export async function describePhoto(env: ServerEnv, userId: string, slug: string, photoId: string, description: string) {
  await changePhoto(env, userId, slug, photoId, async (tx, vendorId, p) => {
    if (p.alt === description) return;
    await tx.execute(sql`update media_asset set alt_text = ${description} where id = ${photoId}`);
    await audit(tx, {
      actor: userId,
      action: 'vendor_photo.describe',
      subjectType: 'vendor',
      subjectId: vendorId,
      changes: { [`photo.${photoId}.description`]: { from: p.alt, to: description } },
    });
  });
}

/** How the square profile photo is framed: a rectangle on the photo, in percentages (the owner's framing screen). */
export async function setProfileFrame(env: ServerEnv, userId: string, slug: string, photoId: string, frame: Frame) {
  await changePhoto(env, userId, slug, photoId, async (tx, vendorId, p) => {
    if (p.role !== 'logo') throw new PhotoRefused('That photo isn’t your profile photo any more.');
    const [was] = await tx.execute<{ x: number | string | null; y: number | string | null; w: number | string | null; h: number | string | null }>(
      sql`select crop_x as x, crop_y as y, crop_w as w, crop_h as h from media_asset where id = ${photoId}`,
    );
    const before = was && was.x != null ? { x: Number(was.x), y: Number(was.y), w: Number(was.w), h: Number(was.h) } : null;
    // Saved again unchanged: nothing to write or record.
    if (before && before.x === frame.x && before.y === frame.y && before.w === frame.w && before.h === frame.h) return;
    await tx.execute(sql`
      update media_asset set crop_x = ${frame.x}, crop_y = ${frame.y}, crop_w = ${frame.w}, crop_h = ${frame.h} where id = ${photoId}`);
    await audit(tx, {
      actor: userId,
      action: 'vendor_photo.frame',
      subjectType: 'vendor',
      subjectId: vendorId,
      changes: { [`photo.${photoId}.frame`]: { from: before, to: frame } },
    });
  });
}

/** Puts a page photo first: it leads the business's page. */
export async function makeMainPhoto(env: ServerEnv, userId: string, slug: string, photoId: string) {
  await changePhoto(env, userId, slug, photoId, async (tx, vendorId, p) => {
    if (p.role !== 'gallery') return;
    await tx.execute(sql`
      update vendor_media set sort_order = (select min(sort_order) - 1 from vendor_media where vendor_id = ${vendorId} and role = 'gallery')
      where vendor_id = ${vendorId} and media_asset_id = ${photoId}`);
    await audit(tx, {
      actor: userId,
      action: 'vendor_photo.main',
      subjectType: 'vendor',
      subjectId: vendorId,
      changes: { mainPhoto: { from: null, to: photoId } },
    });
  });
}

/** Takes a photo off the business at once; its files are deleted afterwards (deleteRemoved). */
async function takeOff(tx: Db, photoId: string): Promise<void> {
  await tx.execute(sql`delete from vendor_media where media_asset_id = ${photoId}`);
  await tx.execute(sql`update media_asset set deleted_at = now() where id = ${photoId}`);
}

export async function removePhoto(env: ServerEnv, userId: string, slug: string, photoId: string): Promise<{ id: string; path: string }> {
  let path = '';
  await changePhoto(env, userId, slug, photoId, async (tx, vendorId, p) => {
    await takeOff(tx, photoId);
    await audit(tx, {
      actor: userId,
      action: 'vendor_photo.remove',
      subjectType: 'vendor',
      subjectId: vendorId,
      changes: { photo: { from: { id: photoId, description: p.alt }, to: null } },
    });
    path = p.path;
  });
  return { id: photoId, path };
}

/** Deletes a removed photo's files from storage and records it. A failure is retried nightly. */
export async function deleteRemoved(env: ServerEnv, photo: { id: string; path: string }): Promise<boolean> {
  if (!(await deleteFiles(env, photo.path))) return false;
  await withDb(env, (db) =>
    db.execute(sql`update media_asset set storage_removed_at = now() where id = ${photo.id} and storage_removed_at is null`),
  );
  return true;
}

/**
 * Photos the nightly retry looks at per run: two deletions each, inside the free plan's 50
 * outside requests per run, which the daily note and the activity count share.
 */
const CLEANUP_PER_RUN = 8;

/** The nightly retry (workers/app.ts): removed business photos whose files are still in storage. */
export async function cleanUpRemovedPhotos(env: ServerEnv): Promise<{ deleted: number; left: number } | 'off'> {
  if (!uploadsOn(env)) return 'off';
  const rows = await withDb(env, (db) =>
    db.execute<{ id: string; path: string }>(sql`
      select id, storage_path as path from media_asset
      where owner_kind = 'vendor' and bucket = 'public' and deleted_at is not null and storage_removed_at is null
      order by deleted_at limit ${CLEANUP_PER_RUN}`),
  );
  let deleted = 0;
  for (const r of rows) if (await deleteRemoved(env, r)) deleted += 1;
  return { deleted, left: rows.length - deleted };
}

// ---------------------------------------------------------------- the team (Admin → Photos)

export type TeamPhoto = Photo & {
  /** The square profile photo (shown in lists), not a page photo. */
  isProfile: boolean;
  vendorId: string;
  vendorName: string;
  slug: string;
  addedBy: string | null;
  addedAt: string;
};

/** Newest photos first, across businesses or for one. Callers must have passed adminGate. */
export async function recentPhotos(env: ServerEnv, vendorId: string | null): Promise<TeamPhoto[]> {
  const rows = await withDb(env, (db) =>
    db.execute<{
      id: string;
      path: string;
      alt: string;
      width: number | null;
      height: number | null;
      cropX: number | null;
      cropY: number | null;
      cropW: number | null;
      cropH: number | null;
      isProfile: boolean;
      vendorId: string;
      vendorName: string;
      slug: string;
      addedBy: string | null;
      addedAt: string;
    }>(sql`
      select a.id, a.storage_path as path, a.alt_text as alt, a.width, a.height,
             a.crop_x as "cropX", a.crop_y as "cropY", a.crop_w as "cropW", a.crop_h as "cropH", vm.role = 'logo' as "isProfile",
             v.id as "vendorId", v.display_name as "vendorName",
             v.slug::text as slug, u.display_name as "addedBy", a.created_at::text as "addedAt"
      from vendor_media vm join media_asset a on a.id = vm.media_asset_id join vendor v on v.id = vm.vendor_id
      left join app_user u on u.id = a.uploaded_by
      where a.deleted_at is null ${vendorId ? sql`and v.id = ${vendorId}` : sql``}
      order by a.created_at desc limit 60`),
  );
  const shown = new Map(toPhotos(env, [...rows]).map((p) => [p.id, p]));
  return rows.flatMap((r) => {
    const p = shown.get(r.id);
    return p
      ? [
          {
            ...p,
            isProfile: Boolean(r.isProfile),
            vendorId: r.vendorId,
            vendorName: r.vendorName,
            slug: r.slug,
            addedBy: r.addedBy,
            addedAt: r.addedAt,
          },
        ]
      : [];
  });
}

/** The team takes a photo off a business (for example, not the business's own). */
export async function removePhotoAsTeam(
  env: ServerEnv,
  admin: Admin,
  photoId: string,
  reason: string | null,
): Promise<{ id: string; path: string } | null> {
  return withDb(env, (db) =>
    db.transaction(async (tx) => {
      const [p] = await tx.execute<{ vendorId: string; alt: string; path: string }>(sql`
        select vm.vendor_id as "vendorId", a.alt_text as alt, a.storage_path as path
        from vendor_media vm join media_asset a on a.id = vm.media_asset_id
        where a.id = ${photoId} and a.deleted_at is null for update of a`);
      if (!p) return null;
      await takeOff(tx, photoId);
      await audit(tx, {
        actor: admin.userId,
        action: 'vendor_photo.team_remove',
        subjectType: 'vendor',
        subjectId: p.vendorId,
        reason,
        changes: { photo: { from: { id: photoId, description: p.alt }, to: null } },
        sessionRef: admin.sessionId,
      });
      return { id: photoId, path: p.path };
    }),
  );
}
