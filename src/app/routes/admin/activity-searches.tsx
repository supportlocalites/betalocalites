import { data, Link } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { pageMeta } from '@/lib/meta';
import { searchesOn } from '@/server/admin/activity.server';
import type { Route } from './+types/activity-searches';
import styles from './admin.module.css';

/**
 * The words people searched on one day (D-30), team only. A search can hold anything, even
 * a name or a phone number, so it's never shown to businesses; every look is recorded.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Searches · Team'), { name: 'robots', content: 'noindex' }];

export const shouldRevalidate = () => false;

export async function loader({ params, context }: Route.LoaderArgs) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.day) || Number.isNaN(Date.parse(params.day))) throw data(null, { status: 404 });
  const { env } = context.get(cloudflareContext);
  return { day: params.day, rows: await searchesOn(env, context.get(adminContext), params.day) };
}

export default function Searches({ loaderData: { day, rows } }: Route.ComponentProps) {
  return (
    <>
      <p>
        <Link to="/admin/activity" className="text-link">
          ← Activity
        </Link>
      </p>
      <h1 className="title-1 section-gap">Searches on {day}</h1>
      <div className="title-rule" aria-hidden="true" />
      <p className="muted">The public’s typed searches, tidied (Toronto day). This look has been recorded.</p>
      {rows.length === 0 ? (
        <p className="muted">No searches that day.</p>
      ) : (
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Searches on this day">
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Words</th>
                <th scope="col">Searches</th>
                <th scope="col">Found nothing</th>
                <th scope="col">Browsers</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.words}>
                  <th scope="row">{r.words}</th>
                  <td>{r.searches}</td>
                  <td>{r.foundNothing}</td>
                  <td>{r.browsers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
