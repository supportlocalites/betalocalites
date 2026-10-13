import { useEffect, useRef, useState } from 'react';
import Cropper, { type Area, type MediaSize } from 'react-easy-crop';
import { defaultFrame, type Frame, keepInRange } from '@/lib/photo-frame';
import { SquarePhoto } from './SquarePhoto';
import styles from './FramingEditor.module.css';

/** How much of the stage the square takes; the rest shows what's left out. */
const SQUARE_SHARE = 0.84;

/**
 * The full-screen "Frame your profile photo" step (product owner, 13 October 2026; research
 * on Instagram, LinkedIn, Facebook, Canva and Etsy). The square stays big and still; the owner
 * moves the photo under it with one finger and zooms with two (or the slider and − / +).
 * What falls outside the square is dimmed, not hidden. "Fill the square" and "Show whole
 * photo" are one tap each; a live preview shows the result in a list and on the page. The
 * stored photo is never changed: only the framing is saved, so "Start again" always works.
 */
export function FramingEditor({
  src,
  width,
  height,
  frame,
  alt,
  name,
  town,
  busy,
  error,
  onSave,
  onClose,
}: {
  src: string;
  width: number | null;
  height: number | null;
  frame: Frame | null;
  alt: string;
  name: string;
  town: string;
  busy: boolean;
  /** Why the last save didn't work, if it didn't. */
  error: string | null;
  onSave: (frame: Frame) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState(0);
  const [media, setMedia] = useState<MediaSize | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Frame>(frame ?? defaultFrame(width, height));
  // "Start again" draws the editor afresh from the smart default (nothing is saved until Save).
  const [start, setStart] = useState<{ frame: Frame; round: number }>({ frame: frame ?? defaultFrame(width, height), round: 0 });

  useEffect(() => {
    const d = dialog.current;
    // What opened the screen gets focus back when it closes (the page may have redrawn it).
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (d && !d.open) d.showModal();
    const el = stage.current;
    const measure = () => el && setStageSize(el.clientWidth);
    const watch = new ResizeObserver(measure);
    if (el) {
      measure();
      watch.observe(el);
    }
    return () => {
      watch.disconnect();
      d?.close();
      if (opener && opener !== document.body && opener.isConnected) opener.focus();
      else document.getElementById('profile-title')?.focus();
    };
  }, []);

  const side = Math.round(stageSize * SQUARE_SHARE);
  const cropSize = side > 0 ? { width: side, height: side } : undefined;
  // At zoom 1 the photo fits the (square) stage. From its shape, the zoom levels where it
  // exactly fills the square, or exactly fits inside it (whole). Known before it loads, so the
  // saved framing is applied exactly.
  const shape = width && height ? width / height : media ? media.naturalWidth / media.naturalHeight : 1;
  const across = Math.min(1, shape); // the photo's width, then height, at zoom 1, as shares of the stage
  const down = Math.min(1, 1 / shape);
  const fill = Math.max(SQUARE_SHARE / across, SQUARE_SHARE / down);
  const whole = Math.min(SQUARE_SHARE / across, SQUARE_SHARE / down);
  // Never smaller than a fifth of the square across (the database keeps framings up to 500%).
  const minZoom = Math.max(Math.min(whole, fill), fill / 5);
  const maxZoom = fill * 4;
  const step = (fill - minZoom) / 10 || 0.1;
  const setClamped = (z: number) => setZoom(Math.min(maxZoom, Math.max(minZoom, z)));

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="framing-title" onCancel={onClose}>
      <div className={styles.top}>
        <h2 id="framing-title" className={styles.title}>
          Frame your profile photo
        </h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close without saving">
          ×
        </button>
      </div>
      <p className={styles.hint}>Drag the photo to move it. Pinch, or use the slider, to zoom. What’s outside the square is left out.</p>

      <div ref={stage} className={styles.stage}>
        {stageSize > 0 && (
          <Cropper
            key={start.round}
            image={src}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropSize={cropSize}
            minZoom={minZoom}
            maxZoom={maxZoom}
            restrictPosition={false}
            objectFit="contain"
            showGrid
            zoomWithScroll
            initialCroppedAreaPercentages={{ x: start.frame.x, y: start.frame.y, width: start.frame.w, height: start.frame.h }}
            onCropChange={setCrop}
            onZoomChange={setClamped}
            onMediaLoaded={setMedia}
            onCropAreaChange={(a: Area) => setArea({ x: a.x, y: a.y, w: a.width, h: a.height })}
            disableAutomaticStylesInjection
            classes={{
              containerClassName: styles.container,
              // Drawn to fit the stage at zoom 1 even when smaller (the library doesn't enlarge
              // small photos), so the zoom levels above hold for a small logo too.
              mediaClassName: `${styles.media} ${shape >= 1 ? styles.wide : styles.tall}`,
              cropAreaClassName: styles.cropArea,
            }}
            mediaProps={{ alt }}
          />
        )}
      </div>

      <div className={styles.controls}>
        <div className={styles.zoomRow}>
          <button type="button" className={styles.round} onClick={() => setClamped(zoom - step)} aria-label="Zoom out">
            −
          </button>
          <label className="visually-hidden" htmlFor="framing-zoom">
            Zoom
          </label>
          <input
            id="framing-zoom"
            type="range"
            className={styles.slider}
            min={minZoom}
            max={maxZoom}
            step={(maxZoom - minZoom) / 200 || 0.01}
            value={zoom}
            onChange={(e) => setClamped(Number(e.target.value))}
          />
          <button type="button" className={styles.round} onClick={() => setClamped(zoom + step)} aria-label="Zoom in">
            +
          </button>
        </div>
        <div className={styles.choices}>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setCrop({ x: 0, y: 0 });
              setZoom(fill);
            }}
          >
            Fill the square
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setCrop({ x: 0, y: 0 });
              setZoom(Math.max(whole, minZoom));
            }}
          >
            Show whole photo
          </button>
        </div>

        <div className={styles.preview} aria-label="How it will look">
          <span className="label">How it will look</span>
          <div className={styles.previewRow}>
            <SquarePhoto photo={{ url: src, width, height, frame: area }} alt="" />
            <span>
              <span className={styles.previewName}>{name}</span>
              <br />
              <span className="muted">{town}</span>
            </span>
          </div>
        </div>

        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        <div className={styles.finish}>
          <button type="button" className="button button-primary" disabled={busy} onClick={() => onSave(keepInRange(area))}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className="text-link"
            disabled={busy}
            onClick={() => setStart((s) => ({ frame: defaultFrame(width, height), round: s.round + 1 }))}
          >
            Start again
          </button>
          <button type="button" className="text-link" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
