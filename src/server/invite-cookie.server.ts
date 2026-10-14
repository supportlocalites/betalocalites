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
