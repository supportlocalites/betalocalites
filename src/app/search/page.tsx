import type { Metadata } from 'next';
import { ResultList } from '@/components/ResultRow';
import { SearchBar } from '@/components/SearchBar';
import { SiteHeader } from '@/components/SiteHeader';
import { listCategories, searchVendors } from '@/server/catalog';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Search' };

type Props = { searchParams: Promise<{ q?: string | string[]; category?: string | string[] }> };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function Search({ searchParams }: Props) {
  const params = await searchParams;
  const q = one(params.q).slice(0, 100);
  const categorySlug = one(params.category).slice(0, 80) || undefined;
  const [vendors, categories] = await Promise.all([searchVendors(q, categorySlug), listCategories()]);
  const categoryName = categories.find((c) => c.slug === categorySlug)?.name;
  const heading = categoryName ?? (q ? `Results for “${q}”` : 'All local businesses');

  return (
    <>
      <SiteHeader />
      <main className="page">
        <SearchBar defaultValue={q} />
        <h1 className="title-1 section-gap">
          {heading}
        </h1>
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
