import { Link } from 'react-router';
import { Wordmark } from '@/components/Wordmark';
import { pageMeta } from '@/lib/meta';
import type { Route } from './+types/welcome';
import styles from './welcome.module.css';

export const meta: Route.MetaFunction = () => pageMeta();

export default function Welcome() {
  return (
    <main className={styles.screen}>
      <div className={styles.frame}>
        <div className={styles.words}>
          <span className="label">Welcome to</span>
          <h1 className={styles.name}>
            <Wordmark suffix="." />
          </h1>
          <div className={styles.rule} aria-hidden="true" />
          <p className={styles.sub}>
            <span>See what your community</span>
            <span>has to offer…</span>
          </p>
        </div>
        <div className={styles.actions}>
          <Link to="/explore" className="button button-primary">
            Browse local
          </Link>
        </div>
      </div>
    </main>
  );
}
