import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { Form, Link, useFetcher, useLocation, useRouteLoaderData } from 'react-router';
import { localFavourites } from '@/lib/local-favourites';
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
  unread,
  favourites,
  onHome,
}: {
  children?: ReactNode;
  /** Before the icons at the right. */
  end?: ReactNode;
  home?: string;
  onTeam?: boolean;
  /** The businesses the person runs, where the page knows them (Browse local); the member layout says otherwise. */
  businesses?: TeamBusiness[];
  /** How many conversations have something new, where the page knows (Messages); else the bar asks. */
  unread?: number;
  /** On Browse local: whether only favourites are showing, and how many there are. */
  favourites?: { on: boolean; count: number };
  /** On Browse local: the wordmark starts it again (its link alone wouldn't reset the filters). */
  onHome?: () => void;
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
        <Link to={home} className={styles.logo} onClick={onHome}>
          <Wordmark small />
        </Link>
        {children}
        <div className={styles.end}>
          {end}
          <IconNav unread={unread} favourites={favourites} />
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

const ICONS = {
  messages: <path d="M5 6h14v9H9l-4 3z" />,
  community: (
    <>
      <circle cx="9" cy="9" r="3" />
      <circle cx="17" cy="10" r="2.4" />
      <path d="M3.5 19c.8-3 3-4.6 5.5-4.6s4.7 1.6 5.5 4.6M15 14.6c2.4 0 4.3 1.3 5 4" />
    </>
  ),
  favourites: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
};
const NavIcon = ({ name }: { name: keyof typeof ICONS }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={styles.navIcon}>
    {ICONS[name]}
  </svg>
);

/**
 * Small labelled icons at the right of the bar, beside the account button, on every page but a
 * business's own (the owner, 26 October 2026: "I like the icons"; then "favourites ... the most
 * left icon, remove the browse (when on the browse page) and then have messages and community to
 * the right with the profile furthest right"; 27 October 2026: no Browse icon, as the wordmark goes to
 * Browse local). The words go on a narrow screen; each keeps its name for screen readers.
 */
function IconNav({ unread: pageUnread, favourites }: { unread?: number; favourites?: { on: boolean; count: number } }) {
  const path = useLocation().pathname;
  const counts = useBarCounts();
  // The page's own numbers when it has them (freshest), else the bar's.
  const unread = pageUnread ?? counts.unread;
  const favouriteCount = favourites?.count ?? counts.favourites;
  const link = (to: string, icon: keyof typeof ICONS, label: string, on: boolean) => (
    <Link
      key={to}
      to={to}
      // The label replaces what's inside for screen readers, so it carries the count itself.
      aria-label={icon === 'messages' && unread > 0 ? `${label}, ${unread} new` : label}
      title={label}
      className={`${styles.navLink} ${on ? styles.navOn : ''}`}
      aria-current={on ? 'page' : undefined}
    >
      <NavIcon name={icon} />
      <span className={styles.navWord}>{label}</span>
      {icon === 'messages' && unread > 0 && (
        <span className={styles.navCount} aria-hidden="true">
          {unread}
        </span>
      )}
    </Link>
  );
  return (
    <nav aria-label="Main" className={styles.nav}>
      {/* Browse local with only favourites, from any page; pressed again it stays there (the owner,
          27 October 2026). The wordmark goes back to all of Browse local. */}
      <Link
        to="/explore?fav=1"
        aria-label={favouriteCount > 0 ? `Favourites, ${favouriteCount}` : 'Favourites'}
        title="Favourites"
        className={`${styles.navLink} ${favourites?.on ? styles.navOn : ''}`}
        aria-current={favourites?.on ? 'page' : undefined}
        preventScrollReset
      >
        <NavIcon name="favourites" />
        <span className={styles.navWord}>Favourites</span>
        {favouriteCount > 0 && (
          <span className={styles.navCount} aria-hidden="true">
            {favouriteCount}
          </span>
        )}
      </Link>
      {link('/messages', 'messages', 'Messages', path.startsWith('/messages'))}
      {link('/community', 'community', 'Community', path.startsWith('/community'))}
    </nav>
  );
}

/**
 * The numbers on the icons, on every page (the owner, 27 October 2026: "the icon numbers should
 * show on all pages"): asked for after each page change, so the page itself isn't slowed. Signed
 * out, favourites are this browser's own and there are no messages.
 */
function useBarCounts(): { favourites: number; unread: number } {
  const signedIn = useRouteLoaderData<{ signedIn: boolean }>('root')?.signedIn ?? false;
  const { pathname } = useLocation();
  const fetcher = useFetcher<{ favourites: number; unread: number } | null>();
  const { load } = fetcher;
  useEffect(() => {
    if (signedIn) void load('/bar-counts');
  }, [signedIn, pathname, load]);
  const local = localFavourites.parse(useSyncExternalStore(localFavourites.subscribe, localFavourites.read, () => '[]'));
  if (!signedIn) return { favourites: local.length, unread: 0 };
  return { favourites: fetcher.data?.favourites ?? 0, unread: fetcher.data?.unread ?? 0 };
}

/**
 * Sign in, or the person's menu (the owner, 25 October 2026): Edit profile and Sign out (Messages
 * is its own icon beside it, the owner, 26 October 2026);
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
        {onTeam && businesses.length === 0 && <Link to="/business">My business</Link>}
        <Form method="post" action="/sign-out">
          <button type="submit">Sign out</button>
        </Form>
      </nav>
    </details>
  );
}
