import { Link } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { pageMeta } from '@/lib/meta';
import { guestsWords, longDate } from '@/lib/plan-terms';
import { bookingFlags } from '@/server/admin/booking-flags.server';
import type { Route } from './+types/booking-flags';
import styles from './admin.module.css';

/**
 * Screen X16, read-only for now (D-41): businesses that said a booking marked by a customer
 * isn't right. Deciding on them comes in Stage 3. Every look is recorded (E §4.2).
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Booking flags · Team'), { name: 'robots', content: 'noindex' }];

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  return { flags: await bookingFlags(env, context.get(adminContext)) };
}

const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' });

export default function BookingFlags({ loaderData: { flags } }: Route.ComponentProps) {
  return (
    <>
      <h1 className="title-1">Booking flags</h1>
      <div className="title-rule" aria-hidden="true" />
      <p className="notice">
        Businesses that said a booking isn’t right. Deciding on flags comes in Stage 3; for now this is the record. If you need to, contact
        the business or the person by email.
      </p>
      <p className="muted">Each time this page is opened, it’s recorded in the audit log.</p>
      {flags.length === 0 ? (
        <p className="muted">No flags yet.</p>
      ) : (
        <ul className={styles.rows}>
          {flags.map((f) => (
            <li key={f.rowId} className={styles.row}>
              <span className={styles.rowName}>
                <Link to={`/admin/listings/${f.vendorId}`}>{f.business}</Link>
              </span>
              <span className="muted">Flagged {when.format(new Date(f.flaggedAt))}</span>
              <span>Note (team only): {f.note ?? <span className="muted">none</span>}</span>
              <span>
                Marked booked by {f.person} ({f.personEmail})
              </span>
              <span className="muted">
                {[f.type ?? 'No type given', longDate(f.date), f.town, guestsWords(f.guests)].filter(Boolean).join(' · ')}
              </span>
              <span>
                <span className={styles.status}>{f.stillBooked ? 'Still marked booked' : 'No longer marked'}</span>
                {f.eventCancelled && (
                  <>
                    {' · '}
                    <span className={styles.status}>Event cancelled</span>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
