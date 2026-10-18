import { sql } from 'drizzle-orm';
import { GUEST_LIMITS, GUEST_REFUSALS, type GuestResponse, RESPONSE_WORDS } from '@/lib/guest-terms';
import { longDateWithYear } from '@/lib/plan-terms';
import { actingAs, errorCode, PlanCapped, PlanNotFound, PlanRefused } from './acting.server';
import { sendEmail } from './email.server';
import { renderEmail } from './email-templates.server';
import { type Db, withDb } from './db.server';
import type { ServerEnv } from './env';

/**
 * Guests and replies (Stage 4; D-08, D-10, E §4.6 and §5; migrations 0033 and 0037). The host
 * keeps a guest list for their own event, as the person (ADR-031); the database lets nobody
 * else read it. Each guest has a personal link the host sends from their own phone: the link
 * is made from INVITE_KEY (a secret only the site has) and the guest's id, so the host can
 * copy it again any time, and only its hash is stored. A guest has no account: their link
 * opens their own invitation and reply (invitation_for, invitation_reply) and nothing else.
 * Part 2: one group link per event (anyone with it replies with their name; the host matches
 * each reply to the list), the host's questions, and updates shown on every invitation.
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

/** The event's group link (D-08): made like a guest's link, from the event's id and version. */
async function groupToken(env: ServerEnv, eventId: string, version: number): Promise<string> {
  return linkToken(env, `group:${eventId}`, version);
}

/** The stored form of a token: its SHA-256, as hex for the query. */
export async function tokenHash(token: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
}

export const inviteUrl = (siteUrl: string, token: string) => `${siteUrl}/i/${token}`;
export const groupUrl = (siteUrl: string, token: string) => `${siteUrl}/g/${token}`;

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

export type Answer = { question: string; answer: string };
export type GroupReplyRow = {
  id: string;
  name: string;
  response: GuestResponse;
  partySize: number | null;
  note: string | null;
  at: string;
  answers: Answer[];
};
export type Question = { id: string; question: string };
export type GuestUpdate = { id: string; body: string; at: string };

/**
 * C13: the host's own guest list, in the order added, with the totals; and part 2: the group
 * link, replies through it not yet matched to a guest, the questions, each one's answers, and
 * the updates. One connection, as the host.
 */
export async function guestList(env: ServerEnv, userId: string, eventId: string, siteUrl: string) {
  return guarded(
    actingAs(env, asPerson(userId), async (tx) => {
      const event = await hostEvent(tx, userId, eventId);
      const guests = await tx.execute<GuestRow & { answers: Answer[] }>(sql`
        select g.id, g.name, g.phone, g.email, g.first_opened_at is not null as opened, g.response, g.party_size as "partySize",
               g.reply_note as note, g.replied_at::text as "repliedAt",
               coalesce((select json_agg(json_build_object('question', q.question, 'answer', a.answer) order by q.created_at)
                         from guest_answer a join event_question q on q.id = a.question_id where a.guest_id = g.id), '[]') as answers
        from guest g where g.event_id = ${eventId} and g.host_user_id = ${userId} order by g.created_at, g.id`);
      const groupReplies = await tx.execute<GroupReplyRow>(sql`
        select r.id, r.name, r.response, r.party_size as "partySize", r.reply_note as note, r.updated_at::text as at,
               coalesce((select json_agg(json_build_object('question', q.question, 'answer', a.answer) order by q.created_at)
                         from guest_answer a join event_question q on q.id = a.question_id where a.group_reply_id = r.id), '[]') as answers
        from group_reply r where r.event_id = ${eventId} and r.host_user_id = ${userId} and r.matched_guest_id is null
        order by r.created_at`);
      const questions = await tx.execute<Question>(sql`
        select id, question from event_question where event_id = ${eventId} and host_user_id = ${userId} order by created_at`);
      const updates = await tx.execute<GuestUpdate>(sql`
        select id, body, created_at::text as at from event_update where event_id = ${eventId} and host_user_id = ${userId}
        order by created_at desc`);
      const [link] = await tx.execute<{ version: number; on: boolean }>(sql`
        select version, token_hash is not null as on from event_group_link where event_id = ${eventId} and host_user_id = ${userId}`);
      const replies = [...guests, ...groupReplies];
      const people = (r: GuestResponse) => replies.filter((g) => g.response === r).reduce((n, g) => n + (g.partySize ?? 0), 0);
      return {
        event,
        guests: [...guests],
        groupReplies: [...groupReplies],
        questions: [...questions],
        updates: [...updates],
        groupLink: link?.on ? groupUrl(siteUrl, await groupToken(env, eventId, link.version)) : null,
        totals: {
          coming: people('yes'),
          maybe: people('maybe'),
          cantCome: replies.filter((g) => g.response === 'no').length,
          noReply: guests.filter((g) => g.response === null).length,
        },
      };
    }),
  );
}

/** For the printable page: the event, and the group link (or null when it's off). */
export async function groupLinkFor(env: ServerEnv, userId: string, eventId: string, siteUrl: string) {
  return guarded(
    actingAs(env, asPerson(userId), async (tx) => {
      const event = await hostEvent(tx, userId, eventId);
      const [link] = await tx.execute<{ version: number; on: boolean }>(sql`
        select version, token_hash is not null as on from event_group_link where event_id = ${eventId} and host_user_id = ${userId}`);
      return { event, link: link?.on ? groupUrl(siteUrl, await groupToken(env, eventId, link.version)) : null };
    }),
  );
}

/** The group link, made or replaced (the old one stops at once). */
export async function newGroupLink(env: ServerEnv, userId: string, eventId: string): Promise<void> {
  await guarded(
    actingAs(env, asPerson(userId), async (tx) => {
      await hostEvent(tx, userId, eventId);
      const [link] = await tx.execute<{ version: number }>(sql`
        select version from event_group_link where event_id = ${eventId} and host_user_id = ${userId} for update`);
      const version = link ? link.version + 1 : 1;
      const hash = await tokenHash(await groupToken(env, eventId, version));
      await tx.execute(
        link
          ? sql`update event_group_link set token_hash = decode(${hash}, 'hex'), version = ${version} where event_id = ${eventId}`
          : sql`insert into event_group_link (event_id, host_user_id, token_hash) values (${eventId}, ${userId}, decode(${hash}, 'hex'))`,
      );
    }),
  );
}

/** Switches the group link off: it stops at once; replies already sent stay. */
export async function groupLinkOff(env: ServerEnv, userId: string, eventId: string): Promise<void> {
  await guarded(
    actingAs(env, asPerson(userId), (tx) =>
      tx.execute(sql`update event_group_link set token_hash = null where event_id = ${eventId} and host_user_id = ${userId}`),
    ),
  );
}

/** The host matches a group reply to a guest on their list (or removes it). */
export async function matchGroupReply(env: ServerEnv, userId: string, eventId: string, replyId: string, guestId: string): Promise<void> {
  await guarded(
    actingAs(env, asPerson(userId), async (tx) => {
      await hostEvent(tx, userId, eventId);
      await tx.execute(sql`select match_group_reply(${replyId}::uuid, ${guestId}::uuid)`);
    }),
  );
}

export async function removeGroupReply(env: ServerEnv, userId: string, eventId: string, replyId: string): Promise<void> {
  await guarded(
    actingAs(env, asPerson(userId), async (tx) => {
      const done = await tx.execute(sql`
        delete from group_reply where id = ${replyId} and event_id = ${eventId} and host_user_id = ${userId} returning id`);
      if (done.length === 0) throw new PlanNotFound();
    }),
  );
}

export async function addQuestion(env: ServerEnv, userId: string, eventId: string, question: string): Promise<void> {
  await guarded(
    actingAs(env, asPerson(userId), (tx) =>
      tx.execute(sql`insert into event_question (id, event_id, host_user_id, question) values (${crypto.randomUUID()}, ${eventId}, ${userId}, ${question})`),
    ),
  );
}

export async function removeQuestion(env: ServerEnv, userId: string, eventId: string, questionId: string): Promise<void> {
  await guarded(
    actingAs(env, asPerson(userId), async (tx) => {
      const done = await tx.execute(sql`
        delete from event_question where id = ${questionId} and event_id = ${eventId} and host_user_id = ${userId} returning id`);
      if (done.length === 0) throw new PlanNotFound();
    }),
  );
}

export async function postUpdate(env: ServerEnv, userId: string, eventId: string, body: string): Promise<void> {
  await guarded(
    actingAs(env, asPerson(userId), (tx) =>
      tx.execute(sql`insert into event_update (id, event_id, host_user_id, body) values (${crypto.randomUUID()}, ${eventId}, ${userId}, ${body})`),
    ),
  );
}

export async function removeUpdate(env: ServerEnv, userId: string, eventId: string, updateId: string): Promise<void> {
  await guarded(
    actingAs(env, asPerson(userId), async (tx) => {
      const done = await tx.execute(sql`
        delete from event_update where id = ${updateId} and event_id = ${eventId} and host_user_id = ${userId} returning id`);
      if (done.length === 0) throw new PlanNotFound();
    }),
  );
}

/** One line of text from the host's form (a question or an update), tidied. */
export function readLine(form: FormData, field: string, max: number, empty: string, tooLong: string): { text: string } | { error: string } {
  const text = String(form.get(field) ?? '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (!text) return { error: empty };
  if (text.length > max) return { error: tooLong };
  return { text };
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

/** How a reply reads in words (the host's list, the guest's email). */
export const replyWords = (response: GuestResponse, partySize: number | null) =>
  `${RESPONSE_WORDS[response]}${response !== 'no' && partySize ? ` (${partySize} ${partySize === 1 ? 'person' : 'people'})` : ''}`;

/**
 * The host sets one guest's reply (D-49). If the host gave the guest's email and the event
 * isn't over, the guest is emailed about it with their link, within the database's limits
 * (host_set_reply decides; a held-back email is recorded with why). Returns whether an email went.
 */
export async function hostSetReply(
  env: ServerEnv,
  userId: string,
  eventId: string,
  guestId: string,
  reply: { response: GuestResponse; partySize: number | null },
  siteUrl: string,
): Promise<'emailed' | 'not_emailed' | 'held_back' | 'email_failed'> {
  const due = await guarded(
    actingAs(env, asPerson(userId), async (tx) => {
      const event = await hostEvent(tx, userId, eventId);
      const [g] = await tx.execute<{ name: string; version: number }>(sql`
        select name, link_version as version from guest where id = ${guestId} and event_id = ${eventId} and host_user_id = ${userId}`);
      if (!g) throw new PlanNotFound();
      const [email] = await tx.execute<{ emailId: string | null; email: string | null; heldBack: string | null }>(sql`
        select email_id as "emailId", email, held_back as "heldBack"
        from host_set_reply(${guestId}::uuid, ${reply.response}, ${reply.partySize}::smallint)`);
      const [host] = await tx.execute<{ name: string | null }>(sql`select given_name as name from app_user where id = ${userId}`);
      return email ? { ...email, guest: g, event, host: host?.name ?? 'Your host' } : null;
    }),
  );
  if (!due) return 'not_emailed';
  if (!due.emailId || !due.email) return 'held_back';
  const emailId = due.emailId;
  const result = await sendEmail(env, {
    to: due.email,
    ...renderEmail('guestReplyChanged', {
      host: due.host,
      guest: due.guest.name,
      title: due.event.name,
      date: longDateWithYear(due.event.date),
      reply: replyWords(reply.response, reply.partySize),
      link: inviteUrl(siteUrl, await linkToken(env, guestId, due.guest.version)),
    }),
  });
  await actingAs(env, asPerson(userId), (tx) =>
    tx.execute(
      result.sent
        ? sql`update guest_email set status = 'sent', sent_at = now() where id = ${emailId}`
        : sql`update guest_email set status = 'failed', failure_reason = ${result.reason} where id = ${emailId}`,
    ),
  ).catch((err: unknown) => console.error('guest email outcome not recorded', err instanceof Error ? err.message : err));
  return result.sent ? 'emailed' : 'email_failed';
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
  /** The host's first name; null when they haven't given one. */
  host: string | null;
  status: 'open' | 'closed' | 'cancelled';
  response: GuestResponse | null;
  partySize: number | null;
  note: string | null;
  /** Who set the reply last: the guest, or the host (D-49). */
  replyBy: 'guest' | 'host' | null;
  timezone: string;
};

/** What an invitation also shows (part 2): the host's questions with this guest's answers, and the updates. */
export type InvitationExtras = { questions: (Question & { answer: string | null })[]; updates: GuestUpdate[] };

async function extrasFor(env: ServerEnv, hash: string, browserHash: string | null): Promise<InvitationExtras> {
  const rows = await withDb(env, (db) =>
    db.execute<{ kind: 'question' | 'update'; id: string; body: string; answer: string | null; at: string }>(sql`
      select kind, id, body, answer, at::text as at
      from invitation_extras(decode(${hash}, 'hex'), ${browserHash ? sql`decode(${browserHash}, 'hex')` : sql`null`})`),
  );
  return {
    questions: rows.filter((r) => r.kind === 'question').map((r) => ({ id: r.id, question: r.body, answer: r.answer })),
    updates: rows
      .filter((r) => r.kind === 'update')
      .map((r) => ({ id: r.id, body: r.body, at: r.at }))
      .reverse(),
  };
}

export async function invitationExtras(env: ServerEnv, token: string): Promise<InvitationExtras> {
  return extrasFor(env, await tokenHash(token), null);
}

/** Answers from the form: answer.<question id> fields, each up to 500 characters. */
export function readAnswers(form: FormData): Record<string, string> | { error: string } {
  const answers: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    const m = /^answer\.([0-9a-f-]{36})$/.exec(key);
    if (!m) continue;
    const text = String(value).replace(/\s+/g, ' ').trim();
    if (text.length > GUEST_LIMITS.answer) return { error: GUEST_REFUSALS.answerTooLong! };
    answers[m[1]!] = text;
  }
  return answers;
}

/** A guest's answers by their own link (after their reply). */
export async function answerInvitation(env: ServerEnv, token: string, answers: Record<string, string>): Promise<void> {
  if (!TOKEN.test(token) || Object.keys(answers).length === 0) return;
  const hash = await tokenHash(token);
  await guarded(
    withDb(env, (db) => db.execute(sql`select invitation_answers(decode(${hash}, 'hex'), ${JSON.stringify(answers)}::jsonb)`)),
  );
}

// ------------------------------------------------------------------ the group link (no account)

/**
 * G1 by the group link: the invitation without a guest's name, and this browser's own reply
 * (found by the hash of its random key, kept in a cookie). Null: a wrong, replaced, switched
 * off or expired link.
 */
export async function groupInvitationFor(
  env: ServerEnv,
  token: string,
  browserKey: string | null,
): Promise<(Invitation & { replyName: string | null; extras: InvitationExtras }) | null> {
  if (!TOKEN.test(token)) return null;
  const hash = await tokenHash(token);
  const browserHash = browserKey ? await tokenHash(browserKey) : await tokenHash('no-browser-key');
  const [row] = await withDb(env, (db) =>
    db.execute<Invitation & { replyName: string | null }>(sql`
      select '' as "guestName", title, event_date::text as date, to_char(start_time, 'HH24:MI') as "startTime",
             to_char(end_time, 'HH24:MI') as "endTime", town, venue_note as "where", message, host_name as host, status,
             response, party_size as "partySize", reply_note as note, case when response is null then null else 'guest' end as "replyBy",
             timezone, reply_name as "replyName"
      from group_invitation_for(decode(${hash}, 'hex'), decode(${browserHash}, 'hex'))`),
  );
  if (!row) return null;
  return { ...row, extras: await extrasFor(env, hash, browserHash) };
}

/** G2 by the group link: a reply with a name, or this browser's own changed. */
export async function replyToGroup(
  env: ServerEnv,
  token: string,
  browserKey: string,
  reply: { name: string; response: GuestResponse; partySize: number | null; note: string | null },
  answers: Record<string, string>,
): Promise<void> {
  if (!TOKEN.test(token)) throw new PlanNotFound();
  const [hash, browserHash] = await Promise.all([tokenHash(token), tokenHash(browserKey)]);
  await guarded(
    withDb(env, (db) =>
      db.execute(sql`
        select group_invitation_reply(decode(${hash}, 'hex'), decode(${browserHash}, 'hex'), ${reply.name}, ${reply.response},
                                      ${reply.partySize}::smallint, ${reply.note}, ${JSON.stringify(answers)}::jsonb)`),
    ),
  );
}

/** G1: what the guest's own link opens, or null (a wrong, replaced or expired link). */
export async function invitationFor(env: ServerEnv, token: string): Promise<Invitation | null> {
  if (!TOKEN.test(token)) return null;
  const hash = await tokenHash(token);
  const [row] = await withDb(env, (db) =>
    db.execute<Invitation>(sql`
      select guest_name as "guestName", title, event_date::text as date, to_char(start_time, 'HH24:MI') as "startTime",
             to_char(end_time, 'HH24:MI') as "endTime", town, venue_note as "where", message, host_name as host, status,
             response, party_size as "partySize", reply_note as note, reply_by as "replyBy", timezone
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
