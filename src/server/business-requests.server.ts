import { sql } from 'drizzle-orm';
import { type AddressForm } from '@/lib/address';
import { OPEN_CLAIMS_PER_PERSON, RELATIONSHIPS } from '@/lib/claim-terms';
import { uuidv7 } from '@/lib/ids.mjs';
import { actingAs } from './acting.server';
import type { Admin } from './auth/admin.server';
import type { Member } from './auth/member.server';
import { audit } from './admin/audit.server';
import { type Db, isUniqueViolation, withDb } from './db.server';
import { sendEmail, TEAM_ADDRESS } from './email.server';
import type { ServerEnv } from './env';
import type { OwnBusinessInput } from './member-input';
import { ALL_VISITORS_PER_DAY, PER_CONNECTION_PER_DAY } from './suggestion-input';

/**
 * Add my business, and asking to remove one (D-63, migration 0058). Adding: a suggestion that
 * says it's the person's own; when the team lists it (or finds it's listed already), a claim is
 * started for them, so it's confirmed exactly as a claim is. Removing: only the business's
 * owner can ask; nothing changes until the team has checked who it affects.
 */

export class RequestRefused extends Error {}

/** At most this many of your own businesses waiting for the team at a time (as claims). */
export const OPEN_OWN_PER_PERSON = OPEN_CLAIMS_PER_PERSON;
/** At most this many removal requests for one business in 30 days (each one emails the team). */
export const REMOVALS_PER_MONTH = 3;

export type KindOption = { group: string; slug: string; name: string };

/** The kinds of business, under their groups, for the form. */
export async function kindOptions(env: ServerEnv): Promise<KindOption[]> {
  return withDb(env, async (db) => [
    ...(await db.execute<KindOption>(sql`
      select coalesce(p.name, c.name) as group, c.slug::text as slug, c.name
      from category c left join category p on p.id = c.parent_id
      where c.is_active and (p.id is null or p.is_active)
        and (c.parent_id is not null or not exists (select 1 from category k where k.parent_id = c.id and k.is_active))
      order by coalesce(p.sort_order, c.sort_order), coalesce(p.name, c.name), c.sort_order, c.name`)),
  ]);
}

export type OwnRequest = { id: string; business: string; status: 'new' | 'declined'; createdAt: string };

/** Their own businesses waiting for the team, and any declined in the last 90 days. */
export async function myOwnRequests(env: ServerEnv, userId: string): Promise<OwnRequest[]> {
  return withDb(env, async (db) => [
    ...(await db.execute<OwnRequest>(sql`
      select id, business_name as business, status, created_at::text as "createdAt"
      from vendor_suggestion
      where suggested_by = ${userId} and relationship is not null
        and (status = 'new' or (status = 'declined' and reviewed_at > now() - interval '90 days'))
      order by created_at desc limit 20`)),
  ]);
}

export async function addOwnBusiness(
  env: ServerEnv,
  member: Member,
  input: OwnBusinessInput,
  address: AddressForm,
  connection: string | null = null,
): Promise<string> {
  return withDb(env, (db) =>
    db.transaction(async (tx) => {
      // The suggestions' own lock: with them, at most ALL_VISITORS_PER_DAY a day for the whole site.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('localites.suggest', 0))`);
      const [n] = await tx.execute<{ mine: number; today: number; connection: number }>(sql`
        select (select count(*) from vendor_suggestion
                where suggested_by = ${member.userId} and relationship is not null and status = 'new')::int as mine,
               (select count(*) from vendor_suggestion where created_at > now() - interval '1 day')::int as today,
               (select count(*) from vendor_suggestion where ${connection}::text is not null and created_at > now() - interval '1 day'
                  and connection_hash = decode(${connection}, 'hex'))::int as connection`);
      if ((n?.mine ?? 0) >= OPEN_OWN_PER_PERSON) {
        throw new RequestRefused(`You can have ${OPEN_OWN_PER_PERSON} businesses waiting for our team at a time. We’ll be in touch about those first.`);
      }
      // One home connection a day, as Suggest a business (M22): fresh accounts can't use up everyone's.
      if ((n?.connection ?? 0) >= PER_CONNECTION_PER_DAY) {
        throw new RequestRefused('That’s the most businesses from one place in a day. Please add more tomorrow.');
      }
      if ((n?.today ?? 0) >= ALL_VISITORS_PER_DAY) {
        throw new RequestRefused('We’ve had a lot of businesses added today. Please try again tomorrow.');
      }
      const id = uuidv7();
      await tx.execute(sql`
        insert into vendor_suggestion (id, business_name, website, contact, category_id, suggested_by,
                                       relationship, town, address_unit, address_number, address_street, postal_code,
                                       hide_address_number, note, connection_hash)
        values (${id}, ${input.businessName}, ${input.website}, ${input.contact},
                (select id from category where slug = ${input.category} and is_active), ${member.userId},
                ${input.relationship}, ${input.town}, ${address.unit}, ${address.number}, ${address.street}, ${input.postalCode},
                ${address.hidden}, ${input.note}, case when ${connection}::text is null then null else decode(${connection}, 'hex') end)`);
      await audit(tx, {
        actor: member.userId,
        action: 'vendor_suggestion.own',
        subjectType: 'vendor_suggestion',
        subjectId: id,
        changes: { relationship: { from: null, to: input.relationship } },
      });
      return id;
    }),
  );
}

/** The team's email about it (plain text; the team page has the full record). */
export function ownTeamEmail(
  s: OwnBusinessInput & { id: string; address: AddressForm; kind: string | null; person: { name: string; email: string } },
  siteUrl: string,
) {
  const street = s.address.street ? `${s.address.number ? `${s.address.number} ` : ''}${s.address.street}` : null;
  const lines = [
    'Someone added their own business to Localites.',
    '',
    `Business: ${s.businessName}`,
    `Kind: ${s.kind ?? '(not chosen)'}`,
    `Address: ${[s.address.unit, street, s.town, s.postalCode].filter(Boolean).join(', ')}${s.address.hidden ? ' (they keep their street number and unit private)' : ''}`,
    `Phone or email for the business: ${s.contact}`,
    `Website or social page: ${s.website ?? '(not given)'}`,
    `Added by: ${s.person.name} <${s.person.email}>, “${RELATIONSHIPS[s.relationship]}”`,
    ...(s.note ? [`Their note: ${s.note}`] : []),
    '',
    'Confirm it with the business, then add it as a draft listing (that starts their claim) or decline it:',
    `${siteUrl}/admin/suggestions#s-${s.id}`,
  ];
  return { subject: `Business added by its owner: ${s.businessName.slice(0, 80)}`, text: lines.join('\n') };
}

/** Emails the team and records the outcome, as a suggestion's. */
export async function notifyTeamOwn(env: ServerEnv, id: string, email: { subject: string; text: string }): Promise<void> {
  const result = await sendEmail(env, { to: TEAM_ADDRESS, ...email });
  if (result.sent) {
    await withDb(env, (db) =>
      db.execute(sql`update vendor_suggestion set team_email_status = 'sent', team_email_sent_at = now(), team_email_error = null where id = ${id}`),
    );
  } else if (env.RESEND_API_KEY) {
    await withDb(env, (db) => db.execute(sql`update vendor_suggestion set team_email_status = 'failed', team_email_error = ${result.reason} where id = ${id}`));
  }
}

/**
 * The team listed their own business (or found it already listed): start a claim for them,
 * as if they'd claimed it, so it's confirmed the usual way. Nothing when it isn't their own,
 * their account is gone, the business already has an owner, or they've a claim open for it.
 */
export async function claimFromSuggestion(tx: Db, admin: Admin, suggestionId: string, vendorId: string): Promise<void> {
  const [s] = await tx.execute<{ userId: string; relationship: keyof typeof RELATIONSHIPS; note: string | null }>(sql`
    select s.suggested_by as "userId", s.relationship, s.note
    from vendor_suggestion s join app_user u on u.id = s.suggested_by and u.deleted_at is null
    where s.id = ${suggestionId} and s.relationship is not null`);
  if (!s) return;
  const [v] = await tx.execute<{ claimStatus: string }>(sql`select claim_status as "claimStatus" from vendor where id = ${vendorId} for update`);
  if (!v || v.claimStatus === 'claimed') return;
  const claimId = uuidv7();
  try {
    await tx.execute(sql`savepoint own_claim`);
    await tx.execute(sql`
      insert into vendor_claim (id, vendor_id, claimant_user_id, relationship, claimant_note)
      values (${claimId}, ${vendorId}, ${s.userId}, ${s.relationship}, ${s.note})`);
    await tx.execute(sql`release savepoint own_claim`);
  } catch (err) {
    // They already have a claim waiting for this business: that one is checked instead.
    if (!isUniqueViolation(err)) throw err;
    await tx.execute(sql`rollback to savepoint own_claim`);
    return;
  }
  await tx.execute(sql`
    insert into status_change (subject_type, subject_id, field, from_status, to_status, actor_user_id, actor_kind, reason)
    values ('vendor_claim', ${claimId}, 'status', null, 'submitted', ${admin.userId}, 'admin', 'They added their own business (D-63).')`);
  if (v.claimStatus === 'unclaimed') {
    await tx.execute(sql`update vendor set claim_status = 'claim_pending' where id = ${vendorId}`);
    await tx.execute(sql`
      insert into status_change (subject_type, subject_id, field, from_status, to_status, actor_user_id, actor_kind, reason)
      values ('vendor', ${vendorId}, 'claim_status', 'unclaimed', 'claim_pending', ${admin.userId}, 'admin', 'They added their own business (D-63).')`);
  }
  await audit(tx, {
    actor: admin.userId,
    action: 'vendor_claim.from_own_business',
    subjectType: 'vendor_claim',
    subjectId: claimId,
    reason: 'They added their own business (D-63)',
    changes: { vendorId: { from: null, to: vendorId }, claimant: { from: null, to: s.userId }, suggestion: { from: null, to: suggestionId } },
    sessionRef: admin.sessionId,
  });
}

// ------------------------------------------------------------------ asking to remove a business

export type RemovalPage = {
  vendorId: string;
  slug: string;
  name: string;
  open: { id: string; reason: string | null; createdAt: string } | null;
  recent: number;
};

/** Only for the business's active owner, and not once it's off Localites; otherwise null. */
export async function removalPage(env: ServerEnv, userId: string, slug: string): Promise<RemovalPage | null> {
  return withDb(env, (db) => readRemoval(db, userId, slug));
}

async function readRemoval(db: Db, userId: string, slug: string, lock = false): Promise<RemovalPage | null> {
  const [v] = await db.execute<{ vendorId: string; slug: string; name: string }>(sql`
    select v.id as "vendorId", v.slug::text as slug, v.display_name as name
    from vendor v join vendor_member m on m.vendor_id = v.id
    where v.slug = ${slug} and v.listing_status <> 'archived'
      and m.user_id = ${userId} and m.role = 'owner' and m.ended_at is null
    ${lock ? sql`for update of v` : sql``}`);
  if (!v) return null;
  const [r] = await db.execute<{ open: RemovalPage['open']; recent: number }>(sql`
    select (select json_build_object('id', id, 'reason', reason, 'createdAt', created_at::text)
            from business_removal_request where vendor_id = ${v.vendorId} and status = 'new') as open,
           (select count(*) from business_removal_request
            where vendor_id = ${v.vendorId} and created_at > now() - interval '30 days')::int as recent`);
  return { ...v, open: r?.open ?? null, recent: r?.recent ?? 0 };
}

export async function askToRemove(env: ServerEnv, member: Member, slug: string, reason: string | null): Promise<{ id: string; name: string } | null> {
  return withDb(env, (db) =>
    db.transaction(async (tx) => {
      const page = await readRemoval(tx, member.userId, slug, true);
      if (!page) return null;
      if (page.open) throw new RequestRefused('Your request is already with our team. We’ll be in touch.');
      if (page.recent >= REMOVALS_PER_MONTH) {
        throw new RequestRefused('You’ve asked a few times this month. Please email supportlocalites@gmail.com and we’ll help.');
      }
      const id = uuidv7();
      await tx.execute(sql`
        insert into business_removal_request (id, vendor_id, requested_by, reason) values (${id}, ${page.vendorId}, ${member.userId}, ${reason})`);
      await audit(tx, {
        actor: member.userId,
        action: 'business_removal.ask',
        subjectType: 'vendor',
        subjectId: page.vendorId,
        reason,
        changes: { removalRequest: { from: null, to: id } },
      });
      return { id, name: page.name };
    }),
  );
}

export async function withdrawRemoval(env: ServerEnv, member: Member, slug: string): Promise<boolean> {
  return withDb(env, (db) =>
    db.transaction(async (tx) => {
      const page = await readRemoval(tx, member.userId, slug, true);
      if (!page?.open) return false;
      // Their own request, or one a past owner made: the owner now decides.
      await tx.execute(sql`update business_removal_request set status = 'withdrawn' where id = ${page.open.id} and status = 'new'`);
      await audit(tx, {
        actor: member.userId,
        action: 'business_removal.withdraw',
        subjectType: 'vendor',
        subjectId: page.vendorId,
        changes: { removalRequest: { from: 'new', to: 'withdrawn' } },
      });
      return true;
    }),
  );
}

export function removalTeamEmail(r: { id: string; business: string; reason: string | null; person: { name: string; email: string } }, siteUrl: string) {
  return {
    subject: `Asked to remove: ${r.business.slice(0, 80)}`,
    text: [
      `${r.person.name} <${r.person.email}>, the owner on Localites, asked us to take ${r.business} off Localites.`,
      ...(r.reason ? ['', `Their reason: ${r.reason}`] : []),
      '',
      'Check who it affects (its team, people messaging it, bookings) and get in touch with them:',
      `${siteUrl}/admin/removals#r-${r.id}`,
    ].join('\n'),
  };
}

// ------------------------------------------------------------------ the team's page

export type RemovalRow = {
  id: string;
  status: 'new' | 'done' | 'declined' | 'withdrawn';
  reason: string | null;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  person: { name: string; email: string; stillOwner: boolean } | null;
  vendor: { id: string; name: string; slug: string; status: string };
  affects: { team: number; conversations: number; bookings: number; saved: number };
};

export async function countOpenRemovals(env: ServerEnv): Promise<number> {
  const [row] = await withDb(env, (db) => db.execute<{ n: number }>(sql`select count(*)::int as n from business_removal_request where status = 'new'`));
  return row?.n ?? 0;
}

/** Open ones oldest first, then the rest; with who taking it off would affect, in counts only. */
export async function listRemovals(env: ServerEnv, admin: Admin, show: 'open' | 'all'): Promise<RemovalRow[]> {
  // Acting as the team (ADR-031): conversations, bookings and saves are counted by the database (0058), never read.
  return actingAs(env, { side: 'team', userId: admin.userId }, async (db) => [
    ...(await db.execute<RemovalRow>(sql`
      select r.id, r.status, r.reason, r.decision_note as "decisionNote", r.created_at::text as "createdAt",
             r.decided_at::text as "decidedAt", d.display_name as "decidedBy",
             case when u.id is null then null else json_build_object('name', u.display_name, 'email', u.email,
               'stillOwner', exists (select 1 from vendor_member m where m.vendor_id = r.vendor_id and m.user_id = u.id
                                      and m.role = 'owner' and m.ended_at is null)) end as person,
             json_build_object('id', v.id, 'name', v.display_name, 'slug', v.slug, 'status', v.listing_status) as vendor,
             json_build_object('team', (select count(*) from vendor_member m where m.vendor_id = v.id and m.ended_at is null),
                               'conversations', a.conversations, 'bookings', a.bookings, 'saved', a.saved) as affects
      from business_removal_request r
      join vendor v on v.id = r.vendor_id
      cross join lateral removal_affects(v.id) a
      left join app_user u on u.id = r.requested_by and u.deleted_at is null
      left join app_user d on d.id = r.decided_by
      where ${show} = 'all' or r.status = 'new'
      order by (r.status = 'new') desc, case when r.status = 'new' then r.created_at end asc, r.created_at desc
      limit 200`)),
  ]);
}

export async function decideRemoval(env: ServerEnv, admin: Admin, id: string, to: 'done' | 'declined', note: string | null): Promise<void> {
  await withDb(env, (db) =>
    db.transaction(async (tx) => {
      const [r] = await tx.execute<{ vendorId: string; status: string; listing: string }>(sql`
        select r.vendor_id as "vendorId", r.status, v.listing_status as listing
        from business_removal_request r join vendor v on v.id = r.vendor_id where r.id = ${id} for update of r`);
      if (!r) throw new RequestRefused('That request doesn’t exist.');
      if (r.status !== 'new') throw new RequestRefused('This request was already dealt with.');
      if (to === 'done' && r.listing !== 'archived') throw new RequestRefused('Archive the listing on its page first, then mark this done.');
      if (to === 'declined' && !note) throw new RequestRefused('Say why (kept for the team).');
      await tx.execute(sql`
        update business_removal_request set status = ${to}, decided_by = ${admin.userId}, decided_at = now(), decision_note = ${note}
        where id = ${id}`);
      await audit(tx, {
        actor: admin.userId,
        action: `business_removal.${to}`,
        subjectType: 'vendor',
        subjectId: r.vendorId,
        reason: note,
        changes: { removalRequest: { from: 'new', to } },
        sessionRef: admin.sessionId,
      });
    }),
  );
}
