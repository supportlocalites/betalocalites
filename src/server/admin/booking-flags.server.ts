import { sql } from 'drizzle-orm';
import { FLAG_OUTCOMES } from '@/lib/review-terms';
import { longDate } from '@/lib/plan-terms';
import { actingAs, errorCode, PlanNotFound, PlanRefused } from '../acting.server';
import type { Admin } from '../auth/admin.server';
import { withDb } from '../db.server';
import { emailPerson, renderEmail } from '../email-templates.server';
import { type ClosedReports, closedReports, emailReportOutcomes } from '../reviews.server';
import type { ServerEnv } from '../env';
import { audit } from './audit.server';

/**
 * The team's list of booking flags (X16, D-41): businesses that said a booking marked by a
 * customer isn't right. The team decides each (M8, D-54): the booking stands, or it wasn't
 * real (and its review is removed); the person and the business are emailed. Runs as the team:
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
  /** The team's decision, once made. */
  outcome: 'booking_stands' | 'booking_not_real' | null;
  decidedAt: string | null;
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
             e.status = 'cancelled' as "eventCancelled", ev.flag_outcome as outcome, ev.flag_resolved_at::text as "decidedAt"
      from event_vendor ev
      left join event_vendor_flag_note n on n.event_vendor_id = ev.id
      join vendor v on v.id = ev.vendor_id
      join event e on e.id = ev.event_id
      left join event_type t on t.id = e.event_type_id
      join municipality mu on mu.id = e.municipality_id
      join app_user u on u.id = e.host_user_id
      where ev.vendor_flagged_at is not null
      order by (ev.flag_resolved_at is null) desc, ev.vendor_flagged_at desc
      limit 200`);
    return [...rows];
  });
}

type Decided = {
  vendorId: string;
  hostId: string;
  eventId: string;
  date: string;
  reviewRemoved: boolean;
  /** Reports of the review the decision removed, closed with it: their senders are told too. */
  closed: ClosedReports | null;
  reviewId: string | null;
};

/** The team's decision on one flag (M8, D-54), recorded in audit_log; once decided, it stays decided. */
export async function decideBookingFlag(env: ServerEnv, admin: Admin, rowId: string, outcome: 'stands' | 'not_real'): Promise<Decided> {
  return actingAs(env, { side: 'team', userId: admin.userId }, async (tx) => {
    const [row] = await tx
      .execute<Omit<Decided, 'closed' | 'reviewId'>>(sql`
        select d.vendor_id as "vendorId", d.host_user_id as "hostId", ev.event_id as "eventId", d.event_date::text as date,
               d.review_removed as "reviewRemoved"
        from decide_booking_flag(${rowId}::uuid, ${outcome}) d join event_vendor ev on ev.id = ${rowId}::uuid`)
      .catch((err: unknown) => {
        const code = errorCode(err);
        if (code === 'LP109') throw new PlanRefused('That flag was already decided. Please look again.');
        if (code === 'LP101') throw new PlanNotFound();
        throw err;
      });
    if (!row) throw new PlanNotFound();
    const closed = await closedReports(tx, sql`r.event_vendor_id = ${rowId}::uuid`);
    const [review] = await tx.execute<{ id: string }>(sql`select id from review where event_vendor_id = ${rowId}::uuid`);
    await audit(tx, {
      actor: admin.userId,
      action: `event_vendor.flag_${outcome}`,
      subjectType: 'event_vendor',
      subjectId: rowId,
      reason: row.reviewRemoved ? 'its review was removed' : undefined,
      sessionRef: admin.sessionId,
    });
    return { ...row, closed, reviewId: review?.id ?? null };
  });
}

/** After the decision: the person who marked it booked, and the business's owners and managers (M8, D-54). */
export async function emailAboutFlagDecision(
  env: ServerEnv,
  rowId: string,
  outcome: 'stands' | 'not_real',
  decided: Decided,
  siteUrl: string,
): Promise<void> {
  const date = longDate(decided.date);
  const [biz] = await withDb(env, (db) =>
    db.execute<{ name: string; slug: string }>(sql`select display_name as name, slug::text as slug from vendor where id = ${decided.vendorId}`),
  );
  if (!biz) return;
  const [person] = await withDb(env, (db) =>
    db.execute<{ email: string; name: string }>(sql`
      select email::text as email, coalesce(given_name, display_name) as name from app_user
      where id = ${decided.hostId} and deleted_at is null`),
  );
  // Each email on its own: one failing doesn't stop the others.
  const each = (work: Promise<void>) =>
    work.catch((err: unknown) => console.error('flag decision email failed', err instanceof Error ? err.message : err));
  if (person) {
    await each(emailPerson(
      env,
      { userId: decided.hostId, email: person.email },
      'flag_decision',
      { type: 'event_vendor', id: rowId },
      renderEmail('flagDecisionPerson', {
        name: person.name,
        business: biz.name,
        outcome:
          outcome === 'stands'
            ? FLAG_OUTCOMES.personStands(biz.name, date)
            : FLAG_OUTCOMES.personNotReal(biz.name, date, decided.reviewRemoved),
        link: `${siteUrl}/events/${decided.eventId}`,
      }),
    ));
  }
  const team = await withDb(env, (db) =>
    db.execute<{ id: string; email: string; name: string }>(sql`
      select u.id, u.email::text as email, coalesce(u.given_name, u.display_name) as name
      from vendor_member m join app_user u on u.id = m.user_id
      where m.vendor_id = ${decided.vendorId} and m.ended_at is null and m.role in ('owner', 'manager') and u.deleted_at is null`),
  );
  for (const m of team) {
    await each(emailPerson(
      env,
      { userId: m.id, email: m.email },
      'flag_decision',
      { type: 'event_vendor', id: rowId },
      renderEmail('flagDecisionBusiness', {
        name: m.name,
        outcome: outcome === 'stands' ? FLAG_OUTCOMES.businessStands(date) : FLAG_OUTCOMES.businessNotReal(date, decided.reviewRemoved),
        link: `${siteUrl}/vendors/${biz.slug}/bookings`,
      }),
    ));
  }
  if (decided.closed && decided.reviewId) await emailReportOutcomes(env, decided.reviewId, decided.closed);
}
