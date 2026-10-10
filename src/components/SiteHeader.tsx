import { Link } from 'react-router';
import styles from './SiteHeader.module.css';

/** The wordmark always returns Home (design system §7). */
export function SiteHeader() {
  return (
    <header className={styles.header}>
      <Link to="/explore" className={styles.wordmark}>
        Localites
      </Link>
    </header>
  );
}
