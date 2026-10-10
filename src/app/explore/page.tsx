import type { Metadata } from 'next';
import Link from 'next/link';
import { SearchBar } from '@/components/SearchBar';
import { SiteHeader } from '@/components/SiteHeader';
import { listCategories } from '@/server/catalog';
import styles from './explore.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Explore' };

export default async function Explore() {
  const categories = await listCategories();
  return (
    <>
      <SiteHeader />
      <main className="page">
        <div className={styles.intro}>
          <div>
            <h1 className="title-1">Find local help for your event</h1>
            <div className="title-rule" aria-hidden="true" />
            <p className="muted">Orillia, Severn, Oro-Medonte and Ramara.</p>
          </div>
          <SearchBar />
        </div>
        <h2 className="label">Browse by category</h2>
        <ul className={styles.grid}>
          {categories.map((c) => (
            <li key={c.slug}>
              <Link href={`/search?category=${c.slug}`} className={styles.tile}>
                <span className={styles.tileName}>{c.name}</span>
                <span className="muted">
                  {c.vendorCount === 0 ? 'Businesses being added' : `${c.vendorCount} local ${c.vendorCount === 1 ? 'business' : 'businesses'}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
