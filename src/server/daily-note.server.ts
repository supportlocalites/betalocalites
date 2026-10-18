import { sql } from 'drizzle-orm';
import { withDb } from './db.server';
import { sendEmail, TEAM_ADDRESS } from './email.server';
import type { ServerEnv } from './env';
import { type ChangeSet, describeChanges, undoableKeys } from './owner-changes';

/**
 * The team's daily note of owners' changes (D-34, ADR-029), run by Cloudflare's scheduler
 * (wrangler.jsonc triggers). One note a day at most: the day is claimed in team_digest
 * first, and a failed send is retried by the next run (its saves stay pending). It also
 * reminds the team of deleted accounts whose sign-in record still has to be removed by hand
 * (migration 0044). Nothing to say: nothing is sent, and the day is recorded as "nothing to
 * report".
 */

const MAX_LISTED = 200;
const today = sql`(now() at time zone 'America/Toronto')::date`;

type Pending = {
  auditId: string;
  vendorId: string;
  business: string;
  owner: string | null;
  at: string;
  flags: string[];
  changes: ChangeSet;
  undoneBy: string | null;
  /** What the team's undo put back (the undo's own audit row), when it was undone. */
  undoChanges: ChangeSet | null;
  names: Record<string, string>;
};

const undoWords = (s: Pending) => {
  if (!s.undoneBy) return '';
  const putBack = new Set(Object.keys(s.undoChanges ?? {}));
  const all = undoableKeys(s.changes).every((k) => putBack.has(k));
  return ` (${all ? 'already undone' : 'partly undone'} by ${s.undoneBy})`;
};

const when = new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });

/** Deleted accounts whose Supabase sign-in record the team still has to remove (E §8). */
export type ToFinish = { waiting: number; oldest: string | null };

const day = new Intl.DateTimeFormat('en-CA', { month: 'long', day: 'numeric', timeZone: 'America/Toronto' });

/** The reminder's line: how many, and when the oldest is due (30 days after it was asked for). */
export function finishLine(todo: ToFinish, siteUrl: string): string | null {
  if (todo.waiting === 0 || !todo.oldest) return null;
  const due = day.format(new Date(new Date(todo.oldest).getTime() + 30 * 86400000));
  const what = todo.waiting === 1 ? '1 deleted account still needs its sign-in record' : `${todo.waiting} deleted accounts still need their sign-in records`;
  return `${what} removed in Supabase (the oldest by ${due}): ${siteUrl}/admin/account-deletions`;
}

/** The note's words: the reminder first, then owners' saves grouped by business (flagged saves first). */
export function noteText(rows: Pending[], more: number, siteUrl: string, todo: ToFinish = { waiting: 0, oldest: null }): { subject: string; text: string } {
  const businesses = new Map<string, Pending[]>();
  for (const r of rows) businesses.set(r.vendorId, [...(businesses.get(r.vendorId) ?? []), r]);
  const reminder = finishLine(todo, siteUrl);
  if (rows.length === 0) {
    return {
      subject: `Localites: ${todo.waiting === 1 ? '1 deleted account' : `${todo.waiting} deleted accounts`} to finish`,
      text: [reminder ?? '', '', 'No owner changed a listing since the last note.'].join('\n'),
    };
  }
  const lines = [
    ...(reminder ? [reminder, ''] : []),
    'Owners changed these listings since the last note. They are already live. Undo anything that breaks our rules on the listing’s admin page.',
  ];
  for (const [vendorId, saves] of businesses) {
    lines.push('', `${saves[0]!.business}, owner ${saves[0]!.owner ?? 'unknown'}`);
    for (const s of saves) {
      const flag = s.flags.length > 0 ? `. CHECK: new ${s.flags.join(' and ')}` : '';
      lines.push(`  ${when.format(new Date(s.at))}${flag}${undoWords(s)}`);
      for (const l of describeChanges(s.changes, (id) => s.names[id] ?? 'a service')) lines.push(`    ${l}`);
    }
    lines.push(`  ${siteUrl}/admin/listings/${vendorId}#owner-changes`);
  }
  if (more > 0) lines.push('', `…and ${more} more. See each listing’s admin page.`);
  const total = rows.length + more;
  return {
    subject: `Owner changes on Localites: ${businesses.size} ${businesses.size === 1 ? 'business' : 'businesses'}, ${total} ${total === 1 ? 'save' : 'saves'}`,
    text: lines.join('\n'),
  };
}

export type NoteOutcome = 'already_done' | 'empty' | 'sent' | 'failed';

export async function runDailyNote(env: ServerEnv): Promise<NoteOutcome> {
  // One connection for the whole job (each one costs time from the run's small CPU budget).
  return withDb(env, async (db) => {
    // 1. Claim today's note (or retry a failed one, or one stuck for half an hour).
    const [claimed] = await db.execute<{ day: string }>(sql`
      insert into team_digest (day, status) values (${today}, 'sending')
      on conflict (day) do update set status = 'sending', started_at = now(), failure_reason = null, sent_at = null
      where team_digest.status = 'failed'
         or (team_digest.status = 'sending' and team_digest.started_at < now() - interval '30 minutes')
      returning day::text as day`);
    if (!claimed) return 'already_done';
    const fail = async (reason: string) => {
      await db.execute(sql`update team_digest set status = 'failed', failure_reason = ${reason.slice(0, 300)} where day = ${claimed.day}::date`);
      return 'failed' as const;
    };

    let listed: Pending[];
    let more: number;
    let todo: ToFinish;
    try {
      // 2. Every owner save not yet in a note.
      const rows = await db.execute<Pending>(sql`
        select oc.audit_id as "auditId", oc.vendor_id as "vendorId", v.display_name as business, u.display_name as owner,
               a.created_at::text as at, to_json(oc.flags) as flags, a.changes, ub.display_name as "undoneBy",
               ua.changes as "undoChanges",
               coalesce((select json_object_agg(s.id, s.name) from vendor_service s where s.vendor_id = oc.vendor_id), '{}') as names
        from owner_change oc
        join audit_log a on a.id = oc.audit_id
        join vendor v on v.id = oc.vendor_id
        left join app_user u on u.id = a.actor_user_id
        left join app_user ub on ub.id = oc.undone_by
        left join audit_log ua on ua.id = oc.undo_audit_id
        where oc.digest_day is null
        order by (cardinality(oc.flags) > 0) desc, v.display_name, oc.audit_id
        limit ${MAX_LISTED + 1}`);
      listed = rows.slice(0, MAX_LISTED);
      const [pending] = await db.execute<{ n: number }>(sql`select count(*)::int as n from owner_change where digest_day is null`);
      more = Math.max(0, (pending?.n ?? 0) - listed.length);
    } catch (err) {
      // Recorded, so the Listings page says so and the next run tries again.
      return fail(`The note couldn’t be prepared (${err instanceof Error ? err.message : 'unknown error'}).`);
    }

    // The reminder on its own: if it can't be read, the owners' changes still go.
    try {
      const [finish] = await db.execute<ToFinish>(sql`select waiting, oldest::text as oldest from deletions_to_finish()`);
      todo = finish ?? { waiting: 0, oldest: null };
    } catch (err) {
      console.error('deleted accounts reminder not read:', err instanceof Error ? err.message : err);
      todo = { waiting: 0, oldest: null };
    }

    if (listed.length === 0 && todo.waiting === 0) {
      await db.execute(sql`update team_digest set status = 'empty', change_count = 0 where day = ${claimed.day}::date`);
      return 'empty';
    }

    // 3. One email; then mark exactly the saves it listed.
    const result = await sendEmail(env, {
      to: TEAM_ADDRESS,
      ...noteText(listed, more, env.SITE_URL ?? 'https://localites.supportlocalites.workers.dev', todo),
    });
    if (!result.sent) return fail(result.reason);
    const ids = `{${listed.map((r) => r.auditId).join(',')}}`;
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        update team_digest set status = 'sent', sent_at = now(), change_count = ${listed.length} where day = ${claimed.day}::date`);
      await tx.execute(sql`update owner_change set digest_day = ${claimed.day}::date where audit_id = any(${ids}::uuid[])`);
    });
    return 'sent';
  });
}

export type NoteStatus = {
  day: string;
  status: string;
  changeCount: number;
  sentAt: string | null;
  failureReason: string | null;
  stale: boolean;
  stuck: boolean;
} | null;

/**
 * The latest note, for the team's Listings page. "stale": none for 36 hours. "stuck": it
 * started over half an hour ago and never finished (the run stopped part way).
 */
export async function latestNote(env: ServerEnv): Promise<NoteStatus> {
  const [row] = await withDb(env, (db) =>
    db.execute<Exclude<NoteStatus, null>>(sql`
      select day::text as day, status, change_count as "changeCount", sent_at::text as "sentAt",
             failure_reason as "failureReason", started_at < now() - interval '36 hours' as stale,
             status = 'sending' and started_at < now() - interval '30 minutes' as stuck
      from team_digest order by day desc limit 1`),
  );
  return row ?? null;
}
