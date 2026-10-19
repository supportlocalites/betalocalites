import { Link } from 'react-router';
import { guestsWords, longDate, timeRange, whenWords } from '@/lib/plan-terms';
import head from './EventHeader.module.css';

/** The top of an event's pages (D-58): what it is and when, its name, and three numbers. */
export function EventTop({
  event,
  today,
  booked,
  considering,
  coming,
  canEdit,
}: {
  event: {
    id: string;
    name: string;
    typeName: string | null;
    date: string;
    startTime: string | null;
    endTime: string | null;
    town: string;
    guests: number | null;
  };
  today: string;
  booked: number;
  considering: number;
  coming: number;
  canEdit: boolean;
}) {
  const until = whenWords(event.date, today);
  return (
    <>
      <div className={head.evBand}>
        <div className={head.evBandWords}>
          <p className={head.evKind}>Your event</p>
          <p className={head.evSummary}>
            {[event.typeName, longDate(event.date, today), timeRange(event.startTime, event.endTime), event.town, guestsWords(event.guests)]
              .filter(Boolean)
              .join(' / ')}
          </p>
          <span className="muted">{[until, 'only you see this event'].filter(Boolean).join(' · ')}</span>
        </div>
        {canEdit && (
          <Link to={`/events/${event.id}/edit`} className={head.evEdit}>
            Edit
          </Link>
        )}
      </div>
      <div className={head.evHero}>
        <div>
          <p className={head.evKind}>
            <Link to="/events">My events</Link>
          </p>
          <h1 className={head.evTitle}>{event.name}</h1>
        </div>
        <dl className={head.evStats}>
          {(
            [
              ['Booked', booked],
              ['Considering', considering],
              ['Guests coming', coming],
            ] as const
          ).map(([label, n]) => (
            <div key={label}>
              <dd>{String(n).padStart(2, '0')}</dd>
              <dt>{label}</dt>
            </div>
          ))}
        </dl>
      </div>
    </>
  );
}

/** Businesses, Guests and Updates for one event (D-58). */
export function EventTabs({ base, on, coming }: { base: string; on: 'businesses' | 'guests'; coming: number }) {
  return (
    <nav aria-label="This event" className={head.evTabs}>
      <Link to={base} aria-current={on === 'businesses' ? 'page' : undefined}>
        Businesses
      </Link>
      <Link to={`${base}/guests`} aria-current={on === 'guests' ? 'page' : undefined}>
        {coming > 0 ? `Guests · ${coming}` : 'Guests'}
      </Link>
      <Link to={`${base}/guests#updates`}>Updates</Link>
    </nav>
  );
}
