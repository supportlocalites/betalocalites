import { data, Link } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { SOURCE_WORDS } from '@/lib/activity';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { dayDetail } from '@/server/admin/activity.server';
import type { Route } from './+types/listing-activity-day';
import styles from './admin.module.css';

/**
 * One business's detail for one day (X18): each action, by browser. Team only; every look
 * is written to the audit log (and shown on the business's activity page).
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Activity detail · Team'), { name: 'robots', content: 'noindex' }];

// Opened on purpose only: not re-read after a form elsewhere, so each look is one record.
export const shouldRevalidate = () => false;

export async function loader({ params, context }: Route.LoaderArgs) {
  if (!isUuid(params.id) || !/^\d{4}-\d{2}-\d{2}$/.test(params.day) || Number.isNaN(Date.parse(params.day))) {
    throw data(null, { status: 404 });
  }
  const { env } = context.get(cloudflareContext);
  const detail = await dayDetail(env, context.get(adminContext), params.id, params.day);
  if (!detail) throw data(null, { status: 404 });
  return { ...detail, day: params.day };
}

const KIND_WORDS: Record<string, string> = {
  profile_view: 'Opened the page',
  website_tap: 'Tapped Visit website',
  phone_tap: 'Tapped Call',
  profile_time: 'Time on the page',
  services_seen: 'Saw the services',
};

export default function ActivityDay({ loaderData: { name, rows, day } }: Route.ComponentProps) {
  return (
    <>
      <p>
        <Link to=".." relative="path" className="text-link">
          ← Activity: {name}
        </Link>
      </p>
      <h1 className="title-1 section-gap">
        {name}: {day}
      </h1>
      <div className="title-rule" aria-hidden="true" />
      <p className="muted">
        Toronto time. “Browser” is the end of the visitor’s browser code, so the same browser can be followed through the day; it isn’t a
        name. This look has been recorded.
      </p>
      {rows.length === 0 ? (
        <p className="muted">Nothing that day.</p>
      ) : (
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="This day’s activity">
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">What</th>
                <th scope="col">Came from</th>
                <th scope="col">Place in list</th>
                <th scope="col">Device</th>
                <th scope="col">Approximate town</th>
                <th scope="col">Browser</th>
                <th scope="col">Linked account</th>
                <th scope="col">Whose visit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.at}</td>
                  <td>
                    {KIND_WORDS[r.kind] ?? r.kind}
                    {r.seconds ? ` (${r.seconds} s)` : ''}
                  </td>
                  <td>{r.source ? (SOURCE_WORDS[r.source] ?? r.source) : ''}</td>
                  <td>{r.place ?? ''}</td>
                  <td>{r.device ?? ''}</td>
                  <td>{r.town ?? ''}</td>
                  <td>{r.browser ?? ''}</td>
                  <td>{r.account ?? ''}</td>
                  <td>{r.viewer === 'public' ? 'Public' : r.viewer === 'owner' ? 'The business (left out)' : 'Team (left out)'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length >= 500 && <p className="muted">Showing the first 500.</p>}
    </>
  );
}
