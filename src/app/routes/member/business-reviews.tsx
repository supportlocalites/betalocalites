import { data, Form, Link, redirect, useNavigation, useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { ReportLink, ReviewList } from '@/components/Reviews';
import { SiteHeader } from '@/components/SiteHeader';
import { isUuid, SLUG } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { TOO_FAST } from '@/lib/plan-terms';
import { REVIEW_LIMITS } from '@/lib/review-terms';
import { found, refusal, siteUrl, tooFast } from '@/server/plan-pages.server';
import { businessReviews, readReply, replyToReview } from '@/server/reviews.server';
import type { Route } from './+types/business-reviews';

/**
 * Screen V8: a business's published reviews (Stage 3; D-06). Anyone on its team reads them;
 * the owner or a manager replies once to each, publicly. Reviews waiting for the Localites
 * team aren't shown to the business. A reply the language check flags waits for the team (D-50).
 */
export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta(loaderData ? `Reviews · ${loaderData.business.name}` : 'Reviews'),
  { name: 'robots', content: 'noindex' },
];

export async function loader({ params, context }: Route.LoaderArgs) {
  if (!SLUG.test(params.slug)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  return found(businessReviews(context.get(cloudflareContext).env, member.userId, params.slug));
}

export async function action({ request, params, context }: Route.ActionArgs) {
  if (!SLUG.test(params.slug)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const reviewId = String(form.get('reviewId') ?? '');
  if (!isUuid(reviewId)) throw data(null, { status: 400 });
  if (await tooFast(env, member.userId)) return data({ error: TOO_FAST, reviewId }, { status: 429 });
  const read = readReply(form);
  if ('error' in read) return data({ error: read.error, reviewId }, { status: 400 });
  try {
    const { held } = await replyToReview(env, member.userId, params.slug, reviewId, read.reply, siteUrl(env, request));
    return redirect(`/vendors/${params.slug}/reviews?${held ? 'held' : 'replied'}=1`);
  } catch (err) {
    const { error, status } = refusal(err);
    return data({ error, reviewId }, { status });
  }
}

export default function BusinessReviews({ loaderData, actionData }: Route.ComponentProps) {
  const { business, count, average, reviews } = loaderData;
  const busy = useNavigation().state !== 'idle';
  const [params] = useSearchParams();
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <p>
          <Link to="/business" className="text-link">
            ← My business
          </Link>
        </p>
        <p className="label">{business.name}</p>
        <h1 className="title-1">Reviews</h1>
        <div className="title-rule" aria-hidden="true" />
        {params.has('replied') && (
          <p className="notice" role="status">
            Your reply is on your page, under the review.
          </p>
        )}
        {params.has('held') && (
          <p className="notice" role="status">
            Thanks. Our team is checking a few words in your reply before it shows on your page.
          </p>
        )}
        <p className="muted">
          These are on your public page. Our team reads every review before it’s published.
          {business.role === 'staff' ? ' The owner or a manager can reply.' : ' You can reply to each review once, publicly.'}
        </p>
        <ReviewList
          businessName={business.name}
          count={count}
          average={average}
          reviews={reviews}
          after={(r) => {
            const review = reviews.find((x) => x.id === r.id);
            const report = <ReportLink to={`/vendors/${business.slug}/reviews/${r.id}/report`} />;
            if (review?.replyHeld) {
              return (
                <>
                  {report}
                  <p className="muted">{`Your reply, waiting for our team to check some words: “${review.replyHeld}”`}</p>
                </>
              );
            }
            if (!review?.canReply) return report;
            return (
              <>
                {report}
                <Form method="post">
                  <input type="hidden" name="reviewId" value={r.id} />
                  <div className="field">
                    <label htmlFor={`reply-${r.id}`} className="field-label">
                      Reply publicly (once)
                    </label>
                    {actionData?.reviewId === r.id && actionData.error && (
                      <p className="field-error" role="alert">
                        {actionData.error}
                      </p>
                    )}
                    <textarea id={`reply-${r.id}`} name="reply" className="input" maxLength={REVIEW_LIMITS.reply} required />
                  </div>
                  <p>
                    <button type="submit" className="button button-secondary" disabled={busy}>
                      Reply
                    </button>
                  </p>
                </Form>
              </>
            );
          }}
        />
        <p className="section-gap">
          <Link to={`/vendors/${business.slug}`} className="text-link">
            See your public page
          </Link>
        </p>
      </main>
    </>
  );
}
