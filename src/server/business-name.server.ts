import { sql } from 'drizzle-orm';
import { NAME_CHANGE_DAYS, NAME_MAX } from '@/lib/business-name';
import { cleanText, hasVisible } from '@/lib/clean-text';
import { slugify } from '@/lib/ids.mjs';
import { audit } from './admin/audit.server';
import { type Db, withDb } from './db.server';
import type { ServerEnv } from './env';
import { WEB_ADDRESS } from './member-input';
import { SAVES_PER_DAY } from './owner-listing.server';

/**
 * A business's owner changes its name (M20, D-54; changes ADR-029, where the name stayed with
 * the team). Owner only, checked in the database on every request; at most once in
 * NAME_CHANGE_DAYS (a change the team undid doesn't count). The web address follows the new name and the old one keeps working
 * (vendor_slug_history). The database keeps every former name (vendor_former_name, migration
 * 0051) for the owner's name page and the team; everything shows today's name, with no
 * "(dba …)" (the owner, 19 October 2026). Recorded in audit_log with
 * an owner_change flagged 'name': the team gets a "check now" email and can undo it.
 */

export class NameRefused extends Error {}

export type NamePage = {
  vendorId: string;
  slug: string;
  name: string;
  /** Owner (may change it) or manager (is told only the owner can). */
  role: 'owner' | 'manager';
  former: { name: string; until: string }[];
  /** When the owner may change it again, if they changed it recently. */
  nextChange: string | null;
};

/** Not their business, or archived: null. An old web address gives { renamedTo }. */
export async function namePage(env: ServerEnv, userId: string, slug: string): Promise<NamePage | { renamedTo: string } | null> {
  return withDb(env, async (db) => {
    const v = await findRun(db, userId, slug, false);
    if (!v) return null;
    if (v.slug !== slug) return { renamedTo: v.slug };
    const [former, [last]] = await Promise.all([
      db.execute<{ name: string; until: string }>(sql`
        select name, until::text as until from vendor_former_name where vendor_id = ${v.id} order by until desc limit 10`),
      lastOwnerRename(db, v.id),
    ]);
    return { vendorId: v.id, slug: v.slug, name: v.name, role: v.role, former: [...former], nextChange: last?.next ?? null };
  });
}

type Run = { id: string; slug: string; name: string; role: 'owner' | 'manager' };

/** The business, if this person owns or manages it and it isn't archived; by an old web address too. */
async function findRun(db: Db, userId: string, slug: string, lock: boolean): Promise<Run | null> {
  const [v] = await db.execute<Run>(sql`
    select v.id, v.slug::text as slug, v.display_name as name, m.role
    from vendor v
    join vendor_member m on m.vendor_id = v.id and m.user_id = ${userId} and m.role in ('owner', 'manager') and m.ended_at is null
    where v.listing_status <> 'archived'
      and (v.slug = ${slug} or v.id = (select h.vendor_id from vendor_slug_history h where h.slug = ${slug} and v.slug <> ${slug}))
    ${lock ? sql`for update of v for share of m` : sql``}`);
  return v ?? null;
}

async function lastOwnerRename(db: Db, vendorId: string) {
  return db.execute<{ next: string }>(sql`
    select (a.created_at + make_interval(days => ${NAME_CHANGE_DAYS}))::text as next
    from owner_change oc join audit_log a on a.id = oc.audit_id
    where oc.vendor_id = ${vendorId} and a.changes ? 'name' and oc.undone_at is null
      and a.created_at > now() - make_interval(days => ${NAME_CHANGE_DAYS})
    order by a.created_at desc limit 1`);
}

/** The new name as typed, tidied, or why not (the language check is the caller's, before this). */
export function readName(raw: string): { name: string } | { error: string } {
  const name = cleanText(raw).replace(/\s+/g, ' ').trim();
  if (!name || !hasVisible(name)) return { error: 'Enter your business’s new name.' };
  if (name.length > NAME_MAX) return { error: `Keep the name under ${NAME_MAX + 1} characters.` };
  if (/:\/\/|www\.|[<>@]/i.test(name) || WEB_ADDRESS.test(name)) return { error: 'Enter just the name (no web or email addresses).' };
  return { name };
}

/** A web address for the new name that no other business uses or used. */
async function slugFor(db: Db, vendorId: string, name: string, current: string): Promise<string> {
  const base = slugify(name).slice(0, 76).replace(/-+$/, '') || 'business';
  if (base === current) return current;
  for (let i = 1; i < 50; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    if (candidate === current) return current;
    const [taken] = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from (
        select id as vendor_id from vendor where slug = ${candidate}
        union all select vendor_id from vendor_slug_history where slug = ${candidate}
      ) s where s.vendor_id <> ${vendorId}`);
    if ((taken?.n ?? 0) === 0) return candidate;
  }
  return current;
}

export type Renamed = { vendorId: string; auditId: string; slug: string; from: string; to: string };

/** The owner renames their business, all or nothing. */
export async function renameBusiness(env: ServerEnv, userId: string, slug: string, name: string): Promise<Renamed> {
  return withDb(env, (db) =>
    db.transaction(async (tx) => {
      // Locked with the membership, so a hand-over or "Remove owner" meanwhile always wins.
      const v = await findRun(tx, userId, slug, true);
      if (!v) throw new NameRefused('not found');
      if (v.role !== 'owner') throw new NameRefused('Only the business’s owner can change its name.');
      if (name === v.name) throw new NameRefused('That’s already your business’s name.');
      const [[last], [today]] = await Promise.all([
        lastOwnerRename(tx, v.id),
        tx.execute<{ n: number }>(sql`
          select count(*)::int as n from owner_change where vendor_id = ${v.id} and created_at > now() - interval '1 day'`),
      ]);
      if (last) throw new NameRefused(`You can change your business’s name once every ${NAME_CHANGE_DAYS} days.`);
      if ((today?.n ?? 0) >= SAVES_PER_DAY) {
        throw new NameRefused('You’ve saved a lot of changes today. Please try again tomorrow, or email supportlocalites@gmail.com.');
      }
      // One rename at a time across the site, so two businesses renamed alike can't both take one address.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('localites.business-rename', 0))`);
      const next = await slugFor(tx, v.id, name, v.slug);
      if (next !== v.slug) {
        await tx.execute(sql`
          insert into vendor_slug_history (slug, vendor_id) values (${v.slug}, ${v.id})
          on conflict (slug) do update set vendor_id = excluded.vendor_id, retired_at = now()`);
      }
      // The database keeps the former name itself (vendor_name_kept).
      await tx.execute(sql`update vendor set display_name = ${name}, slug = ${next} where id = ${v.id}`);
      const auditId = await audit(tx, {
        actor: userId,
        action: 'vendor.owner_edit',
        subjectType: 'vendor',
        subjectId: v.id,
        changes: { name: { from: v.name, to: name } },
      });
      await tx.execute(sql`insert into owner_change (audit_id, vendor_id, flags) values (${auditId}, ${v.id}, '{name}')`);
      return { vendorId: v.id, auditId, slug: next, from: v.name, to: name };
    }),
  );
}
