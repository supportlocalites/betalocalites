import Link from 'next/link';
import type { VendorResult } from '@/server/catalog';
import styles from './ResultRow.module.css';

export function ResultList({ vendors }: { vendors: VendorResult[] }) {
  return (
    <ul className={styles.list}>
      {vendors.map((v) => (
        <li key={v.slug} className={styles.row}>
          <Link href={`/vendors/${v.slug}`} className={styles.link}>
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
