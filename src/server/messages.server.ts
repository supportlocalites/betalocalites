import { sql } from 'drizzle-orm';
import { uuidv7 } from '@/lib/ids.mjs';
import { MESSAGE_LIMITS, MESSAGE_REFUSALS } from '@/lib/message-terms';
import { type Acting, actAs, actingAs, errorCode, PlanCapped, PlanNotFound, PlanRefused } from './acting.server';
import { type Db, withDb } from './db.server';
import { sendEmails } from './email.server';
import { renderEmail } from './email-templates.server';
import {
  abandonAttachment,
  type Attachment,
  attachFile,
  checkFileRoom,
  checkFilesToday,
  filesByMessage,
  findFile,
  type ShownFile,
  storeAttachment,
} from './conversation-files.server';
import type { ServerEnv } from './env';
import { readPrivateFile } from './photo-store.server';
import { LIST_PHOTO, LIST_PHOTO_COLUMNS, type ListPhoto, type ListPhotoColumns, withListPhoto } from './photo-store.server';

/**
 * Messages (Stage 2B, part 1; D-13, D-17, E §4.3 and §6, migration 0023). A person starts a
 * conversation with a business that has joined Localites; the business's team (owner,
 * managers and staff) replies. Every step acts as a side (ADR-031), and the database's own
 * rules decide what that side may read and write: the person their own conversations, the
 * business its own (never one from before its team last ended, migration 0025), the team only
 * through a report. Unread positions are private. Emails about new messages go once per
 * unread stretch, within the site's daily limit (new_message_notices()).
 */

/** Refusals in plain words; someone else's conversation, like a missing one, is "not found". */
export async function talked<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (err) {
    if (err instanceof PlanNotFound || err instanceof PlanRefused || err instanceof PlanCapped) throw err;
    const code = errorCode(err);
    if (code === 'LP101' || code === '42501' || code === '23503') {
      console.error('message refused as not found:', code);
      throw new PlanNotFound();
    }
    const words = code ? (MESSAGE_REFUSALS as Record<string, string>)[code] : undefined;
    if (words) throw new PlanRefused(words);
    throw err;
  }
}

const asPerson = (userId: string): Acting => ({ side: 'person', userId });
const snippet = (body: string | null, removed: boolean, hidden = false) =>
  hidden
    ? 'Message hidden by Localites'
    : removed
      ? 'Message removed'
      : body === ''
        ? 'Sent a file'
        : body
          ? body.replace(/\s+/g, ' ').slice(0, 120)
          : null;

/** One sender at a time: a lock on their account row, held until the step ends. */
async function lockSender(tx: Db, userId: string): Promise<void> {
  const [me] = await tx.execute<{ id: string }>(sql`select id from app_user where id = ${userId} and deleted_at is null for update`);
  if (!me) throw new PlanNotFound();
}

/** One person's sending limits; call lockSender first. */
async function checkLimits(tx: Db, userId: string, newConversation: boolean): Promise<void> {
  const [n] = await tx.execute<{ messages: number; started: number }>(sql`
    select (select count(*) from message where author_user_id = ${userId} and created_at > now() - interval '1 day')::int as messages,
           (select count(*) from conversation where consumer_user_id = ${userId} and created_at > now() - interval '1 day')::int as started`);
  if ((n?.messages ?? 0) >= MESSAGE_LIMITS.messagesPerDay) throw new PlanCapped(MESSAGE_REFUSALS.messagesPerDay);
  if (newConversation && (n?.started ?? 0) >= MESSAGE_LIMITS.conversationsPerDay)
    throw new PlanCapped(MESSAGE_REFUSALS.conversationsPerDay);
}

/**
 * Writes a message, unless it's the same words this person sent last in this conversation
 * within the last 2 minutes (Send pressed twice, or a page sent again): then that message
 * stands, and `again` says so (no second email). With a file, the same words and the same file
 * (name, type, exact size and a photo's width and height) within 30 seconds count as sent again
 * (scenario tests: a double tap sent a photo twice); the caller then doesn't attach the second
 * copy. Call lockSender first.
 */
async function writeMessage(
  tx: Db,
  conversationId: string,
  userId: string,
  side: 'consumer' | 'vendor',
  body: string,
  file: Attachment | null = null,
): Promise<{ messageId: string; again: boolean }> {
  if (file) {
    const [twice] = await tx.execute<{ id: string }>(sql`
      select m.id from message m join conversation_file f on f.message_id = m.id
      where m.conversation_id = ${conversationId} and m.author_user_id = ${userId} and m.body = ${body}
        and m.removed_at is null and m.created_at > now() - interval '30 seconds'
        and f.file_name = ${file.name} and f.byte_size = ${file.bytes.byteLength} and f.mime_type = ${file.type}
        and f.width is not distinct from ${file.width}::int and f.height is not distinct from ${file.height}::int
      order by m.created_at desc limit 1`);
    if (twice) return { messageId: twice.id, again: true };
    const messageId = uuidv7();
    await tx.execute(sql`
      insert into message (id, conversation_id, author_user_id, author_side, body)
      values (${messageId}, ${conversationId}, ${userId}, ${side}, ${body})`);
    return { messageId, again: false };
  }
  const [last] = await tx.execute<{ id: string; same: boolean }>(sql`
    select id, author_user_id = ${userId} and body = ${body} and removed_at is null
               and created_at > now() - interval '2 minutes' as same
    from message where conversation_id = ${conversationId}
    order by created_at desc, id desc limit 1`);
  if (last?.same) return { messageId: last.id, again: true };
  const messageId = uuidv7();
  await tx.execute(sql`
    insert into message (id, conversation_id, author_user_id, author_side, body)
    values (${messageId}, ${conversationId}, ${userId}, ${side}, ${body})`);
  return { messageId, again: false };
}

/**
 * What a conversation page compares to see whether anything changed: a new message (also one
 * saved a moment out of order: the count), a removal or hiding, a block, its end, the event
 * it's about, or the business being listed or not. Each in its own place, empty ones too.
 * Read before the messages, so a message arriving in between shows on the next look.
 */
const VERSION = sql`format('%s|%s|%s|%s|%s|%s|%s|%s|%s', c.status, c.ended_at, c.last_message_at, c.event_id, v.claim_status,
  v.listing_status, (select count(*) from message m where m.conversation_id = c.id),
  (select count(*) from conversation_file f where f.conversation_id = c.id and f.deleted_at is null),
  (select max(greatest(m.removed_at, m.hidden_by_team_at, m.edited_at)) from message m where m.conversation_id = c.id))`;

/** For the person: the business isn't on Localites (its team ended, or it was archived): nobody can write. */
const LEFT = sql`(c.ended_at is not null or v.claim_status <> 'claimed' or v.listing_status = 'archived')`;
/** For the person: the conversation ended, and the business has since joined Localites again (a new team). */
const REJOINED = sql`(c.ended_at is not null and v.claim_status = 'claimed' and v.listing_status = 'published')`;

export type ThreadMessage = {
  id: string;
  mine: boolean;
  fromBusiness: boolean;
  author: string;
  body: string;
  createdAt: string;
  removed: boolean;
  /** Hidden by the Localites team after a report (part 2): neither side sees its words. */
  hidden: boolean;
  /** The photo or PDF sent with it (part 3), while it's there. */
  file: ShownFile | null;
  /** Its author changed its words (M2, D-54): its earlier versions, oldest first, for both sides. */
  edited: boolean;
  versions: { body: string; replacedAt: string }[];
};

/**
 * The latest 300 messages, oldest first. The person sees the business's name on its
 * messages; the business's team also sees which of them wrote each one.
 */
async function readMessages(tx: Db, conversationId: string, userId: string, viewer: 'person' | 'business', businessName: string) {
  const rows = await tx.execute<{
    id: string;
    side: 'consumer' | 'vendor';
    authorId: string;
    authorName: string;
    body: string;
    createdAt: string;
    removed: boolean;
    hidden: boolean;
    edited: boolean;
  }>(sql`
    select m.id, m.author_side as side, m.author_user_id as "authorId", u.display_name as "authorName",
           case when m.hidden_by_team_at is null then m.body else '' end as body,
           m.created_at::text as "createdAt", m.removed_at is not null as removed, m.hidden_by_team_at is not null as hidden,
           m.edited_at is not null and m.removed_at is null and m.hidden_by_team_at is null as edited
    from message m join app_user u on u.id = m.author_user_id
    where m.conversation_id = ${conversationId}
    order by m.created_at desc, m.id desc
    limit 300`);
  const files = await filesByMessage(tx, conversationId);
  // Earlier versions (the database shows them only for messages that still show).
  const edits = await tx.execute<{ messageId: string; body: string; replacedAt: string }>(sql`
    select e.message_id as "messageId", e.body, e.replaced_at::text as "replacedAt"
    from message_edit e join message m on m.id = e.message_id
    where m.conversation_id = ${conversationId} order by e.replaced_at`);
  const versions = new Map<string, { body: string; replacedAt: string }[]>();
  for (const e of edits) versions.set(e.messageId, [...(versions.get(e.messageId) ?? []), { body: e.body, replacedAt: e.replacedAt }]);
  return [...rows].reverse().map(
    (m): ThreadMessage => ({
      id: m.id,
      mine: m.authorId === userId,
      fromBusiness: m.side === 'vendor',
      author: m.side === 'vendor' && viewer === 'person' ? businessName : m.authorName,
      body: m.body,
      createdAt: m.createdAt,
      removed: m.removed,
      hidden: m.hidden,
      file: files.get(m.id) ?? null,
      edited: m.edited,
      versions: m.edited ? (versions.get(m.id) ?? []) : [],
    }),
  );
}

/**
 * Marks the conversation read up to `upTo`, the newest message the page showed, so one saved
 * a moment later isn't counted as read; or up to now (after writing). Never goes back.
 */
async function markRead(tx: Db, conversationId: string, userId: string, upTo: string | null = null) {
  await tx.execute(sql`
    insert into conversation_read (conversation_id, user_id, last_read_at) values (${conversationId}, ${userId}, ${upTo}::timestamptz)
    on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at`);
}

// ======================================================================= the person's side

export type ConversationCard = {
  id: string;
  vendorSlug: string;
  vendorName: string;
  photo: ListPhoto | null;
  lastMessageAt: string | null;
  snippet: string | null;
  lastFromMe: boolean;
  unread: number;
  /** Which of the person's events it's about, if any: Messages groups by it (D-58). */
  event: { id: string; name: string; date: string } | null;
  blocked: boolean;
  /** The business isn't on Localites any more (left, or no one runs it): the conversation has ended. */
  left: boolean;
  /** The business isn't listed at the moment: messages are paused. */
  paused: boolean;
  /** The conversation ended, and the business has since joined again: the person can start afresh. */
  rejoined: boolean;
};

export async function myConversations(env: ServerEnv, userId: string): Promise<ConversationCard[]> {
  return talked(
    actingAs(env, asPerson(userId), async (tx) => {
      const rows = await tx.execute<
        Omit<ConversationCard, 'photo' | 'snippet' | 'event'> &
          ListPhotoColumns & {
            listed: boolean;
            lastBody: string | null;
            lastRemoved: boolean;
            lastHidden: boolean;
            eventId: string | null;
            eventName: string | null;
            eventDate: string | null;
          }
      >(sql`
        select c.id, v.slug::text as "vendorSlug", v.display_name as "vendorName", c.last_message_at::text as "lastMessageAt",
               c.status <> 'open' as blocked, ${LEFT} as left, not ${LEFT} and v.listing_status <> 'published' as paused,
               ${REJOINED} as rejoined,
               v.listing_status = 'published' as listed,
               lm.body as "lastBody", coalesce(lm.removed, false) as "lastRemoved", coalesce(lm.hidden, false) as "lastHidden",
               coalesce(lm.mine, false) as "lastFromMe",
               (select count(*) from message m where m.conversation_id = c.id and m.author_side = 'vendor' and m.removed_at is null and m.hidden_by_team_at is null
                  and m.created_at > coalesce(r.last_read_at, '-infinity'))::int as unread,
               ev.id as "eventId", ep.title as "eventName", ev.event_date::text as "eventDate",
               ${LIST_PHOTO_COLUMNS}
        from conversation c join vendor v on v.id = c.vendor_id
        left join conversation_read r on r.conversation_id = c.id and r.user_id = ${userId}
        left join event ev on ev.id = c.event_id and ev.host_user_id = ${userId}
        left join event_private ep on ep.event_id = ev.id
        left join lateral (
          select case when m.hidden_by_team_at is null then m.body end as body, m.removed_at is not null as removed,
                 m.hidden_by_team_at is not null as hidden, m.author_side = 'consumer' as mine
          from message m where m.conversation_id = c.id order by m.created_at desc limit 1
        ) lm on true
        ${LIST_PHOTO}
        where c.consumer_user_id = ${userId}
        order by c.last_message_at desc nulls last
        limit 200`);
      return rows.map(({ lastBody, lastRemoved, lastHidden, listed, eventId, eventName, eventDate, ...r }) => ({
        ...withListPhoto(env, r, listed),
        snippet: snippet(lastBody, lastRemoved, lastHidden),
        event: eventId && eventName && eventDate ? { id: eventId, name: eventName, date: eventDate } : null,
      }));
    }),
  );
}

export type StartPage = {
  vendor: { id: string; slug: string; name: string; open: boolean; ownBusiness: boolean };
  existing: string | null;
  events: { id: string; name: string; date: string }[];
};

/** C9: starting a conversation (or the one already there). */
export async function startPage(env: ServerEnv, userId: string, slug: string): Promise<StartPage> {
  return talked(
    actingAs(env, asPerson(userId), async (tx) => {
      const [vendor] = await tx.execute<StartPage['vendor']>(sql`
        select v.id, v.slug::text as slug, v.display_name as name, v.claim_status = 'claimed' as open,
               exists (select 1 from vendor_member m where m.vendor_id = v.id and m.user_id = ${userId} and m.ended_at is null) as "ownBusiness"
        from vendor v where v.slug = ${slug} and v.listing_status = 'published'`);
      if (!vendor) throw new PlanNotFound();
      const [c] = await tx.execute<{ id: string }>(sql`
        select id from conversation where consumer_user_id = ${userId} and vendor_id = ${vendor.id} and ended_at is null`);
      const events = await tx.execute<StartPage['events'][number]>(sql`
        select e.id, p.title as name, e.event_date::text as date
        from event e join event_private p on p.event_id = e.id
        where e.host_user_id = ${userId} and e.status = 'planning' and event_ends_at(e) >= now()
        order by e.event_date, e.start_time nulls first limit 50`);
      return { vendor, existing: c?.id ?? null, events: [...events] };
    }),
  );
}

/** again: the same message was already sent a moment ago (see writeMessage); nobody is emailed twice. */
export type Written = { conversationId: string; messageId: string; again: boolean };

/** Starts a conversation with its first message (or adds to the one already there). */
export async function startConversation(
  env: ServerEnv,
  userId: string,
  slug: string,
  input: { body: string; eventId: string | null; file?: Attachment | null },
): Promise<Written> {
  const file = input.file ?? null;
  // With a file, the conversation's id is chosen first, so the file can be stored in its folder
  // before the step that writes them (the database checks the folder matches).
  let planned: string | null = null;
  let path: string | null = null;
  if (file) {
    const page = await startPage(env, userId, slug);
    if (!page.vendor.open || page.vendor.ownBusiness) throw new PlanRefused(MESSAGE_REFUSALS.LP140);
    planned = page.existing ?? uuidv7();
    await checkFileRoom(env, file.bytes.length);
    path = await storeAttachment(env, planned, file);
  }
  try {
    return await talked(
      actingAs(env, asPerson(userId), async (tx) => {
        const [v] = await tx.execute<{ id: string }>(sql`select id from vendor where slug = ${slug} and listing_status = 'published'`);
        if (!v) throw new PlanNotFound();
        // Locked first, so two quick sends can't both find no conversation and both start one.
        await lockSender(tx, userId);
        const [existing] = await tx.execute<{ id: string }>(sql`
          select id from conversation where consumer_user_id = ${userId} and vendor_id = ${v.id} and ended_at is null`);
        await checkLimits(tx, userId, !existing);
        if (file) await checkFilesToday(tx, userId, file.bytes.byteLength);
        const conversationId = existing?.id ?? planned ?? uuidv7();
        if (!existing) {
          await tx.execute(sql`
            insert into conversation (id, consumer_user_id, vendor_id, event_id)
            values (${conversationId}, ${userId}, ${v.id}, ${input.eventId})`);
        } else if (input.eventId) {
          await tx.execute(sql`update conversation set event_id = ${input.eventId} where id = ${conversationId}`);
        }
        const { messageId, again } = await writeMessage(tx, conversationId, userId, 'consumer', input.body, file);
        if (file && path && !again) await attachFile(tx, messageId, conversationId, userId, path, file);
        await markRead(tx, conversationId, userId);
        return { conversationId, messageId, again };
      }),
    ).then(async (written) => {
      // Sent twice in a moment: the first copy stands, this one's stored file goes.
      if (written.again && path) await abandonAttachment(env, path);
      return written;
    });
  } catch (err) {
    if (path) await abandonAttachment(env, path);
    throw err;
  }
}

export type MessageAllPage = {
  event: { id: string; name: string; date: string };
  /** The businesses on the event's Considering list that are on Localites and listed, in the order added. */
  businesses: { slug: string; name: string }[];
};

/** "Message all" on an event's Considering list (D-58): the person's own event, still being planned. */
export async function messageAllPage(env: ServerEnv, userId: string, eventId: string): Promise<MessageAllPage> {
  return talked(
    actingAs(env, asPerson(userId), async (tx) => {
      const [event] = await tx.execute<MessageAllPage['event']>(sql`
        select e.id, p.title as name, e.event_date::text as date
        from event e join event_private p on p.event_id = e.id
        where e.id = ${eventId} and e.host_user_id = ${userId} and e.status = 'planning' and event_ends_at(e) >= now()`);
      if (!event) throw new PlanNotFound();
      const businesses = await tx.execute<MessageAllPage['businesses'][number]>(sql`
        select v.slug::text as slug, v.display_name as name
        from event_vendor ev join vendor v on v.id = ev.vendor_id
        where ev.event_id = ${eventId} and ev.host_user_id = ${userId} and ev.status = 'considering'
          and v.listing_status = 'published' and v.claim_status = 'claimed'
          and not exists (select 1 from vendor_member m where m.vendor_id = v.id and m.user_id = ${userId} and m.ended_at is null)
        order by ev.created_at`);
      return { event, businesses: [...businesses] };
    }),
  );
}

export type MessageAllResult = { sent: Written[]; sentTo: string[]; notSent: { name: string; why: string }[] };

/**
 * Sends the same words to each chosen business on the event's Considering list (at most
 * messageAllMax), each in its own conversation about this event, one at a time through
 * startConversation, so every limit and rule is the same as messaging them one by one. One
 * refused (blocked, say) doesn't stop the rest; the day's limit stops what's left.
 */
export async function messageAll(env: ServerEnv, userId: string, eventId: string, slugs: string[], body: string): Promise<MessageAllResult> {
  const page = await messageAllPage(env, userId, eventId);
  const chosen = page.businesses.filter((b) => slugs.includes(b.slug));
  if (chosen.length === 0) throw new PlanRefused('Choose at least one business.');
  if (chosen.length > MESSAGE_LIMITS.messageAllMax)
    throw new PlanRefused(`Choose up to ${MESSAGE_LIMITS.messageAllMax} businesses at a time.`);
  const result: MessageAllResult = { sent: [], sentTo: [], notSent: [] };
  for (const [i, b] of chosen.entries()) {
    try {
      const written = await startConversation(env, userId, b.slug, { body, eventId });
      // The same words a moment ago (Send pressed twice): already there, not sent again.
      if (written.again) result.notSent.push({ name: b.name, why: 'You sent them this a moment ago.' });
      else {
        result.sent.push(written);
        result.sentTo.push(b.name);
      }
    } catch (err) {
      if (err instanceof PlanCapped) {
        for (const rest of chosen.slice(i)) result.notSent.push({ name: rest.name, why: err.message });
        break;
      }
      if (err instanceof PlanRefused) result.notSent.push({ name: b.name, why: err.message });
      else if (err instanceof PlanNotFound) result.notSent.push({ name: b.name, why: 'It can’t be messaged at the moment.' });
      else {
        // Something went wrong part-way (independent review): those already sent still get their
        // emails, and the person is told plainly which weren't sent.
        console.error('message all stopped:', err instanceof Error ? err.message : err);
        const why = 'Something went wrong, so it wasn’t sent. Please try again.';
        for (const rest of chosen.slice(i)) result.notSent.push({ name: rest.name, why });
        break;
      }
    }
  }
  return result;
}

export type PersonThread = {
  id: string;
  vendor: { slug: string; name: string; photo: ListPhoto | null; left: boolean; paused: boolean; rejoined: boolean; yourTeam: boolean };
  /** The conversation has ended (the business left Localites); see vendor.rejoined. */
  ended: boolean;
  status: 'open' | 'blocked_by_consumer' | 'blocked_by_vendor' | 'blocked_by_team';
  /** Compared by the page's quick look for anything new (personVersion). */
  version: string;
  event: { id: string; name: string; date: string } | null;
  events: { id: string; name: string; date: string }[];
  messages: ThreadMessage[];
};

/** C8: one conversation, as the person; marks it read. */
export async function personThread(env: ServerEnv, userId: string, conversationId: string): Promise<PersonThread> {
  return talked(
    actingAs(env, asPerson(userId), async (tx) => {
      const [c] = await tx.execute<
        {
          id: string;
          status: PersonThread['status'];
          eventId: string | null;
          slug: string;
          name: string;
          left: boolean;
          listed: boolean;
          rejoined: boolean;
          yourTeam: boolean;
          ended: boolean;
          version: string;
        } & ListPhotoColumns
      >(sql`
        select c.id, c.status, c.event_id as "eventId", v.slug::text as slug, v.display_name as name,
               ${LEFT} as left, v.listing_status = 'published' as listed, ${REJOINED} as rejoined,
               -- C6 (D-54): the person now runs (or works for) the business they wrote to.
               exists (select 1 from vendor_member m where m.vendor_id = v.id and m.user_id = ${userId} and m.ended_at is null) as "yourTeam",
               c.ended_at is not null as ended, ${VERSION} as version,
               ${LIST_PHOTO_COLUMNS}
        from conversation c join vendor v on v.id = c.vendor_id
        ${LIST_PHOTO}
        where c.id = ${conversationId} and c.consumer_user_id = ${userId}`);
      if (!c) throw new PlanNotFound();
      const events = await tx.execute<PersonThread['events'][number]>(sql`
        select e.id, p.title as name, e.event_date::text as date
        from event e join event_private p on p.event_id = e.id
        where e.host_user_id = ${userId} and (e.id = ${c.eventId} or (e.status = 'planning' and event_ends_at(e) >= now()))
        order by e.event_date limit 50`);
      const messages = await readMessages(tx, c.id, userId, 'person', c.name);
      await markRead(tx, c.id, userId, messages.at(-1)?.createdAt ?? null);
      const { photo } = withListPhoto(env, c, c.listed);
      return {
        id: c.id,
        vendor: { slug: c.slug, name: c.name, photo, left: c.left, paused: !c.left && !c.listed, rejoined: c.rejoined, yourTeam: c.yourTeam },
        ended: c.ended,
        status: c.status,
        version: c.version,
        event: events.find((e) => e.id === c.eventId) ?? null,
        events: [...events],
        messages,
      };
    }),
  );
}

/**
 * Stores the file (if any) first, outside the step that writes the message, then writes
 * both; a file whose message wasn't saved is deleted again.
 */
async function sendWith<T>(
  env: ServerEnv,
  conversationId: string,
  file: Attachment | null,
  canSee: () => Promise<unknown>,
  write: (path: string | null) => Promise<T>,
): Promise<T> {
  if (!file) return write(null);
  await canSee();
  await checkFileRoom(env, file.bytes.length);
  const path = await storeAttachment(env, conversationId, file);
  try {
    const written = await write(path);
    // Sent twice in a moment: the first copy stands, this one's stored file goes.
    if ((written as { again?: boolean }).again) await abandonAttachment(env, path);
    return written;
  } catch (err) {
    await abandonAttachment(env, path);
    throw err;
  }
}

/** The person writes in their conversation, with a photo or PDF if they chose one. */
export async function personSend(
  env: ServerEnv,
  userId: string,
  conversationId: string,
  body: string,
  file: Attachment | null = null,
): Promise<Written> {
  return sendWith(
    env,
    conversationId,
    file,
    () => personVersion(env, userId, conversationId),
    (path) =>
      talked(
        actingAs(env, asPerson(userId), async (tx) => {
          await lockSender(tx, userId);
          await checkLimits(tx, userId, false);
          if (file) await checkFilesToday(tx, userId, file.bytes.byteLength);
          const { messageId, again } = await writeMessage(tx, conversationId, userId, 'consumer', body, file);
          if (file && path && !again) await attachFile(tx, messageId, conversationId, userId, path, file);
          await markRead(tx, conversationId, userId);
          return { conversationId, messageId, again };
        }),
      ),
  );
}

/** Changes to the person's conversation: block, unblock, the event it's about, removing their own message. */
export async function personChange(
  env: ServerEnv,
  userId: string,
  conversationId: string,
  change:
    | { kind: 'block' | 'unblock' | 'delete' }
    | { kind: 'event'; eventId: string | null }
    | { kind: 'remove'; messageId: string }
    | { kind: 'edit'; messageId: string; body: string },
): Promise<void> {
  await talked(
    actingAs(env, asPerson(userId), async (tx) => {
      // M1, M2 (D-54): the database's own functions, which check who's asking.
      if (change.kind === 'delete') {
        await tx.execute(sql`select delete_my_conversation(${conversationId}::uuid)`);
        return;
      }
      if (change.kind === 'edit') {
        await editMessage(tx, conversationId, change.messageId, change.body);
        return;
      }
      const done =
        change.kind === 'remove'
          ? await tx.execute(sql`
              update message set removed_at = now()
              where id = ${change.messageId} and conversation_id = ${conversationId} and author_user_id = ${userId} and removed_at is null
              returning id`)
          : await tx.execute(
              change.kind === 'event'
                ? sql`update conversation set event_id = ${change.eventId} where id = ${conversationId} and consumer_user_id = ${userId} returning id`
                : sql`update conversation set status = ${change.kind === 'block' ? 'blocked_by_consumer' : 'open'}
                      where id = ${conversationId} and consumer_user_id = ${userId} returning id`,
            );
      if (done.length === 0) throw new PlanNotFound();
    }),
  );
}

/** M2 (D-54): the author changes a message's words; the database keeps the earlier version. */
async function editMessage(tx: Db, conversationId: string, messageId: string, body: string): Promise<void> {
  const [mine] = await tx.execute<{ id: string }>(sql`select id from message where id = ${messageId} and conversation_id = ${conversationId}`);
  if (!mine) throw new PlanNotFound();
  await tx.execute(sql`select edit_my_message(${messageId}::uuid, ${body})`);
}

// ======================================================================= the business's side

export type MessagingBusiness = {
  id: string;
  slug: string;
  name: string;
  role: 'owner' | 'manager' | 'staff';
  /** Listed on Localites: if not (taken down), its messages are paused (migration 0025). */
  listed: boolean;
};

/** A business this person is on the team of (any role), not archived; by web address, or an old one. */
async function findTeam(db: Db, userId: string, slug: string): Promise<MessagingBusiness | null> {
  const [v] = await db.execute<MessagingBusiness>(sql`
    select v.id, v.slug::text as slug, v.display_name as name, m.role, v.listing_status = 'published' as listed
    from vendor v
    join vendor_member m on m.vendor_id = v.id and m.user_id = ${userId} and m.ended_at is null
    where v.listing_status <> 'archived'
      and (v.slug = ${slug} or v.id = (select h.vendor_id from vendor_slug_history h where h.slug = ${slug} and v.slug <> ${slug}))
    order by v.slug = ${slug} desc
    limit 1`);
  return v ?? null;
}

/** Runs as the business, after checking this person is on its team (otherwise "not found"). */
export function asTeam<T>(env: ServerEnv, userId: string, slug: string, fn: (tx: Db, b: MessagingBusiness) => Promise<T>): Promise<T> {
  return talked(
    withDb(env, async (db) => {
      const b = await findTeam(db, userId, slug);
      if (!b) throw new PlanNotFound();
      return actAs(db, { side: 'business', userId, vendorId: b.id }, (tx) => fn(tx, b));
    }),
  );
}

export type BusinessCard = {
  id: string;
  person: string;
  lastMessageAt: string | null;
  snippet: string | null;
  lastFromUs: boolean;
  unread: number;
  blocked: boolean;
  /** The person deleted their account: the conversation has ended. */
  ended: boolean;
};

/** V6: the business's conversations, newest first, each with this team member's own unread count. */
export async function businessInbox(
  env: ServerEnv,
  userId: string,
  slug: string,
): Promise<{ business: MessagingBusiness; conversations: BusinessCard[] }> {
  return asTeam(env, userId, slug, async (tx, business) => {
    const rows = await tx.execute<
      Omit<BusinessCard, 'snippet'> & { lastBody: string | null; lastRemoved: boolean; lastHidden: boolean }
    >(sql`
      select c.id, u.display_name as person, c.last_message_at::text as "lastMessageAt", c.status <> 'open' as blocked,
             c.ended_at is not null as ended,
             lm.body as "lastBody", coalesce(lm.removed, false) as "lastRemoved", coalesce(lm.hidden, false) as "lastHidden",
             coalesce(lm.ours, false) as "lastFromUs",
             (select count(*) from message m where m.conversation_id = c.id and m.author_side = 'consumer' and m.removed_at is null and m.hidden_by_team_at is null
                and m.created_at > coalesce(r.last_read_at, '-infinity'))::int as unread
      from conversation c join app_user u on u.id = c.consumer_user_id
      left join conversation_read r on r.conversation_id = c.id and r.user_id = ${userId}
      left join lateral (
        select case when m.hidden_by_team_at is null then m.body end as body, m.removed_at is not null as removed,
               m.hidden_by_team_at is not null as hidden, m.author_side = 'vendor' as ours
        from message m where m.conversation_id = c.id order by m.created_at desc limit 1
      ) lm on true
      where c.vendor_id = ${business.id} and c.last_message_at is not null
      order by c.last_message_at desc
      limit 200`);
    return {
      business,
      conversations: rows.map(({ lastBody, lastRemoved, lastHidden, ...r }) => ({
        ...r,
        snippet: snippet(lastBody, lastRemoved, lastHidden),
      })),
    };
  });
}

/** Unread messages for one team member at one business (for "My business"). */
export async function businessUnread(db: Db, userId: string, vendorId: string): Promise<number> {
  return actAs(db, { side: 'business', userId, vendorId }, async (tx) => {
    const [n] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n
      from conversation c join message m on m.conversation_id = c.id
      left join conversation_read r on r.conversation_id = c.id and r.user_id = ${userId}
      where c.vendor_id = ${vendorId} and m.author_side = 'consumer' and m.removed_at is null and m.hidden_by_team_at is null
        and m.created_at > coalesce(r.last_read_at, '-infinity')`);
    return n?.n ?? 0;
  });
}

export type BusinessThread = {
  business: MessagingBusiness;
  id: string;
  person: string;
  status: 'open' | 'blocked_by_consumer' | 'blocked_by_vendor' | 'blocked_by_team';
  /** The person deleted their account: no new messages. */
  ended: boolean;
  /** Compared by the page's quick look for anything new (businessVersion). */
  version: string;
  /** D-40's summary of the event the person mentioned, if any: never its name or private details. */
  event: { date: string; town: string; guests: number | null; cancelled: boolean } | null;
  messages: ThreadMessage[];
};

/** V7: one conversation, as the business; marks it read for this team member. */
export async function businessThread(env: ServerEnv, userId: string, slug: string, conversationId: string): Promise<BusinessThread> {
  return asTeam(env, userId, slug, async (tx, business) => {
    const [c] = await tx.execute<{ id: string; person: string; status: BusinessThread['status']; ended: boolean; version: string }>(sql`
      select c.id, u.display_name as person, c.status, c.ended_at is not null as ended, ${VERSION} as version
      from conversation c join app_user u on u.id = c.consumer_user_id join vendor v on v.id = c.vendor_id
      where c.id = ${conversationId} and c.vendor_id = ${business.id}`);
    if (!c) throw new PlanNotFound();
    const [event] = await tx.execute<NonNullable<BusinessThread['event']>>(sql`
      select event_date::text as date, town, guests, cancelled from conversation_event_for_business(${c.id}::uuid)`);
    const messages = await readMessages(tx, c.id, userId, 'business', business.name);
    await markRead(tx, c.id, userId, messages.at(-1)?.createdAt ?? null);
    return { business, id: c.id, person: c.person, status: c.status, ended: c.ended, version: c.version, event: event ?? null, messages };
  });
}

/** A team member replies for the business. */
export async function businessReply(
  env: ServerEnv,
  userId: string,
  slug: string,
  conversationId: string,
  body: string,
  file: Attachment | null = null,
): Promise<Written & { vendorId: string }> {
  return sendWith(
    env,
    conversationId,
    file,
    () => businessVersion(env, userId, slug, conversationId),
    (path) =>
      asTeam(env, userId, slug, async (tx, business) => {
        await lockSender(tx, userId);
        await checkLimits(tx, userId, false);
        if (file) await checkFilesToday(tx, userId, file.bytes.byteLength);
        const { messageId, again } = await writeMessage(tx, conversationId, userId, 'vendor', body, file);
        if (file && path && !again) await attachFile(tx, messageId, conversationId, userId, path, file);
        await markRead(tx, conversationId, userId);
        return { conversationId, messageId, again, vendorId: business.id };
      }),
  );
}

// ======================================================================= opening a file

export type OpenedFile = { body: ReadableStream; type: string; name: string };

async function open(env: ServerEnv, found: { path: string; type: string; name: string } | null): Promise<OpenedFile> {
  if (!found) throw new PlanNotFound();
  const body = await readPrivateFile(env, found.path);
  if (!body) throw new PlanNotFound();
  return { body, type: found.type, name: found.name };
}

/** A file in the person's own conversation (anyone else's is "not found"). */
export async function personFile(env: ServerEnv, userId: string, conversationId: string, fileId: string): Promise<OpenedFile> {
  const found = await talked(actingAs(env, asPerson(userId), (tx) => findFile(tx, conversationId, fileId)));
  return open(env, found);
}

/** A file in one of the business's conversations, for anyone on its team. */
export async function businessFile(
  env: ServerEnv,
  userId: string,
  slug: string,
  conversationId: string,
  fileId: string,
): Promise<OpenedFile> {
  const found = await asTeam(env, userId, slug, (tx) => findFile(tx, conversationId, fileId));
  return open(env, found);
}

/** Block or unblock (owners and managers), or remove your own message (anyone on the team). */
export async function businessChange(
  env: ServerEnv,
  userId: string,
  slug: string,
  conversationId: string,
  change: { kind: 'block' | 'unblock' } | { kind: 'remove'; messageId: string } | { kind: 'edit'; messageId: string; body: string },
): Promise<void> {
  await asTeam(env, userId, slug, async (tx, business) => {
    // Anyone on the team edits their own messages (M2, D-54); owners and managers block.
    if (change.kind === 'edit') {
      await editMessage(tx, conversationId, change.messageId, change.body);
      return;
    }
    if (change.kind !== 'remove' && business.role === 'staff') throw new PlanNotFound();
    const done =
      change.kind === 'remove'
        ? await tx.execute(sql`
            update message set removed_at = now()
            where id = ${change.messageId} and conversation_id = ${conversationId} and author_user_id = ${userId} and removed_at is null
            returning id`)
        : await tx.execute(sql`
            update conversation set status = ${change.kind === 'block' ? 'blocked_by_vendor' : 'open'}
            where id = ${conversationId} and vendor_id = ${business.id} returning id`);
    if (done.length === 0) throw new PlanNotFound();
  });
}

// ======================================================================= the quick look for anything new

/**
 * An open conversation page asks this instead of reloading (MessageThread's useRefresh):
 * one small read, nothing marked. Someone else's conversation is "not found".
 */
export async function personVersion(env: ServerEnv, userId: string, conversationId: string): Promise<string> {
  return talked(
    actingAs(env, asPerson(userId), async (tx) => {
      const [c] = await tx.execute<{ version: string }>(sql`
        select ${VERSION} as version from conversation c join vendor v on v.id = c.vendor_id
        where c.id = ${conversationId} and c.consumer_user_id = ${userId}`);
      if (!c) throw new PlanNotFound();
      return c.version;
    }),
  );
}

/** The same, for a member of the business's team. */
export async function businessVersion(env: ServerEnv, userId: string, slug: string, conversationId: string): Promise<string> {
  return asTeam(env, userId, slug, async (tx, business) => {
    const [c] = await tx.execute<{ version: string }>(sql`
      select ${VERSION} as version from conversation c join vendor v on v.id = c.vendor_id
      where c.id = ${conversationId} and c.vendor_id = ${business.id}`);
    if (!c) throw new PlanNotFound();
    return c.version;
  });
}

// ======================================================================= emails

/**
 * How long after a message the site decides who to email: anyone who opens it meanwhile has
 * seen it (an open conversation looks every 15 seconds while you're there). With one request
 * for all the emails, this fits in the 30 seconds Cloudflare lets background work run.
 */
const EMAIL_WAIT_SECONDS = 18;

/**
 * After a message is written (in the background, after the page has answered): waits
 * EMAIL_WAIT_SECONDS, so two people chatting with the conversation open aren't emailed about
 * every message, then emails whoever new_message_notices() says is due (the person, or the
 * business's team as it was when the message was written): once per unread stretch, never
 * someone who has seen it, within the site's daily limit, in one request, each recorded
 * honestly in `notification`. Never the message itself: the email links to the conversation.
 * (If Cloudflare stops the work part-way, an email left "being sent" stops counting after 10
 * minutes, and the nightly run marks it failed.)
 */
export async function emailAboutMessage(env: ServerEnv, acting: Acting, written: Written, siteUrl: string): Promise<void> {
  if (written.again) return;
  const deadline = Date.now() + 27_000; // Cloudflare stops background work 30 seconds after the page answers
  const seconds = Math.min(Math.max(Number(env.MESSAGE_EMAIL_WAIT_SECONDS ?? EMAIL_WAIT_SECONDS) || 0, 0), EMAIL_WAIT_SECONDS);
  await new Promise((done) => setTimeout(done, seconds * 1000));
  await withDb(env, async (db) => {
    const { due, info } = await actAs(db, acting, async (tx) => {
      const due = await tx.execute<{ notificationId: string; email: string; name: string; forBusiness: boolean }>(sql`
        select notification_id as "notificationId", email, name, for_business as "forBusiness"
        from new_message_notices(${written.messageId}::uuid)`);
      const [info] = await tx.execute<{ slug: string; business: string; person: string }>(sql`
        select v.slug::text as slug, v.display_name as business, u.display_name as person
        from conversation c join vendor v on v.id = c.vendor_id join app_user u on u.id = c.consumer_user_id
        where c.id = ${written.conversationId}`);
      return { due: [...due], info };
    });
    if (!info || due.length === 0) return;
    const result = await sendEmails(
      env,
      due.map((d) => ({
        to: d.email,
        ...renderEmail('newMessage', {
          name: d.name,
          from: d.forBusiness ? info.person : info.business,
          link: d.forBusiness
            ? `${siteUrl}/vendors/${info.slug}/messages/${written.conversationId}`
            : `${siteUrl}/messages/${written.conversationId}`,
        }),
      })),
      deadline,
    );
    const ids = `{${due.map((d) => d.notificationId).join(',')}}`;
    await db.execute(
      result.sent
        ? sql`update notification set status = 'sent', sent_at = now() where id = any(${ids}::uuid[])`
        : sql`update notification set status = 'failed', failure_reason = ${result.reason} where id = any(${ids}::uuid[])`,
    );
  });
}

/** A message from a form: trimmed, not too long, and not empty unless a file goes with it. */
export function readBody(form: FormData, withFile = false): { body: string } | { error: string } {
  const body = String(form.get('body') ?? '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (!body && !withFile) return { error: MESSAGE_REFUSALS.empty };
  if (body.length > MESSAGE_LIMITS.body) return { error: MESSAGE_REFUSALS.tooLong };
  return { body };
}
