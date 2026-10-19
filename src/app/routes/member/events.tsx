import { Link, useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SideSwitch } from '@/components/SideSwitch';
import { SiteHeader } from '@/components/SiteHeader';
import { pageMeta } from '@/lib/meta';
import { EVENTS_PRIVATE, shortDate, timeRange, whenWords } from '@/lib/plan-terms';
import { type EventCard, myEvents } from '@/server/events.server';
import { todayIso } from '@/server/plan-pages.server';
import type { Route } from './+types/events';
import styles from './plan.module.css';

/** Screen C1: My events (D-13). Only ever this person's own events; nobody else sees them. */
export const meta: Route.MetaFunction = () => [...pageMeta('My events'), { name: 'robots', content: 'noindex' }];

export async function loader({ context }: Route.LoaderArgs) {
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  return { ...(await myEvents(env, member.userId)), today: todayIso() };
}

const planWords = (c: EventCard) =>
  c.booked + c.considering === 0
    ? 'Nothing on the plan yet'
    : [c.booked ? `${c.booked} booked` : '', c.considering ? `${c.considering} considering` : ''].filter(Boolean).join(' · ');

function Cards({ cards, today }: { cards: EventCard[]; today: string }) {
  return (
    <ul className={styles.list}>
      {cards.map((c) => {
        const when = c.status === 'planning' ? whenWords(c.date, today) : null;
        return (
          <li key={c.id}>
            <Link to={`/events/${c.id}`} className={styles.cardLink}>
              {c.typeName && <span className="label">{c.typeName}</span>}
              <span className={styles.name}>{c.name}</span>
              <span className={styles.meta}>
                {[shortDate(c.date, today), timeRange(c.startTime, c.endTime), c.town].filter(Boolean).join(' · ')}
                {when ? ` · ${when}` : ''}
              </span>
              <span className={styles.meta}>{c.status === 'cancelled' ? 'Cancelled' : planWords(c)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default function MyEvents({ loaderData }: Route.ComponentProps) {
  const { upcoming, past, cancelled, savedCount, onTeam, today } = loaderData;
  const none = upcoming.length + past.length + cancelled.length === 0;
  const deleted = useSearchParams()[0].has('deleted');
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        {onTeam && <SideSwitch current="events" />}
        <h1 className="title-1">My events</h1>
        <div className="title-rule" aria-hidden="true" />
        {deleted && (
          <p className="notice" role="status">
            The cancelled event is deleted.
          </p>
        )}
        {none ? (
          <>
            <p>
              No events yet. Planning a birthday or a get-together? Start with a name, the date and the town, then add businesses as you
              find them.
            </p>
            <div className={styles.actions}>
              <Link to="/events/new" className="button button-primary">
                Plan an event
              </Link>
              <Link to="/explore" className="button button-secondary">
                Browse local
              </Link>
            </div>
          </>
        ) : (
          <>
            <div className={styles.actions}>
              <Link to="/events/new" className="button button-primary">
                Plan an event
              </Link>
            </div>
            <p className="muted">{EVENTS_PRIVATE}</p>

            {upcoming.length > 0 && (
              <section aria-labelledby="coming-up" className={styles.section}>
                <h2 id="coming-up" className="label">
                  Coming up
                </h2>
                <Cards cards={upcoming} today={today} />
              </section>
            )}
            {past.length > 0 && (
              <section aria-labelledby="past" className={styles.section}>
                <h2 id="past" className="label">
                  Past
                </h2>
                <Cards cards={past} today={today} />
              </section>
            )}
            {cancelled.length > 0 && (
              <details className={`${styles.section} ${styles.more}`}>
                <summary>Cancelled ({cancelled.length})</summary>
                <Cards cards={cancelled} today={today} />
              </details>
            )}
          </>
        )}

        <p className="section-gap">
          <Link to="/saved" className="text-link">
            Saved businesses ({savedCount})
          </Link>
        </p>
      </main>
    </>
  );
}
