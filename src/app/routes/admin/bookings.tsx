import { data, Link } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { isUuid } from '@/lib/ids.mjs';
import { STATUS_LABEL } from '@/lib/listing-status';
import { pageMeta } from '@/lib/meta';
import { guestsWords, longDateWithYear } from '@/lib/plan-terms';
import { TEAM_BOOKINGS_MAX, type TeamBooking, teamBookings } from '@/server/admin/team-bookings.server';
import type { Route } from './+types/bookings';
import styles from './admin.module.css';

/**
 * The team's bookings (D-46): every business a person marked booked, listed or not, past
 * events too. Taken-down businesses with bookings still to come are listed first, to check in
 * with those people. Only the team sees this; every look is recorded (E §4.2).
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Bookings · Team'), { name: 'robots', content: 'noindex' }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const business = new URL(request.url).searchParams.get('business');
  if (business !== null && !isUuid(business)) throw data(null, { status: 404 });
  const { env } = context.get(cloudflareContext);
  return {
    bookings: await teamBookings(env, context.get(adminContext), business),
    business,
    max: TEAM_BOOKINGS_MAX,
  };
}

const when = new Intl.DateTimeFormat('en-CA', {
  dateStyle: 'medium',
  timeZone: 'America/Toronto',
});

function Rows({ rows, label }: { rows: TeamBooking[]; label: string }) {
  return (
    <ul className={styles.rows} aria-label={label}>
      {rows.map((b) => (
        <li key={b.rowId} className={styles.row}>
          <span className={styles.rowName}>
            <Link to={`/admin/listings/${b.vendorId}`}>{b.business}</Link>
          </span>
          <span>
            <span className={`${styles.status} ${b.status === 'published' ? styles.statusLive : ''}`}>{STATUS_LABEL[b.status]}</span>
            {b.cancelled && (
              <>
                {' · '}
                <span className={styles.status}>Event cancelled</span>
              </>
            )}
          </span>
          <span>
            Booked by {b.person} (<a href={`mailto:${b.personEmail}`}>{b.personEmail}</a>)
          </span>
          <span className="muted">
            {[longDateWithYear(b.date), b.town, guestsWords(b.guests), `marked booked ${when.format(new Date(b.bookedAt))}`]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function Bookings({ loaderData: { bookings, business, max } }: Route.ComponentProps) {
  const checkIn = bookings.filter((b) => b.upcoming && b.status !== 'published');
  const comingUp = bookings.filter((b) => b.upcoming && b.status === 'published');
  const earlier = bookings.filter((b) => !b.upcoming);
  const name = business ? bookings[0]?.business : null;
  return (
    <>
      <h1 className="title-1">{name ? `Bookings: ${name}` : 'Bookings'}</h1>
      <div className="title-rule" aria-hidden="true" />
      <p className="notice">
        Every business a person has marked booked, whether or not it’s listed now. Taking a business down never deletes these. Only the
        Localites team sees this page; people see only their own events, and a business sees only its own bookings.
      </p>
      <p className="muted">Each time this page is opened, it’s recorded in the audit log.</p>
      {business && (
        <p>
          <Link to="/admin/bookings" className="text-link">
            All bookings
          </Link>
        </p>
      )}
      {bookings.length === 0 ? (
        <p className="muted">No bookings{business ? ' for this business' : ''} yet.</p>
      ) : (
        <>
          {checkIn.length > 0 && (
            <section className={styles.section} aria-labelledby="check-in">
              <h2 id="check-in">Check in with these people ({checkIn.length})</h2>
              <p>The business they booked isn’t listed any more and their event is still to come. Get in touch to see if they need help.</p>
              <Rows rows={checkIn} label="Bookings to check in about" />
            </section>
          )}
          <section className={styles.section} aria-labelledby="coming-up">
            <h2 id="coming-up">Coming up ({comingUp.length})</h2>
            {comingUp.length === 0 ? <p className="muted">None.</p> : <Rows rows={comingUp} label="Bookings coming up" />}
          </section>
          <section className={styles.section} aria-labelledby="earlier">
            <h2 id="earlier">Past and cancelled ({earlier.length})</h2>
            {earlier.length === 0 ? <p className="muted">None.</p> : <Rows rows={earlier} label="Past and cancelled bookings" />}
          </section>
          {bookings.length >= max && (
            <p className="muted">Showing the first {max}. Open a business’s bookings from its listing to see all of its own.</p>
          )}
        </>
      )}
    </>
  );
}
