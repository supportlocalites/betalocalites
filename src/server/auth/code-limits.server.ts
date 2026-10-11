import { sql } from 'drizzle-orm';
import type { Db } from '../db.server';
import { withDb } from '../db.server';
import type { ServerEnv } from '../env';
import { CODE_MINUTES } from '../member-input';

/**
 * Our own limits on emailed sign-in codes (ADR-028). Supabase limits requests per internet
 * address and waits 60 seconds between codes to one address, but has no limit on wrong
 * guesses per code. Addresses are kept only as a SHA-256 fingerprint; internet addresses
 * never.
 *
 * Each request and each guess is counted BEFORE Supabase is asked, under a lock per
 * address, so that (1) many guesses sent at the same moment can't get past the limit, and
 * (2) the limits behave the same whatever Supabase does with the address, so they never
 * reveal whether it has an account.
 */
export const CODES_PER_ADDRESS_PER_HOUR = 3;
export const WRONG_GUESSES_PER_CODE = 5;
/** All sign-in codes in a day, leaving room in Resend's 100 a day for other emails. */
export const CODES_PER_DAY = 60;

export async function addressHash(email: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Holds a lock on one address until the transaction ends, so its counts can't race. */
const lockAddress = (tx: Db, hash: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${hash}, 0))`);

export type SendCheck = 'ok' | 'address_limit' | 'daily_limit';

/**
 * Counts a request for a code, if the limits allow it. "sent" rows record requests that
 * passed our limits, whether or not Supabase then sent an email.
 */
export async function claimCodeSend(env: ServerEnv, hash: string): Promise<{ check: SendCheck; recentlyAsked: boolean }> {
  return withDb(env, (db) =>
    db.transaction(async (tx) => {
      await lockAddress(tx, hash);
      const [row] = await tx.execute<{ address: number; minute: number; today: number }>(sql`
        select count(*) filter (where email_hash = ${hash} and created_at > now() - interval '1 hour')::int as address,
               count(*) filter (where email_hash = ${hash} and created_at > now() - interval '65 seconds')::int as minute,
               count(*)::int as today
        from sign_in_code_event
        where kind = 'sent' and created_at > now() - interval '1 day'`);
      const recentlyAsked = (row?.minute ?? 0) > 0;
      if ((row?.today ?? 0) >= CODES_PER_DAY) return { check: 'daily_limit', recentlyAsked };
      if ((row?.address ?? 0) >= CODES_PER_ADDRESS_PER_HOUR) return { check: 'address_limit', recentlyAsked };
      await tx.execute(sql`insert into sign_in_code_event (email_hash, kind) values (${hash}, 'sent')`);
      // Keep only two days: enough for the limits above.
      await tx.execute(sql`delete from sign_in_code_event where created_at < now() - interval '2 days'`);
      return { check: 'ok', recentlyAsked };
    }),
  );
}

/**
 * Counts one guess at a code, if the address may still guess: a code was asked for within
 * CODE_MINUTES and fewer than WRONG_GUESSES_PER_CODE guesses were made since. Returns the
 * guess's row (removed again by `guessWasRight`), or null if no guess is allowed.
 */
export async function claimCodeGuess(env: ServerEnv, hash: string): Promise<number | null> {
  return withDb(env, (db) =>
    db.transaction(async (tx) => {
      await lockAddress(tx, hash);
      const [row] = await tx.execute<{ fresh: boolean; guesses: number }>(sql`
        with last as (
          select max(created_at) as at from sign_in_code_event where email_hash = ${hash} and kind = 'sent'
        )
        select coalesce((select at from last) > now() - make_interval(mins => ${CODE_MINUTES}), false) as fresh,
               (select count(*) from sign_in_code_event e, last
                where e.email_hash = ${hash} and e.kind = 'wrong_code' and e.created_at >= last.at)::int as guesses`);
      if (!row?.fresh || row.guesses >= WRONG_GUESSES_PER_CODE) return null;
      const [guess] = await tx.execute<{ id: number }>(sql`
        insert into sign_in_code_event (email_hash, kind) values (${hash}, 'wrong_code') returning id::int as id`);
      return guess?.id ?? null;
    }),
  );
}

/** The guess was right: it no longer counts as a wrong one. */
export async function guessWasRight(env: ServerEnv, id: number): Promise<void> {
  await withDb(env, (db) => db.execute(sql`delete from sign_in_code_event where id = ${id} and kind = 'wrong_code'`));
}
