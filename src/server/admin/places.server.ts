import { sql } from 'drizzle-orm';
import type { Admin } from '../auth/admin.server';
import { type Db, isUniqueViolation, withDb } from '../db.server';
import type { ServerEnv } from '../env';
import { audit, diff } from './audit.server';
import { type KindInput, newSlug, type TownInput } from './places-input';

/**
 * Admin → Categories and towns (X6, X8; migration 0017): the team adds, renames, reorders
 * and hides kinds of business and towns. Hide, never delete: businesses and events that use
 * one keep it. Web address parts never change. Every change is written to audit_log in the
 * same transaction. Callers must have passed adminGate.
 */

export class PlacesConflict extends Error {}

const OUT_OF_DATE = 'Something on the page was out of date. Please reload it and try again.';

function refusal(err: unknown, what: 'kind' | 'town'): never {
  if (err instanceof PlacesConflict) throw err;
  if (isUniqueViolation(err)) {
    throw new PlacesConflict(
      what === 'kind' ? 'That name is already used under the same main kind.' : 'There’s already a town with that name in that region.',
    );
  }
  for (let e = err; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (code === 'LP100') {
      throw new PlacesConflict(
        what === 'kind'
          ? 'Kinds of business have two levels: a main kind, and kinds within it. A main kind with kinds within it stays a main kind.'
          : OUT_OF_DATE,
      );
    }
    if (code === '23503' || code === '23514' || code === '22P02') throw new PlacesConflict(OUT_OF_DATE);
  }
  throw err;
}

export type KindRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  shown: boolean;
  parentId: string | null;
  /** Businesses with this kind (any listing status). */
  businesses: number;
};
export type MainKind = KindRow & { kinds: KindRow[] };
export type TownRow = { id: string; slug: string; name: string; region: string; sortOrder: number; shown: boolean; businesses: number };

export async function placesPage(env: ServerEnv): Promise<{ mains: MainKind[]; towns: TownRow[] }> {
  return withDb(env, async (db) => {
    const [kinds, towns] = await Promise.all([
      db.execute<KindRow>(sql`
        select c.id, c.slug::text as slug, c.name, c.description, c.sort_order as "sortOrder", c.is_active as shown,
               c.parent_id as "parentId",
               (select count(distinct vc.vendor_id)::int from vendor_category vc where vc.category_id = c.id) as businesses
        from category c order by c.sort_order, c.name`),
      db.execute<TownRow>(sql`
        select m.id, m.slug::text as slug, m.name, m.region, m.sort_order as "sortOrder", m.is_active as shown,
               (select count(*)::int from vendor v where v.primary_municipality_id = m.id) as businesses
        from municipality m order by m.sort_order, m.name`),
    ]);
    const mains: MainKind[] = kinds.filter((k) => !k.parentId).map((k) => ({ ...k, kinds: kinds.filter((c) => c.parentId === k.id) }));
    return { mains, towns: [...towns] };
  });
}

async function takenSlugs(db: Db, table: 'category' | 'municipality'): Promise<Set<string>> {
  const rows = await db.execute<{ slug: string }>(
    table === 'category' ? sql`select slug::text as slug from category` : sql`select slug::text as slug from municipality`,
  );
  return new Set(rows.map((r) => r.slug));
}

const created = (values: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(values).map(([k, to]) => [k, { from: null, to: to ?? null }]));

export async function addKind(env: ServerEnv, admin: Admin, input: KindInput): Promise<string> {
  try {
    return await withDb(env, (db) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`lock table category in share row exclusive mode`); // one new web address at a time
        const slug = newSlug(input.name, await takenSlugs(tx, 'category'), 'kind');
        const [row] = await tx.execute<{ id: string }>(sql`
          insert into category (parent_id, slug, name, description, sort_order, is_active)
          values (${input.parentId}, ${slug}, ${input.name}, ${input.description}, ${input.sortOrder}, ${input.shown})
          returning id`);
        if (!row) throw new PlacesConflict(OUT_OF_DATE);
        await audit(tx, {
          actor: admin.userId,
          action: 'category.create',
          subjectType: 'category',
          subjectId: row.id,
          changes: created({ slug, ...input }),
          sessionRef: admin.sessionId,
        });
        return row.id;
      }),
    );
  } catch (err) {
    return refusal(err, 'kind');
  }
}

export async function updateKind(env: ServerEnv, admin: Admin, id: string, input: KindInput): Promise<'changed' | 'unchanged'> {
  try {
    return await withDb(env, (db) =>
      db.transaction(async (tx) => {
        // One kind-of-business change at a time, so two moves can't make three levels together.
        await tx.execute(sql`lock table category in share row exclusive mode`);
        if (input.parentId === id) throw new PlacesConflict('Choose a main kind from the list.');
        const [before] = await tx.execute<KindInput>(sql`
          select name, description, sort_order as "sortOrder", is_active as shown, parent_id as "parentId"
          from category where id = ${id} for update`);
        if (!before) throw new PlacesConflict(OUT_OF_DATE);
        const changes = diff(before, input);
        if (Object.keys(changes).length === 0) return 'unchanged';
        await tx.execute(sql`
          update category set name = ${input.name}, description = ${input.description}, sort_order = ${input.sortOrder},
                 is_active = ${input.shown}, parent_id = ${input.parentId}
          where id = ${id}`);
        await audit(tx, {
          actor: admin.userId,
          action: 'category.update',
          subjectType: 'category',
          subjectId: id,
          changes,
          sessionRef: admin.sessionId,
        });
        return 'changed';
      }),
    );
  } catch (err) {
    return refusal(err, 'kind');
  }
}

export async function addTown(env: ServerEnv, admin: Admin, input: TownInput): Promise<string> {
  try {
    return await withDb(env, (db) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`lock table municipality in share row exclusive mode`);
        const slug = newSlug(input.name, await takenSlugs(tx, 'municipality'), 'town');
        const [row] = await tx.execute<{ id: string }>(sql`
          insert into municipality (slug, name, region, sort_order, is_active)
          values (${slug}, ${input.name}, ${input.region}, ${input.sortOrder}, ${input.shown})
          returning id`);
        if (!row) throw new PlacesConflict(OUT_OF_DATE);
        await audit(tx, {
          actor: admin.userId,
          action: 'municipality.create',
          subjectType: 'municipality',
          subjectId: row.id,
          changes: created({ slug, ...input }),
          sessionRef: admin.sessionId,
        });
        return row.id;
      }),
    );
  } catch (err) {
    return refusal(err, 'town');
  }
}

export async function updateTown(env: ServerEnv, admin: Admin, id: string, input: TownInput): Promise<'changed' | 'unchanged'> {
  try {
    return await withDb(env, (db) =>
      db.transaction(async (tx) => {
        const [before] = await tx.execute<TownInput>(sql`
          select name, region, sort_order as "sortOrder", is_active as shown from municipality where id = ${id} for update`);
        if (!before) throw new PlacesConflict(OUT_OF_DATE);
        const changes = diff(before, input);
        if (Object.keys(changes).length === 0) return 'unchanged';
        await tx.execute(sql`
          update municipality set name = ${input.name}, region = ${input.region}, sort_order = ${input.sortOrder}, is_active = ${input.shown}
          where id = ${id}`);
        await audit(tx, {
          actor: admin.userId,
          action: 'municipality.update',
          subjectType: 'municipality',
          subjectId: id,
          changes,
          sessionRef: admin.sessionId,
        });
        return 'changed';
      }),
    );
  } catch (err) {
    return refusal(err, 'town');
  }
}
