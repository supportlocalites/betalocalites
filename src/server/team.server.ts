import { sql } from 'drizzle-orm';
import { uuidv7 } from '@/lib/ids.mjs';
import { audit } from './admin/audit.server';
import { type Db, withDb } from './db.server';
import { sendEmail, TEAM_ADDRESS } from './email.server';
import { emailPerson, renderEmail } from './email-templates.server';
import type { ServerEnv } from './env';
import { TEAM_ROLES, type TeamRole } from '@/lib/team-terms';

export { TEAM_ROLES, type TeamRole };

/**
 * A business owner's team (screen V4, E §3; migration 0015). Only the business's current
 * owner, checked in the database on every request, can invite, cancel an invitation or
 * remove someone. An invitation works once, for 7 days, and only for the account with the
 * email address it was sent to. Every change is in audit_log.
 *   manager: everything the owner does, except the team and ownership;
 *   staff: reads and replies to the business's messages (Stage 2B).
 */

/** Managers and staff (not counting the owner) plus open invitations, per business. */
export const TEAM_LIMIT = 10;
/** Invitations one business may send in a day (emails come out of Resend's free 100 a day). */
export const INVITES_PER_DAY = 20;
/** Hand-overs one business may make in a day (each emails the new owner; D-54). */
export const HAND_OVERS_PER_DAY = 5;

export class TeamRefused extends Error {}

type Owned = { id: string; slug: string; name: string; status: string; ownerHidden: boolean };

/** The business, if this person is its current owner and it isn't archived (by web address, or an old one). */
async function ownedBusiness(db: Db, userId: string, slug: string, lock = false): Promise<Owned | null> {
  const [v] = await db.execute<Owned>(sql`
    select v.id, v.slug::text as slug, v.display_name as name, v.listing_status as status,
           v.owner_hidden_at is not null and v.listing_status = 'unpublished' as "ownerHidden"
    from vendor v
    join vendor_member m on m.vendor_id = v.id and m.user_id = ${userId} and m.role = 'owner' and m.ended_at is null
    where v.listing_status <> 'archived'
      and (v.slug = ${slug} or v.id = (select h.vendor_id from vendor_slug_history h where h.slug = ${slug} and v.slug <> ${slug}))
    order by v.slug = ${slug} desc
    limit 1
    ${lock ? sql`for update of v, m` : sql``}`);
  return v ?? null;
}

export type TeamPage = {
  vendor: Owned;
  members: { memberId: string; name: string; role: 'owner' | TeamRole; since: string; you: boolean }[];
  invites: { id: string; email: string; role: TeamRole; expiresAt: string; emailStatus: 'pending' | 'sent' | 'failed' }[];
};

/** V4: the team and open invitations. Null: not this person's business (404, whatever the reason). */
export async function teamFor(env: ServerEnv, userId: string, slug: string): Promise<TeamPage | { renamedTo: string } | null> {
  return withDb(env, async (db) => {
    const vendor = await ownedBusiness(db, userId, slug);
    if (!vendor) return null;
    if (vendor.slug !== slug) return { renamedTo: vendor.slug };
    const [members, invites] = await Promise.all([
      db.execute<TeamPage['members'][number]>(sql`
        select m.id as "memberId", u.display_name as name, m.role, m.created_at::text as since, m.user_id = ${userId} as you
        from vendor_member m join app_user u on u.id = m.user_id
        where m.vendor_id = ${vendor.id} and m.ended_at is null
        order by m.role = 'owner' desc, m.created_at`),
      db.execute<TeamPage['invites'][number]>(sql`
        select id, email::text as email, role, expires_at::text as "expiresAt", email_status as "emailStatus"
        from vendor_invite
        where vendor_id = ${vendor.id} and accepted_at is null and revoked_at is null and expires_at > now()
        order by created_at`),
    ]);
    return { vendor, members: [...members], invites: [...invites] };
  });
}

const tokenHash = async (token: string) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
};
const newToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

/**
 * Invites someone by email (a new invitation to the same address replaces the open one).
 * Returns what the email needs; the caller sends it and records how that went.
 */
export async function inviteToTeam(
  env: ServerEnv,
  owner: { userId: string; email: string; name: string },
  slug: string,
  email: string,
  role: TeamRole,
): Promise<{ inviteId: string; token: string; business: string }> {
  return withDb(env, (db) =>
    db.transaction(async (tx) => {
      const vendor = await ownedBusiness(tx, owner.userId, slug, true);
      if (!vendor) throw new TeamRefused('not found');
      if (email.toLowerCase() === owner.email.toLowerCase()) throw new TeamRefused('You’re already the owner.');
      const [counts] = await tx.execute<{ onTeam: boolean; size: number; today: number }>(sql`
        select exists (select 1 from vendor_member m join app_user u on u.id = m.user_id
                       where m.vendor_id = ${vendor.id} and m.ended_at is null and u.email = ${email}) as "onTeam",
               (select count(*) from vendor_member where vendor_id = ${vendor.id} and ended_at is null and role <> 'owner')
               + (select count(*) from vendor_invite where vendor_id = ${vendor.id} and accepted_at is null and revoked_at is null
                    and expires_at > now() and email <> ${email})::int as size,
               (select count(*) from vendor_invite where vendor_id = ${vendor.id} and created_at > now() - interval '1 day')::int as today`);
      if (counts?.onTeam) throw new TeamRefused('That person is already on your team.');
      if ((counts?.size ?? 0) >= TEAM_LIMIT)
        throw new TeamRefused(`A business can have up to ${TEAM_LIMIT} people besides the owner. Remove someone first.`);
      if ((counts?.today ?? 0) >= INVITES_PER_DAY)
        throw new TeamRefused('You’ve sent a lot of invitations today. Please try again tomorrow.');
      await tx.execute(sql`
        update vendor_invite set revoked_at = now()
        where vendor_id = ${vendor.id} and email = ${email} and accepted_at is null and revoked_at is null`);
      const token = newToken();
      const inviteId = uuidv7();
      await tx.execute(sql`
        insert into vendor_invite (id, vendor_id, email, role, token_hash, invited_by)
        values (${inviteId}, ${vendor.id}, ${email}, ${role}, ${await tokenHash(token)}, ${owner.userId})`);
      await audit(tx, {
        actor: owner.userId,
        action: 'vendor_invite.create',
        subjectType: 'vendor',
        subjectId: vendor.id,
        changes: { role: { from: null, to: role } },
      });
      return { inviteId, token, business: vendor.name };
    }),
  );
}

/** Sends the invitation email and records honestly whether it went (sent / failed). */
export async function sendInvite(
  env: ServerEnv,
  siteUrl: string,
  invite: { inviteId: string; token: string; business: string },
  to: string,
  role: TeamRole,
  inviter: string,
): Promise<void> {
  const content = renderEmail('teamInvite', {
    inviter,
    business: invite.business,
    role: TEAM_ROLES[role].name,
    what: TEAM_ROLES[role].what,
    email: to,
    link: `${siteUrl}/team-invite/${invite.token}`,
  });
  const result = await sendEmail(env, { to, ...content, replyTo: TEAM_ADDRESS });
  await withDb(env, (db) =>
    result.sent
      ? db.execute(sql`update vendor_invite set email_status = 'sent' where id = ${invite.inviteId}`)
      : db.execute(sql`update vendor_invite set email_status = 'failed', email_failure = ${result.reason} where id = ${invite.inviteId}`),
  );
}

/** Cancels an open invitation. */
export async function cancelInvite(env: ServerEnv, ownerId: string, slug: string, inviteId: string): Promise<boolean> {
  return withDb(env, (db) =>
    db.transaction(async (tx) => {
      const vendor = await ownedBusiness(tx, ownerId, slug, true);
      if (!vendor) throw new TeamRefused('not found');
      const done = await tx.execute(sql`
        update vendor_invite set revoked_at = now()
        where id = ${inviteId} and vendor_id = ${vendor.id} and accepted_at is null and revoked_at is null returning id`);
      if (done.length === 0) return false;
      await audit(tx, { actor: ownerId, action: 'vendor_invite.revoke', subjectType: 'vendor', subjectId: vendor.id });
      return true;
    }),
  );
}

/** Removes a manager or staff member (never the owner; ownership changes go through the team). */
export async function removeFromTeam(env: ServerEnv, ownerId: string, slug: string, memberId: string): Promise<boolean> {
  return withDb(env, (db) =>
    db.transaction(async (tx) => {
      const vendor = await ownedBusiness(tx, ownerId, slug, true);
      if (!vendor) throw new TeamRefused('not found');
      const [done] = await tx.execute<{ userId: string; role: string }>(sql`
        update vendor_member set ended_at = now()
        where id = ${memberId} and vendor_id = ${vendor.id} and role <> 'owner' and ended_at is null
        returning user_id as "userId", role`);
      if (!done) return false;
      await audit(tx, {
        actor: ownerId,
        action: 'vendor_member.remove',
        subjectType: 'vendor',
        subjectId: vendor.id,
        changes: { member: { from: done.userId, to: null }, role: { from: done.role, to: null } },
      });
      return true;
    }),
  );
}

export type Invitation =
  | { state: 'open'; business: string; slug: string; role: TeamRole; forYou: boolean }
  | { state: 'used' | 'expired' | 'unknown' };

/** What an invitation link is, for the person who opened it (never says whose address it is). */
export async function invitationFor(env: ServerEnv, token: string, email: string): Promise<Invitation> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { state: 'unknown' };
  const hash = await tokenHash(token);
  return withDb(env, async (db) => {
    const [i] = await db.execute<{ business: string; slug: string; role: TeamRole; forYou: boolean; open: boolean; expired: boolean }>(sql`
      select v.display_name as business, v.slug::text as slug, i.role, i.email = ${email} as "forYou",
             i.accepted_at is null and i.revoked_at is null and v.listing_status <> 'archived' as open, i.expires_at <= now() as expired
      from vendor_invite i join vendor v on v.id = i.vendor_id
      where i.token_hash = ${hash}`);
    if (!i) return { state: 'unknown' };
    if (!i.open) return { state: 'used' };
    if (i.expired) return { state: 'expired' };
    return { state: 'open', business: i.business, slug: i.slug, role: i.role, forYou: i.forYou };
  });
}

/** Accepts an invitation, for the signed-in person whose email it was sent to. */
export async function acceptInvite(
  env: ServerEnv,
  person: { userId: string; email: string },
  token: string,
): Promise<{ business: string; slug: string; role: TeamRole }> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new TeamRefused('This invitation link isn’t valid.');
  const hash = await tokenHash(token);
  return withDb(env, (db) =>
    db.transaction(async (tx) => {
      const [i] = await tx.execute<{
        id: string;
        vendorId: string;
        business: string;
        slug: string;
        role: TeamRole;
        invitedBy: string;
        ok: boolean;
        forYou: boolean;
      }>(sql`
        select i.id, i.vendor_id as "vendorId", v.display_name as business, v.slug::text as slug, i.role, i.invited_by as "invitedBy",
               i.accepted_at is null and i.revoked_at is null and i.expires_at > now() and v.listing_status <> 'archived'
               and exists (select 1 from vendor_member o where o.vendor_id = v.id and o.role = 'owner' and o.ended_at is null) as ok,
               i.email = ${person.email} as "forYou"
        from vendor_invite i join vendor v on v.id = i.vendor_id
        where i.token_hash = ${hash}
        for update of i, v`);
      if (!i || !i.ok) throw new TeamRefused('This invitation has expired or has already been used. Ask the owner to send a new one.');
      if (!i.forYou)
        throw new TeamRefused('This invitation was sent to a different email address. Sign in with that address to accept it.');
      const [already] = await tx.execute<{ id: string }>(sql`
        select id from vendor_member where vendor_id = ${i.vendorId} and user_id = ${person.userId} and ended_at is null`);
      if (already) throw new TeamRefused('You’re already on this business’s team.');
      await tx.execute(sql`
        insert into vendor_member (id, vendor_id, user_id, role, added_by) values (${uuidv7()}, ${i.vendorId}, ${person.userId}, ${i.role}, ${i.invitedBy})`);
      await tx.execute(sql`update vendor_invite set accepted_at = now(), accepted_by = ${person.userId} where id = ${i.id}`);
      await audit(tx, {
        actor: person.userId,
        action: 'vendor_member.join',
        subjectType: 'vendor',
        subjectId: i.vendorId,
        changes: { role: { from: null, to: i.role } },
      });
      return { business: i.business, slug: i.slug, role: i.role };
    }),
  );
}

/** This person's role on this business's team now, if any (C6: their own page shows as theirs). */
export async function teamRoleAt(env: ServerEnv, userId: string, vendorId: string): Promise<'owner' | TeamRole | null> {
  const [m] = await withDb(env, (db) =>
    db.execute<{ role: 'owner' | TeamRole }>(sql`
      select role from vendor_member where vendor_id = ${vendorId} and user_id = ${userId} and ended_at is null`),
  );
  return m?.role ?? null;
}

// ------------------------------------------------------------------ stepping back (B6, M18; D-54)

/**
 * The owner hands the business to someone already on its team: they become the owner, and the
 * old owner stays on as a manager (they can leave after). Returns who to email.
 */
export async function handOver(
  env: ServerEnv,
  ownerId: string,
  slug: string,
  memberId: string,
): Promise<{ vendorId: string; business: string; slug: string; to: { userId: string; email: string; name: string } }> {
  return withDb(env, (db) =>
    db.transaction(async (tx) => {
      const vendor = await ownedBusiness(tx, ownerId, slug, true);
      if (!vendor) throw new TeamRefused('not found');
      const [next] = await tx.execute<{ userId: string; email: string; name: string }>(sql`
        select u.id as "userId", u.email::text as email, coalesce(u.given_name, u.display_name) as name
        from vendor_member m join app_user u on u.id = m.user_id
        where m.id = ${memberId} and m.vendor_id = ${vendor.id} and m.role <> 'owner' and m.ended_at is null and u.deleted_at is null
          and not exists (select 1 from account_suspension s where s.user_id = u.id)
        for update of m`);
      if (!next) throw new TeamRefused('Choose someone who is on your team now.');
      // Each hand-over emails the new owner: a few a day per business is plenty.
      const [today] = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from audit_log
        where action = 'vendor_member.hand_over' and subject_id = ${vendor.id} and created_at > now() - interval '1 day'`);
      if ((today?.n ?? 0) >= HAND_OVERS_PER_DAY) throw new TeamRefused('This business has changed hands a lot today. Please try again tomorrow.');
      // One owner at a time (vendor_member_one_owner): the old owner steps down first.
      await tx.execute(sql`
        update vendor_member set role = 'manager' where vendor_id = ${vendor.id} and user_id = ${ownerId} and role = 'owner' and ended_at is null`);
      await tx.execute(sql`update vendor_member set role = 'owner' where id = ${memberId}`);
      await audit(tx, {
        actor: ownerId,
        action: 'vendor_member.hand_over',
        subjectType: 'vendor',
        subjectId: vendor.id,
        changes: { owner: { from: ownerId, to: next.userId } },
      });
      return { vendorId: vendor.id, business: vendor.name, slug: vendor.slug, to: next };
    }),
  );
}

/** The new owner is told (D-54). */
export async function emailNewOwner(
  env: ServerEnv,
  handed: { vendorId: string; business: string; slug: string; to: { userId: string; email: string; name: string } },
  from: string,
  siteUrl: string,
): Promise<void> {
  await emailPerson(
    env,
    { userId: handed.to.userId, email: handed.to.email },
    'ownership_given',
    { type: 'vendor', id: handed.vendorId },
    renderEmail('ownershipGiven', { name: handed.to.name, from, business: handed.business, link: `${siteUrl}/vendors/${handed.slug}/team` }),
  );
}

/**
 * The owner hides the business's page (not listed; messages paused, as when the team unlists it)
 * or shows it again: only a page they hid themselves (the team's decisions stay the team's).
 */
export async function setOwnerHidden(env: ServerEnv, ownerId: string, slug: string, hide: boolean): Promise<void> {
  await withDb(env, (db) =>
    db.transaction(async (tx) => {
      const vendor = await ownedBusiness(tx, ownerId, slug, true);
      if (!vendor) throw new TeamRefused('not found');
      if (hide ? vendor.status !== 'published' : !vendor.ownerHidden) {
        throw new TeamRefused(hide ? 'Your page isn’t showing at the moment.' : 'Only a page you hid yourself can be shown again here.');
      }
      const to = hide ? 'unpublished' : 'published';
      await tx.execute(sql`
        update vendor set listing_status = ${to}, owner_hidden_at = ${hide ? sql`now()` : sql`null`},
               published_at = case when ${to} = 'published' then coalesce(published_at, now()) else published_at end
        where id = ${vendor.id}`);
      await tx.execute(sql`
        insert into status_change (id, subject_type, subject_id, field, from_status, to_status, actor_user_id, actor_kind, reason)
        values (${uuidv7()}, 'vendor', ${vendor.id}, 'listing_status', ${vendor.status}, ${to}, ${ownerId}, 'vendor',
                ${hide ? 'The owner hid the page.' : 'The owner showed the page again.'})`);
      await audit(tx, {
        actor: ownerId,
        action: hide ? 'vendor.owner_hide' : 'vendor.owner_show',
        subjectType: 'vendor',
        subjectId: vendor.id,
        changes: { listing_status: { from: vendor.status, to } },
      });
    }),
  );
}

/**
 * An owner with no one else on the team takes the business off Localites: the page is archived
 * (as when the team removes a listing; to come back, it's added again), the business is unclaimed and their place on it ends, as when
 * the team removes an owner. Its conversations end (0025).
 */
export async function takeOffLocalites(env: ServerEnv, ownerId: string, slug: string): Promise<void> {
  await withDb(env, (db) =>
    db.transaction(async (tx) => {
      const vendor = await ownedBusiness(tx, ownerId, slug, true);
      if (!vendor) throw new TeamRefused('not found');
      const [others] = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from vendor_member where vendor_id = ${vendor.id} and ended_at is null and user_id <> ${ownerId}`);
      if ((others?.n ?? 0) > 0) throw new TeamRefused('Hand the business to someone on your team, or remove them first.');
      await tx.execute(sql`update vendor_member set ended_at = now() where vendor_id = ${vendor.id} and user_id = ${ownerId} and ended_at is null`);
      await tx.execute(sql`
        update vendor set listing_status = 'archived', archived_at = now(), claim_status = 'unclaimed', owner_hidden_at = null
        where id = ${vendor.id}`);
      await tx.execute(sql`
        insert into status_change (id, subject_type, subject_id, field, from_status, to_status, actor_user_id, actor_kind, reason)
        values (${uuidv7()}, 'vendor', ${vendor.id}, 'listing_status', ${vendor.status}, 'archived', ${ownerId}, 'vendor',
                'The owner took the business off Localites.'),
               (${uuidv7()}, 'vendor', ${vendor.id}, 'claim_status', 'claimed', 'unclaimed', ${ownerId}, 'vendor',
                'The owner took the business off Localites.')`);
      await audit(tx, {
        actor: ownerId,
        action: 'vendor.owner_take_off',
        subjectType: 'vendor',
        subjectId: vendor.id,
        changes: { listing_status: { from: vendor.status, to: 'archived' }, claimStatus: { from: 'claimed', to: 'unclaimed' } },
      });
    }),
  );
}

/** A manager or staff member leaves a business's team (the owner hands over first). */
export async function leaveTeam(env: ServerEnv, userId: string, vendorId: string): Promise<void> {
  await withDb(env, (db) =>
    db.transaction(async (tx) => {
      const [done] = await tx.execute<{ role: string }>(sql`
        update vendor_member set ended_at = now()
        where vendor_id = ${vendorId} and user_id = ${userId} and role <> 'owner' and ended_at is null
        returning role`);
      if (!done) throw new TeamRefused('not found');
      await audit(tx, {
        actor: userId,
        action: 'vendor_member.leave',
        subjectType: 'vendor',
        subjectId: vendorId,
        changes: { member: { from: userId, to: null }, role: { from: done.role, to: null } },
      });
    }),
  );
}
