import { sql } from 'drizzle-orm';
import { addDays, torontoDate } from '@/lib/activity';
import { type Db, withDb } from './db.server';
import type { ServerEnv } from './env';

/**
 * The nightly count (ADR-023, ADR-030): adds each finished Toronto day's activity into the
 * totals that reports read. Run by Cloudflare's scheduler with the daily note. Each day is
 * claimed first (activity_rollup), so a day is counted once, a failed day is retried by
 * the next run, and up to a week of missed days catch up by themselves.
 */

const CATCH_UP_DAYS = 7;

/**
 * Counts one day, taking turns with anyone else counting the same day (the team's "Count
 * this day again" during the morning run), so the two never clash.
 */
export async function countDay(db: Db, day: string): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`activity_rollup:${day}`}, 0))`);
    const [counted] = await tx.execute<{ n: number }>(sql`select activity_rollup_day(${day}::date) as n`);
    return counted?.n ?? 0;
  });
}

export async function runActivityRollup(env: ServerEnv): Promise<string> {
  const today = torontoDate(new Date());
  const days = Array.from({ length: CATCH_UP_DAYS }, (_, i) => addDays(today, -(CATCH_UP_DAYS - i)));
  // One connection for the whole job (each costs time from the run's small budget).
  return withDb(env, async (db) => {
    const done = new Set(
      (
        await db.execute<{ day: string }>(sql`
          select day::text as day from activity_rollup where status = 'done' and day >= ${days[0]}::date`)
      ).map((r) => r.day),
    );
    const outcome: string[] = [];
    for (const day of days.filter((d) => !done.has(d))) {
      const [claimed] = await db.execute<{ day: string }>(sql`
        insert into activity_rollup (day, status) values (${day}::date, 'running')
        on conflict (day) do update set status = 'running', started_at = now(), finished_at = null, failure_reason = null
        where activity_rollup.status = 'failed'
           or (activity_rollup.status = 'running' and activity_rollup.started_at < now() - interval '30 minutes')
        returning day::text as day`);
      if (!claimed) continue;
      try {
        const counted = await countDay(db, day);
        await db.execute(sql`
          update activity_rollup set status = 'done', events = ${counted}, finished_at = now() where day = ${day}::date`);
        outcome.push(`${day} done`);
      } catch (err) {
        const reason = (err instanceof Error ? err.message : 'unknown error').slice(0, 300);
        await db.execute(sql`
          update activity_rollup set status = 'failed', failure_reason = ${reason}, finished_at = now() where day = ${day}::date`);
        outcome.push(`${day} failed`);
      }
    }
    return outcome.join(', ') || 'nothing to count';
  });
}
