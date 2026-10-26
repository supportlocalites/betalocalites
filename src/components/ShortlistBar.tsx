import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useFetcher, useLocation } from 'react-router';
import type { ShortlistItem } from '@/server/browse.server';
import { picksUndo } from './picksUndo';
import { useCloseOutside } from './useCloseOutside';
import styles from './ShortlistBar.module.css';

/**
 * How long "… removed · Undo" stays, then fades (the owner, 26 October 2026: "keep it up for 2
 * seconds and then let it fade away"); a click anywhere else fades it at once ("me clicking on
 * something else shows I do not want to undo"). The pointer resting on it keeps it up.
 */
const UNDO_MS = 2000;
/** From the keyboard it takes longer to reach Undo, so it waits longer (and while focus is on it). */
const UNDO_KEYBOARD_MS = 8000;
const FADE_MS = 300;

const businesses = (n: number) => `${n} ${n === 1 ? 'business' : 'businesses'}`;
/** As the event's Message all counts them: only those on Localites can be messaged. */
const messageWords = (n: number) => (n === 1 ? 'Message 1' : n === 0 ? 'Message all' : `Message all ${n}`);

/**
 * My picks (D-57, the shortlist; renamed by the owner, 25 October 2026), at the bottom of Browse
 * local when something is on it: the hairline pill (the owner, 26 October 2026: "I like hair line
 * for picks"), one small white pill on every screen with the businesses' faces and how many, which
 * opens the list above it (× on each), then Clear and Message all. After any removal, one or all,
 * "… removed · Undo" puts them back.
 */
export function ShortlistBar({ items }: { items: ShortlistItem[] }) {
  const location = useLocation();
  const back = location.pathname + location.search;
  const clear = useFetcher();
  const undo = useFetcher();
  const removed = useSyncExternalStore(picksUndo.subscribe, picksUndo.get, picksUndo.none);
  // Undo couldn't put them all back (the picks filled up meanwhile): said once, until OK.
  const [seen, setSeen] = useState<unknown>(null);
  const undoError = undo.state === 'idle' && seen !== undo.data ? (undo.data as { error?: string | null } | undefined)?.error : null;

  // The note goes by itself, or at a click anywhere else; each new removal starts again.
  const note = useRef<HTMLDivElement>(null);
  // Which note is fading: a new removal is a new note, so it starts fresh by itself.
  const [fading, setFading] = useState<typeof removed>(null);
  const leaving = removed !== null && fading === removed;
  // Bumped when the pointer or focus leaves the note, to start its time again.
  const [again, setAgain] = useState(0);
  const byKeyboard = useRef(false);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') byKeyboard.current = true;
    };
    const pointer = () => {
      byKeyboard.current = false;
    };
    document.addEventListener('keydown', keys, true);
    document.addEventListener('pointerdown', pointer, true);
    return () => {
      document.removeEventListener('keydown', keys, true);
      document.removeEventListener('pointerdown', pointer, true);
    };
  }, []);
  useEffect(() => {
    if (!removed || leaving) return;
    const id = setTimeout(
      () => {
        // Kept up while the pointer rests on it or focus is in it; leaving starts the time again.
        const n = note.current;
        if (n && (n.matches(':hover') || n.contains(document.activeElement))) return;
        setFading(removed);
      },
      byKeyboard.current ? UNDO_KEYBOARD_MS : UNDO_MS,
    );
    return () => clearTimeout(id);
  }, [removed, leaving, again]);
  useEffect(() => {
    if (!removed || leaving) return;
    // A click (or tap), not a press: scrolling a phone's page isn't saying "no thanks".
    const away = (e: MouseEvent) => {
      if (!note.current?.contains(e.target as Node)) setFading(removed);
    };
    document.addEventListener('click', away, true);
    return () => document.removeEventListener('click', away, true);
  }, [removed, leaving]);
  useEffect(() => {
    if (!leaving) return;
    // By the clock, not the animation's end: with reduced motion there is no animation.
    const id = setTimeout(() => picksUndo.done(), FADE_MS);
    return () => clearTimeout(id);
  }, [leaving]);

  const shown = clear.state !== 'idle' ? [] : items;

  return (
    <>
      {shown.length > 0 && <Bar items={shown} back={back} clear={clear} onClear={() => picksUndo.cleared(items.map((i) => i.slug))} />}
      {undoError && (
        <div className={`${styles.undo} ${shown.length > 0 ? styles.undoAbove : ''}`} role="status">
          <span className={styles.undoWords}>{undoError}</span>
          <button type="button" className={styles.undoButton} onClick={() => setSeen(undo.data)}>
            OK
          </button>
        </div>
      )}
      {removed && !undoError && (
        <div
          ref={note}
          className={`${styles.undo} ${shown.length > 0 ? styles.undoAbove : ''} ${leaving ? styles.undoOut : ''}`}
          role="status"
          onPointerLeave={() => setAgain((n) => n + 1)}
          onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setAgain((n) => n + 1)}
        >
          <span className={styles.undoWords}>{removed.words}</span>
          <undo.Form method="post" action="/shortlist" preventScrollReset onSubmit={() => picksUndo.done()}>
            <input type="hidden" name="intent" value="restore" />
            <input type="hidden" name="slugs" value={removed.slugs.join(',')} />
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
  return (
    <aside className={styles.bar} aria-label="My picks">
      <div className={styles.pill}>
        <details className={styles.tray} ref={tray}>
          <summary className={styles.open} aria-controls={trayId}>
            <span className={styles.faces} aria-hidden="true">
              {items.slice(0, 3).map((i) => (i.photo ? <img key={i.slug} src={i.photo} alt="" /> : <span key={i.slug} />))}
            </span>
            <span className={styles.count}>{`${items.length} ${items.length === 1 ? 'pick' : 'picks'}`}</span>
            <span className="visually-hidden">: {businesses(items.length)}, show or hide the list</span>
          </summary>
          <ul id={trayId} className={styles.list}>
            {items.map((i) => (
              <Item key={i.slug} item={i} back={back} />
            ))}
          </ul>
        </details>
        <clear.Form method="post" action="/shortlist" preventScrollReset onSubmit={onClear}>
          <input type="hidden" name="intent" value="clear" />
          <input type="hidden" name="back" value={back} />
          <input type="hidden" name="inline" value="1" />
          <button type="submit" className={styles.clearAll} aria-label="Clear all my picks">
            Clear
          </button>
        </clear.Form>
        <Link to="/shortlist/message" className={styles.message}>
          {messageWords(canMessage)}
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
      {item.photo ? <img src={item.photo} alt="" className={styles.thumb} /> : <span className={styles.thumb} aria-hidden="true" />}
      <span className={styles.words}>
        <span className={styles.name}>{item.name}</span>
        <span className={styles.kind}>{item.kind}</span>
      </span>
      <fetcher.Form method="post" action="/shortlist" preventScrollReset onSubmit={() => picksUndo.removed(item.slug, item.name)}>
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
