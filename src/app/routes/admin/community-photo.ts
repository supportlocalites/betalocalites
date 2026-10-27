import { data } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { isUuid } from '@/lib/ids.mjs';
import { openPhoto } from '@/server/community-photos.server';
import type { Route } from './+types/community-photo';

/** A Community photo for the team to check (0063): any photo, waiting or not, as the team (adminGate). */
export async function loader({ params, context }: Route.LoaderArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const { env } = context.get(cloudflareContext);
  const photo = await openPhoto(env, { userId: context.get(adminContext).userId, team: true }, params.id);
  if (!photo) throw data(null, { status: 404 });
  return new Response(photo.body, {
    headers: { 'Content-Type': photo.type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' },
  });
}
