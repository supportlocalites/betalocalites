import { sql } from 'drizzle-orm';
import { INQUIRY_LIMITS, INQUIRY_REFUSALS } from '@/lib/inquiry-terms';
import { uuidv7 } from '@/lib/ids.mjs';
import { guestsWords, longDateWithYear } from '@/lib/plan-terms';
import { actingAs, errorCode, PlanCapped, PlanNotFound, PlanRefused } from './acting.server';
import { audit } from './admin/audit.server';
import type { Admin } from './auth/admin.server';
import { sendEmail, TEAM_ADDRESS } from './email.server';
import { emailPerson, renderEmail } from './email-templates.server';
import type { ServerEnv } from './env';

/**
 * Inquire (screen C10, ADR-024, D-04, D-05): a signed-in person tells the Localites team
 * they're interested in a business that isn't on Localites yet, with an optional note and
 * one of their events. Saved (vendor_interest, migration 0021), emailed to the team, and the
 * person is told when the business joins. The business is never sent anything by us.
 * Every step acts as the person (ADR-031); the team's list acts as the team.
 */

export type EmailStatus = 'pending' | 'sent' | 'failed';

export type InquiryPage = {
  vendor: { id: string; slug: string; name: string; claimed: boolean; ownBusiness: boolean };
  /** The person's events still to come, for "mention an event" (their own names, on their own page). */
  events: { id: string; name: string; date: string }[];
  /** What they already sent about this business, if anything. */
  sent: { createdAt: string; note: string | null; sharedEvent: string | null; emailStatus: EmailStatus; joinedTold: boolean } | null;
};

const asPerson = (userId: string) => ({ side: 'person', userId }) as const;

/** Refusals in plain words (inquiry-terms); someone else's row, like a missing one, is "not found". */
async function inquired<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (err) {
    if (err instanceof PlanNotFound || err instanceof PlanRefused || err instanceof PlanCapped) throw err;
    const code = errorCode(err);
    if (code === '23505') throw new PlanRefused(INQUIRY_REFUSALS.LP131);
    if (code && INQUIRY_REFUSALS[code]) throw new PlanRefused(INQUIRY_REFUSALS[code]);
    if (code === 'LP101' || code === '42501') {
      console.error('inquiry refused as not found:', code);
      throw new PlanNotFound();
    }
    throw err;
  }
}

export async function inquiryPage(env: ServerEnv, userId: string, slug: string): Promise<InquiryPage> {
  return inquired(
    actingAs(env, asPerson(userId), async (tx) => {
      const [vendor] = await tx.execute<InquiryPage['vendor']>(sql`
        select v.id, v.slug::text as slug, v.display_name as name, v.claim_status = 'claimed' as claimed,
               exists (select 1 from vendor_member m where m.vendor_id = v.id and m.user_id = ${userId} and m.ended_at is null) as "ownBusiness"
        from vendor v where v.slug = ${slug} and v.listing_status = 'published'`);
      if (!vendor) throw new PlanNotFound();
      const [sent] = await tx.execute<NonNullable<InquiryPage['sent']>>(sql`
        select created_at::text as "createdAt", note, shared_event as "sharedEvent", team_email_status as "emailStatus",
               notified_joined_at is not null as "joinedTold"
        from vendor_interest where vendor_id = ${vendor.id} and user_id = ${userId}`);
      const events = await tx.execute<InquiryPage['events'][number]>(sql`
        select e.id, p.title as name, e.event_date::text as date
        from event e join event_private p on p.event_id = e.id
        where e.host_user_id = ${userId} and e.status = 'planning' and event_ends_at(e) >= now()
        order by e.event_date, e.start_time nulls first
        limit 50`);
      return { vendor, sent: sent ?? null, events: [...events] };
    }),
  );
}

/** What the team is sent about an event (D-04): never its name or private details. */
export function eventSummary(e: { type: string | null; date: string; town: string; guests: number | null }): string {
  return [e.type ?? 'An event', longDateWithYear(e.date), e.town, guestsWords(e.guests)].filter(Boolean).join(' · ');
}

export type Sent = {
  id: string;
  business: string;
  slug: string;
  person: { name: string; email: string };
  note: string | null;
  sharedEvent: string | null;
};

/**
 * Saves an inquiry, once per business (again only if the team email failed, which may
 * change the note and event). The team email is sent by the caller (sendInquiryEmail).
 */
export async function saveInquiry(
  env: ServerEnv,
  userId: string,
  slug: string,
  input: { note: string | null; eventId: string | null },
): Promise<Sent> {
  return inquired(
    actingAs(env, asPerson(userId), async (tx) => {
      // One at a time per person, so the daily limit can't be raced.
      const [person] = await tx.execute<{ name: string; email: string }>(sql`
        select display_name as name, email::text as email from app_user where id = ${userId} and deleted_at is null for update`);
      if (!person) throw new PlanNotFound();
      const [v] = await tx.execute<{ id: string; name: string; slug: string }>(sql`
        select id, display_name as name, slug::text as slug from vendor where slug = ${slug} and listing_status = 'published'`);
      if (!v) throw new PlanNotFound();

      let sharedEvent: string | null = null;
      if (input.eventId) {
        const [e] = await tx.execute<{ type: string | null; date: string; town: string; guests: number | null }>(sql`
          select t.name as type, e.event_date::text as date, mu.name as town, e.guest_count_estimate as guests
          from event e join municipality mu on mu.id = e.municipality_id left join event_type t on t.id = e.event_type_id
          where e.id = ${input.eventId} and e.host_user_id = ${userId} and e.status = 'planning' and event_ends_at(e) >= now()`);
        if (!e) throw new PlanRefused('Choose one of your events still to come, or none.');
        sharedEvent = eventSummary(e);
      }

      const [before] = await tx.execute<{ id: string; emailStatus: EmailStatus }>(sql`
        select id, team_email_status as "emailStatus" from vendor_interest where vendor_id = ${v.id} and user_id = ${userId} for update`);
      let id: string;
      if (before) {
        if (before.emailStatus !== 'failed') throw new PlanRefused(INQUIRY_REFUSALS.LP131);
        id = before.id;
        await tx.execute(sql`
          update vendor_interest set note = ${input.note}, shared_event = ${sharedEvent}, team_email_status = 'pending', team_email_error = null
          where id = ${id}`);
      } else {
        const [n] = await tx.execute<{ n: number }>(sql`
          select count(*)::int as n from vendor_interest where user_id = ${userId} and created_at > now() - interval '1 day'`);
        if ((n?.n ?? 0) >= INQUIRY_LIMITS.perDay) throw new PlanCapped(INQUIRY_REFUSALS.perDay);
        id = uuidv7();
        await tx.execute(sql`
          insert into vendor_interest (id, vendor_id, user_id, note, shared_event)
          values (${id}, ${v.id}, ${userId}, ${input.note}, ${sharedEvent})`);
      }
      return { id, business: v.name, slug: v.slug, person, note: input.note, sharedEvent };
    }),
  );
}

/**
 * Emails the team about an inquiry and records the outcome honestly on it ("sent" only once
 * the email service accepted it). Sent before the page answers, so the person is told the
 * truth. Replies reach the person.
 */
export async function sendInquiryEmail(env: ServerEnv, userId: string, sent: Sent, siteUrl: string): Promise<EmailStatus> {
  const result = await sendEmail(env, {
    to: TEAM_ADDRESS,
    replyTo: sent.person.email,
    ...renderEmail('inquiryTeam', {
      name: sent.person.name,
      email: sent.person.email,
      business: sent.business,
      note: sent.note ?? 'none',
      event: sent.sharedEvent ?? 'none mentioned',
      vendorUrl: `${siteUrl}/vendors/${sent.slug}`,
      inquiriesUrl: `${siteUrl}/admin/inquiries`,
    }),
  });
  await actingAs(env, asPerson(userId), (tx) =>
    tx.execute(
      result.sent
        ? sql`update vendor_interest set team_email_status = 'sent', team_email_error = null where id = ${sent.id}`
        : sql`update vendor_interest set team_email_status = 'failed', team_email_error = ${result.reason.slice(0, 500)} where id = ${sent.id}`,
    ),
  );
  return result.sent ? 'sent' : 'failed';
}

// ------------------------------------------------------------------ the team (X14)

export type InquiryRow = {
  id: string;
  vendorId: string;
  business: string;
  claimed: boolean;
  listed: boolean;
  person: string;
  personEmail: string;
  note: string | null;
  sharedEvent: string | null;
  createdAt: string;
  emailStatus: EmailStatus;
  emailError: string | null;
  joinedToldAt: string | null;
};

/** Every inquiry, newest first: waiting ones (the business hasn't joined), or all. Each look is recorded. */
export async function listInquiries(env: ServerEnv, admin: Admin, show: 'waiting' | 'all'): Promise<InquiryRow[]> {
  return actingAs(env, { side: 'team', userId: admin.userId }, async (tx) => {
    await audit(tx, {
      actor: admin.userId,
      action: 'vendor_interest.list_view',
      subjectType: 'vendor_interest',
      subjectId: null,
      sessionRef: admin.sessionId,
    });
    const rows = await tx.execute<InquiryRow>(sql`
      select vi.id, v.id as "vendorId", v.display_name as business, v.claim_status = 'claimed' as claimed,
             v.listing_status = 'published' as listed, u.display_name as person, u.email::text as "personEmail",
             vi.note, vi.shared_event as "sharedEvent", vi.created_at::text as "createdAt", vi.team_email_status as "emailStatus",
             vi.team_email_error as "emailError", vi.notified_joined_at::text as "joinedToldAt"
      from vendor_interest vi join vendor v on v.id = vi.vendor_id join app_user u on u.id = vi.user_id
      where ${show === 'all'} or v.claim_status <> 'claimed'
      order by vi.created_at desc
      limit 300`);
    return [...rows];
  });
}

/**
 * After the team approves a claim: tells everyone who asked about that business that it
 * joined (each once; take_joined_notices marks them), recording each email honestly.
 */
export async function tellJoined(
  env: ServerEnv,
  admin: Admin,
  vendor: { id: string; name: string; slug: string },
  siteUrl: string,
): Promise<void> {
  const people = await actingAs(env, { side: 'team', userId: admin.userId }, (tx) =>
    tx.execute<{ interestId: string; userId: string; email: string; name: string }>(sql`
      select interest_id as "interestId", user_id as "userId", email, name from take_joined_notices(${vendor.id}::uuid)`),
  );
  for (const p of people) {
    await emailPerson(
      env,
      { userId: p.userId, email: p.email },
      'vendor_joined',
      { type: 'vendor_interest', id: p.interestId },
      renderEmail('vendorJoined', { name: p.name, business: vendor.name, vendorUrl: `${siteUrl}/vendors/${vendor.slug}` }),
    );
  }
}
