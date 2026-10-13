import { useRef } from 'react';
import { data, Link, useLocation } from 'react-router';
import { cloudflareContext } from '@/app/context';
import { useListActivity } from '@/components/ActivityTracker';
import { ResultList } from '@/components/ResultRow';
import { SearchBar } from '@/components/SearchBar';
import { SiteHeader } from '@/components/SiteHeader';
import { pageMeta } from '@/lib/meta';
import { cookieHeaders, listTrack } from '@/server/activity.server';
import { categoryName as nameOfCategory, searchVendors } from '@/server/catalog.server';
import { withDb } from '@/server/db.server';
import { toListPhoto } from '@/server/photo-store.server';
import type { Route } from './+types/search';

export const meta: Route.MetaFunction = () => pageMeta('Search');

export async function loader({ request, context }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams;
  const q = (params.get('q') ?? '').slice(0, 100);
  const categorySlug = (params.get('category') ?? '').slice(0, 80) || undefined;
  const { env } = context.get(cloudflareContext);
  const [found, categoryName] = await withDb(env, (db) =>
    Promise.all([searchVendors(db, q, categorySlug), categorySlug ? nameOfCategory(db, categorySlug) : null]),
  );
  // A signed note of what this page shows, for counting what's really seen (ADR-030).
  const { track, setCookie } = await listTrack(env, request, {
    words: q.trim(),
    category: categorySlug ?? null,
    ids: found.map((v) => v.id),
  });
  const vendors = found.map((v) => ({
    slug: v.slug,
    name: v.name,
    tagline: v.tagline,
    town: v.town,
    photo: toListPhoto(env, v),
  }));
  return data(
    { q, category: categorySlug ?? '', vendors, track, heading: categoryName ?? (q ? `Results for “${q}”` : 'All local businesses') },
    { headers: cookieHeaders(setCookie) },
  );
}

// The visitor cookie a new browser gets with the page (ADR-030).
export const headers: Route.HeadersFunction = ({ loaderHeaders }) => loaderHeaders;

export default function Search({ loaderData: { q, category, vendors, heading, track } }: Route.ComponentProps) {
  const listRef = useRef<HTMLDivElement>(null);
  useListActivity(track?.token ?? null, listRef, useLocation().key);
  const suggestLink = `/suggest?${new URLSearchParams({ ...(category ? { category } : {}), ...(q ? { q } : {}) })}`;
  return (
    <>
      <SiteHeader />
      <main className="page">
        <SearchBar key={q} defaultValue={q} />
        <h1 className="title-1 section-gap">{heading}</h1>
        <div className="title-rule" aria-hidden="true" />
        {vendors.length > 0 ? (
          <>
            <p className="label">
              {vendors.length} {vendors.length === 1 ? 'business' : 'businesses'}
            </p>
            <div ref={listRef}>
              <ResultList vendors={vendors} listId={track?.list ?? null} />
            </div>
          </>
        ) : (
          <p className="muted">
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
    </>
  );
}
