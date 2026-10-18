import { guestsWords, longDateWithYear } from '@/lib/plan-terms';
import type { Flagged } from './bookings.server';
import { sql } from 'drizzle-orm';
import { type Db, withDb } from './db.server';
import { sendEmail, TEAM_ADDRESS } from './email.server';
import {
  emailPersonUnlessRepeat,
  emailTeam,
  renderEmail,
  type RepeatRule,
  type TemplateName,
} from './email-templates.server';
import type { ServerEnv } from './env';
import type { BookingNotice } from './events.server';

/**
 * Emails about plans (D-40, D-41), decided after the change has been saved (ctx.waitUntil):
 * a business's booking emails wait for the morning summary (D-53); the person's email about a
 * flag goes at once. What a business is told comes only from a BookingNotice: the person's
 * name, the date, the town and about how many guests, never anything private. Each email
 * to a person is a `notification` row with an honest status.
 */

const SENT: Record<BookingNotice['kind'], { template: TemplateName; rule: RepeatRule }> = {
  marked_booked: { template: 'markedBooked', rule: 'unless_known_booked' },
  booking_unmarked: { template: 'bookingUnmarked', rule: 'only_after_marked' },
  booked_event_cancelled: { template: 'bookedEventCancelled', rule: 'always' },
  booked_event_changed: { template: 'bookedEventChanged', rule: 'always' },
};

/** The only values a booking email can show (the unit test checks the keys). */
export function bookingNoticeValues(n: BookingNotice, recipientName: string, siteUrl: string): Record<string, string> {
  const guests = guestsWords(n.guests);
  return {
    name: recipientName,
    person: n.person,
    business: n.vendorName,
    date: longDateWithYear(n.date),
    town: n.town,
    guests: guests ? `, ${guests}` : '',
    was: n.was ? `${longDateWithYear(n.was.date)} in ${n.was.town}` : '',
    link: `${siteUrl}/vendors/${n.vendorSlug}/bookings`,
  };
}

/**
 * One line of the morning summary (D-53), from the same few facts the single email showed
 * (D-40): the person's name, the business, the date, the town and about how many guests.
 */
export function summaryLine(n: BookingNotice): string {
  const v = bookingNoticeValues(n, '', '');
  switch (n.kind) {
    case 'marked_booked':
      return `${v.person} marked ${v.business} as booked for ${v.date}, in ${v.town}${v.guests}.`;
    case 'booking_unmarked':
      return `${v.person} no longer has ${v.business} marked as booked for ${v.date}.`;
    case 'booked_event_cancelled':
      return `${v.person} cancelled their event on ${v.date} in ${v.town}, which they had marked ${v.business} as booked for.`;
    case 'booked_event_changed':
      return `${v.person} changed their event (${v.business} is marked booked): it's now ${v.date} in ${v.town} (it was ${v.was}).`;
  }
}

/**
 * Booking notices from one change (D-40): each owner or manager's emails wait for the morning
 * summary (D-53), each still under its kind's repeat rule. Nothing is sent now, so a change that
 * touches many businesses (cancelling an event) costs no emails until the morning.
 */
export async function sendBookingNotices(env: ServerEnv, siteUrl: string, notices: BookingNotice[]): Promise<void> {
  if (notices.length === 0) return;
  await withDb(env, async (db) => {
    for (const notice of notices) {
      const { template, rule } = SENT[notice.kind];
      const subject = { type: 'event_vendor' as const, id: notice.eventVendorId };
      const line = summaryLine(notice);
      for (const r of notice.recipients) {
        await emailPersonUnlessRepeat(env, r, notice.kind, subject, renderEmail(template, bookingNoticeValues(notice, r.name, siteUrl)), rule, db, line);
      }
    }
  });
}

/** Tells each owner or manager of the business, under the kind's repeat rule, in the morning summary. */
export async function sendBookingNotice(env: ServerEnv, siteUrl: string, notice: BookingNotice): Promise<void> {
  await sendBookingNotices(env, siteUrl, [notice]);
}

/**
 * Summaries one morning run sends: with each send's one retry, inside Cloudflare's 50 outside
 * requests a run alongside the "How was it?" emails. The second run, and the next morning,
 * send the rest (oldest waiting first).
 */
export const SUMMARIES_PER_RUN = 10;
/** Lines one summary shows; more are counted, with the link to see them all. */
const LINES_SHOWN = 25;
/** A summary that keeps failing is given up on (recorded as failed) once its oldest line is this old. */
const RETRY_FOR = '2 days';
/** Between sends: Resend's free plan takes about 2 a second. */
const PAUSE_MS = 550;

type Waiting = { id: string; userId: string; email: string; name: string; kind: BookingNotice['kind']; subjectId: string; line: string };

/**
 * The morning summary (D-53): each person's waiting booking emails, as one email. Lines for a
 * business they're no longer on the team of are dropped. Per booking, "marked booked" and "no
 * longer booked" collapse to the latest; if that leaves them where the last email they were sent
 * did (marked and un-marked overnight), neither is mentioned. Under the person's lock, the lines
 * to send are moved from waiting to queued (so the second run can't take them); then the email
 * is sent and the outcome recorded. A run cut short mid-send leaves them queued, and the nightly
 * run marks them failed ("not known whether it was sent"). A failed send waits for the next run,
 * for up to two days.
 */
export async function sendPlanSummaries(env: ServerEnv): Promise<{ sent: number; failed: number }> {
  const siteUrl = env.SITE_URL ?? '';
  const people = await withDb(env, async (db) => {
    // Someone who deleted their account since isn't emailed.
    await db.execute(sql`
      update notification n set status = 'suppressed', summary_line = null,
             failure_reason = 'Their account was deleted before the daily summary.'
      from app_user u where u.id = n.user_id and n.status = 'waiting' and u.deleted_at is not null`);
    return db.execute<{ userId: string }>(sql`
      select n.user_id as "userId" from notification n where n.status = 'waiting'
      group by n.user_id order by min(n.created_at) limit ${SUMMARIES_PER_RUN}`);
  });
  let sent = 0;
  let failed = 0;
  for (const { userId } of people) {
    if (sent + failed > 0) await new Promise((done) => setTimeout(done, PAUSE_MS));
    try {
      const outcome = await sendOneSummary(env, siteUrl, userId);
      if (outcome === true) sent += 1;
      else if (outcome === false) failed += 1;
    } catch (err) {
      failed += 1;
      console.error('booking summary failed', err instanceof Error ? err.message : err);
    }
  }
  return { sent, failed };
}

/** One person's summary: true sent, false not sent, null nothing to send. */
async function sendOneSummary(env: ServerEnv, siteUrl: string, userId: string): Promise<boolean | null> {
  return withDb(env, async (db) => {
    const keep = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`localites.plan-email:${userId}`}, 0))`);
      await tx.execute(sql`
        update notification set status = 'suppressed', summary_line = null,
               failure_reason = 'No longer on the business’s team before the daily summary.'
        where user_id = ${userId} and status = 'waiting' and not booking_still_theirs(user_id, subject_id)`);
      const rows = await tx.execute<Waiting>(sql`
        select n.id, n.user_id as "userId", u.email::text as email, coalesce(u.given_name, u.display_name) as name,
               n.kind, n.subject_id as "subjectId", n.summary_line as line
        from notification n join app_user u on u.id = n.user_id and u.deleted_at is null
        where n.user_id = ${userId} and n.status = 'waiting'
        order by n.created_at, n.id
        for update of n`);
      if (rows.length === 0) return [];
      const { keep, drop } = await collapse(tx as unknown as Db, userId, [...rows]);
      if (drop.length > 0) {
        await tx.execute(sql`
          update notification set status = 'suppressed', summary_line = null, failure_reason = 'Cancelled out before the daily summary.'
          where id = any(${uuids(drop)}::uuid[])`);
      }
      if (keep.length > 0) {
        await tx.execute(sql`update notification set status = 'queued' where id = any(${uuids(keep.map((k) => k.id))}::uuid[])`);
      }
      return keep;
    });
    if (keep.length === 0) return null;
    const first = keep[0]!;
    const more = keep.length - LINES_SHOWN;
    const result = await sendEmail(env, {
      to: first.email,
      replyTo: TEAM_ADDRESS,
      ...renderEmail('planSummary', {
        name: first.name,
        count: keep.length === 1 ? '1 update' : `${keep.length} updates`,
        lines: [...keep.slice(0, LINES_SHOWN).map((k) => k.line), ...(more > 0 ? [`…and ${more} more on your bookings page.`] : [])],
        link: `${siteUrl}/business`,
      }),
    });
    const ids = uuids(keep.map((k) => k.id));
    if (result.sent) {
      await db.execute(sql`update notification set status = 'sent', sent_at = now(), summary_line = null where id = any(${ids}::uuid[])`);
    } else {
      // Waits for the next run; given up on (failed, with why) once the oldest line is two days old.
      await db.execute(sql`
        update notification n set
          status = case when o.oldest < now() - ${RETRY_FOR}::interval then 'failed' else 'waiting' end,
          failure_reason = case when o.oldest < now() - ${RETRY_FOR}::interval then ${result.reason} end,
          summary_line = case when o.oldest < now() - ${RETRY_FOR}::interval then null else n.summary_line end
        from (select min(created_at) as oldest from notification where id = any(${ids}::uuid[])) o
        where n.id = any(${ids}::uuid[])`);
    }
    return result.sent;
  });
}

const uuids = (ids: string[]) => `{${ids.join(',')}}`;

/**
 * Per booking, the latest of "marked booked" / "no longer booked", unless it changes nothing for
 * them; a booking that ends up "no longer booked" also drops the earlier lines about its event
 * changing (they'd describe a booking that's gone). Rows come oldest first.
 */
async function collapse(db: Db, userId: string, rows: Waiting[]): Promise<{ keep: Waiting[]; drop: string[] }> {
  const byState = new Map<string, Waiting[]>();
  for (const r of rows) {
    if (r.kind === 'marked_booked' || r.kind === 'booking_unmarked') byState.set(r.subjectId, [...(byState.get(r.subjectId) ?? []), r]);
  }
  const drop = new Set<string>();
  if (byState.size > 0) {
    // What each booking's last email (before this summary) told them.
    const told = await db.execute<{ subjectId: string; kind: string }>(sql`
      select distinct on (subject_id) subject_id as "subjectId", kind from notification
      where user_id = ${userId} and status = 'sent' and kind in ('marked_booked', 'booking_unmarked')
        and subject_id = any(${uuids([...byState.keys()])}::uuid[])
      order by subject_id, created_at desc, id desc`);
    for (const [subjectId, list] of byState) {
      const last = list.at(-1)!;
      const before = told.find((t) => t.subjectId === subjectId)?.kind ?? 'booking_unmarked';
      for (const r of list) if (r !== last || last.kind === before) drop.add(r.id);
      if (last.kind === 'booking_unmarked') {
        const lastAt = rows.indexOf(last);
        rows.forEach((r, i) => {
          if (i < lastAt && r.subjectId === subjectId && r.kind === 'booked_event_changed') drop.add(r.id);
        });
      }
    }
  }
  return { keep: rows.filter((r) => !drop.has(r.id)), drop: [...drop] };
}

/** The values of the person's email about a flag (D-41): never the business's note. */
export function flaggedPersonValues(f: Flagged & { person: NonNullable<Flagged['person']> }, siteUrl: string): Record<string, string> {
  return { name: f.person.name, business: f.vendorName, date: longDateWithYear(f.date), link: `${siteUrl}/events/${f.eventId}` };
}

/**
 * After a business says a booking isn't right (D-41): the team is emailed (the business's
 * name and a link; no note, no person), and the person who marked it booked is told
 * politely, with a link to their own plan.
 */
export async function emailBookingFlagged(env: ServerEnv, siteUrl: string, flagged: Flagged): Promise<void> {
  await emailTeam(env, renderEmail('bookingFlagTeam', { business: flagged.vendorName, link: `${siteUrl}/admin/booking-flags` }));
  const { person } = flagged;
  if (!person) return;
  await emailPersonUnlessRepeat(
    env,
    person,
    'booking_flagged',
    { type: 'event_vendor', id: flagged.rowId },
    renderEmail('bookingFlaggedPerson', flaggedPersonValues({ ...flagged, person }, siteUrl)),
    'always',
  );
}
