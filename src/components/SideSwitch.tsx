import { Link } from 'react-router';
import styles from './SideSwitch.module.css';

/**
 * Screen A5: one account, two sides (D-13, D-29, ADR-022). Shown only to someone on a
 * business's team. It only moves between pages: which side the database is told is acting
 * comes from the page itself (My events: the person; My business: the business), never
 * from this switch or a cookie.
 */
export function SideSwitch({ current }: { current: 'events' | 'business' }) {
  return (
    <nav aria-label="Switch between your events and your business" className={styles.switch}>
      <Link to="/events" aria-current={current === 'events' ? 'page' : undefined}>
        My events
      </Link>
      <Link to="/business" aria-current={current === 'business' ? 'page' : undefined}>
        My business
      </Link>
    </nav>
  );
}
