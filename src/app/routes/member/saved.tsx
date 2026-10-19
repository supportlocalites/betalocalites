import { useRef } from 'react';
import { Link } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { CardGrid } from '@/components/BrowseCard';
import { ShortlistBar } from '@/components/ShortlistBar';
import { SideSwitch } from '@/components/SideSwitch';
import { SiteHeader } from '@/components/SiteHeader';
import { pageMeta } from '@/lib/meta';
import { browse } from '@/server/browse.server';
import { savedVendors } from '@/server/events.server';
import type { Route } from './+types/saved';
import styles from '../explore.module.css';

/**
 * Screen C6: the person's favourites (the bookmark, D-57), as the same cards as Browse local:
 * the bookmark takes one off, + adds it to the shortlist. Private: businesses aren't told (B §4).
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Your favourites'), { name: 'robots', content: 'noindex' }];

export async function loader({ context }: Route.LoaderArgs) {
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const [found, { onTeam }] = await Promise.all([
    browse(env, member.userId, { q: '', town: null, cost: null, minRating: null, sort: 'new', view: 'list', savedOnly: true }),
    savedVendors(env, member.userId),
  ]);
  return { favourites: found.onMap, shortlist: found.shortlist, onTeam };
}

export default function Saved({ loaderData }: Route.ComponentProps) {
  const { favourites, shortlist, onTeam } = loaderData;
  const ref = useRef<HTMLUListElement>(null);
  return (
    <>
      <SiteHeader />
      <main className={`page ${shortlist.length > 0 ? styles.withBar : ''}`}>
        {onTeam && <SideSwitch current="events" />}
        <h1 className="title-1">Your favourites</h1>
        <div className="title-rule" aria-hidden="true" />
        <p className="muted">Only you can see this list. Businesses aren’t told when you save them as a favourite.</p>
        {favourites.length === 0 ? (
          <p>No favourites yet. Tap the bookmark on any business to keep it here.</p>
        ) : (
          <CardGrid items={favourites} signedIn listId={null} listRef={ref} />
        )}
        <p className="section-gap">
          <Link to="/explore" className="text-link">
            Browse local
          </Link>{' '}
          <Link to="/events" className="text-link">
            My events
          </Link>
        </p>
      </main>
      <ShortlistBar items={shortlist} />
    </>
  );
}
