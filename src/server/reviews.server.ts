import { sql } from 'drizzle-orm';
import { uuidv7 } from '@/lib/ids.mjs';
import { REVIEW_LIMITS, REVIEW_REFUSALS } from '@/lib/review-terms';
import { actingAs, errorCode, PlanCapped, PlanNotFound, PlanRefused } from './acting.server';
import { audit } from './admin/audit.server';
import type { Admin } from './auth/admin.server';
import { type Db, withDb } from './db.server';
import { sendEmail, TEAM_ADDRESS } from './email.server';
import { emailPerson, renderEmail } from './email-templates.server';
import type { ServerEnv } from './env';
import { asTeam } from './messages.server';

/**
 * Reviews (Stage 3, part 1; D-06, D-48, ADR-026, E §4.4 and §4.5; migration 0031). A person
 * reviews a business they booked, after the event, within 60 days; the Localites team
 * publishes or declines every review; the business's owner or a manager replies once; the
 * public sees published reviews of a listed business, the author as "Sarah M.". Every step
 * acts as a side (ADR-031) and the database's rules decide what that side may do.
 */

/** Refusals in plain words; someone else's booking or review, like a missing one, is "not found". */
async function reviewed<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (err) {
    if (err instanceof PlanNotFound || err instanceof PlanRefused || err instanceof PlanCapped) throw err;
    const code = errorCode(err);
    if (code === 'LP101' || code === '42501' || code === '23503') throw new PlanNotFound();
    const words = code ? (REVIEW_REFUSALS as Record<string, string>)[code] : undefined;
    if (words) throw new PlanRefused(words);
    throw err;
  }
}

const tidy = (raw: string) =>
  raw
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** A review from a form: 1 to 5 stars and some words. */
export function readReview(form: FormData): { rating: number; body: string } | { error: string } {
  const rating = Number(form.get('rating'));
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: REVIEW_REFUSALS.rating };
  const body = tidy(String(form.get('body') ?? ''));
  if (!body) return { error: REVIEW_REFUSALS.body };
  if (body.length > REVIEW_LIMITS.body) return { error: REVIEW_REFUSALS.bodyTooLong };
  return { rating, body };
}

// ======================================================================= the person

export type ReviewStatus = 'pending' | 'published' | 'declined' | 'removed' | 'withdrawn';

/** Whether a booking can be reviewed now, and why not. */
export type CanReview = 'yes' | 'not_booked' | 'not_yet' | 'closed' | 'flagged' | 'own' | 'unlisted';

/** The same rules as the database's (enforce_review_rules), to say so on the page before anyone tries. */
export const CAN_REVIEW = sql`case
  when ev.status <> 'booked' or e.status = 'cancelled' then 'not_booked'
  when event_ends_at(e) > now() then 'not_yet'
  when now() > event_ends_at(e) + interval '60 days' then 'closed'
  when ev.vendor_flagged_at is not null and ev.vendor_flagged_at >= ev.booked_at and ev.flag_outcome is distinct from 'booking_stands' then 'flagged'
  when exists (select 1 from vendor_member m where m.vendor_id = ev.vendor_id and m.user_id = ev.host_user_id and m.ended_at is null) then 'own'
  when v.listing_status <> 'published' then 'unlisted'
  else 'yes' end`;

export type ReviewForm = {
  business: { name: string; slug: string; listed: boolean };
  event: { name: string; date: string };
  can: CanReview;
  /** The last day to review (60 days after the event). */
  until: string;
  review: { id: string; rating: number; body: string; status: ReviewStatus; reason: string | null; reply: string | null } | null;
};

/** C11: reviewing a business booked for one of the person's events (their own, or "not found"). */
export async function reviewForm(env: ServerEnv, userId: string, eventId: string, rowId: string): Promise<ReviewForm> {
  return reviewed(
    actingAs(env, { side: 'person', userId }, async (tx) => {
      const [row] = await tx.execute<{
        name: string;
        slug: string;
        listed: boolean;
        eventName: string;
        date: string;
        can: CanReview;
        until: string;
      }>(sql`
        select v.display_name as name, v.slug::text as slug, v.listing_status = 'published' as listed,
               p.title as "eventName", e.event_date::text as date, ${CAN_REVIEW} as can,
               ((event_ends_at(e) + interval '60 days') at time zone e.timezone)::date::text as until
        from event_vendor ev join event e on e.id = ev.event_id join event_private p on p.event_id = e.id
        join vendor v on v.id = ev.vendor_id
        where ev.id = ${rowId} and ev.event_id = ${eventId} and ev.host_user_id = ${userId}`);
      if (!row) throw new PlanNotFound();
      const [review] = await tx.execute<NonNullable<ReviewForm['review']>>(sql`
        select id, rating, body, status, decision_reason as reason,
               case when reply_removed_at is null then vendor_reply end as reply
        from review where event_vendor_id = ${rowId} and author_user_id = ${userId}`);
      return {
        business: { name: row.name, slug: row.slug, listed: row.listed },
        event: { name: row.eventName, date: row.date },
        can: row.can,
        until: row.until,
        review: review ?? null,
      };
    }),
  );
}

/**
 * Writes the review (or changes it while it waits). A new one is emailed to the team with a
 * link to it in the team's pages, never the words and never a one-tap publish (ADR-026).
 */
export async function saveReview(
  env: ServerEnv,
  userId: string,
  rowId: string,
  input: { rating: number; body: string },
  siteUrl: string,
): Promise<{ id: string; created: boolean }> {
  const acting = { side: 'person' as const, userId };
  const saved = await reviewed(
    actingAs(env, acting, async (tx) => {
      const [existing] = await tx.execute<{ id: string }>(sql`
        select id from review where event_vendor_id = ${rowId} and author_user_id = ${userId} for update`);
      if (existing) {
        await tx.execute(sql`update review set rating = ${input.rating}, body = ${input.body} where id = ${existing.id}`);
        return { id: existing.id, created: false };
      }
      // At most 10 reviews a day, so a script can't flood the team's queue.
      const [n] = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from review where author_user_id = ${userId} and created_at > now() - interval '1 day'`);
      if ((n?.n ?? 0) >= 10) throw new PlanCapped('That’s a lot of reviews for one day. Please add more tomorrow.');
      const id = uuidv7();
      await tx.execute(sql`
        insert into review (id, event_vendor_id, author_user_id, rating, body)
        values (${id}, ${rowId}, ${userId}, ${input.rating}, ${input.body})`);
      return { id, created: true };
    }),
  );
  if (!saved.created) return saved;
  const [info] = await actingAs(env, acting, (tx) =>
    tx.execute<{ business: string; planned: boolean }>(sql`
      select v.display_name as business, r.planned_on_localites as planned
      from review r join vendor v on v.id = r.vendor_id where r.id = ${saved.id}`),
  );
  const [who] = await withDb(env, (db) => db.execute<{ author: string }>(sql`select reviewer_name(${userId}::uuid) as author`));
  if (info) {
    const result = await sendEmail(env, {
      to: TEAM_ADDRESS,
      ...renderEmail('reviewTeam', {
        author: who?.author ?? 'Someone',
        stars: String(input.rating),
        business: info.business,
        planned: info.planned ? 'planned on Localites' : 'planned outside Localites',
        reviewUrl: `${siteUrl}/admin/reviews/${saved.id}`,
      }),
    });
    await actingAs(env, acting, (tx) =>
      tx.execute(sql`update review set team_email_status = ${result.sent ? 'sent' : 'failed'} where id = ${saved.id}`),
    ).catch((err: unknown) => console.error('review email outcome not recorded', err instanceof Error ? err.message : err));
  }
  return saved;
}

// ======================================================================= the public

export type PublicReview = {
  id: string;
  rating: number;
  body: string;
  author: string;
  livingLocal: boolean;
  eventMonth: string;
  plannedOnLocalites: boolean;
  reply: string | null;
};
export type PublicReviews = { count: number; average: number | null; reviews: PublicReview[] };

/** A listed business's published reviews and its rating (the average only from 3, D-06). */
export async function publicReviews(db: Db, vendorId: string): Promise<PublicReviews> {
  const reviews = await db.execute<PublicReview>(sql`
    select id, rating, body, author, living_local as "livingLocal", event_month::text as "eventMonth",
           planned_on_localites as "plannedOnLocalites", reply
    from published_reviews(${vendorId}::uuid, 50)`);
  const [rating] = await db.execute<{ count: number; average: string | null }>(sql`
    select review_count as count, average::text as average from vendor_rating(${vendorId}::uuid)`);
  return { count: rating?.count ?? 0, average: rating?.average ? Number(rating.average) : null, reviews: [...reviews] };
}

// ======================================================================= the business

export type BusinessReview = PublicReview & { canReply: boolean };

/** V8: the business's published reviews (anyone on its team); owners and managers reply once. */
export async function businessReviews(env: ServerEnv, userId: string, slug: string) {
  return reviewed(
    asTeam(env, userId, slug, async (tx, business) => {
      const rows = await tx.execute<Omit<BusinessReview, 'canReply'> & { replied: boolean }>(sql`
        select r.id, r.vendor_reply is not null as replied, r.rating, r.body, reviewer_name(r.author_user_id) as author, false as "livingLocal",
               date_trunc('month', r.event_date)::date::text as "eventMonth", r.planned_on_localites as "plannedOnLocalites",
               case when r.reply_removed_at is null then r.vendor_reply end as reply
        from review r where r.vendor_id = ${business.id} and r.status = 'published'
        order by r.published_at desc limit 200`);
      const replies = business.role !== 'staff';
      const [rating] = await tx.execute<{ count: number; average: string | null }>(sql`
        select review_count as count, average::text as average from vendor_rating(${business.id}::uuid)`);
      return {
        business,
        count: rating?.count ?? 0,
        average: rating?.average ? Number(rating.average) : null,
        // A reply the team removed still counts: the business replies once.
        reviews: rows.map(({ replied, ...r }) => ({ ...r, canReply: replies && !replied })),
      };
    }),
  );
}

/** The business's one reply to a published review (owners and managers; the database checks). */
export async function replyToReview(env: ServerEnv, userId: string, slug: string, reviewId: string, reply: string): Promise<void> {
  await reviewed(
    asTeam(env, userId, slug, async (tx, business) => {
      if (business.role === 'staff') throw new PlanNotFound();
      const done = await tx.execute(sql`
        update review set vendor_reply = ${reply} where id = ${reviewId} and vendor_id = ${business.id} returning id`);
      if (done.length === 0) throw new PlanNotFound();
    }),
  );
}

export function readReply(form: FormData): { reply: string } | { error: string } {
  const reply = tidy(String(form.get('reply') ?? ''));
  if (!reply) return { error: REVIEW_REFUSALS.reply };
  if (reply.length > REVIEW_LIMITS.reply) return { error: REVIEW_REFUSALS.replyTooLong };
  return { reply };
}

// ======================================================================= the team (X14)

export type TeamReviewRow = {
  id: string;
  business: string;
  slug: string;
  author: string;
  rating: number;
  status: ReviewStatus;
  plannedOnLocalites: boolean;
  createdAt: string;
};

/** Waiting reviews first (oldest first), then the latest decided ones. */
export async function listReviews(env: ServerEnv, admin: Admin): Promise<{ waiting: TeamReviewRow[]; recent: TeamReviewRow[] }> {
  return actingAs(env, { side: 'team', userId: admin.userId }, async (tx) => {
    const cols = sql`r.id, v.display_name as business, v.slug::text as slug, u.display_name as author, r.rating, r.status,
                     r.planned_on_localites as "plannedOnLocalites", r.created_at::text as "createdAt"`;
    const waiting = await tx.execute<TeamReviewRow>(sql`
      select ${cols} from review r join vendor v on v.id = r.vendor_id join app_user u on u.id = r.author_user_id
      where r.status = 'pending' order by r.created_at limit 200`);
    const recent = await tx.execute<TeamReviewRow>(sql`
      select ${cols} from review r join vendor v on v.id = r.vendor_id join app_user u on u.id = r.author_user_id
      where r.status <> 'pending' order by coalesce(r.decided_at, r.updated_at) desc limit 50`);
    return { waiting: [...waiting], recent: [...recent] };
  });
}

export type TeamReview = TeamReviewRow & {
  body: string;
  shownAs: string;
  eventDate: string;
  reason: string | null;
  reply: string | null;
  replyRemoved: boolean;
  emailStatus: 'pending' | 'sent' | 'failed';
  /** The business says it wasn't booked (and the team hasn't said the booking stands). */
  flagged: boolean;
  /** When the words last changed: the team decides on the words it read. */
  seen: string;
};

export async function teamReview(env: ServerEnv, admin: Admin, id: string): Promise<TeamReview> {
  return actingAs(env, { side: 'team', userId: admin.userId }, async (tx) => {
    const [row] = await tx.execute<TeamReview>(sql`
      select r.id, v.display_name as business, v.slug::text as slug, u.display_name as author, r.rating, r.status,
             r.planned_on_localites as "plannedOnLocalites", r.created_at::text as "createdAt", r.body,
             reviewer_name(r.author_user_id) as "shownAs", r.event_date::text as "eventDate", r.decision_reason as reason,
             r.vendor_reply as reply, r.reply_removed_at is not null as "replyRemoved", r.team_email_status as "emailStatus",
             coalesce(x.vendor_flagged_at is not null and x.flag_outcome is distinct from 'booking_stands', false) as flagged,
             r.updated_at::text as seen
      from review r join vendor v on v.id = r.vendor_id join app_user u on u.id = r.author_user_id
        left join event_vendor x on x.id = r.event_vendor_id   -- the team sees flagged bookings only (0012)
      where r.id = ${id}`);
    if (!row) throw new PlanNotFound();
    return row;
  });
}

export type ReviewDecision =
  | { kind: 'publish'; seen: string }
  | { kind: 'decline'; reason: string; seen: string }
  | { kind: 'remove'; reason: string }
  | { kind: 'remove_reply'; reason: string };

/** The team's decision, recorded in audit_log; the author (and, when published, the business) is emailed after. */
export async function decideReview(
  env: ServerEnv,
  admin: Admin,
  id: string,
  decision: ReviewDecision,
): Promise<{ notify: 'published' | 'declined' | null }> {
  return reviewed(
    actingAs(env, { side: 'team', userId: admin.userId }, async (tx) => {
      const change =
        decision.kind === 'publish'
          ? sql`update review set status = 'published'
                where id = ${id} and status = 'pending' and updated_at = ${decision.seen}::timestamptz returning id`
          : decision.kind === 'decline'
            ? sql`update review set status = 'declined', decision_reason = ${decision.reason}
                  where id = ${id} and status = 'pending' and updated_at = ${decision.seen}::timestamptz returning id`
            : decision.kind === 'remove'
              ? sql`update review set status = 'removed', decision_reason = ${decision.reason} where id = ${id} and status = 'published' returning id`
              : sql`update review set reply_removed_at = now(), reply_removed_reason = ${decision.reason}
                    where id = ${id} and vendor_reply is not null and reply_removed_at is null returning id`;
      const done = await tx.execute(change);
      if (done.length === 0) throw new PlanRefused('That was already decided, or the review changed. Please look again.');
      await audit(tx, {
        actor: admin.userId,
        action: `review.${decision.kind}`,
        subjectType: 'review',
        subjectId: id,
        reason: 'reason' in decision ? decision.reason : undefined,
        sessionRef: admin.sessionId,
      });
      return { notify: decision.kind === 'publish' ? 'published' : decision.kind === 'decline' ? 'declined' : null };
    }),
  );
}

/** After the decision: the author is told (and, when published, the business's owners and managers). */
export async function emailAboutDecision(
  env: ServerEnv,
  admin: Admin,
  id: string,
  outcome: 'published' | 'declined',
  siteUrl: string,
): Promise<void> {
  const asTeamMember = { side: 'team' as const, userId: admin.userId };
  const [r] = await actingAs(env, asTeamMember, (db) =>
    db.execute<{
      authorId: string;
      email: string;
      name: string;
      shownAs: string;
      business: string;
      slug: string;
      vendorId: string;
      rating: number;
      reason: string | null;
      deleted: boolean;
    }>(sql`
      select u.id as "authorId", u.email::text as email, coalesce(u.given_name, u.display_name) as name,
             reviewer_name(u.id) as "shownAs", v.display_name as business, v.slug::text as slug, v.id as "vendorId",
             r.rating, r.decision_reason as reason, u.deleted_at is not null as deleted
      from review_for_email(${id}::uuid) r join app_user u on u.id = r.author_user_id join vendor v on v.id = r.vendor_id`),
  );
  if (!r) return;
  if (!r.deleted) {
    await emailPerson(
      env,
      { userId: r.authorId, email: r.email },
      outcome === 'published' ? 'review_published' : 'review_declined',
      { type: 'review', id },
      outcome === 'published'
        ? renderEmail('reviewPublished', { name: r.name, business: r.business, shownAs: r.shownAs, link: `${siteUrl}/vendors/${r.slug}` })
        : renderEmail('reviewDeclined', { name: r.name, business: r.business, reason: r.reason ?? '' }),
    );
  }
  if (outcome !== 'published') return;
  const team = await actingAs(env, asTeamMember, (db) =>
    db.execute<{ id: string; email: string; name: string }>(sql`
      select id, email, name from review_business_contacts(${id}::uuid)`),
  );
  for (const m of team) {
    await emailPerson(
      env,
      { userId: m.id, email: m.email },
      'review_for_business',
      { type: 'review', id },
      renderEmail('reviewForBusiness', {
        name: m.name,
        business: r.business,
        stars: String(r.rating),
        link: `${siteUrl}/vendors/${r.slug}/reviews`,
      }),
    );
  }
}
