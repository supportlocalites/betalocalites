import { sql } from 'drizzle-orm';
import { redirect } from 'react-router';
import { withDb } from '../db.server';
import type { ServerEnv } from '../env';
import { countedBrowser, linkVisitor, trackingOn } from '../activity.server';
import type { Names, Profile } from '../member-input';
import { writeProfile } from '../profile.server';
import { loadSession, pagePath, withCookies } from './session.server';

export type Member = {
  userId: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  accessToken: string;
  /** On a business's team now (C6, D-54): the header offers My business. */
  onTeam: boolean;
};

type Person = {
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  closed: boolean;
  suspended: boolean;
  onTeam: boolean;
};

/**
 * Our own record of a person (app_user), if they've finished joining. With a browser id,
 * also remembers that browser is theirs (activity counting leaves their own visits out).
 */
export async function findPerson(env: ServerEnv, userId: string, visitorId: string | null = null): Promise<Person | null> {
  const [person] = await withDb(env, (db) =>
    db.execute<Person>(sql`
      ${linkVisitor(visitorId, userId)}select display_name as name, given_name as "firstName", family_name as "lastName", email::text as email,
             deleted_at is not null as closed,
             exists (select 1 from account_suspension s where s.user_id = app_user.id) as suspended,
             exists (select 1 from vendor_member m where m.user_id = app_user.id and m.ended_at is null) as "onTeam"
      from app_user where id = ${userId}`),
  );
  return person ?? null;
}

/**
 * Creates our record of a person once they've proved their email address (a code) and
 * told us their name (ADR-028), with any personal details they chose to give (D-36), in
 * one transaction. The name is kept only here, never in Supabase.
 */
export async function createPerson(env: ServerEnv, user: { id: string; email: string }, names: Names, profile: Profile): Promise<void> {
  await withDb(env, (db) =>
    db.transaction(async (tx) => {
      const created = await tx.execute(sql`
        insert into app_user (id, display_name, given_name, family_name, email)
        values (${user.id}, ${names.display}, ${names.firstName}, ${names.lastName}, ${user.email})
        on conflict (id) do nothing returning id`);
      if (created.length > 0) await writeProfile(tx, user.id, profile);
    }),
  );
}

/** Updates the person's own name and details (Your account). */
export async function updatePerson(env: ServerEnv, userId: string, names: Names, profile: Profile): Promise<void> {
  await withDb(env, (db) =>
    db.transaction(async (tx) => {
      const updated = await tx.execute(sql`
        update app_user set display_name = ${names.display}, given_name = ${names.firstName}, family_name = ${names.lastName}
        where id = ${userId} and deleted_at is null returning id`);
      if (updated.length > 0) await writeProfile(tx, userId, profile);
    }),
  );
}

/** What a suspended person can still do: get a copy of their data, or delete their account. */
const OPEN_WHILE_SUSPENDED = new Set(['/account/data', '/account/data/download', '/account/delete']);

/**
 * For pages that need an account (D-27): a live Supabase session and our own record of
 * the person. Anyone else is sent to "Sign in or create an account" and brought back
 * here afterwards.
 */
export async function memberGate(request: Request, env: ServerEnv): Promise<{ member: Member; setCookies: string[] }> {
  const back = `/join?next=${encodeURIComponent(pagePath(request))}`;
  const { session, setCookies } = await loadSession(request, env);
  if (!session) throw redirect(back, withCookies(undefined, setCookies));
  const browser = trackingOn(env) ? await countedBrowser(env, request) : null;
  const person = await findPerson(env, session.user.id, browser?.id ?? null);
  if (!person || person.closed) throw redirect(back, withCookies(undefined, setCookies));
  // Suspended by the team (migration 0042): only their own data and deleting the account stay open.
  if (person.suspended && !OPEN_WHILE_SUSPENDED.has(new URL(request.url).pathname)) {
    throw redirect('/suspended', withCookies(undefined, setCookies));
  }
  if (browser?.setCookie) setCookies.push(browser.setCookie);
  const member = {
    userId: session.user.id,
    name: person.name,
    firstName: person.firstName,
    lastName: person.lastName,
    email: person.email,
    accessToken: session.accessToken,
    onTeam: person.onTeam,
  };
  return { member, setCookies };
}
