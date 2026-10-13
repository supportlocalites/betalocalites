import { useEffect, useRef, useState } from 'react';
import type { VendorPhoto } from './VendorPage';
import styles from './PhotoViewer.module.css';

/** How far a finger moves sideways, in CSS pixels, before it counts as a swipe. */
const SWIPE = 48;

/**
 * A business's photos, one at a time and as large as the screen allows, always whole: swipe
 * or use the arrows (on screen or on the keyboard), Escape or × to close. The page underneath
 * stays where it was, and focus goes back to the photo that was opened.
 */
export function PhotoViewer({ photos, start, onClose }: { photos: VendorPhoto[]; start: number; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [at, setAt] = useState(start);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const count = photos.length;
  const photo = photos[at];
  const go = (step: number) => setAt((i) => (i + step + count) % count);

  useEffect(() => {
    const d = dialog.current;
    // The photo that was opened gets focus back when the viewer closes.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (d && !d.open) d.showModal();
    return () => {
      d?.close();
      opener?.focus();
    };
  }, []);

  // The next and previous photos load while this one is looked at, so moving on is instant.
  const near = count > 1 ? [photos[(at + 1) % count], photos[(at - 1 + count) % count]] : [];

  return (
    <dialog
      ref={dialog}
      className={styles.viewer}
      aria-label={`Photos, ${at + 1} of ${count}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') go(1);
        else if (e.key === 'ArrowLeft') go(-1);
      }}
      onPointerDown={(e) => {
        touch.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const t = touch.current;
        touch.current = null;
        if (!t || count < 2) return;
        const dx = e.clientX - t.x;
        if (Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(e.clientY - t.y)) go(dx < 0 ? 1 : -1);
      }}
    >
      <div className={styles.top}>
        <span className={styles.count} aria-live="polite">
          {at + 1} of {count}
        </span>
        <button type="button" className={styles.button} onClick={onClose} aria-label="Close photos" autoFocus>
          ×
        </button>
      </div>
      {photo && (
        <figure className={styles.figure}>
          <img
            key={photo.id}
            src={photo.url}
            alt={photo.alt}
            width={photo.width ?? undefined}
            height={photo.height ?? undefined}
            className={styles.photo}
            draggable={false}
          />
          <figcaption className={styles.caption}>{photo.alt}</figcaption>
        </figure>
      )}
      {count > 1 && (
        <>
          <button type="button" className={`${styles.button} ${styles.previous}`} onClick={() => go(-1)} aria-label="Previous photo">
            ‹
          </button>
          <button type="button" className={`${styles.button} ${styles.next}`} onClick={() => go(1)} aria-label="Next photo">
            ›
          </button>
        </>
      )}
      <div hidden>{near.map((p) => p && <img key={p.id} src={p.url} alt="" loading="eager" />)}</div>
    </dialog>
  );
}
