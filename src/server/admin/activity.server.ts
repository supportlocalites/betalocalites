import { sql } from 'drizzle-orm';
import type { Admin } from '../auth/admin.server';
import { type Db, withDb } from '../db.server';
import type { ServerEnv } from '../env';
import { audit } from './audit.server';

/**
 * The team's side of activity (screen X18, D-22, D-37). Totals can be read freely; every
 * look at the detail (who did what, the words people searched) is written to the audit log
 * first, in the same transaction, so a look that isn't recorded shows nothing. Callers
 * must have passed adminGate.
 */

export type AnalyticsSwitch = { enabled: boolean; changedAt: string; changedBy: string | null } | null;

export async function readSwitch(db: Db, vendorId: string): Promise<AnalyticsSwitch> {
  const [s] = await db.execute<Exclude<AnalyticsSwitch, null>>(sql`
    select a.enabled, a.changed_at::text as "changedAt", u.display_name as "changedBy"
    from vendor_analytics a left join app_user u on u.id = a.changed_by where a.vendor_id = ${vendorId}`);
  return s ?? null;
}

export class ActivityConflict extends Error {}

/** Switches a business's Analytics page on or off (D-37). Recorded in the audit log. */
export async function setAnalytics(env: ServerEnv, admin: Admin, vendorId: string, enabled: boolean, note: string | null): Promise<'changed' | 'unchanged'> {
  return withDb(env, (db) =>
    db.transaction(async (tx) => {
      const [v] = await tx.execute<{ id: string }>(sql`select id from vendor where id = ${vendorId} for update`);
      if (!v) throw new ActivityConflict('This listing no longer exists.');
      const [before] = await tx.execute<{ enabled: boolean }>(sql`select enabled from vendor_analytics where vendor_id = ${vendorId}`);
      if ((before?.enabled ?? false) === enabled) return 'unchanged';
      const auditId = await audit(tx, {
        actor: admin.userId,
        action: enabled ? 'vendor.analytics.on' : 'vendor.analytics.off',
        subjectType: 'vendor',
        subjectId: vendorId,
        reason: note,
        changes: { analyticsPage: { from: before?.enabled ?? false, to: enabled } },
        sessionRef: admin.sessionId,
      });
      await tx.execute(sql`
        insert into vendor_analytics (vendor_id, enabled, changed_by, audit_id) values (${vendorId}, ${enabled}, ${admin.userId}, ${auditId})
        on conflict (vendor_id) do update set enabled = excluded.enabled, changed_at = now(),
                                              changed_by = excluded.changed_by, audit_id = excluded.audit_id`);
      return 'changed';
    }),
  );
}

export type DayCount = { day: string; seen: number; views: number; unusual: boolean };

/** The last 28 days' totals, with days far above the business's own average marked (possible inflation). */
export async function recentDays(db: Db, vendorId: string, today: string): Promise<DayCount[]> {
  const rows = await db.execute<{ day: string; seen: number; views: number }>(sql`
    select day::text as day, sum(seen_in_search)::int as seen, sum(profile_views)::int as views
    from vendor_daily_stats where vendor_id = ${vendorId} and day >= ${today}::date - 28 and day < ${today}::date
    group by day order by day desc`);
  const avgSeen = rows.reduce((a, r) => a + r.seen, 0) / 28;
  const avgViews = rows.reduce((a, r) => a + r.views, 0) / 28;
  return rows.map((r) => ({ ...r, unusual: (r.seen >= 20 && r.seen > 5 * avgSeen) || (r.views >= 10 && r.views > 5 * avgViews) }));
}

export type DetailLook = { at: string; who: string | null; action: string; day: string | null };

/** Who on the team looked at this business's detail, most recent first. */
export async function detailLooks(db: Db, vendorId: string): Promise<DetailLook[]> {
  return [
    ...(await db.execute<DetailLook>(sql`
      select a.created_at::text as at, u.display_name as who, a.action, a.changes->'day'->>'to' as day
      from audit_log a left join app_user u on u.id = a.actor_user_id
      where a.subject_type = 'vendor' and a.subject_id = ${vendorId} and a.action like 'activity.%'
      order by a.created_at desc limit 20`)),
  ];
}

export type DetailRow = {
  at: string;
  kind: string;
  source: string | null;
  place: number | null;
  device: string | null;
  town: string | null;
  browser: string | null;
  account: string | null;
  viewer: string;
  seconds: number | null;
};

const DETAIL_ROWS = 500;

/** One Toronto day's detail for one business. The look is recorded in the same transaction: if it can't be, nothing is shown. */
export async function dayDetail(env: ServerEnv, admin: Admin, vendorId: string, day: string): Promise<{ name: string; rows: DetailRow[] } | null> {
  return withDb(env, (db) =>
    db.transaction(async (tx) => {
      const [v] = await tx.execute<{ name: string }>(sql`select display_name as name from vendor where id = ${vendorId}`);
      if (!v) return null;
      const rows = await tx.execute<DetailRow>(sql`
        select to_char(e.occurred_at at time zone 'America/Toronto', 'HH24:MI') as at, e.kind, e.source,
               e.list_position as place, e.device, e.visitor_town as town,
               right(e.visitor_id::text, 6) as browser,
               (select string_agg(distinct u.display_name, ', ') from visitor_account va join app_user u on u.id = va.user_id
                where va.visitor_id = e.visitor_id) as account,
               e.viewer, e.duration_seconds as seconds
        from activity_event e
        where e.vendor_id = ${vendorId}
          and e.occurred_at >= ${day}::date::timestamp at time zone 'America/Toronto'
          and e.occurred_at < (${day}::date + 1)::timestamp at time zone 'America/Toronto'
        order by e.occurred_at, e.id
        limit ${DETAIL_ROWS}`);
      await audit(tx, {
        actor: admin.userId,
        action: 'activity.view_detail',
        subjectType: 'vendor',
        subjectId: vendorId,
        changes: { day: { from: null, to: day }, rows: { from: null, to: rows.length } },
        sessionRef: admin.sessionId,
      });
      return { name: v.name, rows: [...rows] };
    }),
  );
}

export type SearchWords = { words: string; searches: number; foundNothing: number; browsers: number };

/** The words people searched on one Toronto day. Recorded in the audit log in the same transaction. */
export async function searchesOn(env: ServerEnv, admin: Admin, day: string): Promise<SearchWords[]> {
  return withDb(env, (db) =>
    db.transaction(async (tx) => {
      const rows = await tx.execute<SearchWords>(sql`
        select words_norm as words, count(*)::int as searches, count(*) filter (where result_count = 0)::int as "foundNothing",
               count(distinct visitor_id)::int as browsers
        from search_record
        where placement = 'search' and viewer = 'public'
          and occurred_at >= ${day}::date::timestamp at time zone 'America/Toronto'
          and occurred_at < (${day}::date + 1)::timestamp at time zone 'America/Toronto'
        group by words_norm order by searches desc, words_norm limit 500`);
      await audit(tx, {
        actor: admin.userId,
        action: 'search.view_detail',
        subjectType: 'search',
        subjectId: null,
        changes: { day: { from: null, to: day } },
        sessionRef: admin.sessionId,
      });
      return [...rows];
    }),
  );
}

export type CategoryRow = { category: string; businesses: number; views: number; seen: number; websiteTaps: number; phoneTaps: number };
export type DemandRow = { category: string; searches: number; foundNothing: number };
export type RollupRow = { day: string; status: string; events: number; failureReason: string | null };

/** The team's overview: categories, search demand, the nightly count, and database space. */
export async function overview(db: Db, from: string, to: string) {
  const [categories, demand, typed, rollups, [space]] = await Promise.all([
    db.execute<CategoryRow>(sql`
      select c.name as category, count(distinct v.id)::int as businesses,
             coalesce(sum(s.profile_views), 0)::int as views, coalesce(sum(s.seen_in_search), 0)::int as seen,
             coalesce(sum(s.website_taps), 0)::int as "websiteTaps", coalesce(sum(s.phone_taps), 0)::int as "phoneTaps"
      from category c
      join vendor_category vc on vc.category_id = c.id and vc.is_primary
      join vendor v on v.id = vc.vendor_id and v.listing_status = 'published'
      left join vendor_daily_stats s on s.vendor_id = v.id and s.day >= ${from}::date and s.day < ${to}::date
      group by c.name order by views desc, c.name`),
    db.execute<DemandRow>(sql`
      select coalesce(c.name, 'All businesses') as category, sum(d.searches)::int as searches, sum(d.found_nothing)::int as "foundNothing"
      from search_daily_stats d left join category c on c.id = d.category_id
      where d.placement = 'category' and d.day >= ${from}::date and d.day < ${to}::date
      group by c.name order by searches desc`),
    db.execute<{ searches: number; foundNothing: number }>(sql`
      select coalesce(sum(searches), 0)::int as searches, coalesce(sum(found_nothing), 0)::int as "foundNothing"
      from search_daily_stats where placement = 'search' and day >= ${from}::date and day < ${to}::date`),
    db.execute<RollupRow>(sql`
      select day::text as day, status, events, failure_reason as "failureReason"
      from activity_rollup order by day desc limit 7`),
    db.execute<{ database: number; activity: number }>(sql`
      select pg_database_size(current_database())::bigint as database,
             (select sum(pg_total_relation_size(c.oid)) from pg_class c
              where c.relname in ('activity_event', 'search_record', 'vendor_daily_stats', 'vendor_daily_breakdown',
                                  'vendor_period_people', 'search_daily_stats'))::bigint as activity`),
  ]);
  return {
    categories: [...categories],
    demand: [...demand],
    typed: typed[0] ?? { searches: 0, foundNothing: 0 },
    rollups: [...rollups],
    space: { database: Number(space?.database ?? 0), activity: Number(space?.activity ?? 0) },
  };
}

/** Counts one day again (the team's "Count this day again"). Recorded in the audit log. */
export async function recountDay(env: ServerEnv, admin: Admin, day: string): Promise<void> {
  await withDb(env, (db) =>
    db.transaction(async (tx) => {
      await audit(tx, {
        actor: admin.userId,
        action: 'activity.recount',
        subjectType: 'activity',
        subjectId: null,
        changes: { day: { from: null, to: day } },
        sessionRef: admin.sessionId,
      });
      const [counted] = await tx.execute<{ n: number }>(sql`select activity_rollup_day(${day}::date) as n`);
      await tx.execute(sql`
        insert into activity_rollup (day, status, events, finished_at) values (${day}::date, 'done', ${counted?.n ?? 0}, now())
        on conflict (day) do update set status = 'done', events = excluded.events, finished_at = now(), failure_reason = null`);
    }),
  );
}
