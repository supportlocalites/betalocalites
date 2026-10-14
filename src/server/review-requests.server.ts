import { sql } from 'drizzle-orm';
import { longDateWithYear } from '@/lib/plan-terms';
import { REVIEW_LIMITS } from '@/lib/review-terms';
import { actingAs } from './acting.server';
import { withDb } from './db.server';
import { sendEmails } from './email.server';
import { renderEmail } from './email-templates.server';
import type { ServerEnv } from './env';

/**
 * "How was it?" (Stage 3, part 2; roadmap Stage 3, migration 0032), run by the morning job
 * (workers/app.ts). The morning after an event, its host is emailed once about the businesses
 * they booked and haven't reviewed; once more a week later if any are still not reviewed;
 * never after the 60 days. review_requests_due() decides who is due and claims them (at most
 * 20 of the email service's 100 a day, leaving room for sign-in codes and the rest); here they're sent in one
 * request and each is recorded as sent or failed. Never the event's name, only its date.
 */

type Due = {
  notificationId: string;
  kind: 'review_request' | 'review_reminder';
  email: string;
  name: string;
  eventId: string;
  eventDate: string;
  businesses: number;
  rowId: string | null;
};

const addDays = (isoDate: string, days: number) => {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** The email for one person and event. With one business, the link opens its review form. */
export function requestEmail(d: Due, siteUrl: string): { subject: string; text: string } {
  return renderEmail(d.kind === 'review_request' ? 'reviewRequest' : 'reviewReminder', {
    name: d.name,
    date: longDateWithYear(d.eventDate),
    businesses: d.businesses === 1 ? 'the business you booked' : `the ${d.businesses} businesses you booked`,
    link: d.rowId ? `${siteUrl}/events/${d.eventId}/review/${d.rowId}` : `${siteUrl}/events/${d.eventId}`,
    until: longDateWithYear(addDays(d.eventDate, REVIEW_LIMITS.windowDays)),
    account: `${siteUrl}/account#emails`,
  });
}

export async function sendReviewRequests(env: ServerEnv, limit = 20): Promise<{ sent: number; failed: number }> {
  const siteUrl = env.SITE_URL ?? 'https://localites.supportlocalites.workers.dev';
  return withDb(env, async (db) => {
    const due = await db.execute<Due>(sql`
      select notification_id as "notificationId", kind, email, name, event_id as "eventId", event_date::text as "eventDate",
             businesses, row_id as "rowId"
      from review_requests_due(${limit})`);
    if (due.length === 0) return { sent: 0, failed: 0 };
    const result = await sendEmails(
      env,
      due.map((d) => ({ to: d.email, ...requestEmail(d, siteUrl) })),
    );
    const ids = `{${due.map((d) => d.notificationId).join(',')}}`;
    await db.execute(
      result.sent
        ? sql`update notification set status = 'sent', sent_at = now() where id = any(${ids}::uuid[])`
        : sql`update notification set status = 'failed', failure_reason = ${result.reason} where id = any(${ids}::uuid[])`,
    );
    return result.sent ? { sent: due.length, failed: 0 } : { sent: 0, failed: due.length };
  });
}

/** The person's own choice (no row: on). Only ever read or written as that person. */
export async function reviewRequestsOn(env: ServerEnv, userId: string): Promise<boolean> {
  const [row] = await actingAs(env, { side: 'person', userId }, (tx) =>
    tx.execute<{ on: boolean }>(sql`select review_requests as "on" from email_choice where user_id = ${userId}`),
  );
  return row?.on ?? true;
}

export async function setReviewRequests(env: ServerEnv, userId: string, on: boolean): Promise<void> {
  await actingAs(env, { side: 'person', userId }, (tx) =>
    tx.execute(sql`
      insert into email_choice (user_id, review_requests) values (${userId}, ${on})
      on conflict (user_id) do update set review_requests = excluded.review_requests, updated_at = now()`),
  );
}
