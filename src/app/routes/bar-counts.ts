import { data } from 'react-router';
import { cloudflareContext } from '@/app/context';
import { hasSessionCookie, signedInUserId } from '@/server/auth/session.server';
import { barCounts } from '@/server/counts.server';
import type { Route } from './+types/bar-counts';

/**
 * The numbers on the bar's Favourites and Messages icons, which the bar asks for on every page
 * (the owner, 27 October 2026). Signed out (or the session ended): none. Only ever the person's own.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const userId = hasSessionCookie(request) ? await signedInUserId(request, env) : null;
  const counts = userId ? await barCounts(env, userId) : null;
  return data(counts, { headers: { 'Cache-Control': 'private, no-store' } });
}
