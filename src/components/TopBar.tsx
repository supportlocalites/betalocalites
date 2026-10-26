import { useRef } from 'react';
import type { ReactNode } from 'react';
import { Form, Link, useLocation, useRouteLoaderData } from 'react-router';
import type { TeamBusiness } from '@/server/auth/member.server';
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
  businesses: known,
}: {
  children?: ReactNode;
  /** Beside the profile button, at the far right (Browse local's Favourites). */
  end?: ReactNode;
  home?: string;
  onTeam?: boolean;
  /** The businesses the person runs, where the page knows them (Browse local); the member layout says otherwise. */
  businesses?: TeamBusiness[];
}) {
  const businesses = useTeamBusinesses(known);
  const here = useBusinessHere(businesses);
  // On a business's own pages the bar is the business's (the owner, 26 October 2026: "a toggle ...
  // that lets them switch between personal and business account", "shown on both pages").
  if (here) {
    return (
      <header className={`${styles.bar} ${styles.barBusiness}`}>
        <div className={styles.inner}>
          <Link to={home} className={styles.logo}>
            <Wordmark small />
          </Link>
          <span className={styles.bizName}>{here.name}</span>
          <BusinessNav business={here} />
          <div className={styles.end}>
            <Link to="/explore" className={`${styles.pill} ${styles.pillDark}`}>
              Switch to personal
            </Link>
            <AccountMenu onTeam businesses={businesses} />
          </div>
        </div>
      </header>
    );
  }
  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <Link to={home} className={styles.logo}>
          <Wordmark small />
        </Link>
        {children}
        <div className={styles.end}>
          {end}
          <AccountMenu onTeam={onTeam} businesses={businesses} />
        </div>
      </div>
    </header>
  );
}

/** A business's own pages (D-63): where the bar becomes the business's. */
const BUSINESS_PAGES = /^\/vendors\/([^/]+)\/(edit|name|address|analytics|photos|messages|bookings|reviews|team|remove)(\/|$)/;

/** The businesses the person runs: from the member layout on pages that need an account, else as the page knows them. */
function useTeamBusinesses(known?: TeamBusiness[]): TeamBusiness[] {
  return useRouteLoaderData<{ businesses: TeamBusiness[] }>('routes/member/layout')?.businesses ?? known ?? [];
}

/** Which of the person's businesses this page belongs to, if it's one of that business's own pages. */
function useBusinessHere(businesses: TeamBusiness[]): TeamBusiness | null {
  const { pathname, search } = useLocation();
  const slug = BUSINESS_PAGES.exec(pathname)?.[1] ?? (pathname === '/business' ? new URLSearchParams(search).get('b') : null);
  return businesses.find((b) => b.slug === slug) ?? null;
}

/** Where switching to a business goes: My business for its owners and managers, its inbox for staff. */
export const businessHome = (b: TeamBusiness) => (b.role === 'staff' ? `/vendors/${b.slug}/messages` : `/business?b=${b.slug}`);

/** A business's pages, as the person's role on its team allows (the server checks each one too). */
function BusinessNav({ business: b }: { business: TeamBusiness }) {
  const { pathname } = useLocation();
  const runs = b.role === 'owner' || b.role === 'manager';
  const links: [string, string][] = [
    ...(runs ? ([[`/business?b=${b.slug}`, 'Home']] as [string, string][]) : []),
    [`/vendors/${b.slug}/messages`, 'Inbox'],
    ...(runs ? ([[`/vendors/${b.slug}/edit`, 'Listing'], [`/vendors/${b.slug}/photos`, 'Photos']] as [string, string][]) : []),
    ...(runs && b.analytics ? ([[`/vendors/${b.slug}/analytics`, 'Analytics']] as [string, string][]) : []),
    ...(b.role === 'owner' ? ([[`/vendors/${b.slug}/team`, 'Team']] as [string, string][]) : []),
  ];
  return (
    <nav aria-label={`${b.name}’s pages`} className={styles.bizNav}>
      {links.map(([to, label]) => {
        const on = to.startsWith('/business') ? pathname === '/business' : pathname.startsWith(to);
        return (
          <Link key={to} to={to} className={`${styles.bizLink} ${on ? styles.bizOn : ''}`} aria-current={on ? 'page' : undefined}>
            {label}
          </Link>
        );
      })}
    </nav>
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
 * Sign in, or the person's menu (the owner, 25 October 2026): Edit profile, Messages, Sign out;
 * for someone on a business's team, a switch between their personal account and each business
 * (D-63). Favourites is in Browse local's bar.
 */
export function AccountMenu({ onTeam: known, businesses = [] }: { onTeam?: boolean; businesses?: TeamBusiness[] } = {}) {
  const here = useBusinessHere(businesses);
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
        {businesses.length > 0 && (
          <>
            <span className={styles.listHead}>Switch account</span>
            <Link to="/explore" className={!here ? styles.acctOn : undefined} aria-current={!here ? 'true' : undefined}>
              Personal
            </Link>
            {businesses.map((b) => (
              <Link key={b.slug} to={businessHome(b)} className={here?.slug === b.slug ? styles.acctOn : undefined} aria-current={here?.slug === b.slug ? 'true' : undefined}>
                {b.name}
              </Link>
            ))}
            <span className={styles.listRule} aria-hidden="true" />
          </>
        )}
        <Link to="/account">Edit profile</Link>
        <Link to="/messages">Messages</Link>
        {onTeam && businesses.length === 0 && <Link to="/business">My business</Link>}
        <Form method="post" action="/sign-out">
          <button type="submit">Sign out</button>
        </Form>
      </nav>
    </details>
  );
}
