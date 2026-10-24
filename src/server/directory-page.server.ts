import { data } from 'react-router';
import { cookieHeaders, pageTracks } from './activity.server';
import { hasSessionCookie, signedInUserId } from './auth/session.server';
import { directory } from './browse.server';
import type { ServerEnv } from './env';

/**
 * Everything the Base44 browsing page needs, for Browse local and for a business's own web
 * address (which opens the same page with its profile open, D-59, K18).
 */
export async function loadDirectory(request: Request, env: ServerEnv, openId: string | null = null) {
  const userId = hasSessionCookie(request) ? await signedInUserId(request, env) : null;
  const found = await directory(env, userId);
  // Each row is counted as a list seen (ADR-030).
  const rails = found.kinds.map((k) => ({ slug: k.slug, ids: found.cards.filter((c) => c.kindSlug === k.slug).map((c) => c.id) }));
  const shown = rails.filter((r) => r.ids.length > 0);
  // The rows' notes, and the opened business's visit (its own address), for one browser (ADR-030).
  const { tracks, view, setCookie } = await pageTracks(
    env,
    request,
    shown.map((r) => ({ words: '', category: r.slug, ids: r.ids })),
    openId,
  );
  const headers = new Headers(cookieHeaders(setCookie));
  // Hearts and the shortlist depend on who's signed in: never kept by a shared cache.
  if (hasSessionCookie(request)) headers.set('Cache-Control', 'private, no-store');
  return data(
    {
      ...found,
      signedIn: Boolean(userId),
      tracks: Object.fromEntries(shown.map((r, i) => [r.slug, tracks[i] ?? null])),
      view,
    },
    { headers },
  );
}

