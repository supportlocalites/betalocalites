import { sql } from 'drizzle-orm';
import { actingAs } from './acting.server';
import type { ServerEnv } from './env';

/**
 * The number on the bar's Messages icon, on every page (the owner, 27 October 2026: "the icon
 * numbers should show on all pages"): how many conversations have something new, as Messages
 * counts them. Read as the person, so only their own. (Favourites moved to Browse local's own bar.)
 */
export async function barCounts(env: ServerEnv, userId: string): Promise<{ unread: number }> {
  const [row] = await actingAs(env, { side: 'person', userId }, (db) =>
    db.execute<{ unread: number }>(sql`
      select
        (select count(*) from conversation c
         left join conversation_read r on r.conversation_id = c.id and r.user_id = ${userId}
         where c.consumer_user_id = ${userId}
           and exists (select 1 from message m where m.conversation_id = c.id and m.author_side = 'vendor'
                         and m.removed_at is null and m.hidden_by_team_at is null
                         and m.created_at > coalesce(r.last_read_at, '-infinity')))::int as unread`),
  );
  return { unread: row?.unread ?? 0 };
}
