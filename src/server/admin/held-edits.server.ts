import { sql } from 'drizzle-orm';
import type { Admin } from '../auth/admin.server';
import { withDb } from '../db.server';
import { emailPerson, renderEmail } from '../email-templates.server';
import { sendEmail, TEAM_ADDRESS } from '../email.server';
import type { ServerEnv } from '../env';
import { type ChangeSet, describeChanges } from '../owner-changes';
import { type HeldEdit, OwnerRefused, readCurrent, writeHeldEdit } from '../owner-listing.server';
import { audit } from './audit.server';

/**
 * Owners' saves held by the language check (D-50, migration 0036): the team's email, the
 * team's list, and putting one live or declining it. Putting it live makes the save as the
 * owner's own, exactly as if they had just saved (only what they changed; refused if any of
 * it changed since). The owner is emailed either way. Callers must have passed adminGate.
 */

/** Team emails about held saves a day, across the site (Resend's free 100 a day are shared). */
const TEAM_EMAILS_PER_DAY = 20;

export class HeldRefused extends Error {}

/** After a save is held: tells the team, within the day's limit, and records how it went. */
export async function emailTeamAboutHold(env: ServerEnv, holdId: string, siteUrl: string): Promise<void> {
  await withDb(env, async (db) => {
    type Row = { business: string; owner: string; reason: string; today: number };
    const row = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('localites.held-email', 0))`);
      const [r] = await tx.execute<Row>(sql`
        select v.display_name as business, coalesce(u.display_name, 'The owner') as owner, h.flag_reason as reason,
               (select count(*) from owner_edit_hold x where x.team_email_status = 'sent'
                  and x.created_at > now() - interval '1 day')::int as today
        from owner_edit_hold h join vendor v on v.id = h.vendor_id left join app_user u on u.id = h.user_id
        where h.id = ${holdId} and h.team_email_status = 'pending'
        for update of h`);
      if (!r) return null;
      if (r.today >= TEAM_EMAILS_PER_DAY) {
        await tx.execute(sql`update owner_edit_hold set team_email_status = 'skipped' where id = ${holdId}`);
        return null;
      }
      return r;
    });
    if (!row) return;
    const result = await sendEmail(env, {
      to: TEAM_ADDRESS,
      ...renderEmail('heldEditTeam', { business: row.business, owner: row.owner, reason: row.reason, url: `${siteUrl}/admin/held-changes` }),
    });
    await db.execute(sql`
      update owner_edit_hold set team_email_status = ${result.sent ? 'sent' : env.RESEND_API_KEY ? 'failed' : 'skipped'}
      where id = ${holdId}`);
  });
}

export type HeldCard = {
  id: string;
  vendorId: string;
  business: string;
  owner: string | null;
  at: string;
  reason: string;
  status: 'waiting' | 'published' | 'declined' | 'withdrawn';
  decidedAt: string | null;
  decidedBy: string | null;
  decisionReason: string | null;
  emailStatus: string;
  lines: string[];
};

/** Waiting saves first (oldest first), then the last 30 days' decided ones. */
export async function heldEdits(env: ServerEnv): Promise<HeldCard[]> {
  return withDb(env, async (db) => {
    const rows = await db.execute<Omit<HeldCard, 'lines'> & { changes: ChangeSet }>(sql`
      select h.id, h.vendor_id as "vendorId", v.display_name as business, u.display_name as owner, h.created_at::text as at,
             h.flag_reason as reason, h.status, h.decided_at::text as "decidedAt", d.display_name as "decidedBy",
             h.decision_reason as "decisionReason", h.team_email_status as "emailStatus", h.changes
      from owner_edit_hold h join vendor v on v.id = h.vendor_id
        left join app_user u on u.id = h.user_id left join app_user d on d.id = h.decided_by
      where h.status = 'waiting' or h.decided_at > now() - interval '30 days'
      order by (h.status = 'waiting') desc, case when h.status = 'waiting' then h.created_at end, h.decided_at desc
      limit 200`);
    const names = new Map<string, Map<string, string>>();
    for (const id of new Set(rows.map((r) => r.vendorId))) names.set(id, (await readCurrent(db, id)).names);
    return rows.map(({ changes, ...r }) => ({
      ...r,
      lines: describeChanges(changes ?? {}, (id) => names.get(r.vendorId)?.get(id) ?? 'a service'),
    }));
  });
}


type Decided = { vendorId: string; business: string; userId: string; name: string; email: string | null; lines: string[] };

async function decide(env: ServerEnv, admin: Admin, id: string, decision: 'published' | 'declined', reason: string | null) {
  return withDb(env, (db) =>
    db.transaction(async (tx): Promise<Decided> => {
      // The listing first, then the hold: the same order as the owner's withdraw, so the two
      // can't wait on each other.
      await tx.execute(sql`
        select 1 from vendor where id = (select vendor_id from owner_edit_hold where id = ${id}) for update`);
      const [h] = await tx.execute<HeldEdit & { business: string; name: string; email: string | null; changes: ChangeSet }>(sql`
        select h.id, h.vendor_id as "vendorId", h.user_id as "userId", h.base, h.submitted, h.changes,
               v.display_name as business, coalesce(u.given_name, u.display_name) as name,
               case when u.deleted_at is null then u.email::text end as email
        from owner_edit_hold h join vendor v on v.id = h.vendor_id join app_user u on u.id = h.user_id
        where h.id = ${id} and h.status = 'waiting'
        for update of h`);
      if (!h) throw new HeldRefused('Someone has already dealt with this change. Reload the page.');
      if (decision === 'published') {
        let result;
        try {
          result = await writeHeldEdit(tx, h);
        } catch (err) {
          if (err instanceof OwnerRefused) throw new HeldRefused(err.message);
          throw err;
        }
        if (result.status === 'clash') {
          throw new HeldRefused('Part of the listing has changed since they saved. Decline this change and ask them to save again.');
        }
      }
      await tx.execute(sql`
        update owner_edit_hold set status = ${decision}, decided_by = ${admin.userId}, decision_reason = ${reason}
        where id = ${id}`);
      await audit(tx, {
        actor: admin.userId,
        action: decision === 'published' ? 'vendor.owner_edit_hold_publish' : 'vendor.owner_edit_hold_decline',
        subjectType: 'vendor',
        subjectId: h.vendorId,
        reason,
        sessionRef: admin.sessionId,
      });
      const { names } = await readCurrent(tx, h.vendorId);
      return {
        vendorId: h.vendorId,
        business: h.business,
        userId: h.userId,
        name: h.name,
        email: h.email,
        lines: describeChanges(h.changes ?? {}, (sid) => names.get(sid) ?? 'a service'),
      };
    }),
  );
}

/** Puts it live as the owner's save, then emails them. */
export async function publishHeld(env: ServerEnv, admin: Admin, id: string): Promise<Decided> {
  const d = await decide(env, admin, id, 'published', null);
  if (d.email) {
    await emailPerson(env, { userId: d.userId, email: d.email }, 'held_edit_published', { type: 'vendor', id: d.vendorId },
      renderEmail('heldEditPublished', { name: d.name, business: d.business, lines: d.lines }),
    ).catch((err: unknown) => console.error('held change email not recorded', err instanceof Error ? err.message : err));
  }
  return d;
}

/** Declines it with a reason the owner is emailed; the listing stays as it was. */
export async function declineHeld(env: ServerEnv, admin: Admin, id: string, reason: string): Promise<Decided> {
  const d = await decide(env, admin, id, 'declined', reason);
  if (d.email) {
    await emailPerson(env, { userId: d.userId, email: d.email }, 'held_edit_declined', { type: 'vendor', id: d.vendorId },
      renderEmail('heldEditDeclined', { name: d.name, business: d.business, lines: d.lines, reason }),
    ).catch((err: unknown) => console.error('held change email not recorded', err instanceof Error ? err.message : err));
  }
  return d;
}
