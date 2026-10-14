import { sql } from 'drizzle-orm';
import { uuidv7 } from '@/lib/ids.mjs';
import { MESSAGE_LIMITS, MESSAGE_REFUSALS } from '@/lib/message-terms';
import { type Acting, actAs, actingAs, errorCode, PlanCapped, PlanNotFound, PlanRefused } from './acting.server';
import { type Db, withDb } from './db.server';
import { sendEmail } from './email.server';
import { renderEmail } from './email-templates.server';
import type { ServerEnv } from './env';
import { LIST_PHOTO, LIST_PHOTO_COLUMNS, type ListPhoto, type ListPhotoColumns, withListPhoto } from './photo-store.server';

/**
 * Messages (Stage 2B, part 1; D-13, D-17, E §4.3 and §6, migration 0023). A person starts a
 * conversation with a business that has joined Localites; the business's team (owner,
 * managers and staff) replies. Every step acts as a side (ADR-031), and the database's own
 * rules decide what that side may read and write: the person their own conversations, the
 * business its own, the team nothing (reports come next). Unread positions are private.
 * Emails about new messages go once per unread stretch (new_message_notices()).
 */

/** Refusals in plain words; someone else's conversation, like a missing one, is "not found". */
async function talked<T>(work: Promise<T>): Promise<T> {
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
const snippet = (body: string | null, removed: boolean) =>
  removed ? 'Message removed' : body ? body.replace(/\s+/g, ' ').slice(0, 120) : null;

/** One person's sending limits, checked under a lock on their account row. */
async function checkSending(tx: Db, userId: string, newConversation: boolean): Promise<void> {
  const [me] = await tx.execute<{ id: string }>(sql`select id from app_user where id = ${userId} and deleted_at is null for update`);
  if (!me) throw new PlanNotFound();
  const [n] = await tx.execute<{ messages: number; started: number }>(sql`
    select (select count(*) from message where author_user_id = ${userId} and created_at > now() - interval '1 day')::int as messages,
           (select count(*) from conversation where consumer_user_id = ${userId} and created_at > now() - interval '1 day')::int as started`);
  if ((n?.messages ?? 0) >= MESSAGE_LIMITS.messagesPerDay) throw new PlanCapped(MESSAGE_REFUSALS.messagesPerDay);
  if (newConversation && (n?.started ?? 0) >= MESSAGE_LIMITS.conversationsPerDay)
    throw new PlanCapped(MESSAGE_REFUSALS.conversationsPerDay);
}

export type ThreadMessage = {
  id: string;
  mine: boolean;
  fromBusiness: boolean;
  author: string;
  body: string;
  createdAt: string;
  removed: boolean;
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
  }>(sql`
    select m.id, m.author_side as side, m.author_user_id as "authorId", u.display_name as "authorName", m.body,
           m.created_at::text as "createdAt", m.removed_at is not null as removed
    from message m join app_user u on u.id = m.author_user_id
    where m.conversation_id = ${conversationId}
    order by m.created_at desc, m.id desc
    limit 300`);
  return [...rows].reverse().map(
    (m): ThreadMessage => ({
      id: m.id,
      mine: m.authorId === userId,
      fromBusiness: m.side === 'vendor',
      author: m.side === 'vendor' && viewer === 'person' ? businessName : m.authorName,
      body: m.body,
      createdAt: m.createdAt,
      removed: m.removed,
    }),
  );
}

async function markRead(tx: Db, conversationId: string, userId: string) {
  await tx.execute(sql`
    insert into conversation_read (conversation_id, user_id) values (${conversationId}, ${userId})
    on conflict (conversation_id, user_id) do update set last_read_at = now()`);
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
  blocked: boolean;
  /** The business isn't on Localites any more (left, or no one runs it). */
  left: boolean;
};

export async function myConversations(env: ServerEnv, userId: string): Promise<ConversationCard[]> {
  return talked(
    actingAs(env, asPerson(userId), async (tx) => {
      const rows = await tx.execute<
        Omit<ConversationCard, 'photo' | 'snippet'> & ListPhotoColumns & { listed: boolean; lastBody: string | null; lastRemoved: boolean }
      >(sql`
        select c.id, v.slug::text as "vendorSlug", v.display_name as "vendorName", c.last_message_at::text as "lastMessageAt",
               c.status <> 'open' as blocked, (v.claim_status <> 'claimed' or v.listing_status = 'archived') as left,
               v.listing_status = 'published' as listed,
               lm.body as "lastBody", coalesce(lm.removed, false) as "lastRemoved", coalesce(lm.mine, false) as "lastFromMe",
               (select count(*) from message m where m.conversation_id = c.id and m.author_side = 'vendor' and m.removed_at is null
                  and m.created_at > coalesce(r.last_read_at, '-infinity'))::int as unread,
               ${LIST_PHOTO_COLUMNS}
        from conversation c join vendor v on v.id = c.vendor_id
        left join conversation_read r on r.conversation_id = c.id and r.user_id = ${userId}
        left join lateral (
          select m.body, m.removed_at is not null as removed, m.author_side = 'consumer' as mine
          from message m where m.conversation_id = c.id order by m.created_at desc limit 1
        ) lm on true
        ${LIST_PHOTO}
        where c.consumer_user_id = ${userId}
        order by c.last_message_at desc nulls last
        limit 200`);
      return rows.map(({ lastBody, lastRemoved, listed, ...r }) => ({
        ...withListPhoto(env, r, listed),
        snippet: snippet(lastBody, lastRemoved),
      }));
    }),
  );
}

/** New messages from businesses, across the person's conversations (for "Messages (n new)"). */
export async function myUnread(env: ServerEnv, userId: string): Promise<number> {
  return actingAs(env, asPerson(userId), async (tx) => {
    const [n] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n
      from conversation c join message m on m.conversation_id = c.id
      left join conversation_read r on r.conversation_id = c.id and r.user_id = ${userId}
      where c.consumer_user_id = ${userId} and m.author_side = 'vendor' and m.removed_at is null
        and m.created_at > coalesce(r.last_read_at, '-infinity')`);
    return n?.n ?? 0;
  });
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
        select id from conversation where consumer_user_id = ${userId} and vendor_id = ${vendor.id}`);
      const events = await tx.execute<StartPage['events'][number]>(sql`
        select e.id, p.title as name, e.event_date::text as date
        from event e join event_private p on p.event_id = e.id
        where e.host_user_id = ${userId} and e.status = 'planning' and event_ends_at(e) >= now()
        order by e.event_date, e.start_time nulls first limit 50`);
      return { vendor, existing: c?.id ?? null, events: [...events] };
    }),
  );
}

export type Written = { conversationId: string; messageId: string };

/** Starts a conversation with its first message (or adds to the one already there). */
export async function startConversation(
  env: ServerEnv,
  userId: string,
  slug: string,
  input: { body: string; eventId: string | null },
): Promise<Written> {
  return talked(
    actingAs(env, asPerson(userId), async (tx) => {
      const [v] = await tx.execute<{ id: string }>(sql`select id from vendor where slug = ${slug} and listing_status = 'published'`);
      if (!v) throw new PlanNotFound();
      const [existing] = await tx.execute<{ id: string }>(sql`
        select id from conversation where consumer_user_id = ${userId} and vendor_id = ${v.id}`);
      await checkSending(tx, userId, !existing);
      const conversationId = existing?.id ?? uuidv7();
      if (!existing) {
        await tx.execute(sql`
          insert into conversation (id, consumer_user_id, vendor_id, event_id)
          values (${conversationId}, ${userId}, ${v.id}, ${input.eventId})`);
      } else if (input.eventId) {
        await tx.execute(sql`update conversation set event_id = ${input.eventId} where id = ${conversationId}`);
      }
      const messageId = uuidv7();
      await tx.execute(sql`
        insert into message (id, conversation_id, author_user_id, author_side, body)
        values (${messageId}, ${conversationId}, ${userId}, 'consumer', ${input.body})`);
      await markRead(tx, conversationId, userId);
      return { conversationId, messageId };
    }),
  );
}

export type PersonThread = {
  id: string;
  vendor: { slug: string; name: string; photo: ListPhoto | null; left: boolean };
  status: 'open' | 'blocked_by_consumer' | 'blocked_by_vendor';
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
        } & ListPhotoColumns
      >(sql`
        select c.id, c.status, c.event_id as "eventId", v.slug::text as slug, v.display_name as name,
               (v.claim_status <> 'claimed' or v.listing_status = 'archived') as left, v.listing_status = 'published' as listed,
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
      await markRead(tx, c.id, userId);
      const { photo } = withListPhoto(env, c, c.listed);
      return {
        id: c.id,
        vendor: { slug: c.slug, name: c.name, photo, left: c.left },
        status: c.status,
        event: events.find((e) => e.id === c.eventId) ?? null,
        events: [...events],
        messages,
      };
    }),
  );
}

/** The person writes in their conversation. */
export async function personSend(env: ServerEnv, userId: string, conversationId: string, body: string): Promise<Written> {
  return talked(
    actingAs(env, asPerson(userId), async (tx) => {
      await checkSending(tx, userId, false);
      const messageId = uuidv7();
      await tx.execute(sql`
        insert into message (id, conversation_id, author_user_id, author_side, body)
        values (${messageId}, ${conversationId}, ${userId}, 'consumer', ${body})`);
      await markRead(tx, conversationId, userId);
      return { conversationId, messageId };
    }),
  );
}

/** Changes to the person's conversation: block, unblock, the event it's about, removing their own message. */
export async function personChange(
  env: ServerEnv,
  userId: string,
  conversationId: string,
  change: { kind: 'block' | 'unblock' } | { kind: 'event'; eventId: string | null } | { kind: 'remove'; messageId: string },
): Promise<void> {
  await talked(
    actingAs(env, asPerson(userId), async (tx) => {
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

// ======================================================================= the business's side

export type MessagingBusiness = { id: string; slug: string; name: string; role: 'owner' | 'manager' | 'staff' };

/** A business this person is on the team of (any role), not archived; by web address, or an old one. */
async function findTeam(db: Db, userId: string, slug: string): Promise<MessagingBusiness | null> {
  const [v] = await db.execute<MessagingBusiness>(sql`
    select v.id, v.slug::text as slug, v.display_name as name, m.role
    from vendor v
    join vendor_member m on m.vendor_id = v.id and m.user_id = ${userId} and m.ended_at is null
    where v.listing_status <> 'archived'
      and (v.slug = ${slug} or v.id = (select h.vendor_id from vendor_slug_history h where h.slug = ${slug} and v.slug <> ${slug}))
    order by v.slug = ${slug} desc
    limit 1`);
  return v ?? null;
}

/** Runs as the business, after checking this person is on its team (otherwise "not found"). */
function asTeam<T>(env: ServerEnv, userId: string, slug: string, fn: (tx: Db, b: MessagingBusiness) => Promise<T>): Promise<T> {
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
};

/** V6: the business's conversations, newest first, each with this team member's own unread count. */
export async function businessInbox(
  env: ServerEnv,
  userId: string,
  slug: string,
): Promise<{ business: MessagingBusiness; conversations: BusinessCard[] }> {
  return asTeam(env, userId, slug, async (tx, business) => {
    const rows = await tx.execute<Omit<BusinessCard, 'snippet'> & { lastBody: string | null; lastRemoved: boolean }>(sql`
      select c.id, u.display_name as person, c.last_message_at::text as "lastMessageAt", c.status <> 'open' as blocked,
             lm.body as "lastBody", coalesce(lm.removed, false) as "lastRemoved", coalesce(lm.ours, false) as "lastFromUs",
             (select count(*) from message m where m.conversation_id = c.id and m.author_side = 'consumer' and m.removed_at is null
                and m.created_at > coalesce(r.last_read_at, '-infinity'))::int as unread
      from conversation c join app_user u on u.id = c.consumer_user_id
      left join conversation_read r on r.conversation_id = c.id and r.user_id = ${userId}
      left join lateral (
        select m.body, m.removed_at is not null as removed, m.author_side = 'vendor' as ours
        from message m where m.conversation_id = c.id order by m.created_at desc limit 1
      ) lm on true
      where c.vendor_id = ${business.id} and c.last_message_at is not null
      order by c.last_message_at desc
      limit 200`);
    return {
      business,
      conversations: rows.map(({ lastBody, lastRemoved, ...r }) => ({ ...r, snippet: snippet(lastBody, lastRemoved) })),
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
      where c.vendor_id = ${vendorId} and m.author_side = 'consumer' and m.removed_at is null
        and m.created_at > coalesce(r.last_read_at, '-infinity')`);
    return n?.n ?? 0;
  });
}

export type BusinessThread = {
  business: MessagingBusiness;
  id: string;
  person: string;
  status: 'open' | 'blocked_by_consumer' | 'blocked_by_vendor';
  /** D-40's summary of the event the person mentioned, if any: never its name or private details. */
  event: { date: string; town: string; guests: number | null; cancelled: boolean } | null;
  messages: ThreadMessage[];
};

/** V7: one conversation, as the business; marks it read for this team member. */
export async function businessThread(env: ServerEnv, userId: string, slug: string, conversationId: string): Promise<BusinessThread> {
  return asTeam(env, userId, slug, async (tx, business) => {
    const [c] = await tx.execute<{ id: string; person: string; status: BusinessThread['status'] }>(sql`
      select c.id, u.display_name as person, c.status
      from conversation c join app_user u on u.id = c.consumer_user_id
      where c.id = ${conversationId} and c.vendor_id = ${business.id}`);
    if (!c) throw new PlanNotFound();
    const [event] = await tx.execute<NonNullable<BusinessThread['event']>>(sql`
      select event_date::text as date, town, guests, cancelled from conversation_event_for_business(${c.id}::uuid)`);
    const messages = await readMessages(tx, c.id, userId, 'business', business.name);
    await markRead(tx, c.id, userId);
    return { business, id: c.id, person: c.person, status: c.status, event: event ?? null, messages };
  });
}

/** A team member replies for the business. */
export async function businessReply(
  env: ServerEnv,
  userId: string,
  slug: string,
  conversationId: string,
  body: string,
): Promise<Written & { vendorId: string }> {
  return asTeam(env, userId, slug, async (tx, business) => {
    await checkSending(tx, userId, false);
    const messageId = uuidv7();
    await tx.execute(sql`
      insert into message (id, conversation_id, author_user_id, author_side, body)
      values (${messageId}, ${conversationId}, ${userId}, 'vendor', ${body})`);
    await markRead(tx, conversationId, userId);
    return { conversationId, messageId, vendorId: business.id };
  });
}

/** Block or unblock (owners and managers), or remove your own message (anyone on the team). */
export async function businessChange(
  env: ServerEnv,
  userId: string,
  slug: string,
  conversationId: string,
  change: { kind: 'block' | 'unblock' } | { kind: 'remove'; messageId: string },
): Promise<void> {
  await asTeam(env, userId, slug, async (tx, business) => {
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

// ======================================================================= emails

/**
 * After a message is written: emails whoever new_message_notices() says is due (the person,
 * or each member of the business's team), once per unread stretch, recording each email
 * honestly in `notification`. Never the message itself: it links to the conversation.
 */
export async function emailAboutMessage(env: ServerEnv, acting: Acting, written: Written, siteUrl: string): Promise<void> {
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
    if (!info) return;
    for (const d of due) {
      const content = renderEmail('newMessage', {
        name: d.name,
        from: d.forBusiness ? info.person : info.business,
        link: d.forBusiness
          ? `${siteUrl}/vendors/${info.slug}/messages/${written.conversationId}`
          : `${siteUrl}/messages/${written.conversationId}`,
      });
      const result = await sendEmail(env, { to: d.email, ...content });
      await db.execute(
        result.sent
          ? sql`update notification set status = 'sent', sent_at = now() where id = ${d.notificationId}`
          : sql`update notification set status = 'failed', failure_reason = ${result.reason} where id = ${d.notificationId}`,
      );
    }
  });
}

/** A message from a form: trimmed, not empty, not too long. */
export function readBody(form: FormData): { body: string } | { error: string } {
  const body = String(form.get('body') ?? '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (!body) return { error: MESSAGE_REFUSALS.empty };
  if (body.length > MESSAGE_LIMITS.body) return { error: MESSAGE_REFUSALS.tooLong };
  return { body };
}
