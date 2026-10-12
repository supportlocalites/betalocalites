/**
 * Signed notes of what a page showed (ADR-030): the server signs the list of businesses on
 * a search page, or the business on its page, and the browser hands the note back when it
 * reports what was on screen. Nobody can make up a business, a place in a list or where a
 * visitor came from. HMAC-SHA256 with the ACTIVITY_KEY secret, through WebCrypto.
 */

export type ListNote = {
  k: 'list';
  pv: string; // this list page's id
  pl: 'search' | 'category';
  w: string | null; // the words searched
  cat: string | null; // the category browsed
  ids: string[]; // the businesses shown, in order (at most 30)
  n: number; // how many results
  b: string; // the browser it was made for (the visitor cookie)
  x: number; // expires (seconds since 1970)
};
export type ViewNote = {
  k: 'view';
  pv: string; // this page's id
  v: string; // the business
  src: string; // where the visitor came from (classifySource)
  b: string; // the browser it was made for
  x: number;
};
export type Note = ListNote | ViewNote;

/** Notes last 12 hours: long enough for a page left open, short enough to be useless later. */
export const NOTE_HOURS = 12;

// The finished key is kept for the next request (Workers can't share a pending promise
// between requests).
const keys = new Map<string, CryptoKey>();
async function keyFor(secret: string): Promise<CryptoKey> {
  const kept = keys.get(secret);
  if (kept) return kept;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
  keys.set(secret, key);
  return key;
}

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export async function signNote(secret: string, note: Note): Promise<string> {
  const body = toB64(new TextEncoder().encode(JSON.stringify(note)));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await keyFor(secret), new TextEncoder().encode(body)));
  return `${body}.${toB64(mac)}`;
}

/**
 * The visitor cookie's value for counting: "<id>.<signature>", so a browser id can't be
 * made up (a made-up one counts as a new browser, which is limited per address).
 */
export async function signBrowser(secret: string, id: string): Promise<string> {
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await keyFor(secret), new TextEncoder().encode(`browser:${id}`)));
  return `${id}.${toB64(mac.slice(0, 16))}`;
}

/** The browser id in a signed cookie value, or null if it isn't signed by us. */
export async function readBrowser(secret: string, value: string | null): Promise<string | null> {
  const [id, mac, extra] = (value ?? '').split('.');
  if (!id || !mac || extra !== undefined || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (await signBrowser(secret, id)) === `${id}.${mac}` ? id : null;
}

/** The note, if it's ours, untouched and not expired; otherwise null. */
export async function readNote(secret: string, token: string, now: number): Promise<Note | null> {
  const [body, mac, extra] = token.split('.');
  if (!body || !mac || extra !== undefined || !/^[\w-]+$/.test(body) || !/^[\w-]+$/.test(mac)) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify('HMAC', await keyFor(secret), fromB64(mac), new TextEncoder().encode(body));
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    const note = JSON.parse(new TextDecoder().decode(fromB64(body))) as Note;
    if (typeof note.x !== 'number' || note.x < now) return null;
    if (note.k !== 'list' && note.k !== 'view') return null;
    return note;
  } catch {
    return null;
  }
}

export const expiry = (now: number) => Math.floor(now) + NOTE_HOURS * 3600;
