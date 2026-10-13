import { guestsWords, longDateWithYear } from '@/lib/plan-terms';
import type { Flagged } from './bookings.server';
import { withDb } from './db.server';
import {
  emailPersonUnlessRepeat,
  emailTeam,
  recordNotSent,
  renderEmail,
  type RepeatRule,
  type TemplateName,
} from './email-templates.server';
import type { ServerEnv } from './env';
import type { BookingNotice } from './events.server';

/**
 * Emails about plans (D-40, D-41), sent after the change has been saved
 * (ctx.waitUntil). What a business is told comes only from a BookingNotice: the person's
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
 * Emails one run may send for one change (cancelling or re-dating an event tells every
 * business on it): inside Cloudflare's 50 outside requests per run, even if each needs a
 * second try. The rest are recorded as not sent, for the team to follow up by hand.
 */
export const SENDS_PER_RUN = 15;
/** Between sends: Resend's free plan takes about 2 a second. */
const PAUSE_MS = 550;

/**
 * Several booking notices from one change, one after another on one database connection,
 * paced for Resend and capped per run (each still under its kind's repeat rule).
 */
export async function sendBookingNotices(env: ServerEnv, siteUrl: string, notices: BookingNotice[]): Promise<void> {
  if (notices.length === 0) return;
  await withDb(env, async (db) => {
    let attempted = 0;
    for (const notice of notices) {
      const { template, rule } = SENT[notice.kind];
      const subject = { type: 'event_vendor' as const, id: notice.eventVendorId };
      for (const r of notice.recipients) {
        if (attempted >= SENDS_PER_RUN) {
          await recordNotSent(db, r, notice.kind, subject, 'Not sent: too many emails from one change. Tell them by hand.');
          continue;
        }
        if (attempted > 0) await new Promise((done) => setTimeout(done, PAUSE_MS));
        const result = await emailPersonUnlessRepeat(
          env,
          r,
          notice.kind,
          subject,
          renderEmail(template, bookingNoticeValues(notice, r.name, siteUrl)),
          rule,
          db,
        );
        if (result !== 'suppressed') attempted += 1;
      }
    }
  });
}

/** Tells each owner or manager of the business, under the kind's repeat rule. */
export async function sendBookingNotice(env: ServerEnv, siteUrl: string, notice: BookingNotice): Promise<void> {
  const { template, rule } = SENT[notice.kind];
  for (const r of notice.recipients) {
    await emailPersonUnlessRepeat(
      env,
      r,
      notice.kind,
      { type: 'event_vendor', id: notice.eventVendorId },
      renderEmail(template, bookingNoticeValues(notice, r.name, siteUrl)),
      rule,
    );
  }
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
