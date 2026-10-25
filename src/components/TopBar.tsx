import { useRef } from 'react';
import type { ReactNode } from 'react';
import { Form, Link, useLocation, useRouteLoaderData } from 'react-router';
import styles from './TopBar.module.css';
import { useCloseOutside } from './useCloseOutside';
import { Wordmark } from './Wordmark';

/**
 * The bar along the top of every page, as in the Base44 design (D-59): our wordmark (D-31) on
 * the left, then whatever the page puts in it (Browse local's search and filters), then Sign in,
 * or the round button that opens the signed-in person's menu (G3, G4).
 */
export function TopBar({
  children,
  end,
  home = '/explore',
  onTeam,
}: {
  children?: ReactNode;
  /** Beside the profile button, at the far right (Browse local's Favourites). */
  end?: ReactNode;
  home?: string;
  onTeam?: boolean;
}) {
  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <Link to={home} className={styles.logo}>
          <Wordmark small />
        </Link>
        {children}
        <div className={styles.end}>
          {end}
          <AccountMenu onTeam={onTeam} />
        </div>
      </div>
    </header>
  );
}

/**
 * Browse local · Messages · Community (the owner, 25 October 2026: "a nav bar at the top that
 * allows it - where you can go back to localites, messages, or community"), on Messages and
 * Community. Messages shows how many conversations have something new, when the page knows.
 */
export function MainNav({ unread = 0 }: { unread?: number }) {
  const path = useLocation().pathname;
  const links: [string, string, boolean][] = [
    ['/explore', 'Browse local', path === '/explore'],
    ['/messages', 'Messages', path.startsWith('/messages')],
    ['/community', 'Community', path.startsWith('/community')],
  ];
  return (
    <nav aria-label="Main" className={styles.nav}>
      {links.map(([to, label, on]) => (
        <Link key={to} to={to} className={`${styles.navLink} ${on ? styles.navOn : ''}`} aria-current={on ? 'page' : undefined}>
          {label}
          {label === 'Messages' && unread > 0 && (
            <span className={styles.navCount}>
              {unread}
              <span className="visually-hidden"> new</span>
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Sign in, or the person's menu (the owner, 25 October 2026): Edit profile, Messages (until it
 * finds its own place), My business (on a team), Sign out. Favourites is in Browse local's bar.
 */
export function AccountMenu({ onTeam: known }: { onTeam?: boolean } = {}) {
  const signedIn = useRouteLoaderData<{ signedIn: boolean }>('root')?.signedIn ?? false;
  // On pages that need an account, the member layout says whether they're on a business's team (C6).
  // Browse local knows it from its own data (known).
  const onTeam = useRouteLoaderData<{ onTeam: boolean }>('routes/member/layout')?.onTeam ?? known ?? false;
  const menu = useRef<HTMLDetailsElement>(null);
  useCloseOutside(menu);
  if (!signedIn) {
    return (
      <Link to="/join" className={styles.pill}>
        Sign in
      </Link>
    );
  }
  return (
    <details className={styles.menu} ref={menu}>
      <summary className={styles.avatar} aria-label="Your menu">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={styles.icon}>
          <circle cx="12" cy="8.5" r="3.5" />
          <path d="M5 19.5c1.2-3.4 4-5 7-5s5.8 1.6 7 5" />
        </svg>
      </summary>
      <nav aria-label="Your pages" className={styles.list}>
        <Link to="/account">Edit profile</Link>
        <Link to="/messages">Messages</Link>
        {onTeam && <Link to="/business">My business</Link>}
        <Form method="post" action="/sign-out">
          <button type="submit">Sign out</button>
        </Form>
      </nav>
    </details>
  );
}
