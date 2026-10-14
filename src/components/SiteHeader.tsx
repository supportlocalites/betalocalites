import { Link, useRouteLoaderData } from 'react-router';
import styles from './SiteHeader.module.css';
import { Wordmark } from './Wordmark';

/** The wordmark always returns Home (design system §7). */
export function SiteHeader() {
  const signedIn = useRouteLoaderData<{ signedIn: boolean }>('root')?.signedIn ?? false;
  return (
    <header className={styles.header}>
      <Link to="/explore" className={styles.wordmark}>
        <Wordmark small />
      </Link>
      {signedIn ? (
        <nav aria-label="Your pages" className={styles.links}>
          <Link to="/events" className="text-link">
            My events
          </Link>
          <Link to="/messages" className="text-link">
            Messages
          </Link>
          <Link to="/account" className="text-link">
            Account
          </Link>
        </nav>
      ) : (
        <Link to="/join" className="text-link">
          Sign in
        </Link>
      )}
    </header>
  );
}
