import { cloudflareContext } from '@/app/context';
import { ResultList } from '@/components/ResultRow';
import { SearchBar } from '@/components/SearchBar';
import { SiteHeader } from '@/components/SiteHeader';
import { pageMeta } from '@/lib/meta';
import { listCategories, searchVendors } from '@/server/catalog.server';
import type { Route } from './+types/search';

export const meta: Route.MetaFunction = () => pageMeta('Search');

export async function loader({ request, context }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams;
  const q = (params.get('q') ?? '').slice(0, 100);
  const categorySlug = (params.get('category') ?? '').slice(0, 80) || undefined;
  const { env } = context.get(cloudflareContext);
  const [vendors, categories] = await Promise.all([searchVendors(env, q, categorySlug), listCategories(env)]);
  const categoryName = categories.find((c) => c.slug === categorySlug)?.name;
  return { q, vendors, heading: categoryName ?? (q ? `Results for “${q}”` : 'All local businesses') };
}

export default function Search({ loaderData: { q, vendors, heading } }: Route.ComponentProps) {
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
            <ResultList vendors={vendors} />
          </>
        ) : (
          <p className="muted">
            No businesses match yet. Localites is new and businesses are still being added, so try a broader word or
            browse a category.
          </p>
        )}
      </main>
    </>
  );
}
