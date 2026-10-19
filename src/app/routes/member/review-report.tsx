import { data, Form, Link, redirect, useNavigation, useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { Stars } from '@/components/Reviews';
import { SiteHeader } from '@/components/SiteHeader';
import { isUuid, SLUG } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { TOO_FAST } from '@/lib/plan-terms';
import { REVIEW_REPORT_REASONS, REVIEW_REPORT_SENT } from '@/lib/review-terms';
import { found, refusal, siteUrl, tooFast } from '@/server/plan-pages.server';
import { businessReportTarget, personReportTarget, readReviewReport, reportReview } from '@/server/review-reports.server';
import type { Route } from './+types/review-report';
import styles from './member.module.css';

/**
 * Report a published review to the Localites team (Stage 3, part 2; E §4.4). Two addresses,
 * one page: /reviews/<id>/report as the person, and /vendors/<name>/reviews/<id>/report as
 * anyone on the business's team, about its own reviews. The review stays up until the team
 * decides; the author isn't told who reported it.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Report a review'), { name: 'robots', content: 'noindex' }];

function where(params: { id?: string; slug?: string }) {
  if (!params.id || !isUuid(params.id) || (params.slug !== undefined && !SLUG.test(params.slug))) throw data(null, { status: 404 });
  return { id: params.id, slug: params.slug ?? null };
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const { id, slug } = where(params);
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const t = await found(slug ? businessReportTarget(env, member.userId, slug, id) : personReportTarget(env, member.userId, id));
  return { review: t.review, business: t.business, back: slug ? `/vendors/${t.slug}/reviews` : `/vendors/${t.slug}` };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const { id, slug } = where(params);
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const input = readReviewReport(await request.formData());
  if ('error' in input) return data({ error: input.error }, { status: 400 });
  if (await tooFast(env, member.userId)) return data({ error: TOO_FAST }, { status: 429 });
  try {
    const acting = slug
      ? ({
          side: 'business',
          userId: member.userId,
          vendorId: (await businessReportTarget(env, member.userId, slug, id)).vendorId,
        } as const)
      : ({ side: 'person', userId: member.userId } as const);
    await reportReview(env, acting, id, input, siteUrl(env, request));
  } catch (err) {
    const { error, status } = refusal(err);
    return data({ error }, { status });
  }
  return redirect(`${slug ? `/vendors/${slug}` : ''}/reviews/${id}/report?sent=1`);
}

export default function ReviewReport({ loaderData: { review, business, back }, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== 'idle';
  const [params] = useSearchParams();
  const backLink = (
    <p className="section-gap">
      <Link to={back} className="text-link">
        Back to {business}’s reviews
      </Link>
    </p>
  );
  if (params.has('sent')) {
    return (
      <>
        <SiteHeader />
        <main className="page narrow">
          <h1 className="title-1">Reported</h1>
          <div className="title-rule" aria-hidden="true" />
          <p role="status">{REVIEW_REPORT_SENT}</p>
          {backLink}
        </main>
      </>
    );
  }
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">Report a review</h1>
        <div className="title-rule" aria-hidden="true" />
        <p>
          Tell the Localites team what’s wrong with this review of {business}. It stays up until they decide. {review.author} isn’t told who
          reported it.
        </p>
        <blockquote className="notice">
          <p>
            <Stars rating={review.rating} /> {review.author}
          </p>
          <p dir="auto" style={{ whiteSpace: 'pre-wrap' }}>{review.body}</p>
        </blockquote>
        {actionData?.error && (
          <p className="notice" role="alert">
            {actionData.error}
          </p>
        )}
        <Form method="post" noValidate>
          <fieldset className={styles.choices}>
            <legend>What’s wrong?</legend>
            {Object.entries(REVIEW_REPORT_REASONS).map(([value, label]) => (
              <label key={value} className={styles.choice}>
                <input type="radio" name="reason" value={value} required /> {label}
              </label>
            ))}
          </fieldset>
          <div className="field">
            <label htmlFor="details" className="field-label">
              Anything else our team should know (optional)
            </label>
            <textarea id="details" name="details" className="input" maxLength={2000} />
          </div>
          <p className="section-gap">
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? 'Sending…' : 'Send report'}
            </button>
          </p>
        </Form>
        {backLink}
      </main>
    </>
  );
}
