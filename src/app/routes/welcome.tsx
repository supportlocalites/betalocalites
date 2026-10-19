import { Link } from 'react-router';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Wordmark } from '@/components/Wordmark';
import { shareMeta } from '@/lib/meta';
import type { Route } from './+types/welcome';
import styles from './welcome.module.css';

export const meta: Route.MetaFunction = ({ matches }) => shareMeta(matches, '/');

export default function Welcome() {
  return (
    <main className={styles.screen}>
      <div className={styles.frame}>
        <ThemeToggle className={styles.theme} />
        <div className={styles.words}>
          <h1 className={styles.name}>
            <Wordmark />
          </h1>
          <div className={styles.rule} aria-hidden="true" />
          <p className={styles.sub}>
            <span>Love where you live</span>
          </p>
        </div>
        <div className={styles.actions}>
          <Link to="/explore" className="button button-primary">
            Browse local
          </Link>
          <Link to="/events/new" className="button button-secondary">
            Plan an event
          </Link>
        </div>
      </div>
    </main>
  );
}
