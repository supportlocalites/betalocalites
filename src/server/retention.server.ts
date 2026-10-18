import { sql } from 'drizzle-orm';
import { withDb } from './db.server';
import type { ServerEnv } from './env';

export type Deleted = { emails: number; audit: number; conversations: number; suggestions: number };

/**
 * The deletions the privacy policy promises (E §8, migration 0041), each morning: email records
 * after 1 year, the team's change log after 2, conversations 3 years after the last message (not
 * reported ones), and a declined suggestion's contact details after 1. The database decides what's
 * old enough; this only asks it to run. A kind that failed comes back as -1 (the others still ran),
 * and is logged as an error so the site watch's log shows it.
 */
export async function runScheduledDeletions(env: ServerEnv): Promise<Deleted> {
  const [row] = await withDb(env, (db) => db.execute<Deleted>(sql`select * from run_scheduled_deletions()`));
  const outcome = row ?? { emails: 0, audit: 0, conversations: 0, suggestions: 0 };
  const failed = Object.entries(outcome).filter(([, n]) => n < 0).map(([kind]) => kind);
  if (failed.length > 0) console.error('scheduled deletions failed for:', failed.join(', '));
  return outcome;
}
