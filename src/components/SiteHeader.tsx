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
      <Link to={signedIn ? '/account' : '/join'} className="text-link">
        {signedIn ? 'Your account' : 'Sign in'}
      </Link>
    </header>
  );
}
