import { useRef } from 'react';
import { Link } from 'react-router';
import { cloudflareContext } from '@/app/context';
import { useListActivity } from '@/components/ActivityTracker';
import { ResultList } from '@/components/ResultRow';
import { SearchBar } from '@/components/SearchBar';
import { SiteHeader } from '@/components/SiteHeader';
import { pageMeta } from '@/lib/meta';
import { listTrack } from '@/server/activity.server';
import { readCategories, searchVendors } from '@/server/catalog.server';
import { withDb } from '@/server/db.server';
import type { Route } from './+types/search';

export const meta: Route.MetaFunction = () => pageMeta('Search');

export async function loader({ request, context }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams;
  const q = (params.get('q') ?? '').slice(0, 100);
  const categorySlug = (params.get('category') ?? '').slice(0, 80) || undefined;
  const { env } = context.get(cloudflareContext);
  const [found, categories] = await withDb(env, (db) => Promise.all([searchVendors(db, q, categorySlug), readCategories(db)]));
  const categoryName = categories.find((c) => c.slug === categorySlug)?.name;
  // A signed note of what this page shows, for counting what's really seen (ADR-030).
  const track = await listTrack(env, request, { words: q.trim(), category: categorySlug ?? null, ids: found.map((v) => v.id) });
  const vendors = found.map((v) => ({ slug: v.slug, name: v.name, tagline: v.tagline, town: v.town }));
  return { q, category: categorySlug ?? '', vendors, track, heading: categoryName ?? (q ? `Results for “${q}”` : 'All local businesses') };
}

export default function Search({ loaderData: { q, category, vendors, heading, track } }: Route.ComponentProps) {
  const listRef = useRef<HTMLDivElement>(null);
  useListActivity(track?.token ?? null, listRef);
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
            No businesses match yet. Localites is new and businesses are still being added, so try a broader word or
            browse a category.
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
