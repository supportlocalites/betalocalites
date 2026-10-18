import { Link } from 'react-router';
import { cloudflareContext } from '@/app/context';
import { SearchBar } from '@/components/SearchBar';
import { SiteHeader } from '@/components/SiteHeader';
import { shareMeta } from '@/lib/meta';
import { listCategories } from '@/server/catalog.server';
import type { Route } from './+types/explore';
import styles from './explore.module.css';

export const meta: Route.MetaFunction = ({ matches }) => shareMeta(matches, '/explore', 'Explore');

export async function loader({ context }: Route.LoaderArgs) {
  return { categories: await listCategories(context.get(cloudflareContext).env) };
}

export default function Explore({ loaderData: { categories } }: Route.ComponentProps) {
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
              <Link to={`/search?category=${c.slug}`} className={styles.tile}>
                <span className={styles.tileName}>{c.name}</span>
                <span className="muted">
                  {c.vendorCount === 0 ? 'Businesses being added' : `${c.vendorCount} local ${c.vendorCount === 1 ? 'business' : 'businesses'}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <p className={styles.more}>
          <Link to="/how-it-works" className="text-link">
            How it works
          </Link>
          <Link to="/for-businesses" className="text-link">
            For businesses
          </Link>
          <Link to="/suggest" className="text-link">
            Suggest a business
          </Link>
        </p>
      </main>
    </>
  );
}
