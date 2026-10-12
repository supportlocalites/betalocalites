import { isbot } from 'isbot';
import { cloudflareContext } from '@/app/context';
import { MAX_BEACON_BYTES, parseBeacon } from '@/lib/activity';
import { recordBeacon, trackingOn } from '@/server/activity.server';
import { addressKey, visitor } from '@/server/visitor.server';
import type { Route } from './+types/api-activity';

/**
 * Where browsers report what was on screen (ADR-030). Only from Localites' own pages, only
 * with a note the page's server signed, only from real browsers, and rate-limited. Nothing
 * is counted unless counting is switched on (the ACTIVITY_KEY secret).
 */
const answer = (status: number, cookie: string | null = null) => {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (cookie) headers.append('Set-Cookie', cookie);
  return new Response(null, { status, headers });
};

export function loader() {
  return answer(405);
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env, place } = context.get(cloudflareContext);
  if (!trackingOn(env)) return answer(204);
  // A plain form from anywhere, or a script with no browser behind it, is refused.
  const site = new URL(request.url).origin;
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (
    request.headers.get('Origin') !== site ||
    !(request.headers.get('Content-Type') ?? '').toLowerCase().startsWith('application/json') ||
    (fetchSite !== null && fetchSite !== 'same-origin')
  ) {
    return answer(403);
  }
  if (isbot(request.headers.get('User-Agent') ?? '')) return answer(204);
  if (env.TRACK_LIMIT && !(await env.TRACK_LIMIT.limit({ key: addressKey(request) })).success) return answer(429);
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BEACON_BYTES) return answer(413);
  const beacon = parseBeacon(await request.text());
  if (!beacon) return answer(400);
  const browser = visitor(request);
  const result = await recordBeacon(env, beacon, request, browser.id, place);
  if (result === 'bad_note') return answer(400);
  return answer(204, browser.setCookie);
}
