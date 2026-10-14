import { Link } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { pageMeta } from '@/lib/meta';
import { PLANNED_ON, PLANNED_OUTSIDE, REVIEW_STATUS } from '@/lib/review-terms';
import { listReviews, type TeamReviewRow } from '@/server/reviews.server';
import type { Route } from './+types/reviews';
import styles from './admin.module.css';

/**
 * Screen X14: reviews (Stage 3; D-06, ADR-026). Every review waits here until the team
 * publishes or declines it; nothing is public before. Then published reviews someone
 * reported (part 2), and the latest decisions.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Reviews · Team'), { name: 'robots', content: 'noindex' }];

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  return listReviews(env, context.get(adminContext));
}

const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' });

function Rows({ rows, label }: { rows: (TeamReviewRow & { reports?: number })[]; label: string }) {
  return (
    <ul className={styles.rows} aria-label={label}>
      {rows.map((r) => (
        <li key={r.id} className={styles.row}>
          <span className={styles.rowName}>
            <Link to={`/admin/reviews/${r.id}`}>
              {r.rating} stars · {r.business}
            </Link>
          </span>
          <span>
            <span className={styles.status}>{REVIEW_STATUS[r.status]}</span> · by {r.author} ·{' '}
            {r.plannedOnLocalites ? PLANNED_ON : PLANNED_OUTSIDE}
            {r.reports ? ` · ${r.reports} open ${r.reports === 1 ? 'report' : 'reports'}` : ''}
          </span>
          <span className="muted">{when.format(new Date(r.createdAt))}</span>
        </li>
      ))}
    </ul>
  );
}

export default function Reviews({ loaderData: { waiting, reported, recent } }: Route.ComponentProps) {
  return (
    <>
      <h1 className="title-1">Reviews</h1>
      <div className="title-rule" aria-hidden="true" />
      <p className="notice">
        Every review waits here until you publish or decline it. Nothing is shown to anyone, the business included, before. Localites never
        changes what people wrote.
      </p>
      <h2 className="title-3 section-gap">Waiting ({waiting.length})</h2>
      {waiting.length === 0 ? <p className="muted">Nothing waiting.</p> : <Rows rows={waiting} label="Waiting reviews" />}
      <h2 className="title-3 section-gap">Reported ({reported.length})</h2>
      {reported.length === 0 ? <p className="muted">No open reports.</p> : <Rows rows={reported} label="Reported reviews" />}
      <h2 className="title-3 section-gap">Decided lately</h2>
      {recent.length === 0 ? <p className="muted">None yet.</p> : <Rows rows={recent} label="Decided reviews" />}
    </>
  );
}
