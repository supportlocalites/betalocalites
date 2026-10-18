import { sql } from 'drizzle-orm';
import { actingAs, errorCode } from '../acting.server';
import type { Admin } from '../auth/admin.server';
import type { ServerEnv } from '../env';

/**
 * Admin → Users & roles (X10; migration 0035): who is on the Localites team, and adding or
 * removing an admin. Writes go only through grant_team_admin and revoke_team_admin, which run
 * as the team, refuse anyone removing themselves, and write audit_log in the same
 * transaction; the app can't write platform_role itself. Callers must have passed adminGate.
 */

export type TeamMember = {
  userId: string;
  name: string;
  email: string;
  since: string;
  grantedBy: string | null;
  /** When their role ended; null while they're on the team. */
  endedAt: string | null;
};

/** Plain words for each refusal the database can give. */
const REFUSALS: Record<string, string> = {
  LP101: 'Only the Localites team can change the team. Please sign in again.',
  LP166: 'Say why, in up to 300 characters.',
  LP167: 'No Localites account uses that email. Ask them to sign in to Localites once first, then add them here.',
  LP168: 'That person is already on the team.',
  LP169: 'You can’t remove yourself. Ask another admin to do it.',
  LP170: 'That person isn’t on the team (someone may have just removed them). Reload the page.',
};

export class TeamRefused extends Error {}

function refusal(err: unknown): never {
  const code = errorCode(err);
  if (code && REFUSALS[code]) throw new TeamRefused(REFUSALS[code]);
  throw err;
}

/** Everyone on the team now, then everyone who was (each person's latest role only). */
export async function teamMembers(env: ServerEnv, admin: Admin): Promise<TeamMember[]> {
  return actingAs(env, { side: 'team', userId: admin.userId }, async (tx) => {
    const rows = await tx.execute<TeamMember>(sql`
      select distinct on (r.user_id)
             r.user_id as "userId", u.display_name as name, u.email::text as email, r.granted_at::text as since,
             g.display_name as "grantedBy", r.revoked_at::text as "endedAt"
      from platform_role r
        join app_user u on u.id = r.user_id and u.deleted_at is null
        left join app_user g on g.id = r.granted_by
      where r.role = 'admin'
      order by r.user_id, (r.revoked_at is null) desc, r.granted_at desc`);
    return [...rows].sort((a, b) => Number(a.endedAt !== null) - Number(b.endedAt !== null) || a.name.localeCompare(b.name));
  });
}

export async function addTeamAdmin(env: ServerEnv, admin: Admin, email: string, reason: string): Promise<void> {
  await actingAs(env, { side: 'team', userId: admin.userId }, async (tx) => {
    await tx.execute(sql`select grant_team_admin(${email}, ${reason})`);
  }).catch(refusal);
}

export async function removeTeamAdmin(env: ServerEnv, admin: Admin, userId: string, reason: string): Promise<void> {
  await actingAs(env, { side: 'team', userId: admin.userId }, async (tx) => {
    await tx.execute(sql`select revoke_team_admin(${userId}::uuid, ${reason})`);
  }).catch(refusal);
}
