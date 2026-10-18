import { type SQL, sql } from 'drizzle-orm';
import { uuidv7 } from '@/lib/ids.mjs';
import { ideasHeading, PLAN_LIMITS, PLAN_REFUSALS, type PlanStatus } from '@/lib/plan-terms';
import { type Acting, actingAs, PlanCapped, planned, PlanNotFound, PlanRefused } from './acting.server';
import { type Db, withDb } from './db.server';
import type { ServerEnv } from './env';
import { CAN_REVIEW, type CanReview, type ReviewStatus } from './reviews.server';
import type { EventValues } from './event-input';
import { LIST_PHOTO, LIST_PHOTO_COLUMNS, type ListPhoto, type ListPhotoColumns, withListPhoto } from './photo-store.server';

/**
 * The person's side of planning an event (C1–C6; D-13, D-39–D-43, ADR-031). Everything
 * runs as the person (actingAs, side 'person'): the database shows them only their own
 * events, plans and saves, and refuses the rest. Every query still names the person in
 * its where clause and names its columns. Database refusals come back as PlanNotFound,
 * PlanRefused or PlanCapped (acting.server.ts).
 */

const asPerson = (userId: string): Acting => ({ side: 'person', userId });

/**
 * A plan row's id is random, not time-ordered: a business sees it (to flag a booking), and a
 * time-ordered id would tell it when the person first started considering it (D-40).
 */
const randomRowId = () => crypto.randomUUID();

/** A business's category for its row: its main one first. */
const MAIN_CATEGORY = sql`(select c.name from vendor_category vc join category c on c.id = vc.category_id
                           where vc.vendor_id = v.id order by vc.is_primary desc, c.name limit 1)`;

/** On the team of a business that isn't archived, in any role (who sees "My business"). */
const ON_TEAM = (userId: string) => sql`exists (
  select 1 from vendor_member m join vendor v on v.id = m.vendor_id
  where m.user_id = ${userId} and m.ended_at is null and v.listing_status <> 'archived')`;

/** A listed business by its web address (vendor is open reference data). */
const publishedVendor = async (tx: Db, slug: string) => {
  const [v] = await tx.execute<{ id: string; slug: string; name: string }>(sql`
    select id, slug::text as slug, display_name as name from vendor where slug = ${slug} and listing_status = 'published'`);
  return v ?? null;
};

// ------------------------------------------------------------------ booking notices

/**
 * What a booked business is told, and who on its team (D-40: R5 summary only). Built in
 * the same transaction as the change, sent afterwards (plan-emails.server.ts). Only for a
 * claimed business that isn't archived and has someone to tell.
 */
export type BookingNotice = {
  kind: 'marked_booked' | 'booking_unmarked' | 'booked_event_cancelled' | 'booked_event_changed';
  eventVendorId: string;
  vendorSlug: string;
  vendorName: string;
  /** Active owners and managers (only owners today, D-29), not closed accounts. */
  recipients: { userId: string; email: string; name: string }[];
  /** The person's display name (R5). */
  person: string;
  date: string;
  town: string;
  guests: number | null;
  /** booked_event_changed only: the date and town before. */
  was?: { date: string; town: string };
};

async function noticesFor(tx: Db, userId: string, which: SQL, kind: BookingNotice['kind']): Promise<BookingNotice[]> {
  const rows = await tx.execute<Omit<BookingNotice, 'kind' | 'was'>>(sql`
    select ev.id as "eventVendorId", v.slug::text as "vendorSlug", v.display_name as "vendorName",
           coalesce((select json_agg(json_build_object('userId', u.id, 'email', u.email::text, 'name', u.display_name) order by u.id)
                     from vendor_member m join app_user u on u.id = m.user_id
                     where m.vendor_id = v.id and m.role in ('owner', 'manager') and m.ended_at is null
                       and u.deleted_at is null), '[]'::json) as recipients,
           host.display_name as person, e.event_date::text as date, mu.name as town, e.guest_count_estimate as guests
    from event_vendor ev
    join event e on e.id = ev.event_id
    join vendor v on v.id = ev.vendor_id
    join municipality mu on mu.id = e.municipality_id
    join app_user host on host.id = e.host_user_id
    where ev.host_user_id = ${userId} and ${which}
      and v.claim_status = 'claimed' and v.listing_status <> 'archived'
    order by ev.created_at`);
  return rows.filter((r) => r.recipients.length > 0).map((r) => ({ ...r, kind }));
}

// ------------------------------------------------------------------ C1: My events

export type EventCard = {
  id: string;
  name: string;
  typeName: string | null;
  date: string;
  startTime: string | null;
  endTime: string | null;
  town: string;
  status: 'planning' | 'cancelled';
  passed: boolean;
  booked: number;
  considering: number;
};

const CARD_COLUMNS = sql`
  e.id, p.title as name, t.name as "typeName", e.event_date::text as date,
  to_char(e.start_time, 'HH24:MI') as "startTime", to_char(e.end_time, 'HH24:MI') as "endTime",
  mu.name as town, e.status, event_ends_at(e) < now() as passed,
  (select count(*) from event_vendor x where x.event_id = e.id and x.host_user_id = e.host_user_id and x.status = 'booked')::int as booked,
  (select count(*) from event_vendor x join vendor xv on xv.id = x.vendor_id
   where x.event_id = e.id and x.host_user_id = e.host_user_id and x.status = 'considering' and xv.listing_status = 'published')::int as considering`;

/** Still being planned and not over: listed first (soonest first), so the limit never hides them. */
const UPCOMING = sql`(e.status = 'planning' and event_ends_at(e) >= now())`;

const CARD_FROM = sql`
  from event e
  join event_private p on p.event_id = e.id
  left join event_type t on t.id = e.event_type_id
  join municipality mu on mu.id = e.municipality_id`;

export async function myEvents(
  env: ServerEnv,
  userId: string,
): Promise<{ upcoming: EventCard[]; past: EventCard[]; cancelled: EventCard[]; savedCount: number; onTeam: boolean }> {
  return planned(
    actingAs(env, asPerson(userId), async (tx) => {
      const cards = await tx.execute<EventCard>(sql`
        select ${CARD_COLUMNS} ${CARD_FROM}
        where e.host_user_id = ${userId}
        order by ${UPCOMING} desc, case when ${UPCOMING} then e.event_date end, e.event_date desc,
                 e.start_time nulls first, e.created_at
        limit 200`);
      const [extra] = await tx.execute<{ saved: number; onTeam: boolean }>(sql`
        select (select count(*) from saved_vendor s join vendor v on v.id = s.vendor_id
                where s.user_id = ${userId} and v.listing_status = 'published')::int as saved, ${ON_TEAM(userId)} as "onTeam"`);
      const all = [...cards];
      return {
        upcoming: all.filter((c) => c.status === 'planning' && !c.passed),
        past: all.filter((c) => c.status === 'planning' && c.passed),
        cancelled: all.filter((c) => c.status === 'cancelled'),
        savedCount: extra?.saved ?? 0,
        onTeam: extra?.onTeam ?? false,
      };
    }),
  );
}

// ------------------------------------------------------------------ C2: create, edit, cancel

export type FormOptions = { types: { id: string; name: string }[]; towns: { id: string; name: string }[] };

/**
 * The kinds of event and the towns to choose from: the shown ones in the team's order,
 * plus the event's own kind and town even if the team has hidden them since. Reference data: no one
 * needs to be acting.
 */
export async function eventFormOptions(
  env: ServerEnv,
  keepTypeId: string | null = null,
  keepTownId: string | null = null,
): Promise<FormOptions> {
  return withDb(env, async (db) => {
    const types = await db.execute<{ id: string; name: string }>(sql`
      select id, name from event_type where is_active or id = ${keepTypeId}::uuid order by sort_order, name`);
    const towns = await db.execute<{ id: string; name: string }>(sql`
      select id, name from municipality where is_active or id = ${keepTownId}::uuid order by sort_order, name`);
    return { types: [...types], towns: [...towns] };
  });
}

type StoredEvent = EventValues & { status: 'planning' | 'cancelled'; town: string };

async function readEvent(tx: Db, userId: string, eventId: string, lock: boolean): Promise<StoredEvent | null> {
  const [e] = await tx.execute<StoredEvent>(sql`
    select p.title, e.event_type_id as "typeId", e.event_date::text as date, e.municipality_id as "townId",
           to_char(e.start_time, 'HH24:MI') as "startTime", to_char(e.end_time, 'HH24:MI') as "endTime",
           p.venue_note as "venueNote", e.guest_count_estimate as guests, p.age_range_min as "ageMin",
           p.age_range_max as "ageMax", p.budget_cents as "budgetCents", p.notes, e.status, mu.name as town
    from event e join event_private p on p.event_id = e.id join municipality mu on mu.id = e.municipality_id
    where e.id = ${eventId} and e.host_user_id = ${userId}
    ${lock ? sql`for update of e, p` : sql``}`);
  return e ?? null;
}

const eventValues = (e: StoredEvent): EventValues => ({
  title: e.title,
  typeId: e.typeId,
  date: e.date,
  townId: e.townId,
  startTime: e.startTime,
  endTime: e.endTime,
  venueNote: e.venueNote,
  guests: e.guests,
  ageMin: e.ageMin,
  ageMax: e.ageMax,
  budgetCents: e.budgetCents,
  notes: e.notes,
});

/**
 * The businesses marked booked on an event: how many we can tell (claimed, not archived,
 * with someone to tell: the same test as noticesFor) and how many we can't (not on
 * Localites yet), so the pages promise only what is sent.
 */
export type BookedCounts = { told: number; notTold: number };

const bookedCounts = async (tx: Db, userId: string, eventId: string): Promise<BookedCounts> => {
  const [n] = await tx.execute<BookedCounts>(sql`
    select count(*) filter (where t.tellable)::int as told, count(*) filter (where not t.tellable)::int as "notTold"
    from (
      select v.claim_status = 'claimed' and v.listing_status <> 'archived' and exists (
               select 1 from vendor_member m join app_user u on u.id = m.user_id
               where m.vendor_id = v.id and m.role in ('owner', 'manager') and m.ended_at is null and u.deleted_at is null) as tellable
      from event_vendor ev join vendor v on v.id = ev.vendor_id
      where ev.event_id = ${eventId} and ev.host_user_id = ${userId} and ev.status = 'booked'
    ) t`);
  return n ?? { told: 0, notTold: 0 };
};

/** C2 edit: the event's values, whether it's cancelled, and the businesses marked booked (told or not). */
export async function eventForEdit(
  env: ServerEnv,
  userId: string,
  eventId: string,
): Promise<{ values: EventValues; cancelled: boolean; booked: BookedCounts }> {
  return planned(
    actingAs(env, asPerson(userId), async (tx) => {
      const e = await readEvent(tx, userId, eventId, false);
      if (!e) throw new PlanNotFound();
      return { values: eventValues(e), cancelled: e.status === 'cancelled', booked: await bookedCounts(tx, userId, eventId) };
    }),
  );
}

/**
 * Plans a new event: the event and its private details (with its name) always together
 * (the database checks that at commit, D-39). With `addSlug` (C4), that business goes on
 * the plan as Considering in the same transaction.
 */
export async function createEvent(
  env: ServerEnv,
  userId: string,
  values: EventValues,
  addSlug: string | null,
): Promise<{ eventId: string; added: { slug: string; name: string } | null }> {
  return planned(
    actingAs(env, asPerson(userId), async (tx) => {
      // Locks this person's row, so two quick submits can't both pass the caps.
      await tx.execute(sql`select id from app_user where id = ${userId} for update`);
      const [caps] = await tx.execute<{ today: number; open: number }>(sql`
        select count(*) filter (where e.created_at > now() - interval '1 day')::int as today,
               count(*) filter (where e.status = 'planning' and event_ends_at(e) >= now())::int as open
        from event e where e.host_user_id = ${userId}`);
      if ((caps?.today ?? 0) >= PLAN_LIMITS.eventsPerDay) throw new PlanCapped(PLAN_REFUSALS.eventsPerDay);
      if ((caps?.open ?? 0) >= PLAN_LIMITS.openEvents) throw new PlanCapped(PLAN_REFUSALS.openEvents);

      const vendor = addSlug ? await publishedVendor(tx, addSlug) : null;
      if (addSlug && !vendor) throw new PlanRefused(PLAN_REFUSALS.LP107);

      const eventId = uuidv7();
      await tx.execute(sql`
        insert into event (id, host_user_id, event_type_id, event_date, start_time, end_time, municipality_id, guest_count_estimate)
        values (${eventId}, ${userId}, ${values.typeId}::uuid, ${values.date}::date, ${values.startTime}::time, ${values.endTime}::time,
                ${values.townId}::uuid, ${values.guests}::int)`);
      await tx.execute(sql`
        insert into event_private (event_id, host_user_id, title, venue_note, age_range_min, age_range_max, budget_cents, notes)
        values (${eventId}, ${userId}, ${values.title}, ${values.venueNote}, ${values.ageMin}::smallint, ${values.ageMax}::smallint,
                ${values.budgetCents}::int, ${values.notes})`);
      if (vendor) {
        await tx.execute(sql`
          insert into event_vendor (id, event_id, host_user_id, vendor_id) values (${randomRowId()}, ${eventId}, ${userId}, ${vendor.id})`);
      }
      return { eventId, added: vendor ? { slug: vendor.slug, name: vendor.name } : null };
    }),
  );
}

const EVENT_COLUMNS = ['typeId', 'date', 'townId', 'startTime', 'endTime', 'guests'] as const;
const PRIVATE_COLUMNS = ['title', 'venueNote', 'ageMin', 'ageMax', 'budgetCents', 'notes'] as const;

/**
 * Saves the edit form: only the fields that changed are written. When the date or the
 * town changed, returns one notice per booked business to tell (D-40).
 */
export async function updateEvent(env: ServerEnv, userId: string, eventId: string, values: EventValues): Promise<BookingNotice[]> {
  return planned(
    actingAs(env, asPerson(userId), async (tx) => {
      const before = await readEvent(tx, userId, eventId, true);
      if (!before) throw new PlanNotFound();
      if (before.status !== 'planning') throw new PlanRefused(PLAN_REFUSALS.LP102);
      const has = (k: keyof EventValues) => before[k] !== values[k];

      if (EVENT_COLUMNS.some(has)) {
        await tx.execute(sql`
          update event set
            event_type_id = case when ${has('typeId')} then ${values.typeId}::uuid else event_type_id end,
            event_date = case when ${has('date')} then ${values.date}::date else event_date end,
            municipality_id = case when ${has('townId')} then ${values.townId}::uuid else municipality_id end,
            start_time = case when ${has('startTime')} then ${values.startTime}::time else start_time end,
            end_time = case when ${has('endTime')} then ${values.endTime}::time else end_time end,
            guest_count_estimate = case when ${has('guests')} then ${values.guests}::int else guest_count_estimate end
          where id = ${eventId} and host_user_id = ${userId}`);
      }
      if (PRIVATE_COLUMNS.some(has)) {
        await tx.execute(sql`
          update event_private set
            title = case when ${has('title')} then ${values.title} else title end,
            venue_note = case when ${has('venueNote')} then ${values.venueNote} else venue_note end,
            age_range_min = case when ${has('ageMin')} then ${values.ageMin}::smallint else age_range_min end,
            age_range_max = case when ${has('ageMax')} then ${values.ageMax}::smallint else age_range_max end,
            budget_cents = case when ${has('budgetCents')} then ${values.budgetCents}::int else budget_cents end,
            notes = case when ${has('notes')} then ${values.notes} else notes end
          where event_id = ${eventId} and host_user_id = ${userId}`);
      }

      if (!has('date') && !has('townId')) return [];
      const notices = await noticesFor(tx, userId, sql`ev.event_id = ${eventId} and ev.status = 'booked'`, 'booked_event_changed');
      return notices.map((n) => ({ ...n, was: { date: before.date, town: before.town } }));
    }),
  );
}

/** Cancels an event (final in 2A). Returns a notice for each booked business to tell. Already cancelled: nothing to do. */
export async function cancelEvent(env: ServerEnv, userId: string, eventId: string): Promise<BookingNotice[]> {
  return planned(
    actingAs(env, asPerson(userId), async (tx) => {
      const [e] = await tx.execute<{ status: string }>(sql`
        select status from event where id = ${eventId} and host_user_id = ${userId} for update`);
      if (!e) throw new PlanNotFound();
      if (e.status === 'cancelled') return [];
      await tx.execute(sql`update event set status = 'cancelled' where id = ${eventId} and host_user_id = ${userId}`);
      return noticesFor(tx, userId, sql`ev.event_id = ${eventId} and ev.status = 'booked'`, 'booked_event_cancelled');
    }),
  );
}

// ------------------------------------------------------------------ C3: the event plan

export type PlanRow = {
  rowId: string;
  vendorId: string;
  slug: string;
  name: string;
  category: string | null;
  claimed: boolean;
  listed: boolean;
  status: PlanStatus;
  bookedAt: string | null;
  /** The business said this booking isn't right (D-41). Never the note: only the team sees that. */
  flaggedAt: string | null;
  /** Its square profile photo (none once it's no longer listed). */
  photo: ListPhoto | null;
  /** Whether it can be reviewed now, and why not (Stage 3, migration 0031). */
  canReview: CanReview;
  /** The person's review of this booking, if they wrote one. */
  review: ReviewStatus | null;
};

export type Ideas = {
  heading: string;
  /** At most 3, chosen by the team, clearly labelled where shown (D-43). */
  featured: { slug: string; name: string; town: string; category: string | null; onPlan: boolean; photo: ListPhoto | null }[];
  /** "Businesses people often need": category pages (the search page filtered by category). */
  categories: { slug: string; name: string }[];
};

export type EventPlan = {
  event: EventCard & { guests: number | null; typeId: string | null };
  private: {
    venueNote: string | null;
    ageMin: number | null;
    ageMax: number | null;
    budgetCents: number | null;
    notes: string | null;
  };
  rows: PlanRow[];
  /** Null when no kind of event was chosen (C3 then shows NO_TYPE_IDEAS). */
  ideas: Ideas | null;
  onTeam: boolean;
};

export async function eventPlan(env: ServerEnv, userId: string, eventId: string): Promise<EventPlan> {
  return planned(
    actingAs(env, asPerson(userId), async (tx) => {
      const [e] = await tx.execute<EventPlan['event'] & EventPlan['private'] & { typeKey: string | null; onTeam: boolean }>(sql`
        select ${CARD_COLUMNS}, e.guest_count_estimate as guests, e.event_type_id as "typeId", t.key as "typeKey",
               p.venue_note as "venueNote", p.age_range_min as "ageMin", p.age_range_max as "ageMax",
               p.budget_cents as "budgetCents", p.notes, ${ON_TEAM(userId)} as "onTeam"
        ${CARD_FROM}
        where e.id = ${eventId} and e.host_user_id = ${userId}`);
      if (!e) throw new PlanNotFound();
      const rows = (
        await tx.execute<Omit<PlanRow, 'photo'> & ListPhotoColumns>(sql`
          select ev.id as "rowId", v.id as "vendorId", v.slug::text as slug, v.display_name as name, ${MAIN_CATEGORY} as category,
                 v.claim_status = 'claimed' as claimed, v.listing_status = 'published' as listed, ev.status,
                 ev.booked_at::text as "bookedAt",
                 -- A flag counts only for the current marking (the person may un-mark and mark again).
                 case when ev.vendor_flagged_at >= ev.booked_at then ev.vendor_flagged_at::text end as "flaggedAt",
                 -- A review the team denied isn't shown to its author, and can't be written again (D-51).
                 case when exists (select 1 from review r where r.event_vendor_id = ev.id and r.author_user_id = ${userId}
                                     and r.status = 'declined') then 'not_open' else ${CAN_REVIEW} end as "canReview",
                 (select nullif(r.status, 'declined') from review r where r.event_vendor_id = ev.id and r.author_user_id = ${userId}) as review,
                 ${LIST_PHOTO_COLUMNS}
          from event_vendor ev join vendor v on v.id = ev.vendor_id join event e on e.id = ev.event_id
          ${LIST_PHOTO}
          -- A business that's no longer listed is hidden (D-46), unless the person marked it
          -- booked: then it stays as their own record, with no photo or link.
          where ev.event_id = ${eventId} and ev.host_user_id = ${userId}
            and (v.listing_status = 'published' or ev.status = 'booked')
          order by ev.created_at`)
      ).map((r) => withListPhoto(env, r, r.listed));

      let ideas: Ideas | null = null;
      if (e.typeId && e.typeName && e.typeKey) {
        // Featured: only what featured_for_type gives (current placements of listed
        // businesses, at most 3, in the team's order); never the team's note.
        const featured = (
          await tx.execute<{ slug: string; name: string; town: string; category: string | null; vendorId: string } & ListPhotoColumns>(sql`
            select v.id as "vendorId", v.slug::text as slug, v.display_name as name, mu.name as town, ${MAIN_CATEGORY} as category,
                   ${LIST_PHOTO_COLUMNS}
            from featured_for_type(${e.typeId}::uuid) with ordinality as f(vendor_id, n)
            join vendor v on v.id = f.vendor_id join municipality mu on mu.id = v.primary_municipality_id
            ${LIST_PHOTO}
            order by f.n`)
        ).map((f) => withListPhoto(env, f));
        const categories = await tx.execute<{ slug: string; name: string }>(sql`
          select c.slug::text as slug, c.name from event_type_category s join category c on c.id = s.category_id
          left join category p on p.id = c.parent_id
          where s.event_type_id = ${e.typeId}::uuid and c.is_active and (p.id is null or p.is_active)
          order by s.sort_order, c.name`);
        const onPlan = new Set(rows.filter((r) => r.status !== 'removed').map((r) => r.vendorId));
        ideas = {
          heading: ideasHeading({ key: e.typeKey, name: e.typeName }),
          featured: featured.map(({ vendorId, ...f }) => ({ ...f, onPlan: onPlan.has(vendorId) })),
          categories: [...categories],
        };
      }

      const event: EventPlan['event'] = {
        id: e.id,
        name: e.name,
        typeName: e.typeName,
        date: e.date,
        startTime: e.startTime,
        endTime: e.endTime,
        town: e.town,
        status: e.status,
        passed: e.passed,
        booked: e.booked,
        considering: e.considering,
        guests: e.guests,
        typeId: e.typeId,
      };
      const { venueNote, ageMin, ageMax, budgetCents, notes } = e;
      return { event, private: { venueNote, ageMin, ageMax, budgetCents, notes }, rows, ideas, onTeam: e.onTeam };
    }),
  );
}

/** For the confirm pages of a plan change (C5, un-mark, remove, put back). */
export async function planChangeTarget(
  env: ServerEnv,
  userId: string,
  eventId: string,
  rowId: string,
): Promise<{
  eventName: string;
  date: string;
  vendorName: string;
  claimed: boolean;
  listed: boolean;
  status: PlanStatus;
  cancelled: boolean;
}> {
  return planned(
    actingAs(env, asPerson(userId), async (tx) => {
      const [t] = await tx.execute<{
        eventName: string;
        date: string;
        vendorName: string;
        claimed: boolean;
        listed: boolean;
        status: PlanStatus;
        cancelled: boolean;
      }>(sql`
        select p.title as "eventName", e.event_date::text as date, v.display_name as "vendorName",
               v.claim_status = 'claimed' and v.listing_status <> 'archived' as claimed, v.listing_status = 'published' as listed,
               ev.status, e.status = 'cancelled' as cancelled
        from event_vendor ev join event e on e.id = ev.event_id join event_private p on p.event_id = e.id
        join vendor v on v.id = ev.vendor_id
        where ev.id = ${rowId} and ev.event_id = ${eventId} and ev.host_user_id = ${userId}`);
      if (!t) throw new PlanNotFound();
      return t;
    }),
  );
}

export type PlanChange = 'book' | 'unbook' | 'remove' | 'readd';
export const PLAN_CHANGES: readonly PlanChange[] = ['book', 'unbook', 'remove', 'readd'];

/** Which statuses each change starts from, and where it goes (B §4; the database checks it again). */
export const CHANGE_STEPS: Record<PlanChange, { from: PlanStatus[]; to: PlanStatus }> = {
  book: { from: ['considering'], to: 'booked' },
  unbook: { from: ['booked'], to: 'considering' },
  remove: { from: ['considering', 'booked'], to: 'removed' },
  readd: { from: ['removed'], to: 'considering' },
};

/**
 * Changes one business's status on the person's plan (ADR-017: this and the database's
 * rules are the one way in; the database records each change in status_change). Returns
 * the notice to send: marked booked, or no longer marked booked.
 */
export async function changePlan(
  env: ServerEnv,
  userId: string,
  eventId: string,
  rowId: string,
  change: PlanChange,
): Promise<{ vendorName: string; notice: BookingNotice | null }> {
  return planned(
    actingAs(env, asPerson(userId), async (tx) => {
      const [row] = await tx.execute<{ status: PlanStatus; vendorName: string; eventStatus: string; listed: boolean }>(sql`
        select ev.status, v.display_name as "vendorName", e.status as "eventStatus", v.listing_status = 'published' as listed
        from event_vendor ev join event e on e.id = ev.event_id join vendor v on v.id = ev.vendor_id
        where ev.id = ${rowId} and ev.event_id = ${eventId} and ev.host_user_id = ${userId}
        for update of ev`);
      if (!row) throw new PlanNotFound();
      if (row.eventStatus !== 'planning') throw new PlanRefused(PLAN_REFUSALS.LP102);
      const step = CHANGE_STEPS[change];
      if (!step.from.includes(row.status)) throw new PlanRefused(PLAN_REFUSALS.LP109);
      // Un-marked, a business that's no longer listed would vanish from the plan and couldn't
      // be marked again (D-46): the person can still remove it.
      if (change === 'unbook' && !row.listed) throw new PlanRefused(PLAN_REFUSALS.LP107);

      if (change === 'readd') {
        // Putting one back counts towards the event's limit, like adding it (the database
        // also checks the business is still listed).
        const [n] = await tx.execute<{ n: number }>(sql`
          -- Only what the person can see counts (D-46: a business that isn't listed is hidden).
          select count(*)::int as n from event_vendor x join vendor xv on xv.id = x.vendor_id
          where x.event_id = ${eventId} and x.host_user_id = ${userId} and x.status <> 'removed'
            and (xv.listing_status = 'published' or x.status = 'booked')`);
        if ((n?.n ?? 0) >= PLAN_LIMITS.vendorsPerEvent) throw new PlanCapped(PLAN_REFUSALS.vendorsPerEvent);
      }
      if (change === 'book') {
        const [marks] = await tx.execute<{ n: number }>(sql`
          select count(*)::int as n from status_change
          where actor_user_id = ${userId} and subject_type = 'event_vendor' and field = 'status' and to_status = 'booked'
            and created_at > now() - interval '1 day'`);
        if ((marks?.n ?? 0) >= PLAN_LIMITS.bookedMarksPerDay) throw new PlanCapped(PLAN_REFUSALS.bookedMarksPerDay);
      }
      await tx.execute(sql`
        update event_vendor set status = ${step.to} where id = ${rowId} and event_id = ${eventId} and host_user_id = ${userId}`);

      const kind = change === 'book' ? 'marked_booked' : row.status === 'booked' ? 'booking_unmarked' : null;
      const [notice] = kind ? await noticesFor(tx, userId, sql`ev.id = ${rowId}`, kind) : [];
      return { vendorName: row.vendorName, notice: notice ?? null };
    }),
  );
}

// ------------------------------------------------------------------ C4: add to an event, save

export type AddingChoices = {
  vendor: { id: string; slug: string; name: string; ownBusiness: boolean; saved: boolean; photo: ListPhoto | null };
  /** The person's events still being planned that haven't passed, soonest first. */
  events: { id: string; name: string; date: string; town: string; status: 'considering' | 'booked' | null }[];
};

export async function addingChoices(env: ServerEnv, userId: string, slug: string): Promise<AddingChoices> {
  return planned(
    actingAs(env, asPerson(userId), async (tx) => {
      const [found] = await tx.execute<Omit<AddingChoices['vendor'], 'photo'> & ListPhotoColumns>(sql`
        select v.id, v.slug::text as slug, v.display_name as name,
               exists (select 1 from vendor_member m where m.vendor_id = v.id and m.user_id = ${userId} and m.ended_at is null) as "ownBusiness",
               exists (select 1 from saved_vendor s where s.user_id = ${userId} and s.vendor_id = v.id) as saved,
               ${LIST_PHOTO_COLUMNS}
        from vendor v ${LIST_PHOTO} where v.slug = ${slug} and v.listing_status = 'published'`);
      if (!found) throw new PlanNotFound();
      const v = withListPhoto(env, found);
      const events = await tx.execute<AddingChoices['events'][number]>(sql`
        select e.id, p.title as name, e.event_date::text as date, mu.name as town,
               case when ev.status in ('considering', 'booked') then ev.status end as status
        from event e join event_private p on p.event_id = e.id join municipality mu on mu.id = e.municipality_id
        left join event_vendor ev on ev.event_id = e.id and ev.vendor_id = ${v.id} and ev.host_user_id = ${userId}
        where e.host_user_id = ${userId} and e.status = 'planning' and event_ends_at(e) >= now()
        order by e.event_date, e.start_time nulls first
        limit ${PLAN_LIMITS.openEvents}`);
      return { vendor: v, events: [...events] };
    }),
  );
}

/**
 * Puts a business on one of the person's events as Considering (nobody is told). A
 * business removed earlier comes back on the same row ('back'); one already there is
 * left as it is ('already').
 */
export async function addToEvent(env: ServerEnv, userId: string, eventId: string, slug: string): Promise<'added' | 'back' | 'already'> {
  return planned(
    actingAs(env, asPerson(userId), async (tx) => {
      const v = await publishedVendor(tx, slug);
      if (!v) throw new PlanNotFound();
      const [e] = await tx.execute<{ status: string; onPlan: number }>(sql`
        select e.status,
               (select count(*) from event_vendor x join vendor xv on xv.id = x.vendor_id
                where x.event_id = e.id and x.host_user_id = e.host_user_id and x.status <> 'removed'
                  and (xv.listing_status = 'published' or x.status = 'booked'))::int as "onPlan"
        from event e where e.id = ${eventId} and e.host_user_id = ${userId} for update of e`);
      if (!e) throw new PlanNotFound();
      if (e.status !== 'planning') throw new PlanRefused(PLAN_REFUSALS.LP102);
      if (e.onPlan >= PLAN_LIMITS.vendorsPerEvent) throw new PlanCapped(PLAN_REFUSALS.vendorsPerEvent);
      const [r] = await tx.execute<{ inserted: boolean }>(sql`
        insert into event_vendor (id, event_id, host_user_id, vendor_id) values (${randomRowId()}, ${eventId}, ${userId}, ${v.id})
        on conflict (event_id, vendor_id) do update set status = 'considering' where event_vendor.status = 'removed'
        returning (xmax = 0) as inserted`);
      return r ? (r.inserted ? 'added' : 'back') : 'already';
    }),
  );
}

export type SavedVendor = { slug: string; name: string; town: string; category: string | null; photo: ListPhoto | null };

/** C6: the person's saved businesses, newest first. One that's no longer listed is hidden (D-46). */
export async function savedVendors(env: ServerEnv, userId: string): Promise<{ saved: SavedVendor[]; onTeam: boolean }> {
  return planned(
    actingAs(env, asPerson(userId), async (tx) => {
      const saved = (
        await tx.execute<Omit<SavedVendor, 'photo'> & ListPhotoColumns>(sql`
          select v.slug::text as slug, v.display_name as name, mu.name as town, ${MAIN_CATEGORY} as category,
                 ${LIST_PHOTO_COLUMNS}
          from saved_vendor s join vendor v on v.id = s.vendor_id join municipality mu on mu.id = v.primary_municipality_id
          ${LIST_PHOTO}
          where s.user_id = ${userId} and v.listing_status = 'published'
          order by s.created_at desc
          limit ${PLAN_LIMITS.savedMax}`)
      ).map((r) => withListPhoto(env, r));
      const [t] = await tx.execute<{ onTeam: boolean }>(sql`select ${ON_TEAM(userId)} as "onTeam"`);
      return { saved: [...saved], onTeam: t?.onTeam ?? false };
    }),
  );
}

/** Saves a listed business (private: nobody is told). */
export async function saveVendor(env: ServerEnv, userId: string, slug: string): Promise<'saved' | 'already'> {
  return planned(
    actingAs(env, asPerson(userId), async (tx) => {
      await tx.execute(sql`select id from app_user where id = ${userId} for update`);
      const v = await publishedVendor(tx, slug);
      if (!v) throw new PlanNotFound();
      const [n] = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from saved_vendor s join vendor v on v.id = s.vendor_id
        where s.user_id = ${userId} and v.listing_status = 'published'`);
      if ((n?.n ?? 0) >= PLAN_LIMITS.savedMax) throw new PlanCapped(PLAN_REFUSALS.savedMax);
      const saved = await tx.execute(sql`
        insert into saved_vendor (user_id, vendor_id) values (${userId}, ${v.id}) on conflict do nothing returning vendor_id`);
      return saved.length > 0 ? 'saved' : 'already';
    }),
  );
}

/** Removes a business from the saved list, listed or not. */
export async function unsaveVendor(env: ServerEnv, userId: string, slug: string): Promise<void> {
  await planned(
    actingAs(env, asPerson(userId), (tx) =>
      tx.execute(sql`
        delete from saved_vendor where user_id = ${userId} and vendor_id in (select id from vendor where slug = ${slug})`),
    ),
  );
}
