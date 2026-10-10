import { sql } from 'drizzle-orm';
import { withDb } from '../db.server';
import type { ServerEnv } from '../env';
import { CODE_MINUTES } from '../member-input';

/**
 * Our own limits on emailed sign-in codes (ADR-028). Supabase limits requests per internet
 * address and waits 60 seconds between codes to one address, but has no limit on wrong
 * guesses per code. Addresses are kept only as a hash; internet addresses never.
 */
export const CODES_PER_ADDRESS_PER_HOUR = 3;
export const WRONG_GUESSES_PER_CODE = 5;
/** All sign-in codes in a day, leaving room in Resend's 100 a day for other emails. */
export const CODES_PER_DAY = 60;

export async function addressHash(email: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

export type SendCheck = 'ok' | 'address_limit' | 'daily_limit';

export async function checkCodeSend(env: ServerEnv, hash: string): Promise<SendCheck> {
  const [row] = await withDb(env, (db) =>
    db.execute<{ address: number; today: number }>(sql`
      select count(*) filter (where email_hash = ${hash} and created_at > now() - interval '1 hour')::int as address,
             count(*)::int as today
      from sign_in_code_event
      where kind = 'sent' and created_at > now() - interval '1 day'`),
  );
  if ((row?.today ?? 0) >= CODES_PER_DAY) return 'daily_limit';
  if ((row?.address ?? 0) >= CODES_PER_ADDRESS_PER_HOUR) return 'address_limit';
  return 'ok';
}

/** A code may be tried only if one was sent recently and it hasn't had too many wrong guesses. */
export async function canTryCode(env: ServerEnv, hash: string): Promise<boolean> {
  const [row] = await withDb(env, (db) =>
    db.execute<{ lastSent: string | null; wrong: number }>(sql`
      with last as (
        select max(created_at) as at from sign_in_code_event where email_hash = ${hash} and kind = 'sent'
      )
      select (select at from last)::text as "lastSent",
             (select count(*) from sign_in_code_event e, last
              where e.email_hash = ${hash} and e.kind = 'wrong_code' and e.created_at >= last.at)::int as wrong`),
  );
  if (!row?.lastSent) return false;
  if (Date.now() - new Date(row.lastSent).getTime() > CODE_MINUTES * 60_000) return false;
  return row.wrong < WRONG_GUESSES_PER_CODE;
}

/**
 * Whether a code went to this address in the last minute. Supabase gives the same answer
 * for "wait a minute between codes" and "too many emails from the whole site", so this
 * tells them apart without saying anything about the address.
 */
export async function sentWithinMinute(env: ServerEnv, hash: string): Promise<boolean> {
  const [row] = await withDb(env, (db) =>
    db.execute<{ ok: boolean }>(sql`
      select exists (select 1 from sign_in_code_event
                     where email_hash = ${hash} and kind = 'sent' and created_at > now() - interval '65 seconds') as ok`),
  );
  return Boolean(row?.ok);
}

export async function recordCodeEvent(env: ServerEnv, hash: string, kind: 'sent' | 'wrong_code'): Promise<void> {
  await withDb(env, async (db) => {
    await db.execute(sql`insert into sign_in_code_event (email_hash, kind) values (${hash}, ${kind})`);
    // Keep only two days: enough for the limits above.
    await db.execute(sql`delete from sign_in_code_event where created_at < now() - interval '2 days'`);
  });
}
