import { useRef } from 'react';
import { data, Link, useLocation } from 'react-router';
import { cloudflareContext } from '@/app/context';
import { useListActivity } from '@/components/ActivityTracker';
import { CardGrid } from '@/components/BrowseCard';
import { SearchBar } from '@/components/SearchBar';
import { ShortlistBar } from '@/components/ShortlistBar';
import { SiteHeader } from '@/components/SiteHeader';
import { cleanText } from '@/lib/clean-text';
import { pageMeta } from '@/lib/meta';
import { cookieHeaders, listTrack } from '@/server/activity.server';
import { hasSessionCookie, signedInUserId } from '@/server/auth/session.server';
import { browse } from '@/server/browse.server';
import { categoryName as nameOfCategory } from '@/server/catalog.server';
import { withDb } from '@/server/db.server';
import type { Route } from './+types/search';
import styles from './explore.module.css';

export const meta: Route.MetaFunction = () => pageMeta('Search');

/**
 * Search results, and each kind of business's own page ("See all" on Browse local): the same
 * cards as Browse local (D-57), with + and the bookmark. Never paid for.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams;
  const q = cleanText(params.get('q') ?? '').slice(0, 100);
  const raw = cleanText(params.get('category') ?? '').slice(0, 80);
  const category = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(raw) ? raw : null;
  const { env } = context.get(cloudflareContext);
  const userId = hasSessionCookie(request) ? await signedInUserId(request, env) : null;
  const [found, categoryName] = await Promise.all([
    browse(env, userId, { q, town: null, cost: null, minRating: null, sort: 'match', view: 'list', category }),
    category ? withDb(env, (db) => nameOfCategory(db, category)) : null,
  ]);
  // A signed note of what this page shows, for counting what's really seen (ADR-030).
  const { track, setCookie } = await listTrack(env, request, { words: q.trim(), category, ids: found.onMap.map((v) => v.id) });
  return data(
    {
      q,
      category: category ?? '',
      vendors: found.onMap,
      shortlist: found.shortlist,
      signedIn: Boolean(userId),
      track,
      heading: categoryName ?? (q ? `Results for “${q}”` : 'All local businesses'),
    },
    { headers: cookieHeaders(setCookie) },
  );
}

// The visitor cookie a new browser gets with the page (ADR-030).
export const headers: Route.HeadersFunction = ({ loaderHeaders }) => loaderHeaders;

export default function Search({ loaderData: { q, category, vendors, heading, track, signedIn, shortlist } }: Route.ComponentProps) {
  const listRef = useRef<HTMLUListElement>(null);
  useListActivity(track?.token ?? null, listRef, useLocation().key);
  const suggestLink = `/suggest?${new URLSearchParams({ ...(category ? { category } : {}), ...(q ? { q } : {}) })}`;
  return (
    <>
      <SiteHeader />
      <main className={`page ${shortlist.length > 0 ? styles.withBar : ''}`}>
        <p className={styles.eyebrow}>
          <span className={styles.eyebrowLine} aria-hidden="true" />
          <Link to="/explore">Browse local</Link>
        </p>
        <h1 className="title-1">{heading}</h1>
        <div className="title-rule" aria-hidden="true" />
        <SearchBar key={q} defaultValue={q} />
        {vendors.length > 0 ? (
          <>
            <p className="label section-gap">
              {vendors.length} {vendors.length === 1 ? 'business' : 'businesses'}
            </p>
            <CardGrid items={vendors} signedIn={signedIn} listId={track?.list ?? null} listRef={listRef} />
          </>
        ) : (
          <p className="muted section-gap">
            No businesses match yet. Localites is new and businesses are still being added, so try a broader word or browse a category.
          </p>
        )}
        <p className="muted section-gap">
          Don’t see who you’re looking for?{' '}
          <Link to={suggestLink} className="text-link">
            Suggest a business
          </Link>
        </p>
      </main>
      <ShortlistBar items={shortlist} />
    </>
  );
}
