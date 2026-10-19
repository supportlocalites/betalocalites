import { useRef, useState } from 'react';
import { data, Form, Link, useLocation, useSubmit } from 'react-router';
import { cloudflareContext } from '@/app/context';
import { useListActivity } from '@/components/ActivityTracker';
import { BrowseCard } from '@/components/BrowseCard';
import { ShortlistBar } from '@/components/ShortlistBar';
import { SiteHeader } from '@/components/SiteHeader';
import { cleanText } from '@/lib/clean-text';
import { shareMeta } from '@/lib/meta';
import { cookieHeaders, listTracks } from '@/server/activity.server';
import { hasSessionCookie, signedInUserId } from '@/server/auth/session.server';
import { SORT_WORDS, SORTS } from '@/lib/browse-terms';
import { browse, readFilters } from '@/server/browse.server';
import type { Route } from './+types/explore';
import styles from './explore.module.css';

export const meta: Route.MetaFunction = ({ matches }) => shareMeta(matches, '/explore', 'Browse local');

/**
 * Browse local (D-57): listed businesses in a row for each kind of business, with the filter
 * bar (words, town, cost, rating, sort). On each card, + adds to the shortlist and the bookmark
 * saves as a favourite. Each row is counted as a list seen (ADR-030), as a kind's own page is.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const params = new URL(request.url).searchParams;
  const filters = readFilters(params, cleanText);
  const userId = hasSessionCookie(request) ? await signedInUserId(request, env) : null;
  const found = await browse(env, userId, filters);
  const { tracks, setCookie } = await listTracks(
    env,
    request,
    found.rails.map((r) => ({ words: filters.q.trim(), category: r.slug, ids: r.items.map((c) => c.id) })),
  );
  return data(
    {
      filters,
      signedIn: Boolean(userId),
      towns: found.towns,
      kinds: found.kinds,
      shortlist: found.shortlist,
      rails: found.rails.map((r, i) => ({ ...r, track: tracks[i] ?? null })),
    },
    { headers: cookieHeaders(setCookie) },
  );
}

// The visitor cookie a new browser gets with the page (ADR-030).
export const headers: Route.HeadersFunction = ({ loaderHeaders }) => loaderHeaders;

type Loaded = Route.ComponentProps['loaderData'];

function Rail({ rail, signedIn }: { rail: Loaded['rails'][number]; signedIn: boolean }) {
  const ref = useRef<HTMLUListElement>(null);
  // The note this row was first shown with: tapping + or the bookmark reloads the page's data
  // (and a new note), but the row was already counted as seen (ADR-030). A new visit remounts it.
  const [track] = useState(rail.track);
  useListActivity(track?.token ?? null, ref, useLocation().key);
  return (
    <section className={styles.rail} aria-labelledby={`rail-${rail.slug}`}>
      <div className={styles.railHead}>
        <h2 id={`rail-${rail.slug}`} className={styles.railName}>
          {rail.name}
        </h2>
        <span className={styles.railCount}>{rail.total}</span>
        <span className={styles.railLine} aria-hidden="true" />
        <Link to={`/search?category=${rail.slug}`} className={styles.seeAll} aria-label={`See all ${rail.name}`}>
          See all
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={styles.arrow}>
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </Link>
      </div>
      <ul className={styles.cards} ref={ref}>
        {rail.items.map((c, i) => (
          <BrowseCard key={c.id} card={c} kind={rail.name} signedIn={signedIn} pos={i + 1} listId={track?.list ?? null} />
        ))}
      </ul>
    </section>
  );
}

export default function Explore({ loaderData }: Route.ComponentProps) {
  const { filters, towns, kinds, rails, shortlist, signedIn } = loaderData;
  const submit = useSubmit();
  const visit = useLocation().key;
  const filtered = Boolean(filters.q || filters.town || filters.cost || filters.minRating || filters.sort !== 'match');
  // Choosing from a list shows the results at once (the Show button stays for typing, and without scripts).
  const onChange = (e: React.ChangeEvent<HTMLFormElement>) => {
    if (e.target instanceof HTMLSelectElement) submit(e.currentTarget, { preventScrollReset: true, replace: true });
  };
  return (
    <>
      <SiteHeader />
      <main className={`page ${shortlist.length > 0 ? styles.withBar : ''}`}>
        <section className={styles.intro}>
          <p className={styles.eyebrow}>
            <span className={styles.eyebrowLine} aria-hidden="true" />
            Browse local
          </p>
          <h1 className={styles.title}>
            Everything for your event, <em className={styles.close}>close to home.</em>
          </h1>
          <p className={styles.sub}>
            Local businesses in Orillia, Severn, Oro-Medonte and Ramara. Add the ones you like to your shortlist, then plan your event with
            them.
          </p>
        </section>

        <Form method="get" className={styles.filters} role="search" aria-label="Find businesses" onChange={onChange}>
          <div className={styles.search}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={styles.searchIcon}>
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-4-4" />
            </svg>
            <label htmlFor="q" className="visually-hidden">
              Search businesses
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={filters.q}
              key={filters.q}
              placeholder="Search by name or what they do…"
              className={styles.searchInput}
              maxLength={100}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="town" className={styles.fieldLabel}>
              Where
            </label>
            <select id="town" name="town" defaultValue={filters.town ?? ''} key={`t${filters.town}`} className={styles.select}>
              <option value="">Any town</option>
              {towns.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="cost" className={styles.fieldLabel}>
              Cost
            </label>
            <select id="cost" name="cost" defaultValue={filters.cost ? String(filters.cost) : ''} key={`c${filters.cost}`} className={styles.select}>
              <option value="">Any cost</option>
              <option value="1">$ (low cost)</option>
              <option value="2">$$ (medium cost)</option>
              <option value="3">$$$ (high cost)</option>
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="rating" className={styles.fieldLabel}>
              Rating
            </label>
            <select id="rating" name="rating" defaultValue={filters.minRating ? '4' : ''} key={`r${filters.minRating}`} className={styles.select}>
              <option value="">Any rating</option>
              <option value="4">4 stars and up</option>
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="sort" className={styles.fieldLabel}>
              Sort
            </label>
            <select id="sort" name="sort" defaultValue={filters.sort} key={`s${filters.sort}`} className={styles.select}>
              {SORTS.filter((s) => s !== 'saved' || signedIn).map((s) => (
                <option key={s} value={s}>
                  {SORT_WORDS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.actions}>
            <button type="submit" className="button button-primary">
              Show
            </button>
            {filtered && (
              <Link to="/explore" className="text-link">
                Clear
              </Link>
            )}
          </div>
        </Form>

        <nav aria-label="Kinds of business" className={styles.kinds}>
          {kinds.map((k) => (
            <Link key={k.slug} to={`/search?category=${k.slug}`} className={styles.kind}>
              {k.name}
              <span className={styles.kindCount}>{k.vendorCount === 0 ? 'Being added' : k.vendorCount}</span>
            </Link>
          ))}
        </nav>

        {rails.length === 0 ? (
          <div className={styles.empty}>
            <p>No businesses match yet. Localites is new and businesses are still being added, so try fewer filters or a broader word.</p>
            <Link to={`/suggest${filters.q ? `?q=${encodeURIComponent(filters.q)}` : ''}`} className="text-link">
              Suggest a business
            </Link>
          </div>
        ) : (
          rails.map((r) => <Rail key={`${r.slug}-${visit}`} rail={r} signedIn={signedIn} />)
        )}

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
      <ShortlistBar items={shortlist} />
    </>
  );
}
