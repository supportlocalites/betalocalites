import { sql } from 'drizzle-orm';
import { actingAs, errorCode } from '../acting.server';
import type { Admin } from '../auth/admin.server';
import type { ServerEnv } from '../env';
import { audit } from './audit.server';

/**
 * Admin → Accounts (migration 0042): find an account by its email, and suspend it or lift a
 * suspension. Writes go only through suspend_account and lift_suspension, which run as the team,
 * refuse yourself, team members and deleted accounts, and write audit_log in the same
 * transaction. Each look-up is recorded too. Callers must have passed adminGate.
 */

export type Account = {
  userId: string;
  name: string;
  email: string;
  joined: string;
  onTeam: boolean;
  businesses: string[];
  suspension: { reason: string; at: string; by: string } | null;
};

export type Suspended = { userId: string; name: string; email: string; reason: string; at: string; by: string };

/** Plain words for each refusal the database can give. */
const REFUSALS: Record<string, string> = {
  LP101: 'Only the Localites team can do this. Please sign in again.',
  LP166: 'Say why, in up to 300 characters.',
  LP177: 'You can’t suspend your own account.',
  LP178: 'There’s no such account (it may have just been deleted).',
  LP179: 'That person is on the Localites team. Remove their team role on Users and roles first.',
  LP180: 'That account is already suspended. Reload the page.',
  LP181: 'That account isn’t suspended (someone may have just lifted it). Reload the page.',
};

export class AccountRefused extends Error {}

function refusal(err: unknown): never {
  const code = errorCode(err);
  if (code && REFUSALS[code]) throw new AccountRefused(REFUSALS[code]);
  throw err;
}

/** The account using this email, if any; the look is recorded (who looked, never the email typed). */
export async function findAccount(env: ServerEnv, admin: Admin, email: string): Promise<Account | null> {
  return actingAs(env, { side: 'team', userId: admin.userId }, async (tx) => {
    const [row] = await tx.execute<Omit<Account, 'suspension'> & { reason: string | null; at: string | null; by: string | null }>(sql`
      select u.id as "userId", u.display_name as name, u.email::text as email, u.created_at::text as joined,
             exists (select 1 from platform_role r where r.user_id = u.id and r.revoked_at is null) as "onTeam",
             coalesce((select json_agg(v.display_name order by v.display_name) from vendor_member m join vendor v on v.id = m.vendor_id
                       where m.user_id = u.id and m.ended_at is null), '[]'::json) as businesses,
             s.reason, s.suspended_at::text as at, b.display_name as by
      from app_user u
        left join account_suspension s on s.user_id = u.id
        left join app_user b on b.id = s.suspended_by
      where u.email = ${email}::citext and u.deleted_at is null`);
    await audit(tx, { actor: admin.userId, action: 'account.look', subjectType: 'app_user', subjectId: row?.userId ?? null });
    if (!row) return null;
    const { reason, at, by, ...account } = row;
    return { ...account, suspension: reason && at ? { reason, at, by: by ?? 'A former team member' } : null };
  });
}

/** Everyone suspended now, newest first. */
export async function suspendedAccounts(env: ServerEnv, admin: Admin): Promise<Suspended[]> {
  return actingAs(env, { side: 'team', userId: admin.userId }, async (tx) => [
    ...(await tx.execute<Suspended>(sql`
      select u.id as "userId", u.display_name as name, u.email::text as email, s.reason, s.suspended_at::text as at,
             coalesce(b.display_name, 'A former team member') as by
      from account_suspension s join app_user u on u.id = s.user_id left join app_user b on b.id = s.suspended_by
      order by s.suspended_at desc`)),
  ]);
}

export async function suspendAccount(env: ServerEnv, admin: Admin, userId: string, reason: string): Promise<void> {
  await actingAs(env, { side: 'team', userId: admin.userId }, async (tx) => {
    await tx.execute(sql`select suspend_account(${userId}::uuid, ${reason})`);
  }).catch(refusal);
}

export async function liftSuspension(env: ServerEnv, admin: Admin, userId: string, reason: string): Promise<void> {
  await actingAs(env, { side: 'team', userId: admin.userId }, async (tx) => {
    await tx.execute(sql`select lift_suspension(${userId}::uuid, ${reason})`);
  }).catch(refusal);
}
