import { data } from 'react-router';
import { cloudflareContext } from '@/app/context';
import { cookieHeaders, viewTrack } from '@/server/activity.server';
import { hasSessionCookie } from '@/server/auth/session.server';
import { getVendorId } from '@/server/catalog.server';
import { withDb } from '@/server/db.server';
import { publicReviews } from '@/server/reviews.server';
import type { Route } from './+types/vendor-panel';

/**
 * What the profile panel loads when it opens (D-59): the business's published reviews (K22), and
 * the signed note that counts the opening as a visit to its page (ADR-030). Listed businesses only.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const id = await getVendorId(env, params.slug);
  if (!id) throw data(null, { status: 404 });
  const [reviews, { track, setCookie }] = await Promise.all([withDb(env, (db) => publicReviews(db, id)), viewTrack(env, request, id)]);
  const headers = new Headers(cookieHeaders(setCookie));
  headers.set('Cache-Control', hasSessionCookie(request) ? 'private, no-store' : 'no-store');
  return data({ reviews, track }, { headers });
}
