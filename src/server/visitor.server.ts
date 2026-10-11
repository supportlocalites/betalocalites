import { isUuid, uuidv7 } from '@/lib/ids.mjs';

/**
 * Localites' own visitor cookie (D-22, ADR-023): a random ID, no outside trackers. Used
 * to limit suggestions per visitor now, and to count activity when that's built.
 */
const NAME = '__Host-lc_vid';
const ONE_YEAR = 60 * 60 * 24 * 365;

export function visitor(request: Request): { id: string; setCookie: string | null } {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [k, v] = part.trim().split('=');
    if (k === NAME && v && isUuid(v)) return { id: v, setCookie: null };
  }
  const id = uuidv7();
  return { id, setCookie: `${NAME}=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ONE_YEAR}` };
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
