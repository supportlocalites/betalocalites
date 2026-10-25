import { useEffect, useId, useRef, useState } from 'react';
import { Link, useFetcher, useLocation } from 'react-router';
import type { ShortlistItem } from '@/server/browse.server';
import { useCloseOutside } from './useCloseOutside';
import styles from './ShortlistBar.module.css';

/** How long "Picks cleared · Undo" stays (the owner, 25 October 2026). */
const UNDO_MS = 6000;

const businesses = (n: number) => `${n} ${n === 1 ? 'business' : 'businesses'}`;
/** As the event's Message all counts them: only those on Localites can be messaged. */
const messageWords = (n: number) => (n === 1 ? 'Message 1' : n === 0 ? 'Message all' : `Message all ${n}`);

/**
 * My picks (D-57, the shortlist; renamed by the owner, 25 October 2026), along the bottom of
 * Browse local when something is on it. On a computer, Style A: a quiet dark bar with each
 * business, its own category and an ×, then Clear all and Message all. On a phone, Style C: a
 * dark dock with the photos and how many, which opens the list (× on each), and Clear all and
 * Message all always in reach. After Clear all, "Picks cleared · Undo" puts them back.
 */
export function ShortlistBar({ items }: { items: ShortlistItem[] }) {
  const location = useLocation();
  const back = location.pathname + location.search;
  const clear = useFetcher();
  const undo = useFetcher();
  // What Clear all took off, while Undo is offered; and what Undo is putting back.
  const [cleared, setCleared] = useState<ShortlistItem[] | null>(null);
  const [restoring, setRestoring] = useState<ShortlistItem[]>([]);
  // Undo couldn't put them all back (the picks filled up meanwhile): said once, until OK.
  const [seen, setSeen] = useState<unknown>(null);
  const undoError = undo.state === 'idle' && seen !== undo.data ? (undo.data as { error?: string | null } | undefined)?.error : null;

  useEffect(() => {
    if (!cleared) return;
    const id = setTimeout(() => setCleared(null), UNDO_MS);
    return () => clearTimeout(id);
  }, [cleared]);

  const shown = clear.state !== 'idle' ? [] : items.length === 0 && undo.state !== 'idle' ? restoring : items;

  return (
    <>
      {shown.length > 0 && <Bar items={shown} back={back} clear={clear} onClear={() => setCleared(items)} />}
      {undoError && (
        <div className={styles.undo} role="status">
          <span className={styles.undoWords}>{undoError}</span>
          <button type="button" className={styles.undoButton} onClick={() => setSeen(undo.data)}>
            OK
          </button>
        </div>
      )}
      {cleared && shown.length === 0 && (
        <div className={styles.undo} role="status">
          <span>Picks cleared</span>
          <undo.Form
            method="post"
            action="/shortlist"
            preventScrollReset
            onSubmit={() => {
              setRestoring(cleared);
              setCleared(null);
            }}
          >
            <input type="hidden" name="intent" value="restore" />
            <input type="hidden" name="slugs" value={cleared.map((i) => i.slug).join(',')} />
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="inline" value="1" />
            <button type="submit" className={styles.undoButton}>
              Undo
            </button>
          </undo.Form>
        </div>
      )}
    </>
  );
}

function Bar({ items, back, clear, onClear }: { items: ShortlistItem[]; back: string; clear: ReturnType<typeof useFetcher>; onClear: () => void }) {
  const canMessage = items.filter((i) => i.canMessage).length;
  const tray = useRef<HTMLDetailsElement>(null);
  const trayId = useId();
  useCloseOutside(tray);
  const actions = (
    <>
      <clear.Form method="post" action="/shortlist" preventScrollReset onSubmit={onClear}>
        <input type="hidden" name="intent" value="clear" />
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="inline" value="1" />
        <button type="submit" className={styles.clearAll}>
          Clear all
        </button>
      </clear.Form>
      <Link to="/shortlist/message" className={styles.message}>
        {messageWords(canMessage)}
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={styles.icon}>
          <path d="M5 12h13M13 7l5 5-5 5" />
        </svg>
      </Link>
    </>
  );
  return (
    <aside className={styles.bar} aria-label="My picks">
      {/* Computers: Style A. */}
      <div className={styles.wide}>
        <p className={styles.count}>
          <span className={styles.label}>My picks</span>
          <span className={styles.number}>{businesses(items.length)}</span>
        </p>
        <div className={styles.scroller}>
          <ul className={styles.items}>
            {items.map((i) => (
              <Item key={i.slug} item={i} back={back} />
            ))}
          </ul>
        </div>
        <div className={styles.actions}>{actions}</div>
      </div>
      {/* Phones: Style C. */}
      <div className={styles.dock}>
        <details className={styles.tray} ref={tray}>
          <summary className={styles.open} aria-controls={trayId}>
            <span className={styles.faces} aria-hidden="true">
              {items.slice(0, 4).map((i) => (i.photo ? <img key={i.slug} src={i.photo} alt="" /> : <span key={i.slug} />))}
            </span>
            <span className={styles.dockWords}>
              <b>{`${items.length} ${items.length === 1 ? 'pick' : 'picks'}`}</b>
              <small className={styles.see}>See the list</small>
              <small className={styles.hide}>Hide the list</small>
            </span>
            <span className={styles.chevron} aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false" className={styles.icon}>
                <path d="m6 15 6-6 6 6" />
              </svg>
            </span>
          </summary>
          <ul id={trayId} className={styles.list}>
            {items.map((i) => (
              <Item key={i.slug} item={i} back={back} />
            ))}
          </ul>
        </details>
        <div className={styles.dockActions}>{actions}</div>
      </div>
    </aside>
  );
}

function Item({ item, back }: { item: ShortlistItem; back: string }) {
  const fetcher = useFetcher();
  if (fetcher.formData) return null;
  return (
    <li className={styles.item}>
      {item.photo ? <img src={item.photo} alt="" className={styles.thumb} /> : <span className={styles.thumb} aria-hidden="true" />}
      <span className={styles.words}>
        <span className={styles.name}>{item.name}</span>
        <span className={styles.kind}>{item.kind}</span>
      </span>
      <fetcher.Form method="post" action="/shortlist" preventScrollReset>
        <input type="hidden" name="intent" value="remove" />
        <input type="hidden" name="slug" value={item.slug} />
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="inline" value="1" />
        <button type="submit" className={styles.remove} aria-label={`Remove ${item.name} from my picks`} title="Remove from my picks">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={styles.icon}>
            <path d="M7 7l10 10M17 7 7 17" />
          </svg>
        </button>
      </fetcher.Form>
    </li>
  );
}
