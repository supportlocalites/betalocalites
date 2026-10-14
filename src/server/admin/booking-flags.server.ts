import { sql } from 'drizzle-orm';
import { actingAs } from '../acting.server';
import type { Admin } from '../auth/admin.server';
import type { ServerEnv } from '../env';
import { audit } from './audit.server';

/**
 * The team's read-only list of booking flags (X16, D-41): businesses that said a booking
 * marked by a customer isn't right. Deciding on them comes in Stage 3. Runs as the team:
 * the database shows only flagged plan rows and their events, never anyone's private
 * event details. Every look is written to audit_log first, in the same transaction (E §4.2).
 * Callers must have passed adminGate.
 */

export type FlagRow = {
  rowId: string;
  business: string;
  vendorId: string;
  slug: string;
  flaggedAt: string;
  /** The business's note: for the team only, never in an email or shown to the person. */
  note: string | null;
  person: string;
  personEmail: string;
  type: string | null;
  date: string;
  town: string;
  guests: number | null;
  stillBooked: boolean;
  eventCancelled: boolean;
};

export async function bookingFlags(env: ServerEnv, admin: Admin): Promise<FlagRow[]> {
  return actingAs(env, { side: 'team', userId: admin.userId }, async (tx) => {
    await audit(tx, {
      actor: admin.userId,
      action: 'event_vendor.flags_view',
      subjectType: 'event_vendor',
      subjectId: null,
      sessionRef: admin.sessionId,
    });
    const rows = await tx.execute<FlagRow>(sql`
      select ev.id as "rowId", v.display_name as business, v.id as "vendorId", v.slug::text as slug,
             ev.vendor_flagged_at::text as "flaggedAt", n.note,
             u.display_name as person, u.email::text as "personEmail", t.name as type, e.event_date::text as date,
             mu.name as town, e.guest_count_estimate as guests, ev.status = 'booked' as "stillBooked",
             e.status = 'cancelled' as "eventCancelled"
      from event_vendor ev
      left join event_vendor_flag_note n on n.event_vendor_id = ev.id
      join vendor v on v.id = ev.vendor_id
      join event e on e.id = ev.event_id
      left join event_type t on t.id = e.event_type_id
      join municipality mu on mu.id = e.municipality_id
      join app_user u on u.id = e.host_user_id
      where ev.vendor_flagged_at is not null
      order by ev.vendor_flagged_at desc
      limit 200`);
    return [...rows];
  });
}
