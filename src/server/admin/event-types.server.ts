import { sql } from 'drizzle-orm';
import { uuidv7 } from '@/lib/ids.mjs';
import { PLAN_LIMITS } from '@/lib/plan-terms';
import { actingAs } from '../acting.server';
import type { Admin } from '../auth/admin.server';
import { isUniqueViolation, withDb } from '../db.server';
import type { ServerEnv } from '../env';
import { eventTypeKey, type EventTypeInput, type FeaturedInput, mostOverlapping, type Suggestion } from '../event-input';
import { audit, diff } from './audit.server';

/**
 * The team's "Event types" page (X12, D-39, D-43): the kinds of event people can choose,
 * the kinds of business suggested for each, and businesses featured for each between two
 * dates. Runs as the team (actingAs, side 'team'): the database lets only an admin write
 * these. Every change is written to audit_log in the same transaction. No money is
 * recorded anywhere (D-16, D-24, ADR-025). Callers must have passed adminGate.
 */

export class EventTypeConflict extends Error {}

const OUT_OF_DATE = 'Something on the page was out of date. Please reload it and try again.';

const asTeam = (admin: Admin) => ({ side: 'team', userId: admin.userId }) as const;

/** The database's refusals, in the team's words; anything else is rethrown. */
function teamFailure(err: unknown): never {
  if (err instanceof EventTypeConflict) throw err;
  if (isUniqueViolation(err)) throw new EventTypeConflict('That name is already used.');
  for (let e = err; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (code === 'LP105') throw new EventTypeConflict('The last day has already passed.');
    if (code === 'LP107') throw new EventTypeConflict('Choose a business that’s listed on Localites.');
    if (code === 'LP109') throw new EventTypeConflict('That placement has already ended.');
    if (code === '23503' || code === 'LP100') throw new EventTypeConflict(OUT_OF_DATE);
  }
  throw err;
}

/** A new record's values, for the audit log. */
const created = (values: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(values).map(([k, to]) => [k, { from: null, to: to ?? null }]));

const teamWork = async <T>(work: Promise<T>): Promise<T> => {
  try {
    return await work;
  } catch (err) {
    return teamFailure(err);
  }
};

export type Placement = {
  id: string;
  typeId: string;
  vendorId: string;
  vendorSlug: string;
  vendorName: string;
  listed: boolean;
  startsOn: string;
  endsOn: string;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  endedAt: string | null;
  endedBy: string | null;
  state: 'current' | 'upcoming' | 'past' | 'ended';
};

export type EventTypeRow = {
  id: string;
  key: string;
  name: string;
  shown: boolean;
  sortOrder: number;
  suggestions: { categoryId: string; name: string; sortOrder: number }[];
  placements: Placement[];
  /** The most current or upcoming placements on any one day; above 3 the page warns (only 3 are shown). */
  mostAtOnce: number;
};

export type CategoryChoice = { id: string; name: string; parent: string | null };

/** Everything the page shows: the types in the team's order, each with its suggestions and placements. */
export async function eventTypesPage(env: ServerEnv, admin: Admin): Promise<{ types: EventTypeRow[]; categories: CategoryChoice[] }> {
  return actingAs(env, asTeam(admin), async (tx) => {
    const types = await tx.execute<Omit<EventTypeRow, 'suggestions' | 'placements' | 'mostAtOnce'>>(sql`
      select id, key, name, is_active as shown, sort_order as "sortOrder" from event_type order by sort_order, name`);
    const suggestions = await tx.execute<{ typeId: string; categoryId: string; name: string; sortOrder: number }>(sql`
      select s.event_type_id as "typeId", s.category_id as "categoryId", c.name, s.sort_order as "sortOrder"
      from event_type_category s join category c on c.id = s.category_id
      order by s.sort_order, c.name`);
    const placements = await tx.execute<Placement>(sql`
      select f.id, f.event_type_id as "typeId", v.id as "vendorId", v.slug::text as "vendorSlug", v.display_name as "vendorName",
             v.listing_status = 'published' as listed, f.starts_on::text as "startsOn", f.ends_on::text as "endsOn", f.note,
             cu.display_name as "createdBy", f.created_at::text as "createdAt", f.ended_at::text as "endedAt",
             eu.display_name as "endedBy",
             case when f.ended_at is not null then 'ended'
                  when f.ends_on < (now() at time zone 'America/Toronto')::date then 'past'
                  when f.starts_on > (now() at time zone 'America/Toronto')::date then 'upcoming'
                  else 'current' end as state
      from featured_placement f join vendor v on v.id = f.vendor_id
      left join app_user cu on cu.id = f.created_by left join app_user eu on eu.id = f.ended_by
      order by f.starts_on, f.created_at
      limit 1000`);
    const categories = await tx.execute<CategoryChoice>(sql`
      select c.id, c.name, p.name as parent from category c left join category p on p.id = c.parent_id
      where c.is_active order by coalesce(p.name, c.name), c.parent_id nulls first, c.name`);
    return {
      types: types.map((t) => {
        const mine = placements.filter((p) => p.typeId === t.id);
        return {
          ...t,
          suggestions: suggestions
            .filter((s) => s.typeId === t.id)
            .map((s) => ({ categoryId: s.categoryId, name: s.name, sortOrder: s.sortOrder })),
          placements: mine,
          mostAtOnce: mostOverlapping(mine.filter((p) => p.state === 'current' || p.state === 'upcoming')),
        };
      }),
      categories: [...categories],
    };
  });
}

/** Adds a kind of event. Its key is made from the name and never changes. Returns its id. */
export async function addEventType(env: ServerEnv, admin: Admin, input: EventTypeInput): Promise<string> {
  return teamWork(
    actingAs(env, asTeam(admin), async (tx) => {
      // Takes turns with another add, so two can't pick the same key.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('localites.event-type-key', 0))`);
      const keys = await tx.execute<{ key: string }>(sql`select key from event_type`);
      const id = uuidv7();
      const key = eventTypeKey(input.name, new Set(keys.map((k) => k.key)));
      await tx.execute(sql`
        insert into event_type (id, key, name, is_active, sort_order) values (${id}, ${key}, ${input.name}, ${input.shown}, ${input.sortOrder})`);
      await audit(tx, {
        actor: admin.userId,
        action: 'event_type.create',
        subjectType: 'event_type',
        subjectId: id,
        changes: created({ key, name: input.name, shown: input.shown, sortOrder: input.sortOrder }),
        sessionRef: admin.sessionId,
      });
      return id;
    }),
  );
}

/** Renames, reorders, hides or shows a kind of event. Events that use a hidden one keep it. */
export async function updateEventType(env: ServerEnv, admin: Admin, id: string, input: EventTypeInput): Promise<'changed' | 'unchanged'> {
  return teamWork(
    actingAs(env, asTeam(admin), async (tx) => {
      const [before] = await tx.execute<{ name: string; shown: boolean; sortOrder: number }>(sql`
        select name, is_active as shown, sort_order as "sortOrder" from event_type where id = ${id} for update`);
      if (!before) throw new EventTypeConflict(OUT_OF_DATE);
      const changes = diff(before, input);
      if (Object.keys(changes).length === 0) return 'unchanged';
      await tx.execute(sql`
        update event_type set name = ${input.name}, is_active = ${input.shown}, sort_order = ${input.sortOrder} where id = ${id}`);
      await audit(tx, {
        actor: admin.userId,
        action: 'event_type.update',
        subjectType: 'event_type',
        subjectId: id,
        changes,
        sessionRef: admin.sessionId,
      });
      return 'changed';
    }),
  );
}

/** Sets the kinds of business suggested for a kind of event, in order (D-43). */
export async function setSuggestions(env: ServerEnv, admin: Admin, typeId: string, wanted: Suggestion[]): Promise<'changed' | 'unchanged'> {
  return teamWork(
    actingAs(env, asTeam(admin), async (tx) => {
      const [type] = await tx.execute<{ id: string }>(sql`select id from event_type where id = ${typeId} for update`);
      if (!type) throw new EventTypeConflict(OUT_OF_DATE);
      const names = async () =>
        (
          await tx.execute<{ name: string }>(sql`
            select c.name from event_type_category s join category c on c.id = s.category_id
            where s.event_type_id = ${typeId} order by s.sort_order, c.name`)
        ).map((r) => r.name);
      const current = await tx.execute<Suggestion>(sql`
        select category_id as "categoryId", sort_order as "sortOrder" from event_type_category where event_type_id = ${typeId}`);
      const now = new Map(current.map((s) => [s.categoryId, s.sortOrder]));
      const next = new Map(wanted.map((s) => [s.categoryId, s.sortOrder]));
      const removed = [...now.keys()].filter((c) => !next.has(c));
      const added = wanted.filter((s) => !now.has(s.categoryId));
      const moved = wanted.filter((s) => now.has(s.categoryId) && now.get(s.categoryId) !== s.sortOrder);
      if (removed.length + added.length + moved.length === 0) return 'unchanged';

      const before = await names();
      for (const c of removed)
        await tx.execute(sql`delete from event_type_category where event_type_id = ${typeId} and category_id = ${c}`);
      for (const s of added) {
        await tx.execute(sql`
          insert into event_type_category (event_type_id, category_id, sort_order)
          select ${typeId}, id, ${s.sortOrder} from category where id = ${s.categoryId} and is_active`);
      }
      for (const s of moved) {
        await tx.execute(sql`
          update event_type_category set sort_order = ${s.sortOrder} where event_type_id = ${typeId} and category_id = ${s.categoryId}`);
      }
      const after = await names();
      if (after.length > PLAN_LIMITS.suggestedMax)
        throw new EventTypeConflict(`Suggest up to ${PLAN_LIMITS.suggestedMax} kinds of business.`);
      await audit(tx, {
        actor: admin.userId,
        action: 'event_type.suggestions',
        subjectType: 'event_type',
        subjectId: typeId,
        changes: { suggested: { from: before, to: after } },
        sessionRef: admin.sessionId,
      });
      return 'changed';
    }),
  );
}

/**
 * Features a listed business for a kind of event between two dates (D-43). Returns the
 * most placements then current or upcoming on any one day, so the page can warn above 3.
 */
export async function addPlacement(
  env: ServerEnv,
  admin: Admin,
  typeId: string,
  input: FeaturedInput,
): Promise<{ id: string; mostAtOnce: number }> {
  return teamWork(
    actingAs(env, asTeam(admin), async (tx) => {
      const [type] = await tx.execute<{ name: string }>(sql`select name from event_type where id = ${typeId} for update`);
      if (!type) throw new EventTypeConflict(OUT_OF_DATE);
      const [vendor] = await tx.execute<{ id: string; name: string }>(sql`
        select id, display_name as name from vendor where slug = ${input.vendorSlug} and listing_status = 'published'`);
      if (!vendor) throw new EventTypeConflict('Choose a business that’s listed on Localites.');
      const id = uuidv7();
      await tx.execute(sql`
        insert into featured_placement (id, vendor_id, event_type_id, starts_on, ends_on, note, created_by)
        values (${id}, ${vendor.id}, ${typeId}, ${input.startsOn}::date, ${input.endsOn}::date, ${input.note}, ${admin.userId})`);
      await audit(tx, {
        actor: admin.userId,
        action: 'featured_placement.create',
        subjectType: 'featured_placement',
        subjectId: id,
        changes: created({
          business: vendor.name,
          vendorId: vendor.id,
          eventType: type.name,
          startsOn: input.startsOn,
          endsOn: input.endsOn,
          note: input.note,
        }),
        sessionRef: admin.sessionId,
      });
      const open = await tx.execute<{ startsOn: string; endsOn: string }>(sql`
        select starts_on::text as "startsOn", ends_on::text as "endsOn" from featured_placement
        where event_type_id = ${typeId} and ended_at is null and ends_on >= (now() at time zone 'America/Toronto')::date`);
      return { id, mostAtOnce: mostOverlapping([...open]) };
    }),
  );
}

/** Ends a placement early (once; the database records when and by whom). */
export async function endPlacement(env: ServerEnv, admin: Admin, placementId: string): Promise<void> {
  await teamWork(
    actingAs(env, asTeam(admin), async (tx) => {
      const [ended] = await tx.execute<{ business: string }>(sql`
        update featured_placement f set ended_at = now()
        from vendor v
        where f.id = ${placementId} and f.ended_at is null and v.id = f.vendor_id
        returning v.display_name as business`);
      if (!ended) throw new EventTypeConflict('That placement has already ended.');
      await audit(tx, {
        actor: admin.userId,
        action: 'featured_placement.end',
        subjectType: 'featured_placement',
        subjectId: placementId,
        changes: { ended: { from: false, to: true } },
        sessionRef: admin.sessionId,
      });
    }),
  );
}

/** Listed businesses whose name or web address matches, for choosing one to feature. */
export async function listedBusinesses(env: ServerEnv, q: string): Promise<{ slug: string; name: string; town: string }[]> {
  const words = q.trim().slice(0, 100);
  if (!words) return [];
  return withDb(env, async (db) => [
    ...(await db.execute<{ slug: string; name: string; town: string }>(sql`
      select v.slug::text as slug, v.display_name as name, m.name as town
      from vendor v join municipality m on m.id = v.primary_municipality_id
      where v.listing_status = 'published'
        and (v.display_name ilike '%' || ${words} || '%' or v.slug::text ilike '%' || ${words} || '%')
      order by v.display_name limit 20`)),
  ]);
}
