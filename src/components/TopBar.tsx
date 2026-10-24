import type { ReactNode } from 'react';
import { Form, Link, useRouteLoaderData } from 'react-router';
import styles from './TopBar.module.css';
import { Wordmark } from './Wordmark';

/**
 * The bar along the top of every page, as in the Base44 design (D-59): our wordmark (D-31) on
 * the left, then whatever the page puts in it (Browse local's search and filters), then Sign in,
 * or the round button that opens the signed-in person's menu (G3, G4).
 */
export function TopBar({ children, home = '/explore', onTeam }: { children?: ReactNode; home?: string; onTeam?: boolean }) {
  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <Link to={home} className={styles.logo}>
          <Wordmark small />
        </Link>
        {children}
        <AccountMenu onTeam={onTeam} />
      </div>
    </header>
  );
}

/** Sign in, or the person's menu: Messages, Favourites, My business (on a team), Account, Sign out. */
export function AccountMenu({ onTeam: known }: { onTeam?: boolean } = {}) {
  const signedIn = useRouteLoaderData<{ signedIn: boolean }>('root')?.signedIn ?? false;
  // On pages that need an account, the member layout says whether they're on a business's team (C6).
  // Browse local knows it from its own data (known).
  const onTeam = useRouteLoaderData<{ onTeam: boolean }>('routes/member/layout')?.onTeam ?? known ?? false;
  if (!signedIn) {
    return (
      <Link to="/join" className={styles.pill}>
        Sign in
      </Link>
    );
  }
  return (
    <details className={styles.menu}>
      <summary className={styles.avatar} aria-label="Your menu">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={styles.icon}>
          <circle cx="12" cy="8.5" r="3.5" />
          <path d="M5 19.5c1.2-3.4 4-5 7-5s5.8 1.6 7 5" />
        </svg>
      </summary>
      <nav aria-label="Your pages" className={styles.list}>
        <Link to="/messages">Messages</Link>
        <Link to="/saved">Favourites</Link>
        {onTeam && <Link to="/business">My business</Link>}
        <Link to="/account">Account</Link>
        <Form method="post" action="/sign-out">
          <button type="submit">Sign out</button>
        </Form>
      </nav>
    </details>
  );
}
