import { AwsClient } from 'aws4fetch';
import { sql } from 'drizzle-orm';
import type { Db } from './db.server';
import type { ServerEnv } from './env';

/**
 * Where business photos live: Supabase Storage (ADR-003), in one public bucket, reached
 * through its S3-compatible door with keys that can touch storage only (never the
 * database). Each photo is stored twice: as sent (up to 1600 pixels a side, made by the
 * owner's browser) and small (for lists). File names are random, so nobody can guess one.
 */

export const BUCKET = 'vendor-photos';

/** A business photo as pages show it. */
/** focusX, focusY: the spot (0 to 1 across and down) that frames keep in view (migration 0018). */
export type Photo = {
  id: string;
  url: string;
  smallUrl: string;
  alt: string;
  width: number | null;
  height: number | null;
  focusX: number;
  focusY: number;
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

function publicUrl(env: ServerEnv, path: string): string | null {
  const base = storageBase(env);
  return base ? `${base}/object/public/${BUCKET}/${path}` : null;
}

type PhotoRow = { id: string; path: string; alt: string; width: number | null; height: number | null; focusX: number; focusY: number };

export function toPhotos(env: ServerEnv, rows: PhotoRow[]): Photo[] {
  return rows.flatMap((r) => {
    const url = publicUrl(env, r.path);
    const smallUrl = publicUrl(env, smallPath(r.path));
    return url && smallUrl
      ? [{ id: r.id, url, smallUrl, alt: r.alt, width: r.width, height: r.height, focusX: Number(r.focusX), focusY: Number(r.focusY) }]
      : [];
  });
}

/** The small version of a stored photo, for lists (search results). */
export const smallPhotoUrl = (env: ServerEnv, path: string | null) => (path ? publicUrl(env, smallPath(path)) : null);

/** A business's photos in order: the first is its main photo. */
export async function readPhotos(db: Db, vendorId: string): Promise<PhotoRow[]> {
  return [
    ...(await db.execute<PhotoRow>(sql`
      select a.id, a.storage_path as path, a.alt_text as alt, a.width, a.height, a.focus_x as "focusX", a.focus_y as "focusY"
      from vendor_media vm join media_asset a on a.id = vm.media_asset_id
      where vm.vendor_id = ${vendorId} and a.deleted_at is null
      order by vm.sort_order, a.created_at`)),
  ];
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
