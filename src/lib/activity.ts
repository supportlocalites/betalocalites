/**
 * Activity counting rules shared by the server and tests (D-22, D-30, ADR-023, ADR-030).
 * Plain functions with no other imports.
 */

export type Source = 'search' | 'category' | 'other' | 'web_search' | 'social' | 'other_site' | 'direct';
export type Device = 'phone' | 'tablet' | 'computer';
export const TAP_KINDS = ['website_tap', 'phone_tap'] as const;
export type TapKind = (typeof TAP_KINDS)[number];

const WEB_SEARCH = ['google', 'bing', 'duckduckgo', 'yahoo', 'ecosia', 'brave'];
const SOCIAL = ['facebook', 'instagram', 'tiktok', 'youtube', 'x', 't', 'reddit', 'nextdoor', 'linkedin', 'pinterest', 'threads'];

/**
 * Where a visitor came from, read on the server from the page request's Referer (browsers
 * send only the other site's address, so nothing private is read).
 */
export function classifySource(referer: string | null, siteOrigin: string): Source {
  if (!referer || !URL.canParse(referer)) return 'direct';
  const url = new URL(referer);
  if (url.origin === siteOrigin) {
    if (url.pathname === '/search') return url.searchParams.get('q') ? 'search' : 'category';
    return 'other';
  }
  // The name before the country or .com ending: google.ca, l.facebook.com, t.co.
  const parts = url.hostname.toLowerCase().replace(/^www\./, '').split('.');
  const name = parts.length >= 2 ? (parts.at(-2) === 'co' || parts.at(-2) === 'com' ? parts.at(-3) : parts.at(-2)) : parts[0];
  if (name && WEB_SEARCH.includes(name)) return 'web_search';
  if (name && SOCIAL.includes(name)) return 'social';
  return 'other_site';
}

/** Phone, tablet or computer, from what the browser says about itself. */
export function deviceFrom(userAgent: string | null, mobileHint: string | null): Device {
  const ua = userAgent ?? '';
  if (mobileHint === '?1') return 'phone';
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
  if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua)) return 'phone';
  return 'computer';
}

/** A list's places as a number, one bit per place (place 1 is the lowest bit). */
export function maskOf(positions: number[], listLength: number): number {
  let mask = 0;
  for (const p of positions) if (Number.isInteger(p) && p >= 1 && p <= Math.min(listLength, 30)) mask |= 1 << (p - 1);
  return mask >>> 0;
}

export type Beacon =
  | { t: 'list'; token: string; seen: number[] }
  | { t: 'view'; token: string; pos: number | null; list: string | null }
  | { t: 'tap'; token: string; kind: TapKind }
  | { t: 'time'; token: string; seconds: number }
  | { t: 'services'; token: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_BEACON_BYTES = 4096;

/** A report from the browser, checked field by field; anything else is refused (null). */
export function parseBeacon(body: string): Beacon | null {
  if (body.length > MAX_BEACON_BYTES) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.token !== 'string' || b.token.length > 3000) return null;
  const token = b.token;
  const place = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 30 ? v : null);
  switch (b.t) {
    case 'list': {
      if (!Array.isArray(b.seen) || b.seen.length > 30) return null;
      const seen = b.seen.map(place);
      if (seen.some((p) => p === null) || new Set(seen).size !== seen.length) return null;
      return { t: 'list', token, seen: seen as number[] };
    }
    case 'view': {
      const pos = b.pos === undefined || b.pos === null ? null : place(b.pos);
      if (b.pos !== undefined && b.pos !== null && pos === null) return null;
      const list = typeof b.list === 'string' && UUID.test(b.list) ? b.list : null;
      if (b.list !== undefined && b.list !== null && list === null) return null;
      return { t: 'view', token, pos, list: pos === null ? null : list };
    }
    case 'tap':
      return (TAP_KINDS as readonly unknown[]).includes(b.kind) ? { t: 'tap', token, kind: b.kind as TapKind } : null;
    case 'time':
      return typeof b.seconds === 'number' && Number.isInteger(b.seconds) && b.seconds >= 1 && b.seconds <= 1800
        ? { t: 'time', token, seconds: b.seconds }
        : null;
    case 'services':
      return { t: 'services', token };
    default:
      return null;
  }
}

// ------------------------------------------------------------------ dates (Toronto)

/** Today's date in Toronto, as YYYY-MM-DD. */
export function torontoDate(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

const dayMs = 86_400_000;
const asDate = (s: string) => new Date(`${s}T00:00:00Z`);
const asText = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => asText(new Date(asDate(s).getTime() + n * dayMs));

export type Period = 'week' | 'month' | 'year';
/** Dates as YYYY-MM-DD; `to` is the day after the last one. `people`: the matching row of different visitors. */
export type Range = { from: string; to: string; people: { period: Period; startsOn: string } | null };

const yearEarlier = (s: string) => {
  const d = asDate(s);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return asText(d);
};
const monthStart = (s: string, back: number) => {
  const d = asDate(`${s.slice(0, 7)}-01`);
  d.setUTCMonth(d.getUTCMonth() - back);
  return asText(d);
};

/**
 * The periods an owner can choose, all finished before today (Toronto): last week (Monday
 * to Sunday), last month, and this year so far (to the end of yesterday). Each with the
 * period before it and the same period a year earlier, for comparison. Different-visitor
 * counts exist only for whole calendar periods, so those are the choices.
 */
export function periodRanges(period: Period, today: string): { now: Range; before: Range | null; lastYear: Range } {
  if (period === 'week') {
    const isoDay = (asDate(today).getUTCDay() + 6) % 7; // Monday 0
    const from = addDays(today, -isoDay - 7);
    const range = (f: string): Range => ({ from: f, to: addDays(f, 7), people: { period: 'week', startsOn: f } });
    return { now: range(from), before: range(addDays(from, -7)), lastYear: range(addDays(from, -364)) };
  }
  if (period === 'month') {
    const range = (f: string): Range => ({ from: f, to: monthStart(addDays(f, 32), 0), people: { period: 'month', startsOn: f } });
    const from = monthStart(today, 1);
    return { now: range(from), before: range(monthStart(today, 2)), lastYear: range(yearEarlier(from)) };
  }
  const from = `${today.slice(0, 4)}-01-01`;
  return {
    now: { from, to: today, people: { period: 'year', startsOn: from } },
    before: null,
    // Visitors can't be compared: last year's count covers the whole year.
    lastYear: { from: yearEarlier(from), to: yearEarlier(today), people: null },
  };
}

// ------------------------------------------------------------------ words for owners

/** "fewer than 5" for small breakdown figures, so nobody can work out who a visitor was. */
export const SMALL = 5;
export const small = (n: number) => (n > 0 && n < SMALL ? 'fewer than 5' : n.toLocaleString('en-CA'));

/** "1st", "2nd", "3rd", "11th", "21st". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

/** "Up 6 on the 7 days before", "Down 2 …", "Same as …". */
export function change(now: number, before: number, what: string): string {
  if (now === before) return `Same as ${what}`;
  return `${now > before ? 'Up' : 'Down'} ${Math.abs(now - before).toLocaleString('en-CA')} on ${what}`;
}

/** "1 min 20 s", "45 s". */
export function duration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`;
}

export const SOURCE_WORDS: Record<string, string> = {
  search: 'Localites search',
  category: 'Browsing a category',
  web_search: 'Google or another search engine',
  social: 'Social media',
  other_site: 'Another website',
  direct: 'A link, bookmark or app',
  other: 'Elsewhere on Localites',
  shared_link: 'A shared link',
  collection: 'A Localites collection',
  featured: 'Featured on Localites',
};
