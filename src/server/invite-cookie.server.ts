import { readCookie } from './auth/session.server';
import { TOKEN } from './guests.server';

/**
 * A guest's link (Stage 4, E §5) is swapped for this short-lived cookie (this site only), so
 * the address bar, the browser's history and anything the page loads never show the token.
 */
const INVITE_COOKIE = '__Host-localites-invite';

export const inviteCookie = (token: string, maxAge = 86400) =>
  `${INVITE_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export function inviteToken(request: Request): string | null {
  const t = readCookie(request, INVITE_COOKIE);
  return t && TOKEN.test(t) ? t : null;
}

/** The group link (part 2), likewise swapped for its own short-lived cookie. */
const GROUP_COOKIE = '__Host-localites-group';
/**
 * This browser's random key for the group link (part 2): it lets whoever replied change their
 * own reply, and see it, from the same browser. Only its hash is stored. Kept 60 days.
 */
const BROWSER_COOKIE = '__Host-localites-gkey';

export const groupCookie = (token: string, maxAge = 86400) =>
  `${GROUP_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export function groupToken(request: Request): string | null {
  const t = readCookie(request, GROUP_COOKIE);
  return t && TOKEN.test(t) ? t : null;
}

export function browserKey(request: Request): string | null {
  const k = readCookie(request, BROWSER_COOKIE);
  return k && TOKEN.test(k) ? k : null;
}

/** A new random key for this browser (43 characters, like a link's token). */
export function newBrowserKey(): { key: string; cookie: string } {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const key = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return { key, cookie: `${BROWSER_COOKIE}=${key}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 86400}` };
}
