/**
 * How a business's square profile photo sits in its square (migration 0019). The owner's
 * framing is a rectangle on the photo, in percentages of the photo's width and height:
 * left, top, width, height. A rectangle bigger than the photo means zoomed out: the photo
 * shows whole and the rest of the square is a soft, blurred copy of it. With no framing
 * chosen, the smart default applies (product owner, 13 October 2026): a photo close to
 * square fills the square, centred; any other shape shows whole.
 * Plain functions with no other imports: the server, the pages and the editor share them.
 */

export type Frame = { x: number; y: number; w: number; h: number };

/** Photos this close to square fill the square by default (at most a fifth is trimmed). */
const NEARLY_SQUARE = 1.25;

/**
 * The most a framing can zoom out: the square at most 5 times the photo's shorter side
 * (500%, as migration 0019 keeps). A photo more than 5 times wider than tall (a banner) shows
 * its middle at this size rather than whole.
 */
const MOST = 500;

/** The smart default for a photo of this width and height (unknown: fill, centred). */
export function defaultFrame(width: number | null, height: number | null): Frame {
  if (!width || !height) return { x: 0, y: 0, w: 100, h: 100 };
  const r = width / height;
  const fill = r <= NEARLY_SQUARE && r >= 1 / NEARLY_SQUARE;
  // The square's side as a share of the photo's width (w) and height (h), centred.
  const centred = (w: number, h: number): Frame => ({ x: (100 - w) / 2, y: (100 - h) / 2, w, h });
  if (r >= 1) {
    // Wide: the square is as tall as the photo (fill) or as wide as the photo (whole).
    if (fill) return centred(100 / r, 100);
    const h = Math.min(100 * r, MOST);
    return centred(h / r, h);
  }
  if (fill) return centred(100, 100 * r);
  const w = Math.min(100 / r, MOST);
  return centred(w, w * r);
}

/** The framing to draw: the owner's, or the smart default. */
export const frameOf = (p: { width: number | null; height: number | null; frame: Frame | null }): Frame =>
  p.frame ?? defaultFrame(p.width, p.height);

/** True when the photo doesn't cover the whole square, so the blurred copy shows behind it. */
export const showsBackdrop = (f: Frame) => f.x < -0.5 || f.y < -0.5 || f.x + f.w > 100.5 || f.y + f.h > 100.5;

/**
 * Where to draw the photo inside its square, as CSS percentages of the square: the framed
 * rectangle of the photo exactly fills the square.
 */
export function placement(f: Frame): { left: string; top: string; width: string; height: string } {
  const pct = (n: number) => `${Math.round(n * 1000) / 1000}%`;
  return { left: pct((-f.x / f.w) * 100), top: pct((-f.y / f.h) * 100), width: pct((100 / f.w) * 100), height: pct((100 / f.h) * 100) };
}

/** A framing from the page, checked: four finite numbers in sensible ranges, or null. */
export function readFrame(raw: { x?: unknown; y?: unknown; w?: unknown; h?: unknown }): Frame | null {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const n = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? r(Number(v)) : NaN);
  // Rounded first, then checked: exactly what the database will keep.
  const f = { x: n(raw.x), y: n(raw.y), w: n(raw.w), h: n(raw.h) };
  if (![f.x, f.y, f.w, f.h].every(Number.isFinite)) return null;
  if (f.w <= 0 || f.w > MOST || f.h <= 0 || f.h > MOST || f.x < -400 || f.x > 100 || f.y < -400 || f.y > 100) return null;
  return f;
}

/**
 * A framing pulled back into the range the database keeps (migration 0019): the framing
 * screen lets the photo be dragged freely, and a photo dragged almost out of the square is
 * kept just in range rather than refused.
 */
export function keepInRange(f: Frame): Frame {
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  const r = (v: number) => Math.round(v * 1000) / 1000;
  // Too zoomed out: shrink the square about its middle, keeping it square on the photo.
  const k = Math.min(1, MOST / Math.max(f.w, f.h));
  const w = Math.max(0.001, f.w * k);
  const h = Math.max(0.001, f.h * k);
  const x = f.x + (f.w - w) / 2;
  const y = f.y + (f.h - h) / 2;
  return { x: r(clamp(x, -400, 100)), y: r(clamp(y, -400, 100)), w: r(w), h: r(h) };
}
