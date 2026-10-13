/**
 * Checking a business photo before it is stored (E §9, ADR-020). The browser shrinks each
 * photo before sending it; the server never trusts that and checks the file itself: its
 * type from its contents (not its name), its width and height, and it removes the parts
 * of the file that can carry where and when it was taken (EXIF, including GPS, and XMP).
 * Only reads headers and copies bytes: cheap enough for Cloudflare's 10 ms (ADR-007).
 */

export type ImageType = 'image/jpeg' | 'image/webp';
/** turned: the camera noted the photo is on its side (EXIF Orientation), a note that is removed with the rest. */
export type CheckedImage = { type: ImageType; width: number; height: number; bytes: Uint8Array<ArrayBuffer>; turned?: boolean };

export const IMAGE_EXTENSION: Record<ImageType, string> = { 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** One byte (0 past the end: every length is checked before it matters). */
const at = (b: Uint8Array, i: number): number => b[i] ?? 0;
const u16be = (b: Uint8Array, i: number) => (at(b, i) << 8) | at(b, i + 1);
const u16le = (b: Uint8Array, i: number) => at(b, i) | (at(b, i + 1) << 8);
const u24le = (b: Uint8Array, i: number) => at(b, i) | (at(b, i + 1) << 8) | (at(b, i + 2) << 16);
const u32le = (b: Uint8Array, i: number) => (u16le(b, i) | (u16le(b, i + 2) << 16)) >>> 0;
const tag = (b: Uint8Array, i: number) => String.fromCharCode(at(b, i), at(b, i + 1), at(b, i + 2), at(b, i + 3));

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// JPEG segments kept: the picture's own tables and frames (C0–CF: frames, Huffman tables;
// DB: quantisation tables; DD: restart interval), a plain JFIF header (APP0 without a
// thumbnail), the colour profile (APP2 "ICC_PROFILE") and Adobe's colour note (APP14).
// Everything else is dropped: EXIF and XMP (APP1), IPTC (APP13), other APPn, comments,
// extension markers, and anything after the end-of-picture marker (second pictures, trailers).
const keepSegment = (marker: number, seg: Uint8Array) => {
  if ((marker >= 0xc0 && marker <= 0xcf) || marker === 0xdb || marker === 0xdd) return true;
  const text = (n: number) => String.fromCharCode(...seg.subarray(4, 4 + n));
  if (marker === 0xe0) return text(5) === 'JFIF\0' && seg.length === 2 + 16; // 16: no thumbnail
  if (marker === 0xe2) return text(12) === 'ICC_PROFILE\0';
  if (marker === 0xee) return text(5) === 'Adobe';
  return false;
};
// Start-of-frame markers, which carry the size (not DHT C4, JPG C8 or DAC CC).
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** The EXIF Orientation in an APP1 segment (1 = upright), or 1 if there's none. */
function orientation(seg: Uint8Array): number {
  if (String.fromCharCode(...seg.subarray(4, 10)) !== 'Exif\0\0') return 1;
  const t = seg.subarray(10);
  const le = at(t, 0) === 0x49; // "II": little-endian
  const r16 = (i: number) => (le ? u16le(t, i) : u16be(t, i));
  const r32 = (i: number) => (le ? u32le(t, i) : ((u16be(t, i) << 16) | u16be(t, i + 2)) >>> 0);
  const ifd = r32(4);
  const count = Math.min(r16(ifd), 200);
  for (let k = 0; k < count; k++) {
    const e = ifd + 2 + 12 * k;
    if (e + 12 > t.length) break;
    if (r16(e) === 0x0112) return r16(e + 8) || 1;
  }
  return 1;
}

/** Where a scan's picture data ends: the next marker that isn't a stuffed byte (FF00) or a restart (FFD0–D7). */
function endOfScan(b: Uint8Array, from: number): number {
  let j = from;
  for (;;) {
    j = b.indexOf(0xff, j);
    if (j < 0 || j + 1 >= b.length) return -1;
    const next = at(b, j + 1);
    if (next === 0xff)
      j += 1; // fill byte before a marker
    else if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) j += 2;
    else return j;
  }
}

function checkJpeg(b: Uint8Array): CheckedImage | null {
  const kept: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  let width = 0;
  let height = 0;
  let scans = 0;
  let turned = false;
  while (i + 2 <= b.length) {
    if (at(b, i) !== 0xff) return null;
    const marker = at(b, i + 1);
    if (marker === 0xff) {
      i += 1; // padding
      continue;
    }
    if (marker === 0xd9) {
      // End of the picture: anything after it is left behind.
      if (!scans) return null;
      kept.push(b.subarray(i, i + 2));
      return { type: 'image/jpeg', width, height, bytes: concat(kept), turned };
    }
    if ((marker >= 0xd0 && marker <= 0xd8) || marker === 0x01 || i + 4 > b.length) return null;
    const length = u16be(b, i + 2);
    if (length < 2 || i + 2 + length > b.length) return null;
    const segment = b.subarray(i, i + 2 + length);
    if (SOF.has(marker)) {
      if (length < 7) return null;
      height = u16be(b, i + 5);
      width = u16be(b, i + 7);
    }
    if (marker === 0xda) {
      // Start of a scan: its header, then picture data up to the next marker.
      if (!width || !height) return null;
      const end = endOfScan(b, i + 2 + length);
      if (end < 0) return null;
      kept.push(b.subarray(i, end));
      scans += 1;
      i = end;
      continue;
    }
    if (marker === 0xe1 && orientation(segment) !== 1) turned = true;
    if (keepSegment(marker, segment)) kept.push(segment);
    i += 2 + length;
  }
  return null;
}

function checkWebp(b: Uint8Array): CheckedImage | null {
  if (b.length < 20 || tag(b, 8) !== 'WEBP') return null;
  if (u32le(b, 4) + 8 !== b.length) return null;
  const kept: Uint8Array[] = [];
  let width = 0;
  let height = 0;
  let vp8x: Uint8Array | null = null;
  let picture = false;
  let i = 12;
  while (i + 8 <= b.length) {
    const name = tag(b, i);
    const size = u32le(b, i + 4);
    const end = i + 8 + size + (size % 2);
    if (end > b.length) return null;
    const d = i + 8;
    if (name === 'VP8X') {
      if (size < 10) return null;
      if (at(b, d) & 0x02) return null; // moving pictures aren't accepted
      width = u24le(b, d + 4) + 1;
      height = u24le(b, d + 7) + 1;
      vp8x = b.slice(i, end);
      kept.push(vp8x);
    } else if (name === 'VP8 ') {
      if (size < 10 || at(b, d + 3) !== 0x9d || at(b, d + 4) !== 0x01 || at(b, d + 5) !== 0x2a) return null;
      if (!vp8x) {
        width = u16le(b, d + 6) & 0x3fff;
        height = u16le(b, d + 8) & 0x3fff;
      }
      picture = true;
      kept.push(b.subarray(i, end));
    } else if (name === 'VP8L') {
      if (size < 5 || at(b, d) !== 0x2f) return null;
      if (!vp8x) {
        const bits = u32le(b, d + 1);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
      }
      picture = true;
      kept.push(b.subarray(i, end));
    } else if (name === 'ANIM' || name === 'ANMF') {
      return null;
    } else if (name === 'ICCP' || name === 'ALPH') {
      kept.push(b.subarray(i, end)); // colour profile and transparency; any other chunk (EXIF, XMP, unknown) is dropped
    }
    i = end;
  }
  if (i !== b.length || !picture || !width || !height) return null;
  if (vp8x) vp8x[8] = at(vp8x, 8) & ~0x0c; // no EXIF or XMP any more
  const body = concat(kept);
  const out = new Uint8Array(12 + body.length);
  out.set(b.subarray(0, 12));
  out.set(body, 12);
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  return { type: 'image/webp', width, height, bytes: out };
}

/** The checked photo with its hidden details removed, or null if it isn't a JPEG or WebP picture. */
export function checkImage(bytes: Uint8Array): CheckedImage | null {
  if (bytes.length >= 3 && at(bytes, 0) === 0xff && at(bytes, 1) === 0xd8 && at(bytes, 2) === 0xff) return checkJpeg(bytes);
  if (bytes.length >= 12 && tag(bytes, 0) === 'RIFF') return checkWebp(bytes);
  return null;
}
