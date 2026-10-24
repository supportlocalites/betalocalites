import { AwsClient } from 'aws4fetch';
import { sql } from 'drizzle-orm';
import type { Frame } from '@/lib/photo-frame';
import type { Db } from './db.server';
import type { ServerEnv } from './env';

/**
 * Where business photos live: Supabase Storage (ADR-003), in one public bucket, reached
 * through its S3-compatible door with keys that can touch storage only (never the
 * database). Each photo is stored twice: as sent (up to 1600 pixels a side, made by the
 * owner's browser) and small (for lists). File names are random, so nobody can guess one.
 */

export const BUCKET = 'vendor-photos';

/**
 * A business photo as pages show it. frame: how the owner framed it in its square (the
 * profile photo, migration 0019), or null for the smart default. Page photos are always shown
 * whole, so the spot chosen under migration 0018 (focus_x, focus_y) is no longer read.
 */
export type Photo = {
  id: string;
  url: string;
  smallUrl: string;
  alt: string;
  width: number | null;
  height: number | null;
  frame: Frame | null;
};

const isLocal = (url: string) => {
  try {
    const host = new URL(url).hostname;
    return host === '127.0.0.1' || host === 'localhost';
  } catch {
    return false;
  }
};

/** Supabase Storage's address, or (local tests only) a pretend one on this computer. */
function storageBase(env: ServerEnv): string | null {
  if (env.PHOTO_STORAGE_URL && isLocal(env.PHOTO_STORAGE_URL)) return env.PHOTO_STORAGE_URL.replace(/\/$/, '');
  return env.SUPABASE_URL ? `${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1` : null;
}

/** Owners can add photos exactly when the storage keys are set (Cloudflare → Variables and Secrets). */
export const uploadsOn = (env: ServerEnv) => Boolean(storageBase(env) && env.PHOTO_KEY_ID && env.PHOTO_SECRET && env.PHOTO_REGION);

export const smallPath = (path: string) => path.replace(/\.(jpg|webp)$/, '-small.$1');

/**
 * The sample businesses' drawings (scripts/demo/) are part of the site itself, in
 * public/sample-photos/, not in storage: only the loading script makes these paths, since
 * every uploaded photo gets a random name.
 */
export const SAMPLE_PREFIX = 'samples/';

function publicUrl(env: ServerEnv, path: string): string | null {
  if (path.startsWith(SAMPLE_PREFIX)) return `/sample-photos/${path.slice(SAMPLE_PREFIX.length)}`;
  const base = storageBase(env);
  return base ? `${base}/object/public/${BUCKET}/${path}` : null;
}

/** Numbers may arrive as text (the connection doesn't look types up). */
type PhotoRow = {
  id: string;
  path: string;
  alt: string;
  width: number | null;
  height: number | null;
  cropX?: number | string | null;
  cropY?: number | string | null;
  cropW?: number | string | null;
  cropH?: number | string | null;
};

const PHOTO_COLUMNS = sql`a.id, a.storage_path as path, a.alt_text as alt, a.width, a.height,
  a.crop_x as "cropX", a.crop_y as "cropY", a.crop_w as "cropW", a.crop_h as "cropH"`;

const frameFrom = (r: PhotoRow): Frame | null =>
  r.cropX == null || r.cropY == null || r.cropW == null || r.cropH == null
    ? null
    : { x: Number(r.cropX), y: Number(r.cropY), w: Number(r.cropW), h: Number(r.cropH) };

export function toPhotos(env: ServerEnv, rows: PhotoRow[]): Photo[] {
  return rows.flatMap((r) => {
    const url = publicUrl(env, r.path);
    const smallUrl = publicUrl(env, smallPath(r.path));
    const size = (n: number | null) => (n == null ? null : Number(n));
    return url && smallUrl
      ? [
          {
            id: r.id,
            url,
            smallUrl,
            alt: r.alt,
            width: size(r.width),
            height: size(r.height),
            frame: frameFrom(r),
          },
        ]
      : [];
  });
}

/** A stored photo's large version (the Base44 profile panel's photo, D-59). */
export const photoUrl = (env: ServerEnv, path: string | null) => (path ? publicUrl(env, path) : null);

/** The small version of a stored photo, for lists (search results). */
export const smallPhotoUrl = (env: ServerEnv, path: string | null) => (path ? publicUrl(env, smallPath(path)) : null);

/** A business's page photos in order: the first leads its page. */
export async function readPhotos(db: Db, vendorId: string): Promise<PhotoRow[]> {
  return [
    ...(await db.execute<PhotoRow>(sql`
      select ${PHOTO_COLUMNS}
      from vendor_media vm join media_asset a on a.id = vm.media_asset_id
      where vm.vendor_id = ${vendorId} and vm.role = 'gallery' and a.deleted_at is null
      order by vm.sort_order, a.created_at`)),
  ];
}

/** A business's square profile photo (its logo or a photo it likes), if it has one. */
export async function readProfilePhoto(db: Db, vendorId: string): Promise<PhotoRow[]> {
  return [
    ...(await db.execute<PhotoRow>(sql`
      select ${PHOTO_COLUMNS}
      from vendor_media vm join media_asset a on a.id = vm.media_asset_id
      where vm.vendor_id = ${vendorId} and vm.role = 'logo' and a.deleted_at is null`)),
  ];
}

/**
 * The photo beside a business in lists: its profile photo, or else its first page photo
 * (shown with the smart default). As columns for a lateral join on vendor v.
 */
export const LIST_PHOTO = sql`left join lateral (
    select a.storage_path as path, a.width, a.height, a.crop_x, a.crop_y, a.crop_w, a.crop_h
    from vendor_media vm join media_asset a on a.id = vm.media_asset_id
    where vm.vendor_id = v.id and vm.role in ('logo', 'gallery') and a.deleted_at is null
    order by vm.role = 'logo' desc, vm.sort_order, a.created_at limit 1) lp on true`;

export type ListPhotoColumns = {
  photoPath: string | null;
  photoWidth: number | string | null;
  photoHeight: number | string | null;
  cropX: number | string | null;
  cropY: number | string | null;
  cropW: number | string | null;
  cropH: number | string | null;
};
export const LIST_PHOTO_COLUMNS = sql`lp.path as "photoPath", lp.width as "photoWidth", lp.height as "photoHeight",
  lp.crop_x as "cropX", lp.crop_y as "cropY", lp.crop_w as "cropW", lp.crop_h as "cropH"`;

/** The list photo, ready for a page: its small version and its framing. */
export type ListPhoto = { url: string; width: number | null; height: number | null; frame: Frame | null };
export function toListPhoto(env: ServerEnv, c: ListPhotoColumns): ListPhoto | null {
  if (!c.photoPath) return null;
  const url = publicUrl(env, smallPath(c.photoPath));
  if (!url) return null;
  const num = (v: number | string | null) => (v == null ? null : Number(v));
  const frame =
    c.cropX == null || c.cropY == null || c.cropW == null || c.cropH == null
      ? null
      : { x: Number(c.cropX), y: Number(c.cropY), w: Number(c.cropW), h: Number(c.cropH) };
  return { url, width: num(c.photoWidth), height: num(c.photoHeight), frame };
}

/**
 * A row read with LIST_PHOTO_COLUMNS, made ready for a page: the photo columns become one
 * `photo` (the storage path never leaves the server). `show` false gives no photo, for a
 * business that isn't published (its photos show nowhere until it is, E §9).
 */
export function withListPhoto<T extends ListPhotoColumns>(
  env: ServerEnv,
  row: T,
  show = true,
): Omit<T, keyof ListPhotoColumns> & { photo: ListPhoto | null } {
  const { photoPath, photoWidth, photoHeight, cropX, cropY, cropW, cropH, ...rest } = row;
  const photo = show ? toListPhoto(env, { photoPath, photoWidth, photoHeight, cropX, cropY, cropW, cropH }) : null;
  return { ...rest, photo };
}

function client(env: ServerEnv): { s3: AwsClient; base: string } | null {
  const base = storageBase(env);
  if (!base || !env.PHOTO_KEY_ID || !env.PHOTO_SECRET || !env.PHOTO_REGION) return null;
  return {
    // No automatic retries: an outage gets a quick, plain answer (and the nightly retry for removals),
    // not a page waiting a minute while the free plan's 50 outside requests a run are used up.
    s3: new AwsClient({
      accessKeyId: env.PHOTO_KEY_ID,
      secretAccessKey: env.PHOTO_SECRET,
      service: 's3',
      region: env.PHOTO_REGION,
      retries: 0,
    }),
    base,
  };
}

const objectUrl = (base: string, path: string) => `${base}/s3/${BUCKET}/${path}`;

/** Stores one file. Never throws; false when storage refused or couldn't be reached. */
export async function storeFile(env: ServerEnv, path: string, bytes: Uint8Array<ArrayBuffer>, type: string): Promise<boolean> {
  const c = client(env);
  if (!c) return false;
  try {
    const res = await c.s3.fetch(objectUrl(c.base, path), {
      method: 'PUT',
      body: bytes,
      // An hour: a photo the team removes stops showing from caches within the hour (Supabase's
      // free plan can't clear its cache on demand).
      headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600' },
    });
    await res.body?.cancel();
    if (!res.ok) console.error('photo storage refused a file', res.status);
    return res.ok;
  } catch (err) {
    console.error('photo storage unreachable', err instanceof Error ? err.message : err);
    return false;
  }
}

/** Deletes a photo's two files. Never throws; true when both are gone (or were never there). */
export async function deleteFiles(env: ServerEnv, path: string): Promise<boolean> {
  if (path.startsWith(SAMPLE_PREFIX)) return true; // a sample drawing isn't in storage
  const c = client(env);
  if (!c) return false;
  const results = await Promise.all(
    [path, smallPath(path)].map(async (p) => {
      try {
        const res = await c.s3.fetch(objectUrl(c.base, p), { method: 'DELETE' });
        await res.body?.cancel();
        return res.ok || res.status === 404;
      } catch {
        return false;
      }
    }),
  );
  return results.every(Boolean);
}

// ---------------------------------------------------------------- files in conversations (private)

/** Files sent in conversations (migration 0028): a private folder, never served at a public address. */
export const CONVERSATION_BUCKET = 'conversation-files';

const privateUrl = (base: string, path: string) => `${base}/s3/${CONVERSATION_BUCKET}/${path}`;

/** Stores one conversation file. Never throws; false when storage refused or couldn't be reached. */
export async function storePrivateFile(env: ServerEnv, path: string, bytes: Uint8Array<ArrayBuffer>, type: string): Promise<boolean> {
  const c = client(env);
  if (!c) return false;
  try {
    const res = await c.s3.fetch(privateUrl(c.base, path), {
      method: 'PUT',
      body: bytes,
      headers: { 'Content-Type': type, 'Cache-Control': 'private, no-store' },
    });
    await res.body?.cancel();
    if (!res.ok) console.error('conversation file storage refused a file', res.status);
    return res.ok;
  } catch (err) {
    console.error('conversation file storage unreachable', err instanceof Error ? err.message : err);
    return false;
  }
}

/** One conversation file's contents, for the site to hand over itself; null when it can't be read. */
export async function readPrivateFile(env: ServerEnv, path: string): Promise<ReadableStream | null> {
  const c = client(env);
  if (!c) return null;
  try {
    const res = await c.s3.fetch(privateUrl(c.base, path), { method: 'GET' });
    if (!res.ok || !res.body) {
      await res.body?.cancel();
      return null;
    }
    return res.body;
  } catch {
    return null;
  }
}

/** Deletes one conversation file. Never throws; true when it's gone (or was never there). */
export async function deletePrivateFile(env: ServerEnv, path: string): Promise<boolean> {
  const c = client(env);
  if (!c) return false;
  try {
    const res = await c.s3.fetch(privateUrl(c.base, path), { method: 'DELETE' });
    await res.body?.cancel();
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}
