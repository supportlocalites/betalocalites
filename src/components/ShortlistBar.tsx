import { Link, useFetcher, useLocation } from 'react-router';
import type { ShortlistItem } from '@/server/browse.server';
import styles from './ShortlistBar.module.css';

/**
 * The shortlist bar along the bottom of Browse local (D-57): only when something is on the
 * shortlist. Each business with its kind and an × to take it off; then "Add these to an event".
 */
export function ShortlistBar({ items }: { items: ShortlistItem[] }) {
  const location = useLocation();
  if (items.length === 0) return null;
  return (
    <aside className={styles.bar} aria-label="Your shortlist">
      <div className={styles.inner}>
        <p className={styles.count}>
          <span className={styles.label}>Your shortlist</span>
          <span className={styles.number}>{`${items.length} ${items.length === 1 ? 'business' : 'businesses'}`}</span>
        </p>
        <ul className={styles.items}>
          {items.map((i) => (
            <Item key={i.slug} item={i} back={location.pathname + location.search} />
          ))}
        </ul>
        <Link to="/shortlist" className={styles.go}>
          Add these to an event
        </Link>
      </div>
    </aside>
  );
}

function Item({ item, back }: { item: ShortlistItem; back: string }) {
  const fetcher = useFetcher();
  if (fetcher.formData) return null;
  return (
    <li className={styles.item}>
      {item.photo && <img src={item.photo} alt="" className={styles.thumb} />}
      <span className={styles.words}>
        <span className={styles.label}>{item.kind}</span>
        <span className={styles.name}>{item.name}</span>
      </span>
      <fetcher.Form method="post" action="/shortlist" preventScrollReset>
        <input type="hidden" name="intent" value="remove" />
        <input type="hidden" name="slug" value={item.slug} />
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="inline" value="1" />
        <button type="submit" className={styles.remove} aria-label={`Remove ${item.name} from your shortlist`} title="Remove from shortlist">
          ×
        </button>
      </fetcher.Form>
    </li>
  );
}
