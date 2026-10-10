import { sql } from 'drizzle-orm';
import { type DomainEvidence, emailMatchesWebsite } from '@/lib/domain-match';
import { uuidv7 } from '@/lib/ids.mjs';
import { audit } from './admin/audit.server';
import type { Admin } from './auth/admin.server';
import type { Member } from './auth/member.server';
import { AUTO_DECLINE_REASON, type Check, CHECKS, type ClaimInput, OPEN_CLAIMS_PER_PERSON, RELATIONSHIPS } from './member-input';
import { type Db, withDb } from './db.server';
import type { ServerEnv } from './env';

/**
 * Claiming a business (D-29, D-33, D-35, ADR-028). A signed-in person asks to manage a
 * published listing; the team checks and decides. The first approved claim wins: the
 * claimant becomes the owner and every other open claim is declined in the same
 * transaction. The database also allows only one active owner per business.
 *
 *   vendor_claim:        submitted → approved | rejected            (team)
 *   vendor.claim_status: unclaimed → claim_pending → claimed
 *                        claim_pending → unclaimed (last open claim declined)
 */

export class ClaimRefused extends Error {}

type Person = { userId: string; name: string; email: string };

// ------------------------------------------------------------------ claimant

export type ClaimTarget = {
  vendor: { id: string; slug: string; name: string; websiteUrl: string | null };
  state: 'can_claim' | 'waiting' | 'manager' | 'claimed' | 'too_many';
  evidence: DomainEvidence['result'];
};

/** A published listing and whether this person can claim it. Null if there's no such public listing. */
export async function claimTarget(env: ServerEnv, slug: string, member: Member): Promise<ClaimTarget | null> {
  const [row] = await withDb(env, (db) =>
    db.execute<{
      id: string;
      slug: string;
      name: string;
      websiteUrl: string | null;
      claimStatus: string;
      mine: boolean;
      manager: boolean;
      open: number;
    }>(sql`
      select v.id, v.slug::text as slug, v.display_name as name, v.website_url as "websiteUrl", v.claim_status as "claimStatus",
             exists (select 1 from vendor_claim c
                     where c.vendor_id = v.id and c.claimant_user_id = ${member.userId} and c.status = 'submitted') as mine,
             exists (select 1 from vendor_member m
                     where m.vendor_id = v.id and m.user_id = ${member.userId} and m.ended_at is null) as manager,
             (select count(*) from vendor_claim c
              where c.claimant_user_id = ${member.userId} and c.status = 'submitted')::int as open
      from vendor v
      where v.slug = ${slug} and v.listing_status = 'published'`),
  );
  if (!row) return null;
  const state: ClaimTarget['state'] = row.manager
    ? 'manager'
    : row.mine
      ? 'waiting'
      : row.claimStatus === 'claimed'
        ? 'claimed'
        : row.open >= OPEN_CLAIMS_PER_PERSON
          ? 'too_many'
          : 'can_claim';
  return {
    vendor: { id: row.id, slug: row.slug, name: row.name, websiteUrl: row.websiteUrl },
    state,
    evidence: emailMatchesWebsite(member.email, row.websiteUrl).result,
  };
}

async function statusChange(
  tx: Db,
  c: { type: string; id: string; field: string; from: string | null; to: string; actor: string; kind: 'vendor' | 'admin'; reason?: string | null },
) {
  await tx.execute(sql`
    insert into status_change (id, subject_type, subject_id, field, from_status, to_status, actor_user_id, actor_kind, reason)
    values (${uuidv7()}, ${c.type}, ${c.id}, ${c.field}, ${c.from}, ${c.to}, ${c.actor}, ${c.kind}, ${c.reason ?? null})`);
}

/** Records a claim. Refuses (ClaimRefused, in plain words) anything the claim page wouldn't offer. */
export async function submitClaim(env: ServerEnv, member: Member, vendorId: string, input: ClaimInput): Promise<{ claimId: string; business: string }> {
  return withDb(env, (db) =>
    db.transaction(async (tx) => {
      // Locks: the person (their open-claim count) and the business (a decision in progress).
      await tx.execute(sql`select id from app_user where id = ${member.userId} for update`);
      const [v] = await tx.execute<{ name: string; claimStatus: string }>(sql`
        select display_name as name, claim_status as "claimStatus" from vendor
        where id = ${vendorId} and listing_status = 'published' for update`);
      if (!v) throw new ClaimRefused('This business isn’t listed on Localites.');
      if (v.claimStatus === 'claimed') throw new ClaimRefused('This business is already managed on Localites.');

      const [counts] = await tx.execute<{ open: number; here: number; manager: number }>(sql`
        select count(*) filter (where status = 'submitted')::int as open,
               count(*) filter (where status = 'submitted' and vendor_id = ${vendorId})::int as here,
               (select count(*) from vendor_member
                where vendor_id = ${vendorId} and user_id = ${member.userId} and ended_at is null)::int as manager
        from vendor_claim where claimant_user_id = ${member.userId}`);
      if ((counts?.manager ?? 0) > 0) throw new ClaimRefused('You already manage this business.');
      if ((counts?.here ?? 0) > 0) throw new ClaimRefused('You’ve already claimed this business. Our team will be in touch.');
      if ((counts?.open ?? 0) >= OPEN_CLAIMS_PER_PERSON) {
        throw new ClaimRefused(`You can have ${OPEN_CLAIMS_PER_PERSON} claims waiting at a time. Please wait for our team to answer one.`);
      }

      const claimId = uuidv7();
      await tx.execute(sql`
        insert into vendor_claim (id, vendor_id, claimant_user_id, relationship, claimant_note)
        values (${claimId}, ${vendorId}, ${member.userId}, ${input.relationship}, ${input.note})`);
      await statusChange(tx, { type: 'vendor_claim', id: claimId, field: 'status', from: null, to: 'submitted', actor: member.userId, kind: 'vendor' });
      if (v.claimStatus === 'unclaimed') {
        await tx.execute(sql`update vendor set claim_status = 'claim_pending' where id = ${vendorId}`);
        await statusChange(tx, { type: 'vendor', id: vendorId, field: 'claim_status', from: 'unclaimed', to: 'claim_pending', actor: member.userId, kind: 'vendor' });
      }
      await audit(tx, {
        actor: member.userId,
        action: 'vendor_claim.submit',
        subjectType: 'vendor_claim',
        subjectId: claimId,
        changes: { vendorId: { from: null, to: vendorId }, relationship: { from: null, to: input.relationship } },
      });
      return { claimId, business: v.name };
    }),
  );
}

export type MyClaim = {
  id: string;
  business: string;
  slug: string;
  status: 'submitted' | 'approved' | 'rejected' | 'withdrawn';
  reason: string | null;
  createdAt: string;
};
export type MyBusiness = { id: string; name: string; slug: string; role: string; listed: boolean };

/** The account page: only ever this person's own businesses and claims. */
export async function myAccount(env: ServerEnv, userId: string): Promise<{ businesses: MyBusiness[]; claims: MyClaim[] }> {
  return withDb(env, async (db) => {
    const [businesses, claims] = await Promise.all([
      db.execute<MyBusiness>(sql`
        select v.id, v.display_name as name, v.slug::text as slug, m.role, v.listing_status = 'published' as listed
        from vendor_member m join vendor v on v.id = m.vendor_id
        where m.user_id = ${userId} and m.ended_at is null
        order by v.display_name`),
      db.execute<MyClaim>(sql`
        select c.id, v.display_name as business, v.slug::text as slug, c.status,
               case when c.status = 'rejected' then c.decision_note end as reason, c.created_at::text as "createdAt"
        from vendor_claim c join vendor v on v.id = c.vendor_id
        where c.claimant_user_id = ${userId}
        order by c.created_at desc
        limit 50`),
    ]);
    return { businesses: [...businesses], claims: [...claims] };
  });
}

// ------------------------------------------------------------------ team (X4)

export type ClaimRow = {
  id: string;
  status: 'submitted' | 'approved' | 'rejected' | 'withdrawn';
  relationship: keyof typeof RELATIONSHIPS | null;
  note: string | null;
  decisionNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  claimant: Person;
  vendor: {
    id: string;
    name: string;
    slug: string;
    claimStatus: string;
    listed: boolean;
    websiteUrl: string | null;
    publicEmail: string | null;
    publicPhone: string | null;
  };
  otherOpen: number;
  emailStatus: string | null;
  evidence: DomainEvidence;
};

export async function countOpenClaims(env: ServerEnv): Promise<number> {
  const [row] = await withDb(env, (db) =>
    db.execute<{ n: number }>(sql`select count(*)::int as n from vendor_claim where status = 'submitted'`),
  );
  return row?.n ?? 0;
}

export async function listClaims(env: ServerEnv, show: 'open' | 'all'): Promise<ClaimRow[]> {
  const rows = await withDb(env, (db) =>
    db.execute<Omit<ClaimRow, 'evidence'>>(sql`
      select c.id, c.status, c.relationship, c.claimant_note as note, c.decision_note as "decisionNote",
             c.created_at::text as "createdAt", c.reviewed_at::text as "reviewedAt", r.display_name as "reviewedBy",
             json_build_object('userId', u.id, 'name', u.display_name, 'email', u.email) as claimant,
             json_build_object('id', v.id, 'name', v.display_name, 'slug', v.slug, 'claimStatus', v.claim_status,
                               'listed', v.listing_status = 'published', 'websiteUrl', v.website_url,
                               'publicEmail', v.public_email, 'publicPhone', v.public_phone) as vendor,
             (select count(*) from vendor_claim o
              where o.vendor_id = c.vendor_id and o.status = 'submitted' and o.id <> c.id)::int as "otherOpen",
             (select n.status from notification n
              where n.subject_type = 'vendor_claim' and n.subject_id = c.id and n.kind = 'claim_received'
              order by n.created_at desc limit 1) as "emailStatus"
      from vendor_claim c
      join vendor v on v.id = c.vendor_id
      join app_user u on u.id = c.claimant_user_id
      left join app_user r on r.id = c.reviewed_by
      where ${show} = 'all' or c.status = 'submitted'
      order by (c.status = 'submitted') desc, c.created_at desc
      limit 200`),
  );
  return rows.map((r) => ({ ...r, evidence: emailMatchesWebsite(r.claimant.email, r.vendor.websiteUrl) }));
}

export class ClaimConflict extends Error {}

type Decided = { business: string; slug: string; claimant: Person; declined: (Person & { claimId: string })[] };

async function lockOpenClaim(tx: Db, claimId: string) {
  const [c] = await tx.execute<{
    vendorId: string;
    business: string;
    slug: string;
    status: string;
    claimStatus: string;
    websiteUrl: string | null;
    claimant: Person;
  }>(sql`
    select c.vendor_id as "vendorId", v.display_name as business, v.slug::text as slug, c.status,
           v.claim_status as "claimStatus", v.website_url as "websiteUrl",
           json_build_object('userId', u.id, 'name', u.display_name, 'email', u.email) as claimant
    from vendor_claim c join vendor v on v.id = c.vendor_id join app_user u on u.id = c.claimant_user_id
    where c.id = ${claimId}
    for update of c, v`);
  if (!c) throw new ClaimConflict('That claim doesn’t exist.');
  if (c.status !== 'submitted') throw new ClaimConflict('This claim was already dealt with.');
  return c;
}

/**
 * Approves a claim (D-33, D-35). The claimant becomes the business's owner and every other
 * open claim for it is declined, all in one transaction. A team member can't approve
 * their own claim, and "their email matches the website" is accepted only when it does.
 */
export async function approveClaim(env: ServerEnv, admin: Admin, claimId: string, check: Check): Promise<Decided> {
  return withDb(env, (db) =>
    db.transaction(async (tx) => {
      const c = await lockOpenClaim(tx, claimId);
      if (c.claimant.userId === admin.userId) {
        throw new ClaimConflict('You can’t approve your own claim. Ask another team member to check it.');
      }
      if (c.claimStatus === 'claimed') throw new ClaimConflict('This business already has an owner on Localites.');
      if (check === 'email_domain' && emailMatchesWebsite(c.claimant.email, c.websiteUrl).result !== 'match') {
        throw new ClaimConflict('Their email address isn’t at the business’s own website. Contact the business to confirm.');
      }
      const how = CHECKS[check];

      await tx.execute(sql`
        update vendor_claim set status = 'approved', reviewed_by = ${admin.userId}, reviewed_at = now(), decision_note = ${how}
        where id = ${claimId}`);
      await statusChange(tx, { type: 'vendor_claim', id: claimId, field: 'status', from: 'submitted', to: 'approved', actor: admin.userId, kind: 'admin', reason: how });

      await tx.execute(sql`update vendor set claim_status = 'claimed' where id = ${c.vendorId}`);
      await statusChange(tx, { type: 'vendor', id: c.vendorId, field: 'claim_status', from: c.claimStatus, to: 'claimed', actor: admin.userId, kind: 'admin', reason: how });

      // The database allows one active owner per business (vendor_member_one_owner).
      const memberId = uuidv7();
      await tx.execute(sql`
        insert into vendor_member (id, vendor_id, user_id, role, added_by)
        values (${memberId}, ${c.vendorId}, ${c.claimant.userId}, 'owner', ${admin.userId})`);

      const declined = await tx.execute<Person & { claimId: string }>(sql`
        with d as (
          update vendor_claim set status = 'rejected', reviewed_by = ${admin.userId}, reviewed_at = now(),
                                  decision_note = ${AUTO_DECLINE_REASON}
          where vendor_id = ${c.vendorId} and status = 'submitted' and id <> ${claimId}
          returning id, claimant_user_id
        )
        select d.id as "claimId", u.id as "userId", u.display_name as name, u.email::text as email
        from d join app_user u on u.id = d.claimant_user_id`);
      for (const other of declined) {
        await statusChange(tx, { type: 'vendor_claim', id: other.claimId, field: 'status', from: 'submitted', to: 'rejected', actor: admin.userId, kind: 'admin', reason: AUTO_DECLINE_REASON });
        await audit(tx, {
          actor: admin.userId,
          action: 'vendor_claim.decline',
          subjectType: 'vendor_claim',
          subjectId: other.claimId,
          reason: AUTO_DECLINE_REASON,
          sessionRef: admin.sessionId,
        });
      }

      await audit(tx, {
        actor: admin.userId,
        action: 'vendor_claim.approve',
        subjectType: 'vendor_claim',
        subjectId: claimId,
        reason: how,
        changes: {
          claimStatus: { from: c.claimStatus, to: 'claimed' },
          owner: { from: null, to: c.claimant.userId },
          vendorMember: { from: null, to: memberId },
        },
        sessionRef: admin.sessionId,
      });
      return { business: c.business, slug: c.slug, claimant: c.claimant, declined: [...declined] };
    }),
  );
}

/** Declines a claim with a reason, which is emailed to the claimant. */
export async function declineClaim(env: ServerEnv, admin: Admin, claimId: string, reason: string): Promise<Decided> {
  return withDb(env, (db) =>
    db.transaction(async (tx) => {
      const c = await lockOpenClaim(tx, claimId);
      await tx.execute(sql`
        update vendor_claim set status = 'rejected', reviewed_by = ${admin.userId}, reviewed_at = now(), decision_note = ${reason}
        where id = ${claimId}`);
      await statusChange(tx, { type: 'vendor_claim', id: claimId, field: 'status', from: 'submitted', to: 'rejected', actor: admin.userId, kind: 'admin', reason });

      const [open] = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from vendor_claim where vendor_id = ${c.vendorId} and status = 'submitted'`);
      const reopened = c.claimStatus === 'claim_pending' && (open?.n ?? 0) === 0;
      if (reopened) {
        await tx.execute(sql`update vendor set claim_status = 'unclaimed' where id = ${c.vendorId}`);
        await statusChange(tx, { type: 'vendor', id: c.vendorId, field: 'claim_status', from: 'claim_pending', to: 'unclaimed', actor: admin.userId, kind: 'admin', reason: 'No claims waiting.' });
      }
      await audit(tx, {
        actor: admin.userId,
        action: 'vendor_claim.decline',
        subjectType: 'vendor_claim',
        subjectId: claimId,
        reason,
        changes: reopened ? { claimStatus: { from: 'claim_pending', to: 'unclaimed' } } : null,
        sessionRef: admin.sessionId,
      });
      return { business: c.business, slug: c.slug, claimant: c.claimant, declined: [] };
    }),
  );
}
