import { isUuid, uuidv7 } from '@/lib/ids.mjs';

/**
 * Localites' own visitor cookie (D-22, ADR-023): a random ID, no outside trackers. Used
 * to limit suggestions per visitor now, and to count activity when that's built.
 */
export const VISITOR_COOKIE = '__Host-lc_vid';
const ONE_YEAR = 60 * 60 * 24 * 365;

/** The cookie as sent: "<id>" or, once counting has signed it, "<id>.<signature>" (ADR-030). */
export function visitorCookieValue(request: Request): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [k, v] = part.trim().split('=');
    if (k === VISITOR_COOKIE && v) return v;
  }
  return null;
}

export const visitorCookie = (value: string) => `${VISITOR_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ONE_YEAR}`;

export function visitor(request: Request): { id: string; setCookie: string | null } {
  const id = visitorCookieValue(request)?.split('.')[0];
  if (id && isUuid(id)) return { id, setCookie: null };
  const fresh = uuidv7();
  return { id: fresh, setCookie: visitorCookie(fresh) };
}

/**
 * The visitor's internet address as a rate-limit key (Cloudflare's limiter keeps it briefly;
 * Localites never stores it). An IPv6 address counts by its /64 block, since one home or
 * phone connection controls a whole block and could otherwise pose as countless visitors.
 */
export function addressKey(request: Request): string {
  const ip = (request.headers.get('CF-Connecting-IP') ?? 'local').trim().toLowerCase();
  if (!ip.includes(':')) return ip;
  const [head = '', tail] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}
