import { LIVING_LOCAL, LIVING_LOCAL_HINT, PLANNED_ON, PLANNED_OUTSIDE } from '@/lib/review-terms';
import styles from './Reviews.module.css';

/**
 * A business's published reviews (Stage 3; D-06, D-48): the rating (the average only from 3
 * reviews), then each review with its author as "Sarah M.", the Living Local badge for the top
 * 1% of reviewers, the month of the event, whether it was planned on Localites, and the
 * business's one reply. children: what goes under each review (the business's reply form).
 */

export type ShownReview = {
  id: string;
  rating: number;
  body: string;
  author: string;
  livingLocal: boolean;
  eventMonth: string;
  plannedOnLocalites: boolean;
  reply: string | null;
};

const month = new Intl.DateTimeFormat('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function Stars({ rating }: { rating: number }) {
  return (
    <span className={styles.stars} role="img" aria-label={`${rating} out of 5 stars`}>
      {'★'.repeat(Math.round(rating))}
      <span className={styles.starsOff}>{'★'.repeat(5 - Math.round(rating))}</span>
    </span>
  );
}

export function ReviewList({
  businessName,
  count,
  average,
  reviews,
  after,
}: {
  businessName: string;
  count: number;
  average: number | null;
  reviews: ShownReview[];
  after?: (review: ShownReview) => React.ReactNode;
}) {
  return (
    <>
      <p className={styles.summary}>
        {count === 0 ? (
          'No reviews yet.'
        ) : average !== null ? (
          <>
            <Stars rating={average} /> <strong>{average.toFixed(1)}</strong> from {count} reviews
          </>
        ) : (
          `${count} ${count === 1 ? 'review' : 'reviews'} (the average shows from 3)`
        )}
      </p>
      <ol className={styles.list}>
        {reviews.map((r) => (
          <li key={r.id} className={styles.review}>
            <div className={styles.head}>
              <Stars rating={r.rating} />
              <span className={styles.author}>{r.author}</span>
              {r.livingLocal && (
                <span className={styles.badge} title={LIVING_LOCAL_HINT}>
                  {LIVING_LOCAL}
                </span>
              )}
            </div>
            <span className={styles.meta}>
              Event in {month.format(new Date(`${r.eventMonth}T00:00:00Z`))} · {r.plannedOnLocalites ? PLANNED_ON : PLANNED_OUTSIDE}
            </span>
            <p className={styles.body}>{r.body}</p>
            {r.reply && (
              <div className={styles.reply}>
                <span className="label">{businessName} replied</span>
                <p className={styles.body}>{r.reply}</p>
              </div>
            )}
            {after?.(r)}
          </li>
        ))}
      </ol>
    </>
  );
}
