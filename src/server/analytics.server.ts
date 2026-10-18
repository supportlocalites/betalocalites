import { sql } from 'drizzle-orm';
import { addDays, type Period, periodRanges, type Range } from '@/lib/activity';
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

/** People getting in touch (D-52, migration 0039): totals only, never who or what was said. */
export type Contact = {
  inquiries: number;
  conversations: number;
  messages: number;
  replied: number;
  /** Median minutes to the business's first reply; null when nothing was replied to. */
  medianReplyMinutes: number | null;
};

async function contactTotals(db: Db, vendorId: string, r: Range): Promise<Contact> {
  const [c] = await db.execute<Contact>(sql`
    select inquiries, conversations, messages, replied, median_reply_minutes as "medianReplyMinutes"
    from vendor_contact_totals(${vendorId}::uuid, ${r.from}::date, ${r.to}::date)`);
  return c ?? { inquiries: 0, conversations: 0, messages: 0, replied: 0, medianReplyMinutes: null };
}

export type Report = {
  period: Period;
  range: Range;
  now: Totals;
  before: Totals | null;
  lastYear: Totals | null; // null: not counted that long ago yet
  /** The first day anything was counted, and the last day the nightly count has finished. */
  countingSince: string | null;
  /** Days in the period when the daily safety limit was reached (not every visit was kept). */
  limitedDays: string[];
  sources: Row[];
  devices: Row[];
  towns: Row[];
  hours: Row[];
  leftOut: Row[];
  askedFor: number;
  category: { name: string; browsedName: string; browsed: number; comparison: { businesses: number; average: number; rank: number } | null } | null;
  countedTo: string | null; // the last day counted
  /** People getting in touch in this period, and the one before (D-52). */
  contact: { now: Contact; before: Contact | null };
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
  const [now, [known], breakdown, sources, [asked], [cat], contactNow, contactBefore] = await Promise.all([
    totals(db, vendorId, r),
    // Counting began with the first total written (seen in lists is written as it happens).
    db.execute<{ since: string | null; to: string | null }>(sql`
      select (select min(day)::text from vendor_daily_stats) as since,
             (select max(day)::text from activity_rollup where status = 'done') as to`),
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
    // Messages are counted as they happen, so the current period runs to the end of today
    // (page opens are counted each night, up to yesterday).
    contactTotals(db, vendorId, r.to === today ? { ...r, to: addDays(today, 1) } : r),
    ranges.before ? contactTotals(db, vendorId, ranges.before) : Promise.resolve(null),
  ]);
  // A comparison only when this period is fully counted (the nightly count has reached its
  // last day) and the other was counted from its first day.
  const complete = Boolean(known?.to && known.to >= addDays(r.to, -1));
  const counted = (from: string) => complete && Boolean(known?.since && known.since <= from);
  const [before, lastYear, limited] = await Promise.all([
    ranges.before && counted(ranges.before.from) ? totals(db, vendorId, ranges.before) : Promise.resolve(null),
    counted(ranges.lastYear.from) ? totals(db, vendorId, ranges.lastYear) : Promise.resolve(null),
    // Days when the site-wide daily safety limit was reached: not fully counted.
    db.execute<{ day: string }>(sql`
      select day::text as day from activity_budget
      where limited_at is not null and day >= ${r.from}::date and day < ${r.to}::date order by day`),
  ]);

  let category: Report['category'] = null;
  if (cat) {
    // People browse the top categories (Explore), so interest is the top one's, with its sub-categories.
    const top = cat.parentId ?? cat.id;
    const [[browsed], peers] = await Promise.all([
      db.execute<{ n: number; name: string }>(sql`
        select coalesce((select sum(searches) from search_daily_stats
                         where placement = 'category' and day >= ${r.from}::date and day < ${r.to}::date
                           and category_id in (select id from category where id = ${top} or parent_id = ${top})), 0)::int as n,
               (select name from category where id = ${top}) as name`),
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
      browsedName: browsed?.name ?? cat.name,
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
  // The 10 busiest towns over the whole period; the rest together.
  const allTowns = pick('town');
  const named = allTowns.filter((t) => t.value !== 'unknown');
  const towns = [
    ...named.slice(0, 10),
    ...(named.length > 10 ? [{ value: 'elsewhere', views: named.slice(10).reduce((a, t) => a + t.views, 0) }] : []),
    ...allTowns.filter((t) => t.value === 'unknown'),
  ];
  return {
    period,
    range: r,
    now,
    before,
    lastYear,
    sources: [...sources],
    devices: pick('device'),
    towns,
    hours: pick('hour').sort((a, b) => a.value.localeCompare(b.value)),
    leftOut: pick('left_out'),
    askedFor: asked?.n ?? 0,
    category,
    countedTo: known?.to ?? null,
    countingSince: known?.since ?? null,
    limitedDays: limited.map((d) => d.day),
    contact: { now: contactNow, before: contactBefore },
  };
}
