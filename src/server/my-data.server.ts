import { sql } from 'drizzle-orm';
import { actingAs } from './acting.server';
import type { ServerEnv } from './env';

/**
 * Download my data (migration 0043): everything Localites holds about the signed-in person, as
 * the JSON text the database builds (my_data(), acting as that person; no id comes from the page).
 */
export async function myData(env: ServerEnv, userId: string): Promise<string> {
  const [row] = await actingAs(env, { side: 'person', userId }, (tx) => tx.execute<{ data: string }>(sql`select my_data()::text as data`));
  return row?.data ?? '{}';
}
