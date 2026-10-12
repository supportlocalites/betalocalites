import { sql } from 'drizzle-orm';
import { isbot } from 'isbot';
import { type Beacon, classifySource, deviceFrom, maskOf, type Source } from '@/lib/activity';
import { expiry, type ListNote, type Note, readNote, signNote } from '@/lib/activity-token';
import { uuidv7 } from '@/lib/ids.mjs';
import { withDb } from './db.server';
import type { Place, ServerEnv } from './env';

/**
 * Counting how people find and use each business (D-22, D-30, ADR-023, ADR-030). Pages
 * sign what they showed; the browser reports what was really on screen; only then is
 * anything written. Bots never get a note, so they're never counted.
 */

/** Counting is on exactly when the signing secret is set (a long one). */
export const trackingOn = (env: ServerEnv): env is ServerEnv & { ACTIVITY_KEY: string } =>
  typeof env.ACTIVITY_KEY === 'string' && env.ACTIVITY_KEY.length >= 32;

const isPerson = (request: Request) => !isbot(request.headers.get('User-Agent') ?? '');

export type ListTrack = { token: string; list: string };

/** The note for a search or category page, or null (counting off, or a bot). */
export async function listTrack(
  env: ServerEnv,
  request: Request,
  list: { words: string; category: string | null; ids: string[] },
): Promise<ListTrack | null> {
  if (!trackingOn(env) || !isPerson(request)) return null;
  const pv = uuidv7();
  const note: ListNote = {
    k: 'list',
    pv,
    pl: list.words ? 'search' : 'category',
    w: list.words || null,
    cat: list.category,
    ids: list.ids.slice(0, 30),
    n: Math.min(list.ids.length, 30),
    x: expiry(Date.now() / 1000),
  };
  return { token: await signNote(env.ACTIVITY_KEY, note), list: pv };
}

/** The note for a business's page, with where the visitor came from (read here, not trusted from the page). */
export async function viewTrack(env: ServerEnv, request: Request, vendorId: string): Promise<string | null> {
  if (!trackingOn(env) || !isPerson(request)) return null;
  const src: Source = classifySource(request.headers.get('Referer'), new URL(request.url).origin);
  return signNote(env.ACTIVITY_KEY, { k: 'view', pv: uuidv7(), v: vendorId, src, x: expiry(Date.now() / 1000) });
}

export type Recorded = 'recorded' | 'bad_note';

/** Writes one browser report, in one statement. */
export async function recordBeacon(
  env: ServerEnv & { ACTIVITY_KEY: string },
  beacon: Beacon,
  request: Request,
  visitorId: string,
  place: Place,
): Promise<Recorded> {
  const note: Note | null = await readNote(env.ACTIVITY_KEY, beacon.token, Date.now() / 1000);
  if (!note || (beacon.t === 'list') !== (note.k === 'list')) return 'bad_note';
  const device = deviceFrom(request.headers.get('User-Agent'), request.headers.get('Sec-CH-UA-Mobile'));
  await withDb(env, async (db) => {
    if (note.k === 'list' && beacon.t === 'list') {
      await db.execute(sql`
        select activity_record_list(${note.pv}::uuid, ${note.pl}::text, ${note.w}::text, ${note.cat}::text, ${note.n}::int,
          ${`{${note.ids.join(',')}}`}::uuid[], ${maskOf(beacon.seen, note.ids.length)}::int, ${visitorId}::uuid,
          ${device}::text, ${place.town}::text, ${place.region}::text)`);
      return;
    }
    if (note.k !== 'view') return;
    const kind = beacon.t === 'view' ? 'profile_view' : beacon.t === 'tap' ? beacon.kind : beacon.t === 'time' ? 'profile_time' : 'services_seen';
    const pos = beacon.t === 'view' ? beacon.pos : null;
    const list = beacon.t === 'view' ? beacon.list : null;
    const seconds = beacon.t === 'time' ? beacon.seconds : null;
    await db.execute(sql`
      select activity_record_event(${note.pv}::uuid, ${kind}::text, ${note.v}::uuid, ${visitorId}::uuid, ${note.src}::text,
        ${list}::uuid, ${pos}::int, ${device}::text, ${place.town}::text, ${place.region}::text, ${seconds}::int)`);
  });
  return 'recorded';
}

/**
 * Remembers that this browser belongs to this signed-in person (ADR-030), so their visits
 * to their own business, and the team's, are left out of the totals. Rides along in the
 * gate's own query (put it before the select); written at most once a day per browser
 * and person.
 */
export const linkVisitor = (visitorId: string | null, userId: string) =>
  visitorId
    ? sql`with linked as (
        insert into visitor_account (visitor_id, user_id)
        select ${visitorId}::uuid, id from app_user where id = ${userId}
        on conflict (visitor_id, user_id) do update set last_seen_at = now()
        where visitor_account.last_seen_at < now() - interval '1 day'
        returning 1) `
    : sql``;
