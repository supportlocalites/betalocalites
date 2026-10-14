import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { longDateWithYear } from '@/lib/plan-terms';
import { PLANNED_ON, PLANNED_OUTSIDE, REVIEW_LIMITS, REVIEW_STATUS } from '@/lib/review-terms';
import { PlanRefused } from '@/server/acting.server';
import { afterwards, found, siteUrl } from '@/server/plan-pages.server';
import { decideReview, emailAboutDecision, type ReviewDecision, teamReview } from '@/server/reviews.server';
import type { Route } from './+types/review';
import styles from './admin.module.css';

/**
 * One review (X14): publish or decline it while it waits (a reason for declining, which the
 * author is told); remove a published review, or the business's reply, for breaking the
 * rules (with a reason). Never edit it. Every decision is in audit_log.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Review · Team'), { name: 'robots', content: 'noindex' }];

export async function loader({ params, context }: Route.LoaderArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const { env } = context.get(cloudflareContext);
  return { review: await found(teamReview(env, context.get(adminContext), params.id)) };
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
  let decision: ReviewDecision;
  if (intent === 'publish') decision = { kind: 'publish' };
  else if (intent === 'decline' || intent === 'remove' || intent === 'remove_reply') {
    if (!reason) return data({ error: 'Say why, in a few words. The author is told when a review is declined.' }, { status: 400 });
    decision = { kind: intent, reason };
  } else throw data(null, { status: 400 });
  try {
    const { notify } = await found(decideReview(env, admin, params.id, decision));
    if (notify) afterwards(ctx, emailAboutDecision(env, admin, params.id, notify, siteUrl(env, request)), 'review decision email');
  } catch (err) {
    if (err instanceof PlanRefused) return data({ error: err.message }, { status: 409 });
    throw err;
  }
  return redirect(`/admin/reviews/${params.id}`);
}

export default function TeamReviewPage({ loaderData: { review }, actionData }: Route.ComponentProps) {
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
      {review.emailStatus === 'failed' && <p className="muted">The email telling the team about this review didn’t go.</p>}
      <blockquote className={styles.section}>
        <p style={{ whiteSpace: 'pre-wrap' }}>{review.body}</p>
      </blockquote>
      {review.reason && <p className="muted">Reason given: “{review.reason}”</p>}
      {review.reply && (
        <section className={styles.section} aria-labelledby="reply">
          <h2 id="reply">{review.business} replied</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{review.reply}</p>
          {review.replyRemoved && <p className="muted">Removed by the team.</p>}
        </section>
      )}
      {actionData?.error && (
        <p className="notice" role="alert">
          {actionData.error}
        </p>
      )}

      {review.status === 'pending' && (
        <section className={styles.section} aria-labelledby="decide">
          <h2 id="decide">Decide</h2>
          <Form method="post">
            <input type="hidden" name="intent" value="publish" />
            <button type="submit" className="button button-primary" disabled={busy}>
              Publish
            </button>
          </Form>
          <Form method="post" className={styles.statusPanel}>
            <div className={`field ${styles.reasonField}`}>
              <label htmlFor="reason" className="field-label">
                Or decline it: why (the author is told)
              </label>
              <input id="reason" name="reason" className="input" maxLength={REVIEW_LIMITS.reason} required />
            </div>
            <button type="submit" name="intent" value="decline" className="button button-secondary" disabled={busy}>
              Decline
            </button>
          </Form>
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
