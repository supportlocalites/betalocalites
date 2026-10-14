import { data, Form, Link, redirect, useNavigation, useParams, useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { longDateWithYear, TOO_FAST } from '@/lib/plan-terms';
import { REVIEW_LIMITS, REVIEW_PROMISE, STAR_WORDS } from '@/lib/review-terms';
import { found, refusal, siteUrl, tooFast } from '@/server/plan-pages.server';
import { readReview, reviewForm, saveReview } from '@/server/reviews.server';
import type { Route } from './+types/review';
import styles from './review.module.css';

/**
 * Screen C11: reviewing a business booked for one of the person's events (Stage 3; D-06,
 * D-48). Only the host, only for a business they marked booked, once the event has happened,
 * within 60 days (the database checks every rule). The review waits for the Localites team;
 * it can be changed until then.
 */
export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta(loaderData ? `Review ${loaderData.form.business.name}` : 'Review'),
  { name: 'robots', content: 'noindex' },
];

export async function loader({ params, context }: Route.LoaderArgs) {
  if (!isUuid(params.id) || !isUuid(params.rowId)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  return { form: await found(reviewForm(context.get(cloudflareContext).env, member.userId, params.id, params.rowId)) };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  if (!isUuid(params.id) || !isUuid(params.rowId)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  if (await tooFast(env, member.userId)) return data({ error: TOO_FAST }, { status: 429 });
  const read = readReview(await request.formData());
  if ('error' in read) return data({ error: read.error }, { status: 400 });
  try {
    // The booking must belong to this event (and to this person: the database checks that).
    await found(reviewForm(env, member.userId, params.id, params.rowId));
    const saved = await saveReview(env, member.userId, params.rowId, read, siteUrl(env, request));
    return redirect(`/events/${params.id}/review/${params.rowId}?${saved.created ? 'sent' : 'changed'}=1`);
  } catch (err) {
    const { error, status } = refusal(err);
    return data({ error }, { status });
  }
}

const CANT: Record<string, string> = {
  not_booked: 'A business can be reviewed once it’s marked booked for an event that went ahead.',
  not_yet: 'You can review this business once your event has happened.',
  closed: 'The 60 days to review this booking have passed.',
  flagged: 'The business says it wasn’t booked for this event. Our team will look at it; you can review it if they confirm it was.',
  own: 'You can’t review your own business.',
  unlisted: 'This business isn’t listed on Localites at the moment.',
};

export default function Review({ loaderData: { form }, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== 'idle';
  const [params] = useSearchParams();
  const eventId = useParams().id ?? '';
  const { business, event, review, can } = form;
  const editable = review ? review.status === 'pending' : can === 'yes';
  const back = (
    <p className="section-gap">
      <Link to={`/events/${eventId}`} className="text-link">
        ← Back to {event.name}
      </Link>
    </p>
  );
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <p className="label">
          {event.name} · {longDateWithYear(event.date)}
        </p>
        <h1 className="title-1">Review {business.name}</h1>
        <div className="title-rule" aria-hidden="true" />
        {params.has('sent') && (
          <p className="notice" role="status">
            Thank you. Our team will read your review, and we’ll email you when it’s published.
          </p>
        )}
        {params.has('changed') && (
          <p className="notice" role="status">
            Your changes are saved. Our team hasn’t looked at it yet.
          </p>
        )}
        {actionData?.error && (
          <p className="notice" role="alert">
            {actionData.error}
          </p>
        )}

        {review?.status === 'published' && (
          <>
            <p>
              Your review is published on{' '}
              {business.listed ? (
                <Link to={`/vendors/${business.slug}`} className="text-link">
                  {business.name}’s page
                </Link>
              ) : (
                `${business.name}’s page`
              )}
              .
            </p>
            <p className={styles.stars} aria-label={`${review.rating} out of 5 stars`}>
              {'★'.repeat(review.rating)}
              {'☆'.repeat(5 - review.rating)}
            </p>
            <p className={styles.body}>{review.body}</p>
            {review.reply && (
              <div className={styles.reply}>
                <span className="label">{business.name} replied</span>
                <p className={styles.body}>{review.reply}</p>
              </div>
            )}
          </>
        )}
        {(review?.status === 'declined' || review?.status === 'removed') && (
          <p className="notice" role="status">
            {review.status === 'declined' ? 'Our team didn’t publish your review' : 'Our team removed your review'}
            {review.reason ? `, because: ${review.reason}` : '.'} If you have questions, email supportlocalites@gmail.com.
          </p>
        )}
        {!review && can !== 'yes' && <p>{CANT[can]}</p>}

        {editable && (
          <Form method="post" className={styles.form}>
            {review && <p className="muted">Waiting for our team. You can change it until they’ve looked at it.</p>}
            <fieldset className={styles.starField}>
              <legend className="field-label">How was {business.name}?</legend>
              <div className={styles.starChoices}>
                {[5, 4, 3, 2, 1].map((n) => (
                  <label key={n} className={styles.starChoice}>
                    <input type="radio" name="rating" value={n} defaultChecked={review?.rating === n} required />
                    <span aria-hidden="true">{'★'.repeat(n)}</span> {STAR_WORDS[n]}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="field">
              <label htmlFor="body" className="field-label">
                Your review
              </label>
              <p className="field-hint" id="body-hint">
                What went well, and what could have been better. Please don’t include phone numbers, addresses or anything private.
              </p>
              <textarea
                id="body"
                name="body"
                className="input"
                maxLength={REVIEW_LIMITS.body}
                defaultValue={review?.body ?? ''}
                aria-describedby="body-hint"
                required
              />
            </div>
            <p className="muted">{REVIEW_PROMISE}</p>
            <p>
              <button type="submit" className="button button-primary" disabled={busy}>
                {busy ? 'Sending…' : review ? 'Save changes' : 'Send review'}
              </button>
            </p>
            {!review && <p className="muted">You can review until {longDateWithYear(form.until)}.</p>}
          </Form>
        )}
        {back}
      </main>
    </>
  );
}
