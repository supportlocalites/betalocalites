import { sql } from 'drizzle-orm';
import { uuidv7 } from '@/lib/ids.mjs';
import type { Admin } from './auth/admin.server';
import { audit } from './admin/audit.server';
import { isUniqueViolation, withDb } from './db.server';
import { sendEmail, TEAM_ADDRESS } from './email.server';
import { emailPerson, renderEmail } from './email-templates.server';
import type { ServerEnv } from './env';
import { type SuggestionInput, teamEmail } from './suggestion-input';

/** Suggest a business (D-25, ADR-027). Limits keep spam and the email budget in check. */
export const PER_VISITOR_PER_HOUR = 5;
export const ALL_VISITORS_PER_DAY = 100;

export type SaveResult = { saved: true; id: string } | { saved: false; reason: 'visitor_limit' | 'daily_limit' };

/** suggestedBy: the signed-in person, if any (D-25: they're emailed when the business is listed). */
export async function saveSuggestion(
  env: ServerEnv,
  input: SuggestionInput,
  visitorId: string,
  suggestedBy: string | null = null,
): Promise<SaveResult> {
  return withDb(env, async (db) => {
    const [counts] = await db.execute<{ visitor: number; today: number }>(sql`
      select count(*) filter (where visitor_id = ${visitorId} and created_at > now() - interval '1 hour')::int as visitor,
             count(*) filter (where created_at > now() - interval '1 day')::int as today
      from vendor_suggestion where created_at > now() - interval '1 day'`);
    if ((counts?.visitor ?? 0) >= PER_VISITOR_PER_HOUR) return { saved: false, reason: 'visitor_limit' };
    if ((counts?.today ?? 0) >= ALL_VISITORS_PER_DAY) return { saved: false, reason: 'daily_limit' };
    const id = uuidv7();
    await db.execute(sql`
      insert into vendor_suggestion (id, business_name, website, contact, category_id, search_text, visitor_id, suggested_by)
      values (${id}, ${input.businessName}, ${input.website}, ${input.contact},
              (select id from category where slug = ${input.category}), ${input.q}, ${visitorId},
              (select u.id from app_user u where u.id = ${suggestedBy}::uuid and u.deleted_at is null))`);
    return { saved: true, id };
  });
}

/** Emails the team and records the outcome. Runs after the person has seen "Thanks". */
export async function notifyTeam(env: ServerEnv, id: string, input: SuggestionInput, siteUrl: string): Promise<void> {
  const categoryName = input.category
    ? ((await withDb(env, (db) => db.execute<{ name: string }>(sql`select name from category where slug = ${input.category}`)))[0]?.name ?? null)
    : null;
  const result = await sendEmail(env, { to: TEAM_ADDRESS, ...teamEmail({ ...input, id, categoryName }, siteUrl) });
  if (result.sent) {
    await withDb(env, (db) =>
      db.execute(sql`update vendor_suggestion set team_email_status = 'sent', team_email_sent_at = now(), team_email_error = null where id = ${id}`),
    );
  } else if (env.RESEND_API_KEY) {
    // A real failure is recorded with its short reason. Not set up yet: it stays "pending".
    await withDb(env, (db) =>
      db.execute(sql`update vendor_suggestion set team_email_status = 'failed', team_email_error = ${result.reason} where id = ${id}`),
    );
  }
}

// ------------------------------------------------------------------ admin (X19)

export type SuggestionRow = {
  id: string;
  businessName: string;
  website: string | null;
  contact: string | null;
  where: string | null;
  status: 'new' | 'added' | 'declined' | 'duplicate';
  vendorId: string | null;
  vendorName: string | null;
  declineReason: string | null;
  reviewedBy: string | null;
  emailStatus: 'pending' | 'sent' | 'failed';
  emailError: string | null;
  createdAt: string;
  matches: { id: string; name: string; status: string }[];
};

export async function countNewSuggestions(env: ServerEnv): Promise<number> {
  const [row] = await withDb(env, (db) =>
    db.execute<{ n: number }>(sql`select count(*)::int as n from vendor_suggestion where status = 'new'`),
  );
  return row?.n ?? 0;
}

export async function listSuggestions(env: ServerEnv, show: 'new' | 'all'): Promise<SuggestionRow[]> {
  return withDb(env, async (db) => [
    ...(await db.execute<SuggestionRow>(sql`
      select s.id, s.business_name as "businessName", s.website, s.contact,
             coalesce(c.name, case when s.search_text is not null then 'search: “' || s.search_text || '”' end) as "where",
             s.status, s.vendor_id as "vendorId", v.display_name as "vendorName", s.decline_reason as "declineReason",
             r.display_name as "reviewedBy", s.team_email_status as "emailStatus", s.team_email_error as "emailError",
             s.created_at::text as "createdAt",
             -- Likely duplicates: similar names, or the same website.
             coalesce((
               select json_agg(m order by m.score desc) from (
                 select x.id, x.display_name as name, x.listing_status as status,
                        extensions.word_similarity(s.business_name, x.display_name) as score
                 from vendor x
                 where extensions.word_similarity(s.business_name, x.display_name) > 0.5
                    or (s.website is not null and x.website_url is not null and
                        lower(regexp_replace(x.website_url, '^https?://(www\\.)?([^/]+).*$', '\\2')) =
                        lower(regexp_replace(s.website, '^(https?://)?(www\\.)?([^/]+).*$', '\\3')))
                 order by score desc limit 5
               ) m), '[]'::json) as matches
      from vendor_suggestion s
      left join category c on c.id = s.category_id
      left join vendor v on v.id = s.vendor_id
      left join app_user r on r.id = s.reviewed_by
      where ${show} = 'all' or s.status = 'new'
      order by (s.status = 'new') desc, s.created_at desc
      limit 200`)),
  ]);
}

export class SuggestionConflict extends Error {}

async function decide(
  env: ServerEnv,
  admin: Admin,
  id: string,
  to: 'duplicate' | 'declined',
  vendorId: string | null,
  reason: string | null,
) {
  await withDb(env, (db) =>
    db.transaction(async (tx) => {
      if (vendorId) {
        const [v] = await tx.execute<{ ok: boolean }>(sql`select true as ok from vendor where id = ${vendorId}`);
        if (!v) throw new SuggestionConflict('That listing doesn’t exist.');
      }
      // Only a new suggestion can be decided, so two admins can't overwrite each other.
      const updated = await tx.execute(sql`
        update vendor_suggestion
        set status = ${to}, vendor_id = ${vendorId}, decline_reason = ${reason},
            reviewed_by = ${admin.userId}, reviewed_at = now()
        where id = ${id} and status = 'new' returning id`);
      if (updated.length === 0) throw new SuggestionConflict('This suggestion was already dealt with.');
      await audit(tx, {
        actor: admin.userId,
        action: `vendor_suggestion.${to}`,
        subjectType: 'vendor_suggestion',
        subjectId: id,
        reason,
        changes: vendorId ? { vendorId: { from: null, to: vendorId } } : null,
        sessionRef: admin.sessionId,
      });
    }),
  );
}

export const markDuplicate = (env: ServerEnv, admin: Admin, id: string, vendorId: string) =>
  decide(env, admin, id, 'duplicate', vendorId, null);
export const decline = (env: ServerEnv, admin: Admin, id: string, reason: string) =>
  decide(env, admin, id, 'declined', null, reason);

/** For "Add as a draft listing": the name, and the website only if it looks like one. */
export async function suggestionForListing(env: ServerEnv, id: string): Promise<{ name: string; website: string | null } | null> {
  const [s] = await withDb(env, (db) =>
    db.execute<{ name: string; website: string | null }>(sql`
      select business_name as name, website from vendor_suggestion where id = ${id} and status = 'new'`),
  );
  if (!s) return null;
  const site = s.website && /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(s.website) ? s.website : null;
  return { name: s.name, website: site };
}

/**
 * D-25: emails everyone who suggested this business while signed in, once it's published (or
 * now, if it already is), once per suggestion (a database index makes it once even when two
 * team members publish together; a failed email isn't sent again). Never someone who has since
 * deleted their account, nor about a suggestion the team decided on over a year ago (its email
 * record is deleted after a year, migration 0041, so it couldn't tell). At most 50 at a time; any more are emailed the next time it's
 * published or matched.
 */
export async function emailSuggesters(env: ServerEnv, vendorId: string, siteUrl: string): Promise<void> {
  const due = await withDb(env, (db) =>
    db.execute<{ id: string; userId: string; email: string; name: string; business: string; slug: string }>(sql`
      select s.id, u.id as "userId", u.email::text as email, coalesce(u.given_name, u.display_name) as name,
             v.display_name as business, v.slug::text as slug
      from vendor_suggestion s
        join vendor v on v.id = s.vendor_id and v.listing_status = 'published'
        join app_user u on u.id = s.suggested_by and u.deleted_at is null
      where s.vendor_id = ${vendorId} and s.status in ('added', 'duplicate')
        and s.reviewed_at > now() - interval '1 year'
        and not exists (select 1 from notification n
                        where n.kind = 'suggestion_listed' and n.subject_type = 'vendor_suggestion' and n.subject_id = s.id)
      order by s.created_at limit 50`),
  );
  for (const d of due) {
    try {
      await emailPerson(env, { userId: d.userId, email: d.email }, 'suggestion_listed', { type: 'vendor_suggestion', id: d.id },
        renderEmail('suggestionListed', { name: d.name, business: d.business, link: `${siteUrl}/vendors/${d.slug}` }));
    } catch (err) {
      // Another request is emailing this one right now (the index refuses a second): not twice.
      if (!isUniqueViolation(err)) throw err;
    }
  }
}
