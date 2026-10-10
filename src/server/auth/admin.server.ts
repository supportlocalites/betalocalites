import { sql } from 'drizzle-orm';
import { data, redirect } from 'react-router';
import { withDb } from '../db.server';
import type { ServerEnv } from '../env';
import { type AuthUser, signOut } from './gotrue.server';
import { clearedCookies, loadSession, pagePath, withCookies } from './session.server';

/** Admins sign in again after this long, even if their session is still valid. */
export const ADMIN_SESSION_HOURS = 12;

export type Admin = { userId: string; email: string; name: string; sessionId: string | null };

/**
 * The only way into the admin pages (E §1–3). Every admin request, page or form,
 * passes all four checks on the server; hiding links is never the control:
 *   1. a valid Supabase session (checked with Supabase, so signing out takes effect at once);
 *   2. signed in with a password (not an emailed code) within the last ADMIN_SESSION_HOURS;
 *   3. an active admin role in our own database (platform_role), not anything the person can edit;
 *   4. the two-step code from their authenticator app for this session (aal2).
 * Throws a redirect or a 403 for the router to send. Returns cookies to set (after a refresh).
 */
export async function adminGate(request: Request, env: ServerEnv): Promise<{ admin: Admin; setCookies: string[] }> {
  const here = encodeURIComponent(pagePath(request));
  const { session, setCookies } = await loadSession(request, env);
  if (!session) throw redirect(`/sign-in?next=${here}`, withCookies(undefined, setCookies));

  // Signed in with an emailed code (the public sign-in) or too long ago: the team sign-in again.
  const hours = session.claims.passwordAt ? (Date.now() / 1000 - session.claims.passwordAt) / 3600 : Infinity;
  if (hours > ADMIN_SESSION_HOURS) {
    await signOut(env, session.accessToken).catch(() => undefined);
    const why = session.claims.passwordAt ? 'expired=1' : 'team=1';
    throw redirect(`/sign-in?next=${here}&${why}`, withCookies(undefined, clearedCookies()));
  }

  const [member] = await withDb(env, (db) =>
    db.execute<{ name: string; isAdmin: boolean }>(sql`
      select u.display_name as name,
             exists (select 1 from platform_role r
                     where r.user_id = u.id and r.role = 'admin' and r.revoked_at is null) as "isAdmin"
      from app_user u
      where u.id = ${session.user.id} and u.deleted_at is null
    `),
  );
  if (!member?.isAdmin) throw data({ reason: 'not_team' }, withCookies({ status: 403 }, setCookies));

  if (session.claims.aal !== 'aal2') throw redirect(`/two-step?next=${here}`, withCookies(undefined, setCookies));

  return {
    admin: { userId: session.user.id, email: session.user.email, name: member.name, sessionId: session.claims.sessionId },
    setCookies,
  };
}

/** Keeps our own record of the person (app_user) in step with their sign-in account. */
export async function rememberUser(env: ServerEnv, user: AuthUser): Promise<void> {
  await withDb(env, (db) =>
    db.execute(sql`
      insert into app_user (id, display_name, email)
      values (${user.id}, ${user.displayName}, ${user.email})
      on conflict (id) do update set email = excluded.email
    `),
  );
}

export async function isAdmin(env: ServerEnv, userId: string): Promise<boolean> {
  const [row] = await withDb(env, (db) =>
    db.execute<{ ok: boolean }>(sql`
      select exists (select 1 from platform_role
                     where user_id = ${userId} and role = 'admin' and revoked_at is null) as ok
    `),
  );
  return Boolean(row?.ok);
}
