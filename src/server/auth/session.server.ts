import type { ServerEnv } from '../env';
import { AuthError, type AuthSession, type AuthUser, getUser, readClaims, refreshSession, type TokenClaims } from './gotrue.server';

/**
 * The signed-in session lives in two cookies that page scripts can't read (E §2):
 * HttpOnly, Secure, SameSite=Lax, and the __Host- prefix (this site only, every path).
 */
const ACCESS = '__Host-lc_at';
const REFRESH = '__Host-lc_rt';
const MAX_AGE = 60 * 60 * 24 * 30; // the browser forgets it after 30 days; admins re-sign-in sooner

const cookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export const sessionCookies = (s: Pick<AuthSession, 'accessToken' | 'refreshToken'>) => [
  cookie(ACCESS, s.accessToken, MAX_AGE),
  cookie(REFRESH, s.refreshToken, MAX_AGE),
];

export const clearedCookies = () => [cookie(ACCESS, '', 0), cookie(REFRESH, '', 0)];

export function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=') || undefined;
  }
  return undefined;
}

/**
 * Whether this browser holds a session, without asking Supabase: enough to choose between
 * "Sign in" and "Your account" in the header. Pages that need an account check properly.
 */
export const hasSessionCookie = (request: Request) => Boolean(readCookie(request, REFRESH));

export type SignedIn = { user: AuthUser; accessToken: string; claims: TokenClaims };

/** Who is signed in, if anyone, plus any cookies the response must set (a refresh or a sign-out). */
export async function loadSession(request: Request, env: ServerEnv): Promise<{ session: SignedIn | null; setCookies: string[] }> {
  const access = readCookie(request, ACCESS);
  const refresh = readCookie(request, REFRESH);
  if (!access && !refresh) return { session: null, setCookies: [] };

  if (access) {
    try {
      const user = await getUser(env, access);
      return { session: { user, accessToken: access, claims: readClaims(access) }, setCookies: [] };
    } catch (err) {
      // Expired or revoked: try the refresh token. Anything else (the service is down) is a real error.
      if (!(err instanceof AuthError) || err.status >= 500) throw err;
    }
  }
  if (refresh) {
    try {
      const s = await refreshSession(env, refresh);
      return {
        session: { user: s.user, accessToken: s.accessToken, claims: readClaims(s.accessToken) },
        setCookies: sessionCookies(s),
      };
    } catch (err) {
      if (!(err instanceof AuthError) || err.status >= 500) throw err;
    }
  }
  return { session: null, setCookies: clearedCookies() };
}

/**
 * The page address a request is for, to come back to after signing in. Moving between
 * pages fetches data from "/page.data"; this gives the page itself ("/page").
 */
export function pagePath(request: Request): string {
  const url = new URL(request.url);
  let path = url.pathname;
  if (path === '/_root.data') path = '/';
  else if (path.endsWith('.data')) path = path.slice(0, -'.data'.length);
  url.searchParams.delete('_routes');
  const search = url.searchParams.toString();
  return path + (search ? `?${search}` : '');
}

/**
 * Only addresses on this site, so a sign-in link can't send people elsewhere. The value is
 * read the way a browser would (which ignores tabs and line breaks, and treats "\" as "/"),
 * and anything containing those is refused outright.
 */
export function safeNext(value: FormDataEntryValue | string | null | undefined, fallback = '/admin'): string {
  const next = typeof value === 'string' ? value : '';
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  if (!next.startsWith('/') || next.length > 2000 || /[\u0000-\u0020\u007f\\]/.test(next)) return fallback;
  try {
    const base = 'https://localites.invalid';
    const url = new URL(next, base);
    return url.origin === base ? url.pathname + url.search + url.hash : fallback;
  } catch {
    return fallback;
  }
}

export function withCookies(init: ResponseInit | undefined, cookies: string[]): ResponseInit {
  const headers = new Headers(init?.headers);
  for (const c of cookies) headers.append('Set-Cookie', c);
  return { ...init, headers };
}
