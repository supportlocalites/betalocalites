import { sql } from 'drizzle-orm';
import { uuidv7 } from '@/lib/ids.mjs';
import type { Db } from '../db.server';

export type AuditEntry = {
  actor: string | null;
  action: string; // e.g. 'vendor.create', 'vendor.publish'
  subjectType: string;
  subjectId: string | null;
  reason?: string | null;
  changes?: Record<string, { from: unknown; to: unknown }> | null;
  sessionRef?: string | null;
};

/** Appends to the permanent audit log (the database refuses edits and deletions). Returns the entry's id. */
export async function audit(db: Db, e: AuditEntry): Promise<string> {
  const id = uuidv7();
  await db.execute(sql`
    insert into audit_log (id, actor_user_id, action, subject_type, subject_id, reason, changes, session_ref)
    values (${id}, ${e.actor}, ${e.action}, ${e.subjectType}, ${e.subjectId}, ${e.reason ?? null},
            ${e.changes ? JSON.stringify(e.changes) : null}::jsonb, ${e.sessionRef ?? null})
  `);
  return id;
}

/** Field-by-field differences, for the audit log. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, to] of Object.entries(after)) {
    const from = before[key];
    if (JSON.stringify(from ?? null) !== JSON.stringify(to ?? null)) changes[key] = { from: from ?? null, to: to ?? null };
  }
  return changes;
}
