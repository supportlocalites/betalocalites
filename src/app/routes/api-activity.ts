import { isbot } from 'isbot';
import { cloudflareContext } from '@/app/context';
import { MAX_BEACON_BYTES, parseBeacon } from '@/lib/activity';
import { readBrowser } from '@/lib/activity-token';
import { recordBeacon, trackingOn } from '@/server/activity.server';
import { addressKey, visitorCookieValue } from '@/server/visitor.server';
import type { Route } from './+types/api-activity';

/**
 * Where browsers report what was on screen (ADR-030). Only from Localites' own pages, only
 * with a note the page's server signed, only from real browsers, and rate-limited. Nothing
 * is counted unless counting is switched on (the ACTIVITY_KEY secret).
 */
const answer = (status: number) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

export function loader() {
  return answer(405);
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env, place } = context.get(cloudflareContext);
  const refuse = async (status: number) => {
    await request.body?.cancel().catch(() => undefined); // not read: let it go
    return answer(status);
  };
  if (!trackingOn(env)) return refuse(204);
  // A plain form from anywhere, or a script with no browser behind it, is refused.
  const site = new URL(request.url).origin;
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (
    request.headers.get('Origin') !== site ||
    !(request.headers.get('Content-Type') ?? '').toLowerCase().startsWith('application/json') ||
    (fetchSite !== null && fetchSite !== 'same-origin')
  ) {
    return refuse(403);
  }
  if (isbot(request.headers.get('User-Agent') ?? '')) return refuse(204);
  if (env.TRACK_LIMIT && !(await env.TRACK_LIMIT.limit({ key: addressKey(request) })).success) return refuse(429);
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BEACON_BYTES) return refuse(413);
  const beacon = parseBeacon(await request.text());
  if (!beacon) return answer(400);
  // Only from the browser the page's note was made for (its own visitor cookie).
  const browser = await readBrowser(env.ACTIVITY_KEY, visitorCookieValue(request));
  const result = await recordBeacon(env, beacon, request, browser, place);
  return answer(result === 'bad_note' ? 400 : 204);
}
