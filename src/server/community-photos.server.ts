import { sql } from 'drizzle-orm';
import { FILE_LIMITS } from '@/lib/message-terms';
import { IMAGE_EXTENSION } from '@/lib/image-file';
import { uuidv7 } from '@/lib/ids.mjs';
import { actingAs } from './acting.server';
import type { Admin } from './auth/admin.server';
import { audit } from './admin/audit.server';
import { type Attachment, readAttachment } from './conversation-files.server';
import { type Db, withDb } from './db.server';
import type { ServerEnv } from './env';
import { deletePrivateFile, readPrivateFile, storePrivateFile, uploadsOn } from './photo-store.server';

/**
 * Photos on Community questions and answers (the owner, 27 October 2026: "photos need to be
 * vetted before they are posted", migration 0063). Up to 3 with a post, shrunk by the person's
 * browser (and their hidden details, such as where they were taken, removed again here). Stored
 * privately; each waits for the team before anyone else sees it, and is handed out by the site
 * only after the database's rules say the person asking may see it.
 */

export const PHOTOS_PER_POST = 3;
/** A whole post with its photos, refused before it's read when clearly bigger. */
export const MAX_POST_UPLOAD = PHOTOS_PER_POST * FILE_LIMITS.photoBytes + 64 * 1024;

export type PostPhoto = { id: string; waiting: boolean; width: number | null; height: number | null };

/** Why photos couldn't go with a post, as a code the page turns into words (community-terms). */
export class PhotoProblem extends Error {
  constructor(readonly code: 'photoProblem' | 'photoTooMany' | 'photoOff' | 'photoFull' | 'photoNotSaved') {
    super(code);
  }
}

/** Community photos are on when photo storage is (the same keys reach the private folder). */
export const communityPhotosOn = uploadsOn;

/** The photos from the form, checked (photos only, up to 3); or why they can't be added. */
export async function readPostPhotos(form: FormData): Promise<Attachment[]> {
  const chosen = form.getAll('photos').filter((v): v is File => typeof v !== 'string' && v.size > 0);
  if (chosen.length > PHOTOS_PER_POST) throw new PhotoProblem('photoTooMany');
  const photos: Attachment[] = [];
  for (const file of chosen) {
    const read = await readAttachment(file);
    if (!read) continue;
    if ('error' in read || read.type === 'application/pdf') throw new PhotoProblem('photoProblem');
    photos.push(read);
  }
  return photos;
}

/** Room for them on the free plan's storage, shared with conversation files. */
export async function checkPhotoRoom(env: ServerEnv, photos: Attachment[]): Promise<void> {
  if (photos.length === 0) return;
  if (!communityPhotosOn(env)) throw new PhotoProblem('photoOff');
  const size = photos.reduce((n, p) => n + p.bytes.length, 0);
  const [n] = await withDb(env, (db) =>
    db.execute<{ stored: string }>(sql`select (conversation_files_stored_bytes() + community_photos_stored_bytes())::text as stored`),
  );
  if (Number(n?.stored ?? 0) + size > FILE_LIMITS.siteBytes) throw new PhotoProblem('photoFull');
}

export type StoredPhoto = Attachment & { id: string; path: string };

/** Stores them before the post is written; their paths, so a post that isn't saved takes them back. */
export async function storePostPhotos(env: ServerEnv, photos: Attachment[]): Promise<StoredPhoto[]> {
  const stored: StoredPhoto[] = [];
  for (const p of photos) {
    const id = uuidv7();
    const path = `community/${id}.${IMAGE_EXTENSION[p.type as keyof typeof IMAGE_EXTENSION]}`;
    if (!(await storePrivateFile(env, path, p.bytes, p.type))) {
      await abandonPhotos(env, stored);
      throw new PhotoProblem('photoNotSaved');
    }
    stored.push({ ...p, id, path });
  }
  return stored;
}

/** Photos stored for a post that wasn't saved: deleted again (their random names are known nowhere else). */
export async function abandonPhotos(env: ServerEnv, stored: StoredPhoto[]): Promise<void> {
  for (const p of stored) if (!(await deletePrivateFile(env, p.path))) console.error('community photo left in storage', p.path);
}

/** Adds them to the post just written, in the same step (the database checks it's the author's). */
export async function attachPostPhotos(tx: Db, post: { questionId?: string; answerId?: string }, userId: string, stored: StoredPhoto[]) {
  for (const p of stored) {
    await tx.execute(sql`
      insert into community_photo (id, question_id, answer_id, author_user_id, storage_path, mime_type, byte_size, width, height)
      values (${p.id}, ${post.questionId ?? null}, ${post.answerId ?? null}, ${userId}, ${p.path}, ${p.type}, ${p.bytes.length}, ${p.width}, ${p.height})`);
  }
}

/** The photos a question's page may show, by post: as the database's rules allow the reader. */
export async function photosOnQuestion(db: Db, questionId: string): Promise<Map<string, PostPhoto[]>> {
  const rows = await db.execute<PostPhoto & { post: string }>(sql`
    select p.id, coalesce(p.question_id, p.answer_id) as post, p.status = 'pending' as waiting, p.width, p.height
    from community_photo p
    where p.status <> 'removed'
      and (p.question_id = ${questionId} or p.answer_id in (select a.id from community_answer a where a.question_id = ${questionId}))
    order by p.created_at`);
  const by = new Map<string, PostPhoto[]>();
  for (const { post, ...photo } of rows) by.set(post, [...(by.get(post) ?? []), photo]);
  return by;
}

/**
 * One photo's picture, if the person asking may see it (the database's rules decide: shown on a
 * shown post; their own; the team). Waiting ones are never kept by a shared cache.
 */
export async function openPhoto(
  env: ServerEnv,
  reader: { userId: string | null; team: boolean },
  photoId: string,
): Promise<{ body: ReadableStream; type: string; waiting: boolean } | null> {
  const read = (db: Db) =>
    db.execute<{ path: string; type: string; waiting: boolean }>(sql`
      select storage_path as path, mime_type as type, status = 'pending' as waiting
      from community_photo where id = ${photoId} and status <> 'removed' and storage_removed_at is null`);
  const [row] = reader.team
    ? await actingAs(env, { side: 'team', userId: reader.userId! }, read)
    : reader.userId
      ? await actingAs(env, { side: 'person', userId: reader.userId }, read)
      : await withDb(env, read);
  if (!row) return null;
  const body = await readPrivateFile(env, row.path);
  return body ? { body, type: row.type, waiting: row.waiting } : null;
}

/** The team's queue: photos waiting, with their post (newest last). */
export type WaitingPhoto = { id: string; questionId: string; title: string; on: 'question' | 'answer'; author: string; createdAt: string };
export async function waitingPhotos(env: ServerEnv, admin: Admin): Promise<WaitingPhoto[]> {
  return actingAs(env, { side: 'team', userId: admin.userId }, (db) =>
    db.execute<WaitingPhoto>(sql`
      select p.id, coalesce(p.question_id, a.question_id) as "questionId", q.title,
             case when p.question_id is not null then 'question' else 'answer' end as on,
             coalesce(reviewer_name(p.author_user_id), 'A Localites member') as author, p.created_at::text as "createdAt"
      from community_photo p
      left join community_answer a on a.id = p.answer_id
      join community_question q on q.id = coalesce(p.question_id, a.question_id)
      -- Not on a post that's been taken down (nothing to show it with).
      where p.status = 'pending' and q.status <> 'removed' and (a.id is null or a.status <> 'removed')
      order by p.created_at
      limit 100`),
  );
}

/** The team shows a waiting photo, or takes one down; written to the audit log. */
export async function decidePhoto(env: ServerEnv, admin: Admin, photoId: string, to: 'show' | 'remove'): Promise<boolean> {
  return actingAs(env, { side: 'team', userId: admin.userId }, async (tx) => {
    const rows = await tx.execute<{ id: string }>(sql`
      update community_photo set status = ${to === 'show' ? 'shown' : 'removed'}, removed_by = ${to === 'show' ? null : 'team'},
             decided_by = ${admin.userId}, decided_at = now()
      where id = ${photoId} and status = 'pending' returning id`);
    if (rows.length === 0) return false;
    await audit(tx, {
      actor: admin.userId,
      action: `community_photo.${to === 'show' ? 'shown' : 'removed'}`,
      subjectType: 'community_photo',
      subjectId: photoId,
      changes: { status: { from: 'pending', to: to === 'show' ? 'shown' : 'removed' } },
      sessionRef: admin.sessionId,
    });
    return true;
  });
}

/** Deletes the stored files of photos taken down (run after a decision and nightly). */
export async function cleanUpCommunityPhotos(env: ServerEnv, limit = 20): Promise<{ deleted: number; left: number } | 'off'> {
  if (!communityPhotosOn(env)) return 'off';
  const rows = await withDb(env, (db) => db.execute<{ id: string; path: string }>(sql`select id, storage_path as path from community_photos_to_remove(${limit})`));
  let deleted = 0;
  for (const r of rows) {
    if (!(await deletePrivateFile(env, r.path))) continue;
    await withDb(env, (db) => db.execute(sql`select community_photo_storage_removed(${r.id}::uuid)`));
    deleted += 1;
  }
  return { deleted, left: rows.length - deleted };
}
