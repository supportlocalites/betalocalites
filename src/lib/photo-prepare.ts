/**
 * Runs in the owner's browser: turns the photo they chose (a phone photo of several MB,
 * any type the browser can open, including iPhone photos in Safari) into the two small
 * files Localites stores: up to 1600 pixels a side for the business page, and up to 640
 * for lists. Redrawing the picture also leaves behind the hidden details phones add
 * (where and when it was taken). The server checks the result again (src/lib/image-file.ts).
 */

const LARGE = { side: 1600, bytes: 1000 * 1024 };
const SMALL = { side: 640, bytes: 240 * 1024 };
const QUALITIES = [0.82, 0.72, 0.6, 0.5];

export type Prepared = { large: File; small: File };

function load(file: File): Promise<{ image: HTMLImageElement; done: () => void }> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  return image.decode().then(
    () => ({ image, done: () => URL.revokeObjectURL(url) }),
    (err: unknown) => {
      URL.revokeObjectURL(url);
      throw err;
    },
  );
}

function draw(image: HTMLImageElement, side: number): HTMLCanvasElement {
  const scale = Math.min(1, side / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  // A see-through picture gets the page's light background (tokens.css), not black.
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim() || 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const blob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/** WebP where the browser can make it (smaller), otherwise JPEG (older Safari). */
async function bestType(): Promise<'image/webp' | 'image/jpeg'> {
  const test = document.createElement('canvas');
  test.width = test.height = 2;
  return (await blob(test, 'image/webp', 0.8))?.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
}

async function encode(image: HTMLImageElement, limits: { side: number; bytes: number }, type: string, name: string): Promise<File> {
  for (const side of [limits.side, Math.round(limits.side * 0.75)]) {
    const canvas = draw(image, side);
    for (const q of QUALITIES) {
      const b = await blob(canvas, type, q);
      if (b && b.type === type && b.size <= limits.bytes) return new File([b], name, { type });
    }
  }
  throw new Error('too big');
}

/** The two files to send, or null if this browser can't open the chosen file as a picture. */
export async function preparePhoto(file: File): Promise<Prepared | null> {
  let loaded: Awaited<ReturnType<typeof load>>;
  try {
    loaded = await load(file);
  } catch {
    return null;
  }
  try {
    const type = await bestType();
    const ext = type === 'image/webp' ? 'webp' : 'jpg';
    return {
      large: await encode(loaded.image, LARGE, type, `photo.${ext}`),
      small: await encode(loaded.image, SMALL, type, `photo-small.${ext}`),
    };
  } catch {
    return null;
  } finally {
    loaded.done();
  }
}

/**
 * One photo for a conversation (migration 0028): the same shrinking (up to 1600 pixels a side,
 * under 1 MB, hidden details left behind), keeping the name the sender gave it. Null if this
 * browser can't open the chosen file as a picture.
 */
export async function prepareOnePhoto(file: File): Promise<File | null> {
  let loaded: Awaited<ReturnType<typeof load>>;
  try {
    loaded = await load(file);
  } catch {
    return null;
  }
  try {
    const type = await bestType();
    const stem = file.name.replace(/\.[^.]*$/, '') || 'photo';
    return await encode(loaded.image, LARGE, type, `${stem}.${type === 'image/webp' ? 'webp' : 'jpg'}`);
  } catch {
    return null;
  } finally {
    loaded.done();
  }
}
