import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { longDateWithYear } from '@/lib/plan-terms';
import {
  PLANNED_ON,
  PLANNED_OUTSIDE,
  REPORT_REASON_WORDS,
  REVIEW_LIMITS,
  REVIEW_STATUS,
} from '@/lib/review-terms';
import { PlanRefused } from '@/server/acting.server';
import { afterwards, found, siteUrl } from '@/server/plan-pages.server';
import { decideReview, emailAboutDecision, emailReportOutcomes, type ReviewDecision, teamReview } from '@/server/reviews.server';
import type { Route } from './+types/review';
import styles from './admin.module.css';

/**
 * One review (X14): approve or deny it while it waits, opened from the team's email with the
 * choice made (?choose=approve or deny), one button to confirm; denying needs no reason and
 * its author is never told (D-51). Remove a published review, or the business's reply, for
 * breaking the rules (with a reason); read its reports and close them, keeping the review
 * (part 2). Never edit it. Every decision is in audit_log.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Review · Team'), { name: 'robots', content: 'noindex' }];

/** What a denied review records (the database keeps a reason for every decline); only the team sees it. */
const DENIED = 'Denied by the team';

export async function loader({ params, request, context }: Route.LoaderArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const { env } = context.get(cloudflareContext);
  const choose = new URL(request.url).searchParams.get('choose');
  return {
    review: await found(teamReview(env, context.get(adminContext), params.id)),
    choose: choose === 'approve' || choose === 'deny' ? choose : null,
  };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const { env, ctx } = context.get(cloudflareContext);
  const admin = context.get(adminContext);
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  const reason = String(form.get('reason') ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, REVIEW_LIMITS.reason);
  // When the words the team read last changed (the database's own time, as text).
  const seen = String(form.get('seen') ?? '');
  const deciding = intent === 'publish' || intent === 'decline';
  if (deciding && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}(:\d{2})?$/.test(seen)) throw data(null, { status: 400 });
  let decision: ReviewDecision;
  if (intent === 'publish') decision = { kind: 'publish', seen };
  else if (intent === 'release_reply') decision = { kind: 'release_reply' };
  else if (intent === 'decline') decision = { kind: 'decline', reason: reason || DENIED, seen };
  else if (intent === 'remove' || intent === 'remove_reply' || intent === 'dismiss_reports') {
    if (!reason) return data({ error: 'Say why, in a few words.' }, { status: 400 });
    decision = { kind: intent, reason };
  } else throw data(null, { status: 400 });
  try {
    const { notify, closed } = await found(decideReview(env, admin, params.id, decision));
    if (notify) afterwards(ctx, emailAboutDecision(env, admin, params.id, notify, siteUrl(env, request)), 'review decision email');
    if (closed) afterwards(ctx, emailReportOutcomes(env, params.id, closed), 'report outcome email');
  } catch (err) {
    if (err instanceof PlanRefused) return data({ error: err.message }, { status: 409 });
    throw err;
  }
  return redirect(`/admin/reviews/${params.id}`);
}

const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' });

/** How long between two times, roughly, in words. */
function gap(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 120) return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hours`;
  return `${Math.round(hours / 24)} days`;
}

/**
 * When the booking behind the review was marked (M9, D-54): a booking marked minutes before
 * its review, or only after the event, is worth a second look.
 */
function BookingTiming({ bookedAt, after, reviewedAt }: { bookedAt: string; after: boolean; reviewedAt: string }) {
  const before = new Date(reviewedAt).getTime() - new Date(bookedAt).getTime();
  // Written before the latest marking: it came back when the booking was marked again (0046).
  if (before < 0) {
    return (
      <p className="muted">
        Written before the booking’s latest marking ({when.format(new Date(bookedAt))}): it came back as written when the business
        was marked booked again.
      </p>
    );
  }
  return (
    <p className={after || before < 24 * 3600000 ? 'notice' : 'muted'}>
      Marked booked {when.format(new Date(bookedAt))}, {gap(before)} before this review was written
      {after ? ', and only after the event (reviews opened 24 hours after the marking).' : '.'}
    </p>
  );
}
const REPORT_STATUS = { open: 'Open', actioned: 'Review removed', dismissed: 'Closed, review kept' } as const;

export default function TeamReviewPage({ loaderData: { review, choose }, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state === 'submitting';
  return (
    <>
      <Link to="/admin/reviews" className="text-link">
        ← All reviews
      </Link>
      <h1 className="title-1 section-gap">
        {review.rating} stars · {review.business}
      </h1>
      <div className="title-rule" aria-hidden="true" />
      <p>
        <span className={styles.status}>{REVIEW_STATUS[review.status]}</span> · by {review.author} (shown as “{review.shownAs}”) · event on{' '}
        {longDateWithYear(review.eventDate)} · {review.plannedOnLocalites ? PLANNED_ON : PLANNED_OUTSIDE}
      </p>
      {review.flagged && (
        <p className="notice">
          The business says it wasn’t booked for this event, and the team hasn’t said the booking stands. Decide on{' '}
          <Link to="/admin/booking-flags">Booking flags</Link>.
        </p>
      )}
      {review.bookedAt && <BookingTiming bookedAt={review.bookedAt} after={review.bookedAfterEvent} reviewedAt={review.createdAt} />}
      {review.emailStatus === 'failed' && <p className="muted">The email telling the team about this review didn’t go.</p>}
      {review.languageFlag && <p className="notice">{`The language check found something to look at: ${review.languageFlag}`}</p>}
      <blockquote className={styles.section}>
        <p dir="auto" style={{ whiteSpace: 'pre-wrap' }}>{review.body}</p>
      </blockquote>
      {review.reason && <p className="muted">Reason given: “{review.reason}”</p>}
      {review.reply && (
        <section className={styles.section} aria-labelledby="reply">
          <h2 id="reply">{review.business} replied</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{review.reply}</p>
          {review.replyRemoved && <p className="muted">Removed by the team.</p>}
          {review.replyHeld && (
            <>
              <p className="notice">{`Held by the language check, not shown yet: ${review.replyHeldReason ?? ''}`}</p>
              <Form method="post" className={styles.buttons}>
                <button type="submit" name="intent" value="release_reply" className="button" disabled={busy}>
                  Put the reply live
                </button>
              </Form>
              <p className="muted">Or remove it below, with a reason.</p>
            </>
          )}
        </section>
      )}
      {actionData?.error && (
        <p className="notice" role="alert">
          {actionData.error}
        </p>
      )}

      {review.status === 'pending' && (
        <section className={styles.section} aria-labelledby="decide">
          <h2 id="decide">{choose === 'approve' ? 'Approve this review?' : choose === 'deny' ? 'Deny this review?' : 'Decide'}</h2>
          <p className="muted">
            Approved, it’s published on the business’s page and its author is emailed. Denied, it isn’t published, and its author isn’t
            told or shown anything.
          </p>
          <div className={styles.buttons}>
            {choose !== 'deny' && (
              <Form method="post">
                <input type="hidden" name="intent" value="publish" />
                <input type="hidden" name="seen" value={review.seen} />
                <button type="submit" className="button button-primary" disabled={busy}>
                  Approve
                </button>
              </Form>
            )}
            {choose !== 'approve' && (
              <Form method="post">
                <input type="hidden" name="intent" value="decline" />
                <input type="hidden" name="seen" value={review.seen} />
                <button type="submit" className={choose === 'deny' ? 'button button-primary' : 'button button-secondary'} disabled={busy}>
                  Deny
                </button>
              </Form>
            )}
          </div>
          {choose && (
            <p>
              <Link to={`/admin/reviews/${review.id}`} className="text-link">
                {choose === 'approve' ? 'Or deny it instead' : 'Or approve it instead'}
              </Link>
            </p>
          )}
        </section>
      )}
      {review.reports.length > 0 && (
        <section className={styles.section} aria-labelledby="reports">
          <h2 id="reports">Reports</h2>
          <ul className={styles.rows}>
            {review.reports.map((x) => (
              <li key={x.id} className={styles.row}>
                <span>
                  <span className={styles.status}>{REPORT_STATUS[x.status]}</span> ·{' '}
                  {REPORT_REASON_WORDS[x.reason as keyof typeof REPORT_REASON_WORDS] ?? x.reason}
                </span>
                <span className="muted">
                  By {x.reporter} ({x.side === 'vendor' ? 'the business' : 'a person'}) · {when.format(new Date(x.createdAt))}
                </span>
                {x.details && <span style={{ whiteSpace: 'pre-wrap' }}>“{x.details}”</span>}
                {x.note && <span className="muted">Decided: {x.note}</span>}
              </li>
            ))}
          </ul>
          {review.status === 'published' && review.reports.some((x) => x.status === 'open') && (
            <Form method="post" className={styles.statusPanel}>
              <div className={`field ${styles.reasonField}`}>
                <label htmlFor="dismiss-reason" className="field-label">
                  It doesn’t break the rules: why (kept with the reports)
                </label>
                <input id="dismiss-reason" name="reason" className="input" maxLength={REVIEW_LIMITS.reason} required />
              </div>
              <button type="submit" name="intent" value="dismiss_reports" className="button button-secondary" disabled={busy}>
                Keep the review, close the reports
              </button>
            </Form>
          )}
        </section>
      )}
      {review.status === 'published' && (
        <section className={styles.section} aria-labelledby="remove">
          <h2 id="remove">If it breaks the rules</h2>
          <Form method="post" className={styles.statusPanel}>
            <div className={`field ${styles.reasonField}`}>
              <label htmlFor="reason" className="field-label">
                Why (kept with the review)
              </label>
              <input id="reason" name="reason" className="input" maxLength={REVIEW_LIMITS.reason} required />
            </div>
            <button type="submit" name="intent" value="remove" className="button button-secondary" disabled={busy}>
              Remove the review
            </button>
            {review.reply && !review.replyRemoved && (
              <button type="submit" name="intent" value="remove_reply" className="button button-secondary" disabled={busy}>
                Remove the business’s reply
              </button>
            )}
          </Form>
        </section>
      )}
    </>
  );
}
