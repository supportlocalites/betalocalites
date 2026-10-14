import { Link } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { pageMeta } from '@/lib/meta';
import { listInquiries } from '@/server/inquiries.server';
import type { Route } from './+types/inquiries';
import styles from './admin.module.css';

/**
 * Screen X14: inquiries (ADR-024, D-04, D-05): people interested in a business that isn't on
 * Localites yet. Use them to invite the business to claim its listing; don't relay messages.
 * Every look is recorded (E §4).
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Inquiries · Team'), { name: 'robots', content: 'noindex' }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const show = new URL(request.url).searchParams.get('show') === 'all' ? 'all' : 'waiting';
  const { env } = context.get(cloudflareContext);
  return { show, inquiries: await listInquiries(env, context.get(adminContext), show) } as const;
}

const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' });
/** The "it joined" email's real outcome (a failed one: email the person yourself). */
const JOINED_WORDS = { sent: 'sent', queued: 'on its way', failed: 'failed: email them yourself', suppressed: 'not sent' } as const;
const EMAIL_WORDS = { sent: 'Emailed to the team', pending: 'Email on its way', failed: 'Email to the team failed' } as const;

export default function Inquiries({ loaderData: { show, inquiries } }: Route.ComponentProps) {
  return (
    <>
      <h1 className="title-1">Inquiries</h1>
      <div className="title-rule" aria-hidden="true" />
      <p className="notice">
        People interested in a business that isn’t on Localites yet. The business hasn’t been sent anything: invite it to claim its listing
        (claiming is free), so people can contact it directly. Please don’t pass messages back and forth. When its claim is approved,
        everyone who asked is emailed that it joined.
      </p>
      <p className="muted">Each time this page is opened, it’s recorded in the audit log.</p>
      <p>
        {show === 'all' ? (
          <Link to="/admin/inquiries" className="text-link">
            Only businesses not on Localites yet
          </Link>
        ) : (
          <Link to="/admin/inquiries?show=all" className="text-link">
            All inquiries, including businesses that joined
          </Link>
        )}
      </p>
      {inquiries.length === 0 ? (
        <p className="muted">No inquiries{show === 'all' ? '' : ' waiting'}.</p>
      ) : (
        <ul className={styles.rows} aria-label="Inquiries">
          {inquiries.map((q) => (
            <li key={q.id} className={styles.row}>
              <span className={styles.rowName}>
                <Link to={`/admin/listings/${q.vendorId}`}>{q.business}</Link>
              </span>
              <span>
                <span className={styles.status}>{q.claimed ? 'Joined Localites' : 'Not on Localites yet'}</span>
                {!q.listed && (
                  <>
                    {' · '}
                    <span className={styles.status}>Not listed</span>
                  </>
                )}
              </span>
              <span>
                From {q.person} (<a href={`mailto:${q.personEmail}`}>{q.personEmail}</a>) · {when.format(new Date(q.createdAt))}
              </span>
              <span>Note: {q.note ?? <span className="muted">none</span>}</span>
              <span>Event: {q.sharedEvent ?? <span className="muted">none mentioned</span>}</span>
              <span className="muted">
                {EMAIL_WORDS[q.emailStatus]}
                {q.emailStatus === 'failed' && q.emailError ? ` (${q.emailError})` : ''}
                {q.joinedToldAt && q.joinedEmail ? ` · “It joined” email ${JOINED_WORDS[q.joinedEmail]}, ${when.format(new Date(q.joinedToldAt))}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
