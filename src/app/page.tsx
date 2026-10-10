import Link from 'next/link';
import styles from './page.module.css';

export default function Welcome() {
  return (
    <main className={styles.screen}>
      <div className={styles.frame}>
        <div className={styles.words}>
          <span className="label">Welcome to</span>
          <h1 className={styles.name}>Localites.</h1>
          <div className={styles.rule} aria-hidden="true" />
          <p className={styles.sub}>
            <span>See what your community</span>
            <span>has to offer…</span>
          </p>
        </div>
        <div className={styles.actions}>
          <Link href="/explore" className="button button-primary">
            Browse local
          </Link>
        </div>
      </div>
    </main>
  );
}
