import { sql } from 'drizzle-orm';
import { actingAs } from './acting.server';
import type { ServerEnv } from './env';
import { READABLE_MAX_CHARS, READABLE_ROWS, readableData, tooLongForReadable } from './readable-data';

/**
 * Download my data (migration 0043; 0052 adds what they did for a business): everything Localites
 * holds about the signed-in person, built by the database (my_data(), acting as that person; no id
 * comes from the page). As the data file, laid out a line at a time (the database does that too),
 * or as a readable page (M21, D-54).
 */
export async function myData(env: ServerEnv, userId: string): Promise<string> {
  const [row] = await actingAs(env, { side: 'person', userId }, (tx) =>
    tx.execute<{ data: string }>(sql`select jsonb_pretty(my_data()) as data`),
  );
  return row?.data ?? '{}';
}

/** The readable copy: the database cuts the two longest lists to their newest READABLE_ROWS first (ADR-005). */
export async function myReadableData(env: ServerEnv, userId: string): Promise<string> {
  const [row] = await actingAs(env, { side: 'person', userId }, (tx) =>
    tx.execute<{ data: string; totals: Record<string, number> }>(sql`
      select ((d - 'activity' - 'searches') || jsonb_build_object(
                'activity', coalesce((select jsonb_agg(x order by n) from jsonb_array_elements(d->'activity') with ordinality a(x, n)
                                      where n <= ${READABLE_ROWS}), '[]'),
                'searches', coalesce((select jsonb_agg(x order by n) from jsonb_array_elements(d->'searches') with ordinality s(x, n)
                                      where n <= ${READABLE_ROWS}), '[]')))::text as data,
             jsonb_build_object('activity', jsonb_array_length(d->'activity'), 'searches', jsonb_array_length(d->'searches')) as totals
      from (select my_data() as d) m`),
  );
  const data = row?.data ?? '{}';
  if (data.length > READABLE_MAX_CHARS) return tooLongForReadable();
  return readableData(JSON.parse(data) as Record<string, unknown>, row?.totals ?? {});
}
