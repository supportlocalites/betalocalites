import { sql } from 'drizzle-orm';
import { isbot } from 'isbot';
import { type Beacon, classifySource, deviceFrom, maskOf, type Source } from '@/lib/activity';
import { expiry, type ListNote, type Note, readBrowser, readNote, signBrowser, signNote } from '@/lib/activity-token';
import { uuidv7 } from '@/lib/ids.mjs';
import { withDb } from './db.server';
import type { Place, ServerEnv } from './env';
import { addressKey, visitorCookie, visitorCookieValue } from './visitor.server';

/**
 * Counting how people find and use each business (D-22, D-30, ADR-023, ADR-030). Pages
 * sign what they showed; the browser reports what was really on screen; only then is
 * anything written. Bots never get a note, so they're never counted.
 */

/** The signing secret needs at least this many characters. */
export const MIN_KEY_LENGTH = 32;

/** Whether counting is on: 'off' (no key), 'short' (a key too short to be safe), or 'on'. */
export const keyState = (env: ServerEnv): 'off' | 'short' | 'on' =>
  !env.ACTIVITY_KEY ? 'off' : env.ACTIVITY_KEY.length < MIN_KEY_LENGTH ? 'short' : 'on';

/** Counting is on exactly when the signing secret is set (a long one). */
export const trackingOn = (env: ServerEnv): env is ServerEnv & { ACTIVITY_KEY: string } => keyState(env) === 'on';

const isPerson = (request: Request) => !isbot(request.headers.get('User-Agent') ?? '');

/**
 * This browser for counting (ADR-030): the id in its signed visitor cookie, or, for a new
 * browser (or a cookie we didn't sign), a new signed cookie to send with the answer. An
 * unsigned id from before counting began keeps its id and gets signed.
 */
export async function countedBrowser(
  env: ServerEnv & { ACTIVITY_KEY: string },
  request: Request,
): Promise<{ id: string; setCookie: string | null; isNew: boolean }> {
  const value = visitorCookieValue(request);
  const signed = await readBrowser(env.ACTIVITY_KEY, value);
  if (signed) return { id: signed, setCookie: null, isNew: false };
  const old = value && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
  const id = old ?? uuidv7();
  return {
    id,
    setCookie: visitorCookie(await signBrowser(env.ACTIVITY_KEY, id)),
    isNew: true,
  };
}

/**
 * The browser a page's note is made for. New (or unsigned) browsers are limited per
 * internet address, so a script that drops or makes up its cookie can't pose as endless
 * visitors; past the limit, no note.
 */
async function pageBrowser(env: ServerEnv & { ACTIVITY_KEY: string }, request: Request) {
  const browser = await countedBrowser(env, request);
  if (browser.isNew && env.NEW_VISITOR_LIMIT && !(await env.NEW_VISITOR_LIMIT.limit({ key: addressKey(request) })).success) {
    return null;
  }
  return browser;
}

/** Counting never gets in a visitor's way: if it fails, the page simply has no note. */
async function quietly<T>(work: () => Promise<Tracked<T>>): Promise<Tracked<T>> {
  try {
    return await work();
  } catch (err) {
    console.error('activity note not made', err instanceof Error ? err.message : err);
    return { track: null, setCookie: null };
  }
}

export type ListTrack = { token: string; list: string };
export type Tracked<T> = { track: T | null; setCookie: string | null };

/** The note for a search or category page, or none (counting off, a bot, or too many new browsers). */
export async function listTrack(
  env: ServerEnv,
  request: Request,
  list: { words: string; category: string | null; ids: string[] },
): Promise<Tracked<ListTrack>> {
  if (!trackingOn(env) || !isPerson(request)) return { track: null, setCookie: null };
  return quietly(async () => {
    const browser = await pageBrowser(env, request);
    if (!browser) return { track: null, setCookie: null };
    return { track: await listNote(env, browser.id, list), setCookie: browser.setCookie };
  });
}

/**
 * Several lists on one page (Browse local's rows, D-57): one browser for all of them (a new one
 * is made and limited once), and a note for each list.
 */
export async function listTracks(
  env: ServerEnv,
  request: Request,
  lists: { words: string; category: string | null; ids: string[] }[],
): Promise<{ tracks: (ListTrack | null)[]; setCookie: string | null }> {
  const none = { tracks: lists.map(() => null), setCookie: null };
  if (!trackingOn(env) || !isPerson(request) || lists.length === 0) return none;
  try {
    const browser = await pageBrowser(env, request);
    if (!browser) return none;
    return { tracks: await Promise.all(lists.map((l) => listNote(env, browser.id, l))), setCookie: browser.setCookie };
  } catch (err) {
    console.error('activity note not made', err instanceof Error ? err.message : err);
    return none;
  }
}

async function listNote(
  env: ServerEnv & { ACTIVITY_KEY: string },
  browserId: string,
  list: { words: string; category: string | null; ids: string[] },
): Promise<ListTrack> {
  {
    const pv = uuidv7();
    const note: ListNote = {
      k: 'list',
      pv,
      pl: list.words ? 'search' : 'category',
      w: list.words || null,
      cat: list.category,
      ids: list.ids.slice(0, 30),
      n: Math.min(list.ids.length, 30),
      b: browserId,
      x: expiry(Date.now() / 1000),
    };
    return { token: await signNote(env.ACTIVITY_KEY, note), list: pv };
  }
}

/**
 * The note for a business's page, with where the visitor came from: read here from the
 * request, so the page can't change it (a script can still claim any Referer it likes).
 */
export async function viewTrack(env: ServerEnv, request: Request, vendorId: string): Promise<Tracked<string>> {
  if (!trackingOn(env) || !isPerson(request)) return { track: null, setCookie: null };
  return quietly(async () => {
    const browser = await pageBrowser(env, request);
    if (!browser) return { track: null, setCookie: null };
    const src: Source = classifySource(request.headers.get('Referer'), new URL(request.url).origin);
    const token = await signNote(env.ACTIVITY_KEY, {
      k: 'view',
      pv: uuidv7(),
      v: vendorId,
      src,
      b: browser.id,
      x: expiry(Date.now() / 1000),
    });
    return { track: token, setCookie: browser.setCookie };
  });
}

/** The page's answer headers: the visitor cookie for a new browser. */
export const cookieHeaders = (setCookie: string | null): HeadersInit | undefined => (setCookie ? { 'Set-Cookie': setCookie } : undefined);

export type Recorded = 'recorded' | 'bad_note';

/**
 * Writes one browser report, in one statement. The report must come from the browser the
 * page's note was made for (its visitor cookie), so a note can't be passed around.
 */
export async function recordBeacon(
  env: ServerEnv & { ACTIVITY_KEY: string },
  beacon: Beacon,
  request: Request,
  visitorId: string | null,
  place: Place,
): Promise<Recorded> {
  const note: Note | null = await readNote(env.ACTIVITY_KEY, beacon.token, Date.now() / 1000);
  if (!note || (beacon.t === 'list') !== (note.k === 'list') || !visitorId || note.b !== visitorId) return 'bad_note';
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
    const kind =
      beacon.t === 'view' ? 'profile_view' : beacon.t === 'tap' ? beacon.kind : beacon.t === 'time' ? 'profile_time' : 'services_seen';
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
