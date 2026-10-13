import { sql } from 'drizzle-orm';
import { isUuid } from '@/lib/ids.mjs';
import { PLAN_REFUSALS } from '@/lib/plan-terms';
import { type Db, withDb } from './db.server';
import type { ServerEnv } from './env';

/**
 * Who is acting, told to the database (ADR-031). Events, plans, saved businesses, event
 * types and featured placements are read and written only inside actAs/actingAs: the
 * database's own rules (migration 0012) give nobody any rows otherwise. The side comes
 * from the page (My events: person; Bookings marked: business; /admin: team), never from
 * anything the browser sends.
 */

export type Acting =
  | { side: 'person'; userId: string }
  | { side: 'business'; userId: string; vendorId: string }
  | { side: 'team'; userId: string };

const SIDES: readonly string[] = ['person', 'business', 'team'];

/**
 * One transaction on an open connection, the database told who is acting first. The
 * settings are transaction-local (set_config(..., true)): they end with it, which is safe
 * with Hyperdrive and Supabase's pooler.
 */
export function actAs<T>(db: Db, who: Acting, fn: (tx: Db) => Promise<T>): Promise<T> {
  const vendorId = who.side === 'business' ? who.vendorId : '';
  // Fixed words and real ids only: nothing else may reach the settings.
  if (!SIDES.includes(who.side) || !isUuid(who.userId) || (who.side === 'business' && !isUuid(vendorId))) {
    throw new Error('actAs: unknown side or id');
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      select set_config('localites.user_id', ${who.userId}, true), set_config('localites.side', ${who.side}, true),
             set_config('localites.vendor_id', ${vendorId}, true)`);
    return fn(tx as unknown as Db);
  });
}

/** The same, on a connection made for this request. */
export function actingAs<T>(env: ServerEnv, who: Acting, fn: (tx: Db) => Promise<T>): Promise<T> {
  return withDb(env, (db) => actAs(db, who, fn));
}

/** Another person's event, plan row or business looks missing: the page answers 404. */
export class PlanNotFound extends Error {
  readonly status = 404;
}
/** Refused for a reason the person can act on; the message is the plain words to show (409). */
export class PlanRefused extends Error {
  readonly status = 409;
}
/** A per-person cap was reached; the message is the plain words to show (429). */
export class PlanCapped extends Error {
  readonly status = 429;
}
export type PlanFailure = PlanNotFound | PlanRefused | PlanCapped;

/** The Postgres error code (SQLSTATE), however the driver wraps it (as isUniqueViolation). */
export function errorCode(err: unknown): string | null {
  for (let e = err; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return null;
}

/**
 * Turns a database refusal into one of the above; rethrows anything else. "Not yours"
 * (LP101), a missing right (42501) and a plan row pointing at someone else's event
 * (23503) all look like "not found", and are logged: they mean a bug or a forged request.
 */
export function planFailure(err: unknown): PlanFailure {
  if (err instanceof PlanNotFound || err instanceof PlanRefused || err instanceof PlanCapped) return err;
  const code = errorCode(err);
  if (code === 'LP101' || code === '42501' || code === '23503') {
    console.error('plan refused as not found:', code);
    return new PlanNotFound();
  }
  if (code === '23505') return new PlanRefused(PLAN_REFUSALS.duplicate);
  if (code && /^LP\d{3}$/.test(code) && PLAN_REFUSALS[code]) return new PlanRefused(PLAN_REFUSALS[code]);
  throw err;
}

/** Runs a planning step and turns any database refusal into a PlanFailure (see planFailure). */
export async function planned<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (err) {
    throw planFailure(err);
  }
}
