import { sql } from 'drizzle-orm';
import { data } from 'react-router';
import { actAs, planned, PlanNotFound } from './acting.server';
import type { MyBusiness } from './claims.server';
import { type Db, withDb } from './db.server';
import type { ServerEnv } from './env';
import { businessUnread } from './messages.server';

/**
 * The business's side of planning (V1-lite, V8; D-13 R3–R5, D-40, D-41, ADR-031). Only an
 * active owner or manager of a business that isn't archived, checked in the database on
 * every request; then everything runs as that business (side 'business'). The business has
 * no rules of its own on the planning tables: it reads its bookings only through the
 * database function bookings_for_business(), which returns exactly what D-40 allows (the
 * person's name, the date, the town and about how many guests), and flags only through
 * flag_booking() (ADR-031). Coming up or earlier is by date alone, so no time is revealed.
 */

/**
 * Before a page that only the owner and managers open (or, for the team, only the owner) says
 * "not found": someone on the business's team who can't open it is told who can instead
 * (scenario tests, C8). Anyone else still gets "not found", so the page reveals nothing about
 * who is on a team.
 */
export async function refuseTeamMember(env: ServerEnv, userId: string, slug: string, ownerOnly = false): Promise<void> {
  const [row] = await withDb(env, (db) =>
    db.execute<{ role: 'owner' | 'manager' | 'staff' }>(sql`
      select m.role from vendor_member m join vendor v on v.id = m.vendor_id
      where v.slug = ${slug} and m.user_id = ${userId} and m.ended_at is null`),
  );
  if (row?.role === 'staff' || (ownerOnly && row?.role === 'manager'))
    throw data({ reason: ownerOnly ? 'owner_only' : 'owner_or_manager' }, { status: 403 });
}

/**
 * "My business": the businesses this person runs, each with how many bookings are marked
 * coming up, and how many new messages this person hasn't read there (Stage 2B).
 */
export async function myBusinesses(env: ServerEnv, userId: string): Promise<(MyBusiness & { hidden: boolean; comingUp: number; unread: number })[]> {
  return withDb(env, async (db) => {
    const businesses = await db.execute<MyBusiness & { hidden: boolean }>(sql`
      select v.id, v.display_name as name, v.slug::text as slug, m.role, v.listing_status = 'published' as listed,
             v.listing_status = 'archived' as archived,
             v.listing_status = 'unpublished' and v.owner_hidden_at is not null as hidden,
             exists (select 1 from vendor_analytics a where a.vendor_id = v.id and a.enabled) as analytics
      from vendor_member m join vendor v on v.id = m.vendor_id
      where m.user_id = ${userId} and m.ended_at is null
      order by v.display_name`);
    const out: (MyBusiness & { hidden: boolean; comingUp: number; unread: number })[] = [];
    for (const b of businesses) {
      // Staff see no bookings (E §3: owners and managers); they read and reply to messages.
      const comingUp =
        b.archived || b.role === 'staff'
          ? 0
          : await actAs(db, { side: 'business', userId, vendorId: b.id }, async (tx) => {
              const [n] = await tx.execute<{ n: number }>(sql`
              select count(*)::int as n from bookings_for_business()
              where not cancelled and event_date >= (now() at time zone 'America/Toronto')::date`);
              return n?.n ?? 0;
            });
      const unread = b.archived ? 0 : await businessUnread(db, userId, b.id);
      out.push({ ...b, comingUp, unread });
    }
    return out;
  });
}

type RunBusiness = { id: string; slug: string; name: string };

/** A business this person is an active owner or manager of, not archived; by web address, or an old one. */
async function findRun(db: Db, userId: string, slug: string): Promise<RunBusiness | null> {
  const [v] = await db.execute<RunBusiness>(sql`
    select v.id, v.slug::text as slug, v.display_name as name
    from vendor v
    join vendor_member m on m.vendor_id = v.id and m.user_id = ${userId} and m.role in ('owner', 'manager') and m.ended_at is null
    where v.listing_status <> 'archived'
      and (v.slug = ${slug} or v.id = (select h.vendor_id from vendor_slug_history h where h.slug = ${slug} and v.slug <> ${slug}))
    order by v.slug = ${slug} desc
    limit 1`);
  return v ?? null;
}

export type BookingMarked = {
  rowId: string;
  /** The person's display name (R5). */
  person: string;
  date: string;
  town: string;
  guests: number | null;
  cancelled: boolean;
  passed: boolean;
  bookedAt: string;
  flaggedAt: string | null;
};

/**
 * V8 "Bookings marked": who marked this business as booked, coming up (soonest first)
 * and earlier (the last 12 months, latest first). Null: not this person's business (the
 * page answers 404, whatever the reason). An old web address gives { renamedTo }.
 */
export async function bookingsMarked(
  env: ServerEnv,
  userId: string,
  slug: string,
): Promise<{ vendor: RunBusiness; comingUp: BookingMarked[]; earlier: BookingMarked[] } | { renamedTo: string } | null> {
  return withDb(env, async (db) => {
    const vendor = await findRun(db, userId, slug);
    if (!vendor) return null;
    if (vendor.slug !== slug) return { renamedTo: vendor.slug };
    const rows = await actAs(db, { side: 'business', userId, vendorId: vendor.id }, (tx) =>
      tx.execute<BookingMarked>(sql`
        select b.row_id as "rowId", b.person, b.event_date::text as date, b.town, b.guests, b.cancelled,
               b.event_date < (now() at time zone 'America/Toronto')::date as passed,
               b.booked_at::text as "bookedAt", b.flagged_at::text as "flaggedAt"
        from bookings_for_business() b
        where b.event_date >= (now() at time zone 'America/Toronto')::date - interval '12 months'
        order by b.event_date, b.booked_at
        limit 300`),
    );
    const all = [...rows];
    return { vendor, comingUp: all.filter((r) => !r.passed), earlier: all.filter((r) => r.passed).reverse() };
  });
}

/** What the emails after a flag need (D-41): never the note. */
export type Flagged = {
  vendorName: string;
  rowId: string;
  eventId: string;
  date: string;
  /** The person who marked it booked, to be told politely. */
  person: { userId: string; email: string; name: string } | null;
};

/**
 * "This isn't right" (D-41): the business says a booking marked by a customer isn't real.
 * Once per marking, and not for a cancelled event; the database (flag_booking) checks this,
 * sets when and by whom, writes status_change, and keeps the note for the Localites team only.
 */
export async function flagBooking(env: ServerEnv, userId: string, slug: string, rowId: string, note: string | null): Promise<Flagged> {
  return planned(
    withDb(env, async (db) => {
      const vendor = await findRun(db, userId, slug);
      if (!vendor) throw new PlanNotFound();
      return actAs(db, { side: 'business', userId, vendorId: vendor.id }, async (tx) => {
        // Refusals come back as LP codes (not this business's booking, cancelled, already told);
        // planned() turns them into the plain words or a 404.
        const [flagged] = await tx.execute<{ eventId: string; date: string; hostId: string }>(sql`
          select event_id as "eventId", event_date::text as date, host_user_id as "hostId"
          from flag_booking(${rowId}::uuid, ${note})`);
        if (!flagged) throw new PlanNotFound();
        const [person] = await tx.execute<{ userId: string; email: string; name: string }>(sql`
          select id as "userId", email::text as email, display_name as name from app_user
          where id = ${flagged.hostId} and deleted_at is null`);
        return { vendorName: vendor.name, rowId, eventId: flagged.eventId, date: flagged.date, person: person ?? null };
      });
    }),
  );
}
