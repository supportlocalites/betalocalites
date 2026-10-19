import { sql } from 'drizzle-orm';
import { REPORT_REASON_WORDS, REVIEW_REFUSALS, REVIEW_REPORT_REASONS, type ReviewReportReason } from '@/lib/review-terms';
import { type Acting, actingAs, errorCode, PlanNotFound, PlanRefused } from './acting.server';
import type { Db } from './db.server';
import { sendEmail, TEAM_ADDRESS } from './email.server';
import { renderEmail } from './email-templates.server';
import type { ServerEnv } from './env';
import { asTeam } from './messages.server';
import { type PublicReview, reviewed } from './reviews.server';

/**
 * Reporting a published review (Stage 3, part 2; E §4.4; migration 0032). Anyone signed in
 * reports as themselves (/reviews/<id>/report); anyone on a business's team reports its own
 * reviews (/vendors/<name>/reviews/<id>/report). The database decides who may (not your own
 * review, once while it's open, 10 a day); the team is emailed once per review, at most 20
 * a day, and decides on Admin → Reviews.
 */

export type ReportTarget = { review: PublicReview; business: string; slug: string; vendorId: string };

/** The published review being reported, as the public sees it ("not found" otherwise). */
async function target(acting: Acting, tx: Db, reviewId: string): Promise<ReportTarget> {
  const [row] = await tx.execute<PublicReview & { business: string; slug: string; vendorId: string }>(sql`
    select p.id, p.rating, p.body, p.author, p.living_local as "livingLocal", p.event_month::text as "eventMonth",
           p.planned_on_localites as "plannedOnLocalites", p.reply, v.display_name as business, v.slug::text as slug, v.id as "vendorId"
    from review_reportable(${reviewId}::uuid) t
      join vendor v on v.id = t.vendor_id
      cross join lateral published_reviews(t.vendor_id, 1000) p
    where p.id = ${reviewId}`);
  if (!row) throw new PlanNotFound();
  if (acting.side === 'business' && row.vendorId !== acting.vendorId) throw new PlanNotFound();
  const { business, slug, vendorId, ...review } = row;
  return { review, business, slug, vendorId };
}

export function personReportTarget(env: ServerEnv, userId: string, reviewId: string): Promise<ReportTarget> {
  const acting = { side: 'person', userId } as const;
  return reviewed(actingAs(env, acting, (tx) => target(acting, tx, reviewId)));
}

export function businessReportTarget(env: ServerEnv, userId: string, slug: string, reviewId: string): Promise<ReportTarget> {
  return reviewed(asTeam(env, userId, slug, (tx, b) => target({ side: 'business', userId, vendorId: b.id }, tx, reviewId)));
}

/**
 * Records the report as the reporter, then emails the team when the database says to. Its
 * author asking for their own published review to be removed is a report too ('author_request',
 * M4, D-54): the database lets only them send it.
 */
export async function reportReview(
  env: ServerEnv,
  acting: Extract<Acting, { side: 'person' } | { side: 'business' }>,
  reviewId: string,
  input: { reason: ReviewReportReason | 'author_request'; details: string | null },
  siteUrl: string,
): Promise<void> {
  const made = await reviewed(
    actingAs(env, acting, async (tx) => {
      const t = await target(acting, tx, reviewId);
      const [row] = await tx
        .execute<{ id: string; email: string }>(
          sql`
          insert into review_report (review_id, reporter_user_id, reporter_side, reason, details)
          values (${reviewId}, ${acting.userId}, ${acting.side === 'person' ? 'consumer' : 'vendor'}, ${input.reason}, ${input.details})
          returning id, team_email_status as email`,
        )
        .catch((err: unknown) => {
          // Two reports sent at once: the second is "already reported".
          throw errorCode(err) === '23505' ? new PlanRefused(REVIEW_REFUSALS.LP159) : err;
        });
      return { ...row!, business: t.business };
    }),
  );
  if (made.email !== 'pending') return;
  const result = await sendEmail(env, {
    to: TEAM_ADDRESS,
    ...renderEmail('reviewReported', {
      business: made.business,
      reason: REPORT_REASON_WORDS[input.reason],
      reviewUrl: `${siteUrl}/admin/reviews/${reviewId}`,
    }),
  });
  await actingAs(env, acting, (tx) =>
    tx.execute(sql`update review_report set team_email_status = ${result.sent ? 'sent' : 'failed'} where id = ${made.id}`),
  ).catch((err: unknown) => console.error('review report email outcome not recorded', err instanceof Error ? err.message : err));
}

export function readReviewReport(form: FormData): { reason: ReviewReportReason; details: string | null } | { error: string } {
  const reason = String(form.get('reason') ?? '');
  if (!Object.hasOwn(REVIEW_REPORT_REASONS, reason)) return { error: 'Choose a reason.' };
  const details = String(form.get('details') ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (details.length > 2000) return { error: 'Please keep it under 2,000 characters.' };
  return { reason: reason as ReviewReportReason, details: details || null };
}
