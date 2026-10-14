import { sql } from 'drizzle-orm';
import { GUEST_LIMITS, GUEST_REFUSALS, type GuestResponse } from '@/lib/guest-terms';
import { actingAs, errorCode, PlanCapped, PlanNotFound, PlanRefused } from './acting.server';
import { type Db, withDb } from './db.server';
import type { ServerEnv } from './env';

/**
 * Guests and replies (Stage 4, part 1; D-08, D-10, E §4.6 and §5; migration 0033). The host
 * keeps a guest list for their own event, as the person (ADR-031); the database lets nobody
 * else read it. Each guest has a personal link the host sends from their own phone: the link
 * is made from INVITE_KEY (a secret only the site has) and the guest's id, so the host can
 * copy it again any time, and only its hash is stored. A guest has no account: their link
 * opens their own invitation and reply (invitation_for, invitation_reply) and nothing else.
 */

const asPerson = (userId: string) => ({ side: 'person' as const, userId });

/** Refusals in plain words; someone else's event or guest, like a missing one, is "not found". */
async function guarded<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (err) {
    if (err instanceof PlanNotFound || err instanceof PlanRefused || err instanceof PlanCapped) throw err;
    const code = errorCode(err);
    if (code === 'LP101' || code === '42501' || code === '23503') throw new PlanNotFound();
    const words = code ? GUEST_REFUSALS[code] : undefined;
    if (words) throw new PlanRefused(words);
    throw err;
  }
}

// ======================================================================= links

const base64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** A link's token looks like this (43 characters); anything else is never looked up. */
export const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const invitesOn = (env: ServerEnv) => Boolean(env.INVITE_KEY && env.INVITE_KEY.length >= 32);

async function linkToken(env: ServerEnv, guestId: string, version: number): Promise<string> {
  if (!invitesOn(env)) throw new PlanRefused(GUEST_REFUSALS.noKey!);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.INVITE_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return base64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`localites-invite:${guestId}:${version}`)));
}

/** The stored form of a token: its SHA-256, as hex for the query. */
export async function tokenHash(token: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
}

export const inviteUrl = (siteUrl: string, token: string) => `${siteUrl}/i/${token}`;

// ======================================================================= the host

export type GuestRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  opened: boolean;
  response: GuestResponse | null;
  partySize: number | null;
  note: string | null;
  repliedAt: string | null;
};

export type GuestEvent = {
  id: string;
  name: string;
  date: string;
  startTime: string | null;
  town: string;
  status: 'planning' | 'cancelled' | 'archived';
  passed: boolean;
  message: string | null;
};

const EVENT = sql`
  select e.id, p.title as name, e.event_date::text as date, to_char(e.start_time, 'HH24:MI') as "startTime",
         mu.name as town, e.status, event_ends_at(e) < now() as passed, p.guest_message as message
  from event e join event_private p on p.event_id = e.id join municipality mu on mu.id = e.municipality_id`;

async function hostEvent(tx: Db, userId: string, eventId: string): Promise<GuestEvent> {
  const [e] = await tx.execute<GuestEvent>(sql`${EVENT} where e.id = ${eventId} and e.host_user_id = ${userId}`);
  if (!e) throw new PlanNotFound();
  return e;
}

/** C13: the host's own guest list, in the order added, with the totals. */
export async function guestList(env: ServerEnv, userId: string, eventId: string) {
  return guarded(
    actingAs(env, asPerson(userId), async (tx) => {
      const event = await hostEvent(tx, userId, eventId);
      const guests = await tx.execute<GuestRow>(sql`
        select id, name, phone, email, first_opened_at is not null as opened, response, party_size as "partySize",
               reply_note as note, replied_at::text as "repliedAt"
        from guest where event_id = ${eventId} and host_user_id = ${userId} order by created_at, id`);
      const people = (r: GuestResponse) => guests.filter((g) => g.response === r).reduce((n, g) => n + (g.partySize ?? 0), 0);
      return {
        event,
        guests: [...guests],
        totals: {
          coming: people('yes'),
          maybe: people('maybe'),
          cantCome: guests.filter((g) => g.response === 'no').length,
          noReply: guests.filter((g) => g.response === null).length,
        },
      };
    }),
  );
}

export function readGuest(form: FormData): { name: string; phone: string | null; email: string | null } | { error: string } {
  const name = String(form.get('name') ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name) return { error: GUEST_REFUSALS.name! };
  if (name.length > GUEST_LIMITS.name) return { error: GUEST_REFUSALS.nameTooLong! };
  const phone = String(form.get('phone') ?? '').trim() || null;
  if (phone && !/^\+?[0-9 ().-]{7,20}$/.test(phone)) return { error: GUEST_REFUSALS.phone! };
  const email = String(form.get('email') ?? '').trim() || null;
  if (email && (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) return { error: GUEST_REFUSALS.email! };
  return { name, phone, email };
}

export async function addGuest(
  env: ServerEnv,
  userId: string,
  eventId: string,
  input: { name: string; phone: string | null; email: string | null },
): Promise<string> {
  const id = crypto.randomUUID();
  const hash = await tokenHash(await linkToken(env, id, 1));
  await guarded(
    actingAs(env, asPerson(userId), (tx) =>
      tx.execute(sql`
        insert into guest (id, event_id, host_user_id, name, phone, email, token_hash)
        values (${id}, ${eventId}, ${userId}, ${input.name}, ${input.phone}, ${input.email}, decode(${hash}, 'hex'))`),
    ),
  );
  return id;
}

export async function removeGuest(env: ServerEnv, userId: string, eventId: string, guestId: string): Promise<void> {
  await guarded(
    actingAs(env, asPerson(userId), async (tx) => {
      const done = await tx.execute(sql`
        delete from guest where id = ${guestId} and event_id = ${eventId} and host_user_id = ${userId} returning id`);
      if (done.length === 0) throw new PlanNotFound();
    }),
  );
}

/** C14 (part): the host's message to guests; empty removes it. */
export async function setGuestMessage(env: ServerEnv, userId: string, eventId: string, message: string | null): Promise<void> {
  await guarded(
    actingAs(env, asPerson(userId), async (tx) => {
      const done = await tx.execute(sql`
        update event_private set guest_message = ${message} where event_id = ${eventId} and host_user_id = ${userId} returning event_id`);
      if (done.length === 0) throw new PlanNotFound();
    }),
  );
}

export type GuestShare = { event: GuestEvent; guest: GuestRow; link: string };

/** Sending one guest's invitation: their link, made again from the key (never stored). */
export async function guestShare(env: ServerEnv, userId: string, eventId: string, guestId: string, siteUrl: string): Promise<GuestShare> {
  return guarded(
    actingAs(env, asPerson(userId), async (tx) => {
      const event = await hostEvent(tx, userId, eventId);
      const [g] = await tx.execute<GuestRow & { version: number }>(sql`
        select id, name, phone, email, first_opened_at is not null as opened, response, party_size as "partySize",
               reply_note as note, replied_at::text as "repliedAt", link_version as version
        from guest where id = ${guestId} and event_id = ${eventId} and host_user_id = ${userId}`);
      if (!g) throw new PlanNotFound();
      const { version, ...guest } = g;
      return { event, guest, link: inviteUrl(siteUrl, await linkToken(env, g.id, version)) };
    }),
  );
}

/** A new link for one guest: the old one stops working at once. */
export async function newGuestLink(env: ServerEnv, userId: string, eventId: string, guestId: string): Promise<void> {
  await guarded(
    actingAs(env, asPerson(userId), async (tx) => {
      const [g] = await tx.execute<{ version: number }>(sql`
        select link_version as version from guest where id = ${guestId} and event_id = ${eventId} and host_user_id = ${userId} for update`);
      if (!g) throw new PlanNotFound();
      const hash = await tokenHash(await linkToken(env, guestId, g.version + 1));
      await tx.execute(sql`
        update guest set token_hash = decode(${hash}, 'hex'), link_version = ${g.version + 1} where id = ${guestId}`);
    }),
  );
}

// ======================================================================= the guest (no account)

export type Invitation = {
  guestName: string;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  town: string;
  where: string | null;
  message: string | null;
  host: string;
  status: 'open' | 'closed' | 'cancelled';
  response: GuestResponse | null;
  partySize: number | null;
  note: string | null;
};

/** G1: what the guest's own link opens, or null (a wrong, replaced or expired link). */
export async function invitationFor(env: ServerEnv, token: string): Promise<Invitation | null> {
  if (!TOKEN.test(token)) return null;
  const hash = await tokenHash(token);
  const [row] = await withDb(env, (db) =>
    db.execute<Invitation>(sql`
      select guest_name as "guestName", title, event_date::text as date, to_char(start_time, 'HH24:MI') as "startTime",
             to_char(end_time, 'HH24:MI') as "endTime", town, venue_note as "where", message, host_name as host, status,
             response, party_size as "partySize", reply_note as note
      from invitation_for(decode(${hash}, 'hex'))`),
  );
  return row ?? null;
}

export function readReply(form: FormData): { response: GuestResponse; partySize: number | null; note: string | null } | { error: string } {
  const response = String(form.get('response') ?? '');
  if (response !== 'yes' && response !== 'no' && response !== 'maybe') return { error: GUEST_REFUSALS.response! };
  let partySize: number | null = null;
  if (response !== 'no') {
    partySize = Number(form.get('partySize') ?? '1');
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > GUEST_LIMITS.partySize) return { error: GUEST_REFUSALS.partySize! };
  }
  const note =
    String(form.get('note') ?? '')
      .replace(/\s+/g, ' ')
      .trim() || null;
  if (note && note.length > GUEST_LIMITS.note) return { error: GUEST_REFUSALS.noteTooLong! };
  return { response, partySize, note };
}

/** G2: the guest's reply, by their own link only (latest wins). */
export async function replyToInvitation(
  env: ServerEnv,
  token: string,
  reply: { response: GuestResponse; partySize: number | null; note: string | null },
): Promise<void> {
  if (!TOKEN.test(token)) throw new PlanNotFound();
  const hash = await tokenHash(token);
  await guarded(
    withDb(env, (db) =>
      db.execute(sql`
        select invitation_reply(decode(${hash}, 'hex'), ${reply.response}, ${reply.partySize}::smallint, ${reply.note})`),
    ),
  );
}

/** The morning job: guests' phone numbers and emails, 90 days after the event (D-10). */
export async function eraseGuestContacts(env: ServerEnv): Promise<number> {
  const [row] = await withDb(env, (db) => db.execute<{ n: number }>(sql`select erase_guest_contacts() as n`));
  return row?.n ?? 0;
}
