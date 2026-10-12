import { sql } from 'drizzle-orm';
import { type Period, periodRanges, type Range } from '@/lib/activity';
import type { Db } from './db.server';

/**
 * One business's numbers for a period (D-30, D-37), read only from the totals (never the
 * detail of who did what). The owner's Analytics page and the team's activity page both
 * use this; the owner's page hides small breakdown figures.
 */

export type Totals = {
  seen: number;
  positionSum: number;
  views: number;
  websiteTaps: number;
  phoneTaps: number;
  servicesSeen: number;
  timedViews: number;
  profileSeconds: number;
  /** Different visitors (by browser); null where they can't be counted for this period. */
  people: number | null;
  returning: number | null;
};

export type Row = { value: string; views: number };

export type Report = {
  period: Period;
  range: Range;
  now: Totals;
  before: Totals | null;
  lastYear: Totals | null; // null: not counted that long ago yet
  sources: Row[];
  devices: Row[];
  towns: Row[];
  hours: Row[];
  leftOut: Row[];
  askedFor: number;
  category: { name: string; browsed: number; comparison: { businesses: number; average: number; rank: number } | null } | null;
  countedTo: string | null; // the last day counted
};

/** Fewer businesses than this in a category: no average or rank, as it could reveal one competitor's numbers. */
export const MIN_TO_COMPARE = 5;

async function totals(db: Db, vendorId: string, r: Range): Promise<Totals> {
  const [t] = await db.execute<Omit<Totals, 'people' | 'returning'>>(sql`
    select coalesce(sum(seen_in_search), 0)::int as seen, coalesce(sum(position_sum), 0)::int as "positionSum",
           coalesce(sum(profile_views), 0)::int as views, coalesce(sum(website_taps), 0)::int as "websiteTaps",
           coalesce(sum(phone_taps), 0)::int as "phoneTaps", coalesce(sum(services_seen), 0)::int as "servicesSeen",
           coalesce(sum(timed_views), 0)::int as "timedViews", coalesce(sum(profile_seconds), 0)::int as "profileSeconds"
    from vendor_daily_stats
    where vendor_id = ${vendorId} and day >= ${r.from}::date and day < ${r.to}::date`);
  let people: number | null = null;
  let returning: number | null = null;
  if (r.people) {
    const [p] = await db.execute<{ people: number; returning: number }>(sql`
      select people, returning_people as returning from vendor_period_people
      where vendor_id = ${vendorId} and period = ${r.people.period} and starts_on = ${r.people.startsOn}::date`);
    people = p?.people ?? 0;
    returning = p?.returning ?? 0;
  }
  return { ...(t ?? { seen: 0, positionSum: 0, views: 0, websiteTaps: 0, phoneTaps: 0, servicesSeen: 0, timedViews: 0, profileSeconds: 0 }), people, returning };
}

export async function readReport(db: Db, vendorId: string, period: Period, today: string): Promise<Report> {
  const ranges = periodRanges(period, today);
  const r = ranges.now;
  const [now, before, [known], breakdown, sources, [asked], [cat]] = await Promise.all([
    totals(db, vendorId, r),
    ranges.before ? totals(db, vendorId, ranges.before) : Promise.resolve(null),
    db.execute<{ since: string | null; to: string | null }>(sql`
      select min(day)::text as since, max(day)::text as to from activity_rollup where status = 'done'`),
    db.execute<{ dimension: string; value: string; views: number }>(sql`
      select dimension, value, sum(profile_views)::int as views from vendor_daily_breakdown
      where vendor_id = ${vendorId} and day >= ${r.from}::date and day < ${r.to}::date
      group by dimension, value order by views desc, value`),
    db.execute<Row>(sql`
      select placement as value, sum(profile_views)::int as views from vendor_daily_stats
      where vendor_id = ${vendorId} and day >= ${r.from}::date and day < ${r.to}::date
      group by placement having sum(profile_views) > 0 order by views desc`),
    db.execute<{ n: number }>(sql`
      select count(*)::int as n from vendor_suggestion where vendor_id = ${vendorId} and status in ('added', 'duplicate')`),
    db.execute<{ id: string; name: string; parentId: string | null }>(sql`
      select c.id, c.name, c.parent_id as "parentId" from vendor_category vc join category c on c.id = vc.category_id
      where vc.vendor_id = ${vendorId} and vc.is_primary`),
  ]);
  // Same period last year: only once counting had started by then.
  const lastYear = known?.since && known.since <= ranges.lastYear.from ? await totals(db, vendorId, ranges.lastYear) : null;

  let category: Report['category'] = null;
  if (cat) {
    const [[browsed], peers] = await Promise.all([
      db.execute<{ n: number }>(sql`
        select coalesce(sum(searches), 0)::int as n from search_daily_stats
        where placement = 'category' and category_id in (${cat.id}::uuid, ${cat.parentId}::uuid)
          and day >= ${r.from}::date and day < ${r.to}::date`),
      db.execute<{ vendorId: string; views: number }>(sql`
        select v.id as "vendorId", coalesce(sum(s.profile_views), 0)::int as views
        from vendor v join vendor_category vc on vc.vendor_id = v.id and vc.is_primary and vc.category_id = ${cat.id}
        left join vendor_daily_stats s on s.vendor_id = v.id and s.day >= ${r.from}::date and s.day < ${r.to}::date
        where v.listing_status = 'published'
        group by v.id`),
    ]);
    const mine = peers.find((p) => p.vendorId === vendorId)?.views ?? now.views;
    category = {
      name: cat.name,
      browsed: browsed?.n ?? 0,
      comparison:
        peers.length >= MIN_TO_COMPARE
          ? {
              businesses: peers.length,
              average: Math.round(peers.reduce((a, p) => a + p.views, 0) / peers.length),
              rank: 1 + peers.filter((p) => p.views > mine).length,
            }
          : null,
    };
  }

  const pick = (d: string) => breakdown.filter((b) => b.dimension === d).map(({ value, views }) => ({ value, views }));
  return {
    period,
    range: r,
    now,
    before,
    lastYear,
    sources: [...sources],
    devices: pick('device'),
    towns: pick('town'),
    hours: pick('hour').sort((a, b) => a.value.localeCompare(b.value)),
    leftOut: pick('left_out'),
    askedFor: asked?.n ?? 0,
    category,
    countedTo: known?.to ?? null,
  };
}
