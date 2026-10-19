import { sql } from 'drizzle-orm';
import { restoreAddress } from '../address.server';
import { uuidv7 } from '@/lib/ids.mjs';
import type { Admin } from '../auth/admin.server';
import { type Db, withDb } from '../db.server';
import type { ServerEnv } from '../env';
import { addedServices, type ChangeSet, describeChange, planUndo, serviceIdOf } from '../owner-changes';
import { priceWords, readCurrent } from '../owner-listing.server';
import { audit } from './audit.server';

/**
 * The team's side of owner editing (D-34, ADR-029): what owners changed, undoing a save,
 * and removing an owner. Callers must have passed adminGate. Every change is audited.
 */

export class OwnerChangeConflict extends Error {}

type Person = { userId: string; name: string; email: string };

/** One part of a save. `putBack`: the team's undo put it back (only on an undone save). */
export type OwnerChangeLine = { key: string; text: string; possible: boolean; now: string; putBack: boolean };
export type OwnerChangeCard = {
  auditId: string;
  at: string;
  owner: string | null;
  flags: string[];
  alertStatus: string;
  lines: OwnerChangeLine[];
  undone: { at: string; by: string | null; reason: string | null } | null;
};

const nowText = (v: unknown) => {
  if (v === null || v === undefined || v === '') return '(empty)';
  if (typeof v === 'boolean') return v ? 'shown' : 'hidden';
  if (typeof v === 'object' && 'pricingModel' in (v as object)) return priceWords(v as { pricingModel: string; priceCents: number | null });
  const s = String(v).replace(/\s+/g, ' ');
  return s.length > 80 ? `${s.slice(0, 79)}…` : s;
};

/** One line per thing that can be undone, in plain words (a service added shows its price). */
function linesFor(
  changes: ChangeSet,
  current: Record<string, unknown>,
  names: Map<string, string>,
  putBack: ChangeSet | null,
): OwnerChangeLine[] {
  const nameOf = (id: string) => names.get(id) ?? (changes[`service:${id}:name`]?.to as string | undefined) ?? 'a service';
  const added = addedServices(changes);
  return planUndo(changes, current).map((l) => {
    const id = serviceIdOf(l.key);
    let text = describeChange(l.key, changes[l.key]!, nameOf, added.has(id ?? ''));
    if (id && added.has(id)) {
      const price = changes[`service:${id}:price`]?.to as { pricingModel: string; priceCents: number | null } | undefined;
      if (price) text += ` (${priceWords(price)})`;
    }
    return { key: l.key, text, possible: l.possible, now: nowText(l.now), putBack: Boolean(putBack && l.key in putBack) };
  });
}

/** The listing's recent owner saves for the team's page, on the page's own connection. */
export async function listOwnerChanges(db: Db, vendorId: string): Promise<{ cards: OwnerChangeCard[]; owner: Person | null }> {
  const [rows, current, [owner]] = await Promise.all([
    db.execute<{
      auditId: string;
      at: string;
      owner: string | null;
      flags: string[];
      alertStatus: string;
      changes: ChangeSet;
      undoneAt: string | null;
      undoneBy: string | null;
      undoReason: string | null;
      undoChanges: ChangeSet | null;
    }>(sql`
      select oc.audit_id as "auditId", a.created_at::text as at, u.display_name as owner, to_json(oc.flags) as flags,
             oc.alert_status as "alertStatus", a.changes, oc.undone_at::text as "undoneAt",
             ub.display_name as "undoneBy", ua.reason as "undoReason", ua.changes as "undoChanges"
      from owner_change oc
      join audit_log a on a.id = oc.audit_id
      left join app_user u on u.id = a.actor_user_id
      left join audit_log ua on ua.id = oc.undo_audit_id
      left join app_user ub on ub.id = oc.undone_by
      where oc.vendor_id = ${vendorId} and oc.created_at > now() - interval '60 days'
      order by oc.audit_id desc
      limit 50`),
    readCurrent(db, vendorId),
    db.execute<Person>(sql`
      select u.id as "userId", u.display_name as name, u.email::text as email
      from vendor_member m join app_user u on u.id = m.user_id
      where m.vendor_id = ${vendorId} and m.role = 'owner' and m.ended_at is null`),
  ]);
  return {
    owner: owner ?? null,
    cards: rows.map((r) => ({
      auditId: r.auditId,
      at: r.at,
      owner: r.owner,
      flags: r.flags ?? [],
      alertStatus: r.alertStatus,
      lines: linesFor(r.changes ?? {}, current.flat, current.names, r.undoneAt ? (r.undoChanges ?? {}) : null),
      undone: r.undoneAt ? { at: r.undoneAt, by: r.undoneBy, reason: r.undoReason } : null,
    })),
  };
}

const VENDOR_COLUMNS: Record<string, string> = {
  // The name (M20, D-54): the database keeps the one it replaces (vendor_name_kept); the web
  // address stays the new one, and the old one keeps working.
  name: 'display_name',
  tagline: 'tagline',
  description: 'description',
  websiteUrl: 'website_url',
  publicPhone: 'public_phone',
};

/** Puts one field back. Only the fixed columns above; every service write is scoped to this business. */
async function restore(tx: Db, vendorId: string, key: string, value: unknown) {
  if (key === 'address') return restoreAddress(tx, vendorId, value);
  const column = VENDOR_COLUMNS[key];
  if (column) {
    await tx.execute(sql`update vendor set ${sql.raw(column)} = ${value as string | null} where id = ${vendorId}`);
    return;
  }
  const id = serviceIdOf(key);
  const field = key.split(':')[2];
  if (!id) throw new OwnerChangeConflict('That change can’t be undone.');
  let updated: unknown[];
  if (field === 'name') {
    updated = await tx.execute(
      sql`update vendor_service set name = ${value as string} where id = ${id} and vendor_id = ${vendorId} returning id`,
    );
  } else if (field === 'description') {
    updated = await tx.execute(
      sql`update vendor_service set description = ${value as string | null} where id = ${id} and vendor_id = ${vendorId} returning id`,
    );
  } else if (field === 'price') {
    const p = value as { pricingModel: string; priceCents: number | null };
    updated = await tx.execute(sql`
      update vendor_service set pricing_model = ${p.pricingModel}, price_cents = ${p.priceCents}::int
      where id = ${id} and vendor_id = ${vendorId} returning id`);
  } else if (field === 'shown') {
    updated = await tx.execute(
      sql`update vendor_service set is_active = ${value as boolean} where id = ${id} and vendor_id = ${vendorId} returning id`,
    );
  } else {
    throw new OwnerChangeConflict('That change can’t be undone.');
  }
  if (updated.length === 0) throw new OwnerChangeConflict('That service isn’t part of this listing.');
}

export type Undone = { owner: Person | null; business: string; lines: string[]; reason: string };

/**
 * Undoes the ticked parts of one owner save (ADR-029). Each field goes back only if it
 * still holds what the save set; a service the save added is hidden, never deleted. One
 * undo per save. The owner is told (by the caller), with the reason.
 */
export async function undoOwnerChange(
  env: ServerEnv,
  admin: Admin,
  vendorId: string,
  auditId: string,
  keys: string[],
  reason: string,
): Promise<Undone> {
  return withDb(env, (db) =>
    db.transaction(async (tx) => {
      const [v] = await tx.execute<{ business: string }>(
        sql`select display_name as business from vendor where id = ${vendorId} for update`,
      );
      if (!v) throw new OwnerChangeConflict('This listing no longer exists.');
      const [oc] = await tx.execute<{ changes: ChangeSet; undoneAt: string | null; owner: Person | null }>(sql`
        select a.changes, oc.undone_at::text as "undoneAt",
               case when u.id is null then null else json_build_object('userId', u.id, 'name', u.display_name, 'email', u.email) end as owner
        from owner_change oc join audit_log a on a.id = oc.audit_id left join app_user u on u.id = a.actor_user_id and u.deleted_at is null
        where oc.audit_id = ${auditId} and oc.vendor_id = ${vendorId}
        for update of oc`);
      if (!oc) throw new OwnerChangeConflict('That change isn’t part of this listing.');
      if (oc.undoneAt) throw new OwnerChangeConflict('Someone on the team already undid this save. The page now shows what was put back.');

      const current = await readCurrent(tx, vendorId);
      const plan = planUndo(oc.changes, current.flat).filter((l) => keys.includes(l.key) && l.possible);
      if (plan.length === 0) throw new OwnerChangeConflict('Tick at least one change that can still be undone.');
      const undone: ChangeSet = {};
      for (const l of plan) {
        await restore(tx, vendorId, l.key, l.restore);
        undone[l.key] = { from: l.now, to: l.restore };
      }
      const nameOf = (id: string) => current.names.get(id) ?? 'a service';
      const undoAudit = await audit(tx, {
        actor: admin.userId,
        action: 'vendor.owner_edit.undo',
        subjectType: 'vendor',
        subjectId: vendorId,
        reason,
        changes: undone,
        sessionRef: admin.sessionId,
      });
      await tx.execute(sql`
        update owner_change set undone_at = now(), undone_by = ${admin.userId}, undo_audit_id = ${undoAudit}
        where audit_id = ${auditId}`);
      // In the owner's words: what it went back to (a service they added: "Service hidden").
      const lines = plan.map((l) => describeChange(l.key, { from: l.now, to: l.restore }, nameOf));
      return { owner: oc.owner, business: v.business, lines, reason };
    }),
  );
}

/**
 * Ends the current owner's membership (wrong person approved, or broke the rules). The
 * listing goes back to unclaimed, so its real owner can claim it. Recorded everywhere.
 */
export async function removeOwner(
  env: ServerEnv,
  admin: Admin,
  vendorId: string,
  reason: string,
): Promise<{ owner: Person; business: string }> {
  return withDb(env, (db) =>
    db.transaction(async (tx) => {
      const [v] = await tx.execute<{ business: string; claimStatus: string }>(sql`
        select display_name as business, claim_status as "claimStatus" from vendor where id = ${vendorId} for update`);
      if (!v) throw new OwnerChangeConflict('This listing no longer exists.');
      const [m] = await tx.execute<Person & { memberId: string }>(sql`
        select m.id as "memberId", u.id as "userId", u.display_name as name, u.email::text as email
        from vendor_member m join app_user u on u.id = m.user_id
        where m.vendor_id = ${vendorId} and m.role = 'owner' and m.ended_at is null
        for update of m`);
      if (!m) throw new OwnerChangeConflict('This business has no owner on Localites.');
      await tx.execute(sql`update vendor_member set ended_at = now() where id = ${m.memberId}`);
      // A page that owner hid stays down, now as the team's decision (D-54): no next owner can show it.
      await tx.execute(sql`update vendor set owner_hidden_at = null where id = ${vendorId}`);
      if (v.claimStatus !== 'unclaimed') {
        await tx.execute(sql`update vendor set claim_status = 'unclaimed' where id = ${vendorId}`);
        await tx.execute(sql`
          insert into status_change (id, subject_type, subject_id, field, from_status, to_status, actor_user_id, actor_kind, reason)
          values (${uuidv7()}, 'vendor', ${vendorId}, 'claim_status', ${v.claimStatus}, 'unclaimed', ${admin.userId}, 'admin', ${reason})`);
      }
      await audit(tx, {
        actor: admin.userId,
        action: 'vendor_member.end',
        subjectType: 'vendor',
        subjectId: vendorId,
        reason,
        changes: { owner: { from: m.userId, to: null }, claimStatus: { from: v.claimStatus, to: 'unclaimed' } },
        sessionRef: admin.sessionId,
      });
      return { owner: { userId: m.userId, name: m.name, email: m.email }, business: v.business };
    }),
  );
}
