import { Link } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { REPORT_REASONS } from '@/lib/message-terms';
import { pageMeta } from '@/lib/meta';
import { listReports } from '@/server/reports.server';
import type { Route } from './+types/reports';
import styles from './admin.module.css';

/**
 * Screen X13: reports of conversations and messages (Stage 2B part 2, E §4.3). The list shows
 * who reported what and why, never the messages: those are read on a report's own page, and
 * each look is recorded with the report.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Reports · Team'), { name: 'robots', content: 'noindex' }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const show = new URL(request.url).searchParams.get('show') === 'all' ? 'all' : 'open';
  const { env } = context.get(cloudflareContext);
  return { show, reports: await listReports(env, context.get(adminContext), show) } as const;
}

const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' });
const STATUS = { open: 'Open', actioned: 'Dealt with', dismissed: 'Dismissed' } as const;

export default function Reports({ loaderData: { show, reports } }: Route.ComponentProps) {
  return (
    <>
      <h1 className="title-1">Reports</h1>
      <div className="title-rule" aria-hidden="true" />
      <p className="notice">
        People and businesses reporting a conversation, or a message in it. Open a report to read the conversation (each time is recorded),
        then hide the message, block the conversation, or dismiss it, with a note.
      </p>
      <p>
        {show === 'all' ? (
          <Link to="/admin/reports" className="text-link">
            Only open reports
          </Link>
        ) : (
          <Link to="/admin/reports?show=all" className="text-link">
            All reports
          </Link>
        )}
      </p>
      {reports.length === 0 ? (
        <p className="muted">No {show === 'open' ? 'open ' : ''}reports.</p>
      ) : (
        <ul className={styles.rows} aria-label="Reports">
          {reports.map((r) => (
            <li key={r.id} className={styles.row}>
              <span className={styles.rowName}>
                <Link to={`/admin/reports/${r.id}`}>{REPORT_REASONS[r.reason]}</Link>
              </span>
              <span>
                <span className={styles.status}>{STATUS[r.status]}</span> · {r.aboutMessage ? 'A message' : 'The conversation'} between{' '}
                {r.person} and {r.business}
              </span>
              <span className="muted">
                Reported by {r.reporter} ({r.reporterSide === 'consumer' ? 'the customer' : 'the business'}) ·{' '}
                {when.format(new Date(r.createdAt))}
              </span>
              {r.details && <span>“{r.details}”</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
