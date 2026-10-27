import { data } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { findPlaces } from '@/server/home-address.server';
import { tooFast } from '@/server/plan-pages.server';
import type { Route } from './+types/address-search';

/**
 * Find my address (the owner, 27 October 2026): the places the address search offers for what the
 * person typed, for them to choose one. Needs an account (the member gate), so the search isn't
 * open to everyone; one look-up per press of Find.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const typed = (new URL(request.url).searchParams.get('q') ?? '').replace(/\s+/g, ' ').trim();
  const headers = { 'Cache-Control': 'private, no-store' };
  if (typed.length < 4 || typed.length > 200) return data({ places: [], problem: 'Type your street address, like “12 Mississaga St, Orillia”.' }, { headers });
  if (await tooFast(env, member.userId)) return data({ places: [], problem: 'That was quick. Please wait a moment and try again.' }, { headers });
  const places = await findPlaces(env, typed);
  if (places === null) return data({ places: [], problem: 'The map’s address search isn’t answering right now. Please try again in a few minutes, or fill in the boxes yourself.' }, { headers });
  return data({ places, problem: places.length === 0 ? 'No address found for that. Check the spelling, or fill in the boxes yourself.' : null }, { headers });
}
