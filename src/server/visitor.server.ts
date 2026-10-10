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
