import { data } from 'react-router';
import { cloudflareContext } from '@/app/context';
import { isUuid } from '@/lib/ids.mjs';
import { hasSessionCookie, signedInUserId } from '@/server/auth/session.server';
import { openPhoto } from '@/server/community-photos.server';
import type { Route } from './+types/community-photo';

/**
 * A Community photo (0063), handed out only if the person asking may see it: one the team showed,
 * on a post that shows, to anyone; one still waiting for the team, only to its author. Anything
 * else is "not found", the same as a photo that doesn't exist.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const { env } = context.get(cloudflareContext);
  const userId = hasSessionCookie(request) ? await signedInUserId(request, env) : null;
  const photo = await openPhoto(env, { userId, team: false }, params.id);
  if (!photo) throw data(null, { status: 404 });
  return new Response(photo.body, {
    headers: {
      'Content-Type': photo.type,
      // Signed in, it may be their own (waiting, or on a held post): never kept by a shared cache.
      // Signed out, only a shown photo on a shown post opens, and it can be taken down: kept briefly.
      'Cache-Control': userId || photo.waiting ? 'private, no-store' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    },
  });
}
