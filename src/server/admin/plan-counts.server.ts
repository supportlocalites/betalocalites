import { sql } from 'drizzle-orm';
import { actingAs } from '../acting.server';
import type { Admin } from '../auth/admin.server';
import type { ServerEnv } from '../env';

/**
 * Planning counts for the Localites team only (D-42): saves, adds to event plans and
 * "marked booked", per business and per kind of event. Totals only, never who or which
 * event. Never on a business's own Analytics page. The database's functions refuse anyone
 * not acting as the team (migration 0012). Periods are Toronto days, `to` not included.
 * Callers must have passed adminGate.
 */

export type PlanCounts = { saved: number; added: number; markedBooked: number };
export type BusinessPlanCounts = PlanCounts & { vendorId: string; name: string; slug: string };
export type TypePlanCounts = { typeName: string | null; eventsPlanned: number; markedBooked: number };

const asTeam = (admin: Admin) => ({ side: 'team', userId: admin.userId }) as const;

/** One business's planning counts ("Planning (team only)" on its activity page). */
export async function planCountsFor(env: ServerEnv, admin: Admin, vendorId: string, from: string, to: string): Promise<PlanCounts> {
  return actingAs(env, asTeam(admin), async (tx) => {
    const [c] = await tx.execute<PlanCounts>(sql`
      select saved, added, marked_booked as "markedBooked"
      from plan_counts_for_team(${from}::date, ${to}::date) where vendor_id = ${vendorId}`);
    return c ?? { saved: 0, added: 0, markedBooked: 0 };
  });
}

/**
 * The team's overview: the 20 businesses most marked booked (then most added), and the
 * totals by kind of event, with "no type given" as its own row (typeName null).
 */
export async function planTotals(
  env: ServerEnv,
  admin: Admin,
  from: string,
  to: string,
): Promise<{ businesses: BusinessPlanCounts[]; types: TypePlanCounts[] }> {
  return actingAs(env, asTeam(admin), async (tx) => {
    const businesses = await tx.execute<BusinessPlanCounts>(sql`
      select c.vendor_id as "vendorId", v.display_name as name, v.slug::text as slug,
             c.saved, c.added, c.marked_booked as "markedBooked"
      from plan_counts_for_team(${from}::date, ${to}::date) c join vendor v on v.id = c.vendor_id
      order by c.marked_booked desc, c.added desc, c.saved desc, v.display_name
      limit 20`);
    const types = await tx.execute<TypePlanCounts>(sql`
      select t.name as "typeName", c.events_planned as "eventsPlanned", c.marked_booked as "markedBooked"
      from plan_type_counts_for_team(${from}::date, ${to}::date) c left join event_type t on t.id = c.event_type_id
      order by c.events_planned desc, c.marked_booked desc, t.name nulls last`);
    return { businesses: [...businesses], types: [...types] };
  });
}
