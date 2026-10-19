import { Link, useRouteLoaderData } from 'react-router';
import styles from './SiteHeader.module.css';
import { Wordmark } from './Wordmark';

/** The wordmark always returns Home (design system §7). */
export function SiteHeader() {
  const signedIn = useRouteLoaderData<{ signedIn: boolean }>('root')?.signedIn ?? false;
  // On pages that need an account, the member layout says whether they're on a business's team (C6).
  const onTeam = useRouteLoaderData<{ onTeam: boolean }>('routes/member/layout')?.onTeam ?? false;
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
          {onTeam && (
            <Link to="/business" className="text-link">
              My business
            </Link>
          )}
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
