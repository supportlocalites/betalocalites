import { sql } from 'drizzle-orm';
import { AUDIT_KINDS } from '@/lib/audit-kinds';
import { isUuid } from '@/lib/ids.mjs';
import { actingAs } from '../acting.server';
import type { Admin } from '../auth/admin.server';
import type { ServerEnv } from '../env';
import { audit } from './audit.server';

/**
 * Admin → Audit log (X11, E §11): the permanent record of every team action and every
 * permission-sensitive change, newest first, 50 at a time. It names people and can hold
 * what changed, so each look is itself written to the log first, in the same transaction
 * (as the team's other pages that show people). Read-only: the database refuses edits and
 * deletions of audit_log. Callers must have passed adminGate.
 */

export const AUDIT_PAGE_SIZE = 50;

export type AuditFilters = {
  /** Who did it: an account id, or null for anyone. */
  actor: string | null;
  /** What it was about (subject_type), or null for anything. */
  kind: string | null;
  /** One record (subject_id), or null. */
  subject: string | null;
  /** Older than this entry (its time and id, "<iso>~<uuid>"), for the next page. */
  before: { at: string; id: string } | null;
};

export type AuditRow = {
  id: string;
  at: string;
  actor: string | null;
  actorEmail: string | null;
  action: string;
  subjectType: string;
  subjectId: string | null;
  reason: string | null;
  changes: unknown;
};

const PG_TIME = /^(\d{4})-(\d{2})-(\d{2}) ([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;
/** A time in Postgres's own text that names a real day (not 30 February), so the database accepts it. */
function isPgTime(at: string): boolean {
  const m = PG_TIME.exec(at);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const day = new Date(Date.UTC(y, mo - 1, d));
  return day.getUTCFullYear() === y && day.getUTCMonth() === mo - 1 && day.getUTCDate() === d;
}

/** Reads ?who=, ?kind=, ?record= and ?before= from the page's address, ignoring anything malformed. */
export function auditFilters(params: URLSearchParams): AuditFilters {
  const who = params.get('who');
  const kind = params.get('kind');
  const record = params.get('record');
  const [at, id] = (params.get('before') ?? '').split('~');
  return {
    actor: who && isUuid(who) ? who : null,
    kind: kind && Object.hasOwn(AUDIT_KINDS, kind) ? kind : null,
    subject: record && isUuid(record) ? record : null,
    // Exactly as the page wrote it (Postgres's own text for a time), so the database never refuses it.
    before: at && id && isUuid(id) && isPgTime(at) ? { at, id } : null,
  };
}

export async function auditPage(
  env: ServerEnv,
  admin: Admin,
  f: AuditFilters,
): Promise<{ rows: AuditRow[]; more: boolean; people: { id: string; name: string }[] }> {
  return actingAs(env, { side: 'team', userId: admin.userId }, async (tx) => {
    await audit(tx, {
      actor: admin.userId,
      action: 'audit_log.view',
      // About the log itself, not the record looked at, so a look never shows up as part of
      // that record's own history; the filters go in the reason.
      subjectType: 'audit_log',
      subjectId: null,
      reason:
        [f.actor && `who: ${f.actor}`, f.kind && `kind: ${f.kind}`, f.subject && `record: ${f.subject}`].filter(Boolean).join(', ') || null,
      sessionRef: admin.sessionId,
    });
    const [rows, people] = await Promise.all([
      tx.execute<AuditRow>(sql`
        select l.id, l.created_at::text as at, u.display_name as actor, u.email::text as "actorEmail", l.action,
               l.subject_type as "subjectType", l.subject_id as "subjectId", l.reason, l.changes
        from audit_log l left join app_user u on u.id = l.actor_user_id
        where (${f.actor}::uuid is null or l.actor_user_id = ${f.actor}::uuid)
          and (${f.kind}::text is null or l.subject_type = ${f.kind}::text)
          and (${f.subject}::uuid is null or l.subject_id = ${f.subject}::uuid)
          and (${f.before?.at ?? null}::timestamptz is null
               or (l.created_at, l.id) < (${f.before?.at ?? null}::timestamptz, ${f.before?.id ?? null}::uuid))
        order by l.created_at desc, l.id desc
        limit ${AUDIT_PAGE_SIZE + 1}`),
      // The filter's list of people: everyone who has been on the team.
      tx.execute<{ id: string; name: string }>(sql`
        select distinct u.id, u.display_name as name
        from platform_role r join app_user u on u.id = r.user_id
        order by name`),
    ]);
    return {
      rows: [...rows].slice(0, AUDIT_PAGE_SIZE),
      more: rows.length > AUDIT_PAGE_SIZE,
      people: [...people],
    };
  });
}
