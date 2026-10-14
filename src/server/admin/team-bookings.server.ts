import { sql } from 'drizzle-orm';
import type { ListingStatus } from '@/lib/listing-status';
import { actAs, actingAs } from '../acting.server';
import type { Admin } from '../auth/admin.server';
import type { Db } from '../db.server';
import type { ServerEnv } from '../env';
import { audit } from './audit.server';

/**
 * The team's view of bookings (D-46): which person marked which business booked, listed or
 * not, past events too, so the team always knows who works with whom and can check in when
 * a business is taken down. Runs as the team, through bookings_for_team() (migration 0020):
 * never the event's name, kind, times or private details, never what a person is only
 * considering or has saved. Every look is written to audit_log first, in the same
 * transaction (E §4.2). Callers must have passed adminGate.
 */

export type TeamBooking = {
  rowId: string;
  vendorId: string;
  business: string;
  status: ListingStatus;
  person: string;
  personEmail: string;
  date: string;
  town: string;
  guests: number | null;
  bookedAt: string;
  cancelled: boolean;
  upcoming: boolean;
};

/** Most rows read at once: the coming-up ones always fit first (the function orders them first). */
export const TEAM_BOOKINGS_MAX = 500;

export async function teamBookings(env: ServerEnv, admin: Admin, vendorId: string | null): Promise<TeamBooking[]> {
  return actingAs(env, { side: 'team', userId: admin.userId }, async (tx) => {
    await audit(tx, {
      actor: admin.userId,
      action: 'event_vendor.bookings_view',
      subjectType: vendorId ? 'vendor' : 'event_vendor',
      subjectId: vendorId,
      sessionRef: admin.sessionId,
    });
    const rows = await tx.execute<TeamBooking>(sql`
      select row_id as "rowId", vendor_id as "vendorId", business, listing_status as status, person,
             person_email as "personEmail", event_date::text as date, town, guests, booked_at::text as "bookedAt",
             cancelled, upcoming
      from bookings_for_team(${vendorId}::uuid)
      limit ${TEAM_BOOKINGS_MAX}`);
    return [...rows];
  });
}

/**
 * With a business, its bookings for events still to come, as a count only (never who; not
 * audited), on the page's own connection (one per page: each costs CPU time).
 */
export async function upcomingBookingCount(db: Db, admin: Admin, vendorId: string): Promise<number> {
  return actAs(db, { side: 'team', userId: admin.userId }, async (tx) => {
    const [n] = await tx.execute<{ n: number | string }>(sql`select taken_down_booking_count(${vendorId}::uuid) as n`);
    return Number(n?.n ?? 0);
  });
}

/**
 * The team menu's two counts in one connection: booking flags not yet decided (D-41), and
 * bookings still to come of businesses that aren't listed, to check in about (D-46). Counts
 * only: not audited.
 */
export async function teamMenuCounts(env: ServerEnv, admin: Admin): Promise<{ openFlags: number; checkIns: number }> {
  return actingAs(env, { side: 'team', userId: admin.userId }, async (tx) => {
    const [n] = await tx.execute<{ openFlags: number | string; checkIns: number | string }>(sql`
      select (select count(*) from event_vendor where vendor_flagged_at is not null and flag_resolved_at is null)::int as "openFlags",
             taken_down_booking_count() as "checkIns"`);
    return { openFlags: Number(n?.openFlags ?? 0), checkIns: Number(n?.checkIns ?? 0) };
  });
}
