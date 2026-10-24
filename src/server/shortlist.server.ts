import { sql } from 'drizzle-orm';
import { PLAN_LIMITS, PLAN_REFUSALS } from '@/lib/plan-terms';
import { actingAs, PlanCapped, planned, PlanNotFound } from './acting.server';
import type { Db } from './db.server';
import type { ServerEnv } from './env';

/**
 * The shortlist (D-57): the + on a business's card. Private to the person, read and changed
 * only as them (ADR-031; the database refuses anyone else, migration 0053). Moved onto an
 * event, as Considering, when they plan one.
 */
const asPerson = (userId: string) => ({ side: 'person', userId }) as const;

const listed = async (tx: Db, slug: string) => {
  const [v] = await tx.execute<{ id: string; name: string }>(sql`
    select id, display_name as name from vendor where slug = ${slug} and listing_status = 'published'`);
  return v ?? null;
};

export async function addToShortlist(env: ServerEnv, userId: string, slug: string): Promise<'added' | 'already'> {
  return planned(
    actingAs(env, asPerson(userId), async (tx) => {
      // One at a time per person, so two quick taps can't pass the limit together.
      await tx.execute(sql`select id from app_user where id = ${userId} for update`);
      const v = await listed(tx, slug);
      if (!v) throw new PlanNotFound();
      const [n] = await tx.execute<{ n: number; there: boolean }>(sql`
        select count(*) filter (where v.listing_status = 'published')::int as n, bool_or(s.vendor_id = ${v.id}) as there
        from shortlist s join vendor v on v.id = s.vendor_id where s.user_id = ${userId}`);
      if (n?.there) return 'already';
      if ((n?.n ?? 0) >= PLAN_LIMITS.shortlistMax) throw new PlanCapped(PLAN_REFUSALS.LP140!);
      const added = await tx.execute(sql`
        insert into shortlist (user_id, vendor_id) values (${userId}, ${v.id}) on conflict do nothing returning vendor_id`);
      return added.length > 0 ? 'added' : 'already';
    }),
  );
}

/** Taken off, listed or not. */
export async function removeFromShortlist(env: ServerEnv, userId: string, slug: string): Promise<void> {
  await planned(
    actingAs(env, asPerson(userId), (tx) =>
      tx.execute(sql`delete from shortlist where user_id = ${userId} and vendor_id in (select id from vendor where slug = ${slug})`),
    ),
  );
}

/** Everything off the person's own shortlist ("Clear all", the owner, 24 October 2026). */
export async function clearShortlist(env: ServerEnv, userId: string): Promise<void> {
  await planned(actingAs(env, asPerson(userId), (tx) => tx.execute(sql`delete from shortlist where user_id = ${userId}`)));
}

/**
 * Moves the listed businesses on the shortlist onto one of the person's own events, as
 * Considering (the database's rules apply to each), and takes those off the shortlist. Already
 * on the event: just taken off. Returns how many were added.
 */
export async function shortlistToEvent(env: ServerEnv, userId: string, eventId: string): Promise<number> {
  return planned(
    actingAs(env, asPerson(userId), async (tx) => {
      // One move at a time per person, so a business can't land on two events at once.
      await tx.execute(sql`select id from app_user where id = ${userId} for update`);
      const [e] = await tx.execute<{ onPlan: number }>(sql`
        select (select count(*) from event_vendor ev where ev.event_id = e.id and ev.status <> 'removed')::int as "onPlan"
        from event e where e.id = ${eventId} and e.host_user_id = ${userId} and e.status = 'planning'
        for update of e`);
      if (!e) throw new PlanNotFound();
      const room = Math.max(0, PLAN_LIMITS.vendorsPerEvent - e.onPlan);
      const moved = await tx.execute<{ vendorId: string; added: boolean }>(sql`
        with picked as (
          select s.vendor_id from shortlist s join vendor v on v.id = s.vendor_id
          where s.user_id = ${userId} and v.listing_status = 'published'
            and not exists (select 1 from vendor_member m where m.vendor_id = v.id and m.user_id = ${userId} and m.ended_at is null)
          order by s.created_at),
        fresh as (
          select p.vendor_id from picked p
          where not exists (select 1 from event_vendor ev where ev.event_id = ${eventId} and ev.vendor_id = p.vendor_id and ev.status <> 'removed')
          limit ${room}),
        ins as (
          insert into event_vendor (id, event_id, host_user_id, vendor_id)
          select gen_random_uuid(), ${eventId}::uuid, ${userId}::uuid, f.vendor_id from fresh f
          on conflict (event_id, vendor_id) do update set status = 'considering' where event_vendor.status = 'removed'
          returning vendor_id)
        select p.vendor_id as "vendorId", exists (select 1 from ins where ins.vendor_id = p.vendor_id) as added
        from picked p
        where exists (select 1 from ins where ins.vendor_id = p.vendor_id)
           or exists (select 1 from event_vendor ev where ev.event_id = ${eventId} and ev.vendor_id = p.vendor_id and ev.status <> 'removed')`);
      if (moved.length > 0) {
        await tx.execute(sql`
          delete from shortlist where user_id = ${userId} and vendor_id = any(${`{${moved.map((m) => m.vendorId).join(',')}}`}::uuid[])`);
      }
      return moved.filter((m) => m.added).length;
    }),
  );
}
