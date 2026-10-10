import Link from 'next/link';
import styles from './SiteHeader.module.css';

/** The wordmark always returns Home (design system §7). */
export function SiteHeader() {
  return (
    <header className={styles.header}>
      <Link href="/explore" className={styles.wordmark}>
        Localites
      </Link>
    </header>
  );
}
