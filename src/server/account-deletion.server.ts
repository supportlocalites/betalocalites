import { sql } from 'drizzle-orm';
import { actingAs, errorCode } from './acting.server';
import type { Admin } from './auth/admin.server';
import { withDb } from './db.server';
import type { ServerEnv } from './env';
import { audit } from './admin/audit.server';

/**
 * A person deletes their own account (E §8, D-10; migration 0014). Everything in our
 * database happens in one database function, run as the person themselves: their events,
 * plans and saves are deleted, their name, email and personal details erased, businesses
 * they owned go back to unclaimed, and the team is told to remove the Supabase sign-in
 * record by hand (the site doesn't hold Supabase's admin key).
 */

/** Whether this person is on the Localites team (they can't delete their account here). */
export async function onLocalitesTeam(env: ServerEnv, userId: string): Promise<boolean> {
  const [r] = await withDb(env, (db) =>
    db.execute<{ team: boolean }>(sql`
      select exists (select 1 from platform_role where user_id = ${userId} and revoked_at is null) as team`),
  );
  return r?.team ?? false;
}

export type DeleteResult = 'deleted' | 'team' | 'closed';

export async function deleteMyAccount(env: ServerEnv, userId: string): Promise<DeleteResult> {
  try {
    await actingAs(env, { side: 'person', userId }, (tx) => tx.execute(sql`select delete_my_account()`));
    return 'deleted';
  } catch (err) {
    const code = errorCode(err);
    if (code === 'LP121') return 'team';
    if (code === 'LP109') return 'closed';
    throw err;
  }
}

// ------------------------------------------------------------------ the team's list

export type AccountDeletion = { userId: string; requestedAt: string; removedAt: string | null; removedBy: string | null };

/** People who deleted their account, sign-in record still to remove first. Callers must have passed adminGate. */
export async function accountDeletions(env: ServerEnv, admin: Admin): Promise<AccountDeletion[]> {
  return actingAs(env, { side: 'team', userId: admin.userId }, async (tx) => [
    ...(await tx.execute<AccountDeletion>(sql`
      select d.user_id as "userId", d.requested_at::text as "requestedAt", d.auth_removed_at::text as "removedAt",
             u.display_name as "removedBy"
      from account_deletion d left join app_user u on u.id = d.auth_removed_by
      order by d.auth_removed_at is not null, d.requested_at desc
      limit 200`)),
  ]);
}

/** The team removed the person's sign-in record in Supabase. Recorded once, in the audit log. */
export async function markSignInRemoved(env: ServerEnv, admin: Admin, userId: string): Promise<boolean> {
  return actingAs(env, { side: 'team', userId: admin.userId }, async (tx) => {
    const done = await tx.execute(sql`
      update account_deletion set auth_removed_at = now() where user_id = ${userId} and auth_removed_at is null returning user_id`);
    if (done.length === 0) return false;
    await audit(tx, {
      actor: admin.userId,
      action: 'account.sign_in_removed',
      subjectType: 'app_user',
      subjectId: userId,
      sessionRef: admin.sessionId,
    });
    return true;
  });
}

/** How many are still to do, for the admin menu. */
export async function countPendingDeletions(env: ServerEnv, admin: Admin): Promise<number> {
  return actingAs(env, { side: 'team', userId: admin.userId }, async (tx) => {
    const [n] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from account_deletion where auth_removed_at is null`);
    return n?.n ?? 0;
  });
}
