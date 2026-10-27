import { sql } from 'drizzle-orm';
import { actingAs } from './acting.server';
import type { ServerEnv } from './env';

/**
 * The small numbers on the bar's icons, on every page (the owner, 27 October 2026: "the icon
 * numbers should show on all pages"): how many favourites (businesses listed, as Browse local
 * counts them) and how many conversations have something new (as Messages counts them). Read as
 * the person, so only their own.
 */
export async function barCounts(env: ServerEnv, userId: string): Promise<{ favourites: number; unread: number }> {
  const [row] = await actingAs(env, { side: 'person', userId }, (db) =>
    db.execute<{ favourites: number; unread: number }>(sql`
      select
        (select count(*) from saved_vendor s join vendor v on v.id = s.vendor_id
         where s.user_id = ${userId} and v.listing_status = 'published'
           and exists (select 1 from vendor_category vc join category c on c.id = vc.category_id
                       where vc.vendor_id = v.id and c.is_active))::int as favourites,
        (select count(*) from conversation c
         left join conversation_read r on r.conversation_id = c.id and r.user_id = ${userId}
         where c.consumer_user_id = ${userId}
           and exists (select 1 from message m where m.conversation_id = c.id and m.author_side = 'vendor'
                         and m.removed_at is null and m.hidden_by_team_at is null
                         and m.created_at > coalesce(r.last_read_at, '-infinity')))::int as unread`),
  );
  return { favourites: row?.favourites ?? 0, unread: row?.unread ?? 0 };
}
