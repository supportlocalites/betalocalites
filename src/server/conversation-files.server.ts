import { sql } from 'drizzle-orm';
import { checkImage, IMAGE_EXTENSION } from '@/lib/image-file';
import { FILE_LIMITS, MESSAGE_REFUSALS } from '@/lib/message-terms';
import { PlanCapped, PlanRefused } from './acting.server';
import type { Db } from './db.server';
import { withDb } from './db.server';
import type { ServerEnv } from './env';
import { deletePrivateFile, storePrivateFile, uploadsOn } from './photo-store.server';

/**
 * Files in conversations (Stage 2B, part 3; E §4.3 and §9; migration 0028). One photo
 * (JPEG or WebP, shrunk by the sender's browser, its hidden details such as where it was
 * taken removed again here) or one PDF per message, stored in a private folder. The site
 * hands each file over itself, only after the database's rules say the person asking may
 * see it. Localites doesn't read or interpret what's in a file.
 */

export type Attachment = {
  name: string;
  type: 'image/jpeg' | 'image/webp' | 'application/pdf';
  bytes: Uint8Array<ArrayBuffer>;
  width: number | null;
  height: number | null;
};

/** The file a message shows: never its storage address, which stays on the server. */
export type ShownFile = {
  id: string;
  name: string;
  isPhoto: boolean;
  size: number;
  width: number | null;
  height: number | null;
  /** Past its end date (D-47): shown as "This file has expired", no longer opened. */
  expired: boolean;
};

/** Sending files is on when photo storage is (the same keys reach the private folder, PO-20). */
export const filesOn = uploadsOn;

/** A whole upload, refused before it is read when it is clearly too big. */
export const MAX_FILE_UPLOAD = FILE_LIMITS.pdfBytes + 64 * 1024;

/** A file name safe to show and to offer for saving: no folders, no odd characters, kept short. */
export function tidyFileName(raw: string, ext: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const clean = base
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} ._()-]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const stem = (clean || 'file').slice(0, FILE_LIMITS.name - ext.length - 1).trim() || 'file';
  return `${stem}.${ext}`;
}

/** A PDF by its contents: it starts as one, and ends as one. */
function isPdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 5));
  const tail = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 1024)));
  return head === '%PDF-' && tail.includes('%%EOF');
}

/** The file from the form, checked; null when none was chosen; or why it can't be sent. */
export async function readAttachment(value: FormDataEntryValue | null): Promise<Attachment | { error: string } | null> {
  if (!value || typeof value === 'string' || value.size === 0) return null;
  if (value.size > FILE_LIMITS.pdfBytes) return { error: MESSAGE_REFUSALS.pdfTooBig };
  const raw = new Uint8Array(await value.arrayBuffer());
  if (isPdf(raw)) return { name: tidyFileName(value.name, 'pdf'), type: 'application/pdf', bytes: raw, width: null, height: null };
  if (raw.length > FILE_LIMITS.photoBytes) return { error: MESSAGE_REFUSALS.photoTooBig };
  const image = checkImage(raw);
  if (!image) return { error: MESSAGE_REFUSALS.fileType };
  if (image.turned) return { error: MESSAGE_REFUSALS.photoTurned };
  if (image.width > FILE_LIMITS.photoSide || image.height > FILE_LIMITS.photoSide) return { error: MESSAGE_REFUSALS.photoTooBig };
  const ext = IMAGE_EXTENSION[image.type];
  return {
    name: tidyFileName(value.name || `photo.${ext}`, ext),
    type: image.type,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
  };
}

/**
 * Before storing: sending files is on, the sender hasn't sent too many today, and the site
 * has room. (Checked again where it counts: the database refuses a file that isn't theirs.)
 */
export async function checkFileRoom(env: ServerEnv, size: number): Promise<void> {
  if (!filesOn(env)) throw new PlanRefused(MESSAGE_REFUSALS.filesOff);
  const [n] = await withDb(env, (db) => db.execute<{ stored: string }>(sql`select conversation_files_stored_bytes()::text as stored`));
  if (Number(n?.stored ?? 0) + size > FILE_LIMITS.siteBytes) throw new PlanRefused(MESSAGE_REFUSALS.filesFull);
}

/** The sender's files today (inside their acting step, after lockSender). */
export async function checkFilesToday(tx: Db, userId: string): Promise<void> {
  // Every file they sent, whichever side they sent it from (migration 0029).
  const [n] = await tx.execute<{ n: number }>(sql`select files_sent_today(${userId}::uuid) as n`);
  if ((n?.n ?? 0) >= FILE_LIMITS.perDay) throw new PlanCapped(MESSAGE_REFUSALS.filesPerDay);
}

/** Stores the file under the conversation's own folder; the path, or a plain refusal. */
export async function storeAttachment(env: ServerEnv, conversationId: string, file: Attachment): Promise<string> {
  const ext = file.type === 'application/pdf' ? 'pdf' : IMAGE_EXTENSION[file.type];
  const path = `conversations/${conversationId}/${crypto.randomUUID()}.${ext}`;
  if (!(await storePrivateFile(env, path, file.bytes, file.type))) throw new PlanRefused(MESSAGE_REFUSALS.fileNotSaved);
  return path;
}

/** A stored file whose message wasn't saved: deleted now (or logged: its random name is known nowhere else). */
export async function abandonAttachment(env: ServerEnv, path: string): Promise<void> {
  if (!(await deletePrivateFile(env, path))) console.error('conversation file left in storage', path);
}

/** Adds the file to the message just written (the database checks it's the author's, as they write it). */
export async function attachFile(tx: Db, messageId: string, conversationId: string, userId: string, path: string, file: Attachment) {
  await tx.execute(sql`
    insert into conversation_file (message_id, conversation_id, uploaded_by, storage_path, file_name, mime_type, byte_size, width, height)
    values (${messageId}, ${conversationId}, ${userId}, ${path}, ${file.name}, ${file.type}, ${file.bytes.length}, ${file.width}, ${file.height})`);
}

/** The files a page shows, by message: only ones still there (not removed or hidden). */
export async function filesByMessage(tx: Db, conversationId: string): Promise<Map<string, ShownFile>> {
  const rows = await tx.execute<ShownFile & { messageId: string }>(sql`
    select f.id, f.message_id as "messageId", f.file_name as name, f.mime_type <> 'application/pdf' as "isPhoto",
           f.byte_size as size, f.width, f.height, f.expired_at is not null as expired
    from conversation_file f join message m on m.id = f.message_id
    where f.conversation_id = ${conversationId} and (f.deleted_at is null or f.expired_at is not null)
      and m.removed_at is null and m.hidden_by_team_at is null`);
  return new Map(rows.map(({ messageId, ...f }) => [messageId, f]));
}

/** One file to open, as the acting side may see it; null when it isn't theirs, or is gone. */
export async function findFile(tx: Db, conversationId: string, fileId: string) {
  const [f] = await tx.execute<{ path: string; type: string; name: string }>(sql`
    select f.storage_path as path, f.mime_type as type, f.file_name as name
    from conversation_file f join message m on m.id = f.message_id
    where f.id = ${fileId} and f.conversation_id = ${conversationId}
      and f.deleted_at is null and m.removed_at is null and m.hidden_by_team_at is null`);
  return f ?? null;
}

/**
 * Hands a file over: photos shown in the page, PDFs saved (never opened as a page of this
 * site), nothing the browser may run, and nothing kept in shared caches.
 */
export function fileResponse(body: ReadableStream, file: { type: string; name: string }): Response {
  const photo = file.type !== 'application/pdf';
  const ascii = file.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return new Response(body, {
    headers: {
      'Content-Type': file.type,
      'Content-Disposition': `${photo ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      // Checked again each time: a removed or hidden file stops showing at once.
      'Cache-Control': 'private, no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; sandbox",
    },
  });
}

/**
 * Deletes the storage of files that went with their messages (and aren't kept for a report).
 * Run after a removal and by the nightly run. Each deletion is one outside request; a few per run.
 */
export async function cleanUpConversationFiles(env: ServerEnv, limit = 20): Promise<{ deleted: number; left: number } | 'off'> {
  if (!filesOn(env)) return 'off';
  const rows = await withDb(env, (db) =>
    db.execute<{ id: string; path: string }>(sql`select id, storage_path as path from conversation_files_to_remove(${limit})`),
  );
  let deleted = 0;
  for (const r of rows) {
    if (!(await deletePrivateFile(env, r.path))) continue;
    await withDb(env, (db) => db.execute(sql`select conversation_file_storage_removed(${r.id}::uuid)`));
    deleted += 1;
  }
  return { deleted, left: rows.length - deleted };
}

/**
 * Nightly (D-47): files past their end date (30 days after the conversation's event, or a year
 * after they were sent) are taken off; their storage is deleted by cleanUpConversationFiles.
 */
export async function expireConversationFiles(env: ServerEnv): Promise<number> {
  const [n] = await withDb(env, (db) => db.execute<{ n: number }>(sql`select expire_conversation_files(500) as n`));
  return n?.n ?? 0;
}
