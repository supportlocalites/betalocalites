import { sql } from 'drizzle-orm';
import approved from '../../emails/claim-approved.txt?raw';
import declined from '../../emails/claim-declined.txt?raw';
import received from '../../emails/claim-received.txt?raw';
import team from '../../emails/claim-team.txt?raw';
import undone from '../../emails/listing-change-undone.txt?raw';
import ownerRemoved from '../../emails/owner-removed.txt?raw';
import bookedEventCancelled from '../../emails/booked-event-cancelled.txt?raw';
import bookedEventChanged from '../../emails/booked-event-changed.txt?raw';
import bookingFlagTeam from '../../emails/booking-flag-team.txt?raw';
import bookingFlaggedPerson from '../../emails/booking-flagged-person.txt?raw';
import bookingUnmarked from '../../emails/booking-unmarked.txt?raw';
import markedBooked from '../../emails/marked-booked.txt?raw';
import teamInvite from '../../emails/team-invite.txt?raw';
import inquiryTeam from '../../emails/inquiry-team.txt?raw';
import vendorJoined from '../../emails/vendor-joined.txt?raw';
import newMessage from '../../emails/new-message.txt?raw';
import reportTeam from '../../emails/report-team.txt?raw';
import reviewDeclined from '../../emails/review-declined.txt?raw';
import reviewForBusiness from '../../emails/review-for-business.txt?raw';
import reviewPublished from '../../emails/review-published.txt?raw';
import reviewReminder from '../../emails/review-reminder.txt?raw';
import reviewReported from '../../emails/review-reported.txt?raw';
import reviewRequest from '../../emails/review-request.txt?raw';
import reviewTeam from '../../emails/review-team.txt?raw';
import { uuidv7 } from '@/lib/ids.mjs';
import { type Db, withDb } from './db.server';
import { sendEmail, TEAM_ADDRESS } from './email.server';
import type { ServerEnv } from './env';

/**
 * Emails written as plain text files in emails/ (checked by `npm run check:words`).
 * The first line is "Subject: …"; {{name}} placeholders are filled in here.
 */
const TEMPLATES = {
  approved,
  declined,
  received,
  team,
  undone,
  ownerRemoved,
  // Planning an event (slice 2A, D-40, D-41).
  markedBooked,
  bookingUnmarked,
  bookedEventCancelled,
  bookedEventChanged,
  bookingFlagTeam,
  bookingFlaggedPerson,
  // A business owner's team (V4, E §3).
  teamInvite,
  // Inquire (ADR-024).
  inquiryTeam,
  vendorJoined,
  // Messages (Stage 2B).
  newMessage,
  reportTeam,
  // Reviews (Stage 3).
  reviewTeam,
  reviewPublished,
  reviewDeclined,
  reviewForBusiness,
  reviewRequest,
  reviewReminder,
  reviewReported,
} as const;
export type TemplateName = keyof typeof TEMPLATES;

export function renderEmail(name: TemplateName, values: Record<string, string | string[]>): { subject: string; text: string } {
  // Values are one line each, so nothing typed can add lines to the subject or the email.
  // A list becomes one "- " line per item (never in a subject).
  const oneLine = (v: string) => v.replace(/[\r\n]+/g, ' ');
  const filled = TEMPLATES[name].replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const v = values[key] ?? '';
    return Array.isArray(v) ? v.map((item) => `- ${oneLine(item)}`).join('\n') : oneLine(v);
  });
  const [first, ...rest] = filled.split('\n');
  return {
    subject: (first ?? '').replace(/^Subject:\s*/, '').trim(),
    text: rest
      .join('\n')
      .replace(/^\n+/, '')
      .replace(/\n{3,}/g, '\n\n'),
  };
}

/**
 * Emails one person and records it honestly in `notification` (A §3): "sent" only once
 * the provider accepted it, "failed" with the reason otherwise (including "not set up").
 */
export async function emailPerson(
  env: ServerEnv,
  to: { userId: string; email: string },
  kind:
    | 'claim_received'
    | 'claim_decision'
    | 'listing_change_undone'
    | 'owner_removed'
    | 'vendor_joined'
    | 'review_published'
    | 'review_declined'
    | 'review_for_business',
  subject: { type: string; id: string },
  content: { subject: string; text: string },
): Promise<void> {
  const id = uuidv7();
  await withDb(env, (db) =>
    db.execute(sql`insert into notification (id, user_id, kind, subject_type, subject_id)
                   values (${id}, ${to.userId}, ${kind}, ${subject.type}, ${subject.id})`),
  );
  const result = await sendEmail(env, { to: to.email, ...content, replyTo: TEAM_ADDRESS });
  await withDb(env, (db) =>
    result.sent
      ? db.execute(sql`update notification set status = 'sent', sent_at = now() where id = ${id}`)
      : db.execute(sql`update notification set status = 'failed', failure_reason = ${result.reason} where id = ${id}`),
  );
}

/** Emails the team (D-11). The admin page is the record; a failed team email is logged only. */
export async function emailTeam(env: ServerEnv, content: { subject: string; text: string }): Promise<void> {
  const result = await sendEmail(env, { to: TEAM_ADDRESS, ...content });
  if (!result.sent && env.RESEND_API_KEY) console.error('team email not sent:', result.reason);
}

/** Emails about plans (slice 2A): to a booked business (D-40), and to the person when a business flags a booking (D-41). */
export type PlanEmailKind = 'marked_booked' | 'booking_unmarked' | 'booked_event_cancelled' | 'booked_event_changed' | 'booking_flagged';
const PLAN_EMAIL_KINDS: PlanEmailKind[] = [
  'marked_booked',
  'booking_unmarked',
  'booked_event_cancelled',
  'booked_event_changed',
  'booking_flagged',
];

/**
 * When an email about a plan is held back, so a person's taps can't flood a business's
 * inbox, without ever holding back news the business doesn't have yet:
 *   unless_known_booked: "marked booked" unless the last word they had was already "marked booked";
 *   only_after_marked: "no longer booked" only if the last word they had was "marked booked";
 *   always: every time (a real change of date or town, a cancelled event, a flag).
 * Every rule also has the daily limit per person below.
 */
export type RepeatRule = 'unless_known_booked' | 'only_after_marked' | 'always';

/** Plan emails to one person in 24 hours, whatever the rule (Resend's free plan: 100 a day for everything). */
export const PLAN_EMAILS_PER_DAY = 30;

/**
 * Emails one person about a plan unless a rule holds it back. Every decision is a
 * `notification` row with an honest status: "suppressed" with the reason, or "sent" /
 * "failed" as emailPerson. Decided under a lock per person, so two quick changes can't
 * both pass the check.
 */
export async function emailPersonUnlessRepeat(
  env: ServerEnv,
  to: { userId: string; email: string },
  kind: PlanEmailKind,
  subject: { type: 'event_vendor'; id: string },
  content: { subject: string; text: string },
  rule: RepeatRule,
  /** A connection the caller already has (a batch of emails shares one). */
  shared?: Db,
): Promise<'sent' | 'failed' | 'suppressed'> {
  const id = uuidv7();
  const kinds = `{${PLAN_EMAIL_KINDS.join(',')}}`;
  const onDb = <T>(fn: (db: Db) => Promise<T>) => (shared ? fn(shared) : withDb(env, fn));
  // An email still being sent counts as told; one left "queued" by an interrupted run stops
  // counting after 10 minutes (the nightly run then marks it failed).
  const told = sql`(n.status = 'sent' or (n.status = 'queued' and n.created_at > now() - interval '10 minutes'))`;
  const [row] = await onDb((db) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`localites.plan-email:${to.userId}`}, 0))`);
      return tx.execute<{ status: string }>(sql`
        with why as (
          select case
            when (select count(*) from notification n
                  where n.user_id = ${to.userId} and n.kind = any(${kinds}::text[]) and ${told}
                    and n.created_at > now() - interval '1 day') >= ${PLAN_EMAILS_PER_DAY}
              then 'daily limit'
            when ${rule} = 'unless_known_booked' and coalesce((
                  select n.kind = 'marked_booked' from notification n
                  where n.user_id = ${to.userId} and n.subject_type = ${subject.type} and n.subject_id = ${subject.id}
                    and n.kind in ('marked_booked', 'booking_unmarked') and ${told}
                  order by n.created_at desc, n.id desc limit 1), false)
              then 'they already know it’s marked booked'
            when ${rule} = 'only_after_marked' and not coalesce((
                  select n.kind = 'marked_booked' from notification n
                  where n.user_id = ${to.userId} and n.subject_type = ${subject.type} and n.subject_id = ${subject.id}
                    and n.kind in ('marked_booked', 'booking_unmarked') and ${told}
                  order by n.created_at desc, n.id desc limit 1), false)
              then 'they weren’t told it was booked'
          end as reason)
        insert into notification (id, user_id, kind, subject_type, subject_id, status, failure_reason)
        select ${id}, ${to.userId}, ${kind}, ${subject.type}, ${subject.id},
               case when reason is null then 'queued' else 'suppressed' end, reason
        from why
        returning status`);
    }),
  );
  if (row?.status !== 'queued') return 'suppressed';
  const result = await sendEmail(env, { to: to.email, ...content, replyTo: TEAM_ADDRESS });
  await onDb((db) =>
    result.sent
      ? db.execute(sql`update notification set status = 'sent', sent_at = now() where id = ${id}`)
      : db.execute(sql`update notification set status = 'failed', failure_reason = ${result.reason} where id = ${id}`),
  );
  return result.sent ? 'sent' : 'failed';
}

/**
 * The nightly run (workers/app.ts): emails left "queued" by a run that was cut short (the
 * email may or may not have gone) are marked failed, so the record stays honest: plan
 * emails, "it joined" emails (ADR-024), new-message emails and "How was it?" emails; and inquiry emails to the
 * team left "pending" (close_stale_inquiry_emails, migration 0022).
 */
export async function closeInterruptedPlanEmails(env: ServerEnv): Promise<number> {
  const kinds = `{${[...PLAN_EMAIL_KINDS, 'vendor_joined', 'new_message', 'review_request', 'review_reminder'].join(',')}}`;
  return withDb(env, async (db) => {
    const rows = await db.execute(sql`
      update notification set status = 'failed', failure_reason = 'Not known whether it was sent: the sending was interrupted.'
      where status = 'queued' and kind = any(${kinds}::text[]) and created_at < now() - interval '1 hour'
      returning id`);
    const [inquiries] = await db.execute<{ n: number }>(sql`select close_stale_inquiry_emails() as n`);
    return rows.length + (inquiries?.n ?? 0);
  });
}

/** A plan email that wasn't attempted, recorded as failed with why (so the team can follow up). */
export async function recordNotSent(
  db: Db,
  to: { userId: string },
  kind: PlanEmailKind,
  subject: { type: 'event_vendor'; id: string },
  reason: string,
): Promise<void> {
  await db.execute(sql`
    insert into notification (id, user_id, kind, subject_type, subject_id, status, failure_reason)
    values (${uuidv7()}, ${to.userId}, ${kind}, ${subject.type}, ${subject.id}, 'failed', ${reason})`);
}
