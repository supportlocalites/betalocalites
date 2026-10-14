import { sql } from 'drizzle-orm';
import type { ListingStatus } from '@/lib/listing-status';
import { actingAs } from '../acting.server';
import type { Admin } from '../auth/admin.server';
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
 * Counts only, never who (not audited): with a business, its bookings for events still to
 * come; without, those of every business that isn't listed (the ones to check in about).
 */
export async function upcomingBookingCount(env: ServerEnv, admin: Admin, vendorId: string | null = null): Promise<number> {
  return actingAs(env, { side: 'team', userId: admin.userId }, async (tx) => {
    const [n] = await tx.execute<{ n: number | string }>(sql`select taken_down_booking_count(${vendorId}::uuid) as n`);
    return Number(n?.n ?? 0);
  });
}
