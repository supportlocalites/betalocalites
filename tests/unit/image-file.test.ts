import { describe, expect, it } from 'vitest';
import { checkImage } from '@/lib/image-file';

const bytes = (...parts: (number[] | string | Uint8Array)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : [...p])));
const be16 = (n: number) => [n >> 8, n & 0xff];
const le16 = (n: number) => [n & 0xff, n >> 8];
const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, n >> 16];
const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24];
const has = (b: Uint8Array, s: string) => new TextDecoder('latin1').decode(b).includes(s);

const segment = (marker: number, payload: number[] | string | Uint8Array) => {
  const p = bytes(payload);
  return bytes([0xff, marker], be16(p.length + 2), p);
};
const jpeg = (...middle: Uint8Array[]) =>
  bytes(
    [0xff, 0xd8],
    ...middle,
    segment(0xc0, [8, ...be16(480), ...be16(640), 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]),
    segment(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]),
    [0x12, 0x34, 0x56, 0xff, 0xd9],
  );

const JFIF = 'JFIF\0\x01\x01\0\0\x01\0\x01\0\0';

const chunk = (name: string, payload: number[] | Uint8Array) => {
  const p = bytes(payload);
  return bytes(name, le32(p.length), p, p.length % 2 ? [0] : []);
};
const riff = (...chunks: Uint8Array[]) => {
  const body = bytes(...chunks);
  return bytes('RIFF', le32(body.length + 4), 'WEBP', body);
};
const vp8 = (w: number, h: number) => chunk('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(w), ...le16(h), 0, 0]);

describe('checking a photo', () => {
  it('reads a JPEG’s size and removes its location details, keeping the picture', () => {
    const file = jpeg(segment(0xe0, JFIF), segment(0xe1, 'Exif\0\0GPS 44.6N 79.4W'), segment(0xfe, 'taken at home'));
    const out = checkImage(file);
    expect(out).toMatchObject({ type: 'image/jpeg', width: 640, height: 480 });
    expect(has(out!.bytes, 'GPS')).toBe(false);
    expect(has(out!.bytes, 'taken at home')).toBe(false);
    expect(has(out!.bytes, 'JFIF')).toBe(true);
    expect([...out!.bytes.slice(-5)]).toEqual([0x12, 0x34, 0x56, 0xff, 0xd9]);
  });

  it('checks the whole JPEG: details hidden between scans or after the end are removed', () => {
    const scan = segment(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]);
    const file = bytes(
      [0xff, 0xd8],
      segment(0xe0, JFIF),
      segment(0xc2, [8, ...be16(480), ...be16(640), 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]),
      scan,
      [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56], // picture data with a stuffed byte and a restart marker
      segment(0xe1, 'Exif\0\0GPS between scans'),
      segment(0xfe, 'a comment between scans'),
      scan,
      [0x78, 0x9a],
      [0xff, 0xd9],
      'PK\x03\x04 a zip file after the end, GPS 44.6N',
    );
    const out = checkImage(file)!;
    expect(out).toMatchObject({ type: 'image/jpeg', width: 640, height: 480 });
    expect(has(out.bytes, 'GPS') || has(out.bytes, 'comment') || has(out.bytes, 'PK')).toBe(false);
    expect([...out.bytes.slice(-4)]).toEqual([0x78, 0x9a, 0xff, 0xd9]);
    expect(has(out.bytes, '\x12\xff\x00\x34\xff\xd0\x56')).toBe(true);
  });

  it('drops a JFIF header that carries a thumbnail, and keeps a colour profile', () => {
    const thumb = segment(0xe0, 'JFIF\0\x01\x01\0\0\x01\0\x01\x01\x01HOMEPICTURE');
    const icc = segment(0xe2, 'ICC_PROFILE\0\x01\x01sRGB');
    const mpf = segment(0xe2, 'MPF\0second picture GPS');
    const out = checkImage(jpeg(thumb, icc, mpf))!;
    expect(has(out.bytes, 'HOMEPICTURE') || has(out.bytes, 'MPF')).toBe(false);
    expect(has(out.bytes, 'ICC_PROFILE')).toBe(true);
  });

  it('notices a photo the camera stored on its side (and still removes the note)', () => {
    const tiff = (o: number) => bytes('II*\0', le32(8), le16(1), le16(0x0112), le16(3), le32(1), le16(o), [0, 0], le32(0));
    const sideways = checkImage(jpeg(segment(0xe1, bytes('Exif\0\0', tiff(6)))))!;
    expect(sideways.turned).toBe(true);
    expect(has(sideways.bytes, 'Exif')).toBe(false);
    expect(checkImage(jpeg(segment(0xe1, bytes('Exif\0\0', tiff(1)))))!.turned).toBe(false);
    const be = bytes('MM\0*', [0, 0, 0, 8], [0, 1], [0x01, 0x12], [0, 3], [0, 0, 0, 1], [0, 8], [0, 0], [0, 0, 0, 0]);
    expect(checkImage(jpeg(segment(0xe1, bytes('Exif\0\0', be))))!.turned).toBe(true);
  });

  it('refuses a JPEG with no end', () => {
    const full = jpeg(segment(0xe0, JFIF));
    expect(checkImage(full.slice(0, full.length - 2))).toBeNull();
  });

  it('removes XMP from a JPEG too', () => {
    const out = checkImage(jpeg(segment(0xe1, 'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>Home street</x:xmpmeta>')));
    expect(out && has(out.bytes, 'Home street')).toBe(false);
  });

  it('reads a simple WebP’s size', () => {
    expect(checkImage(riff(vp8(1600, 1200)))).toMatchObject({ type: 'image/webp', width: 1600, height: 1200 });
  });

  it('removes EXIF and XMP from an extended WebP and keeps the file valid', () => {
    const vp8x = chunk('VP8X', [0x0c, 0, 0, 0, ...le24(799), ...le24(599)]);
    const file = riff(vp8x, vp8(800, 600), chunk('EXIF', bytes('GPS 44.6N')), chunk('XMP ', bytes('<x>Home</x>')));
    const out = checkImage(file)!;
    expect(out).toMatchObject({ type: 'image/webp', width: 800, height: 600 });
    expect(has(out.bytes, 'GPS') || has(out.bytes, 'Home')).toBe(false);
    expect((out.bytes[20] ?? 0) & 0x0c).toBe(0);
    const size = new DataView(out.bytes.buffer).getUint32(4, true);
    expect(size).toBe(out.bytes.length - 8);
    expect(checkImage(out.bytes)).toMatchObject({ width: 800, height: 600 });
  });

  it('keeps only the parts of a WebP it knows (picture, transparency, colour profile)', () => {
    const vp8x = chunk('VP8X', [0x20, 0, 0, 0, ...le24(9), ...le24(9)]);
    const out = checkImage(
      riff(vp8x, chunk('ICCP', bytes('sRGB profile')), vp8(10, 10), chunk('ZZZZ', bytes('<html>hidden page</html>'))),
    )!;
    expect(out).toMatchObject({ width: 10, height: 10 });
    expect(has(out.bytes, 'hidden page')).toBe(false);
    expect(has(out.bytes, 'sRGB profile')).toBe(true);
  });

  it('reads a lossless WebP’s size', () => {
    const bits = (639 & 0x3fff) | ((479 & 0x3fff) << 14);
    expect(checkImage(riff(chunk('VP8L', [0x2f, ...le32(bits), 0])))).toMatchObject({ width: 640, height: 480 });
  });

  it('refuses anything else', () => {
    const png = bytes([0x89], 'PNG\r\n\x1a\n', new Uint8Array(30));
    expect(checkImage(png)).toBeNull();
    expect(checkImage(bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(checkImage(new Uint8Array(0))).toBeNull();
    const animated = riff(chunk('VP8X', [0x02, 0, 0, 0, ...le24(9), ...le24(9)]), chunk('ANIM', new Uint8Array(6)));
    expect(checkImage(animated)).toBeNull();
    const full = jpeg(segment(0xe0, 'JFIF\0'));
    expect(checkImage(full.slice(0, 30))).toBeNull(); // cut off before the picture
    const noSize = bytes([0xff, 0xd8], segment(0xda, [0]), [0xff, 0xd9]);
    expect(checkImage(noSize)).toBeNull();
    const webp = riff(vp8(10, 10));
    expect(checkImage(webp.slice(0, webp.length - 2))).toBeNull(); // wrong length
  });
});
