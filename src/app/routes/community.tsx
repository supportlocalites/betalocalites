import { Link } from 'react-router';
import { TopBar } from '@/components/TopBar';
import { shareMeta } from '@/lib/meta';
import type { Route } from './+types/community';
import styles from './info.module.css';

/**
 * Community (D-62): its own page, reached from the bar along the top of Messages. It isn't
 * built yet, and the page says so plainly (no pretend questions); what it will be is in the
 * owner's decisions (the Community mock-up).
 */
export const meta: Route.MetaFunction = ({ matches }) =>
  shareMeta(matches, '/community', 'Community', 'Questions and answers from people near you, about local businesses. Coming soon.');

export default function Community() {
  return (
    <>
      <TopBar />
      <main className="page">
        <h1 className="title-1">Community</h1>
        <div className="title-rule" aria-hidden="true" />
        <p className={styles.intro}>
          Coming soon: a place to ask people near you things like “Who makes the best dinosaur cakes?”, suggest the local businesses you’d
          recommend and why, and vote for the most helpful answers. It isn’t open yet.
        </p>
        <p>
          <Link to="/explore" className="button button-primary">
            Browse local businesses
          </Link>
        </p>
      </main>
    </>
  );
}
