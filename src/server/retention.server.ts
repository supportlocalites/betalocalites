import { sql } from 'drizzle-orm';
import { withDb } from './db.server';
import type { ServerEnv } from './env';

export type Deleted = {
  emails: number;
  audit: number;
  conversations: number;
  suggestions: number;
  releasedFiles: number;
  erasedReviews: number;
};

/**
 * The deletions the privacy policy promises (E §8, migration 0041), each morning: email records
 * after 1 year, the team's change log after 2, conversations 3 years after the last message (not
 * reported ones), a declined suggestion's contact details after 1, and files kept for a report 90
 * days after the team closed it (migration 0045). The database decides what's
 * old enough; this only asks it to run. A kind that failed comes back as -1 (the others still ran),
 * and is logged as an error so the site watch's log shows it.
 */
export async function runScheduledDeletions(env: ServerEnv): Promise<Deleted> {
  const outcome = await withDb(env, async (db) => {
    const [row] = await db.execute<Omit<Deleted, 'releasedFiles' | 'erasedReviews'>>(sql`select * from run_scheduled_deletions()`);
    // Files kept for a report, 90 days after the team closed it (migration 0045): the nightly
    // file clean-up then deletes them.
    const [released] = await db.execute<{ n: number }>(sql`select release_report_files() as n`);
    // A declined review's words, 30 days after the team declined it (migration 0046).
    const [erased] = await db.execute<{ n: number }>(sql`select erase_declined_review_words() as n`);
    return {
      ...(row ?? { emails: 0, audit: 0, conversations: 0, suggestions: 0 }),
      releasedFiles: released?.n ?? 0,
      erasedReviews: erased?.n ?? 0,
    };
  });
  const failed = Object.entries(outcome).filter(([, n]) => n < 0).map(([kind]) => kind);
  if (failed.length > 0) console.error('scheduled deletions failed for:', failed.join(', '));
  return outcome;
}
