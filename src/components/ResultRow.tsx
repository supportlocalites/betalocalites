import { Link } from 'react-router';
import type { VendorResult } from '@/server/catalog.server';
import styles from './ResultRow.module.css';

/** Results in order. Each place is numbered (data-pos) for counting what's seen (ADR-030). */
export function ResultList({ vendors, listId = null }: { vendors: Omit<VendorResult, 'id'>[]; listId?: string | null }) {
  return (
    <ul className={styles.list}>
      {vendors.map((v, i) => (
        <li key={v.slug} className={styles.row} data-pos={i + 1}>
          <Link to={`/vendors/${v.slug}`} state={listId ? { pos: i + 1, list: listId } : undefined} className={styles.link}>
            <span className={styles.thumb} aria-hidden="true" />
            <span>
              <span className={styles.name}>{v.name}</span>
              <br />
              <span className={styles.meta}>
                {v.town}
                {v.tagline ? ` · ${v.tagline}` : ''}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
