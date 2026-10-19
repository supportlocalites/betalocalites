import { sql } from 'drizzle-orm';
import { type Sort, SORTS } from '@/lib/browse-terms';
import { actingAs } from './acting.server';
import { type Db, withDb } from './db.server';
import type { ServerEnv } from './env';
import { type CategorySummary, readCategories } from './catalog.server';
import { smallPhotoUrl } from './photo-store.server';

/**
 * Browse local (D-57): listed businesses in one row per kind of business, filtered by the
 * words typed, the town, the cost ($ to $$$, set by the team, D-56) and the rating, in the
 * order chosen. Never paid for. Signed in, the same query runs as that person (ADR-031), so it
 * can say which they saved (the bookmark) and shortlisted (the +); signed out, neither.
 */

/** Businesses in one row; "See all" opens the kind's full list. */
export const PER_RAIL = 12;

export type BrowseFilters = { q: string; town: string | null; cost: 1 | 2 | 3 | null; minRating: 4 | null; sort: Sort };

export type BrowseCard = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  town: string;
  cost: number | null;
  reviews: number;
  /** Shown only from 3 published reviews (vendor_rating). */
  average: number | null;
  photo: string | null;
  saved: boolean;
  shortlisted: boolean;
};
export type BrowseRail = { slug: string; name: string; total: number; items: BrowseCard[] };
export type ShortlistItem = { slug: string; name: string; kind: string; photo: string | null };
export type Browse = {
  rails: BrowseRail[];
  towns: { slug: string; name: string }[];
  kinds: CategorySummary[];
  shortlist: ShortlistItem[];
};

type Row = Omit<BrowseCard, 'photo' | 'average'> & {
  average: string | number | null;
  photoPath: string | null;
  railSlug: string;
  railName: string;
  total: number;
};

/** A card's photo: one of the business's page photos first (wide), else its square profile photo. */
const CARD_PHOTO = sql`left join lateral (
    select a.storage_path as path
    from vendor_media vm join media_asset a on a.id = vm.media_asset_id
    where vm.vendor_id = v.id and vm.role in ('gallery', 'logo') and a.deleted_at is null
    order by vm.role = 'gallery' desc, vm.sort_order, a.created_at limit 1) cp on true`;

async function readBrowse(db: Db, f: BrowseFilters, userId: string | null): Promise<Browse> {
  const q = f.q.trim().slice(0, 100);
  const me = userId ?? '00000000-0000-0000-0000-000000000000';
  const order =
    f.sort === 'rated'
      ? sql`m.average desc nulls last, m.reviews desc, m.name`
      : f.sort === 'new'
        ? sql`m.published_at desc nulls last, m.name`
        : f.sort === 'saved'
          ? sql`m.saved desc, m.average desc nulls last, m.name`
          : q
            ? sql`m.rank desc, m.similar desc, m.name`
            : sql`m.average desc nulls last, m.reviews desc, m.name`;
  const [rows, towns, kinds] = await Promise.all([
    db.execute<Row>(sql`
      with matched as (
        select v.id, v.slug::text as slug, v.display_name as name, v.tagline, mu.name as town, v.cost_level as cost,
               v.published_at, coalesce(r.review_count, 0) as reviews, r.average,
               cp.path as "photoPath", top.slug::text as "railSlug", top.name as "railName", top.sort_order as rail_order,
               ts_rank(v.search_document, websearch_to_tsquery('english', ${q})) as rank,
               extensions.word_similarity(${q}, v.display_name) as similar,
               -- Read as the person (RLS): only their own; signed out, nobody's.
               exists (select 1 from saved_vendor s where s.user_id = ${me}::uuid and s.vendor_id = v.id) as saved,
               exists (select 1 from shortlist s where s.user_id = ${me}::uuid and s.vendor_id = v.id) as shortlisted
        from vendor v
        join municipality mu on mu.id = v.primary_municipality_id
        join lateral (
          select coalesce(c.parent_id, c.id) as top_id from vendor_category vc join category c on c.id = vc.category_id
          where vc.vendor_id = v.id order by vc.is_primary desc, c.name limit 1) pc on true
        join category top on top.id = pc.top_id and top.is_active
        left join lateral vendor_rating(v.id) r on true
        ${CARD_PHOTO}
        where v.listing_status = 'published'
          and (${q} = ''
               or v.search_document @@ websearch_to_tsquery('english', ${q})
               or extensions.word_similarity(${q}, v.display_name) > 0.45
               or exists (
                 select 1 from vendor_category vc join category c on c.id = vc.category_id
                 where vc.vendor_id = v.id
                   and (to_tsvector('english', c.name) @@ websearch_to_tsquery('english', ${q})
                        or extensions.word_similarity(${q}, c.name) > 0.45)))
          and (${f.town}::text is null or mu.slug = ${f.town})
          and (${f.cost}::int is null or v.cost_level = ${f.cost})
          and (${f.minRating}::int is null or r.average >= ${f.minRating})
      )
      select id, slug, name, tagline, town, cost, reviews, average, "photoPath", saved, shortlisted, "railSlug", "railName", total
      from (
        select m.*, row_number() over (partition by m."railSlug" order by ${order}) as pos,
               count(*) over (partition by m."railSlug")::int as total
        from matched m) x
      where pos <= ${PER_RAIL}
      order by rail_order, "railName", pos`),
    db.execute<{ slug: string; name: string }>(sql`
      select slug::text as slug, name from municipality where is_active order by sort_order, name`),
    readCategories(db),
  ]);
  const rails: BrowseRail[] = [];
  for (const r of rows) {
    let rail = rails.at(-1);
    if (!rail || rail.slug !== r.railSlug) {
      rail = { slug: r.railSlug, name: r.railName, total: r.total, items: [] };
      rails.push(rail);
    }
    rail.items.push({
      id: r.id,
      slug: r.slug,
      name: r.name,
      tagline: r.tagline,
      town: r.town,
      cost: r.cost,
      reviews: r.reviews,
      average: r.average == null ? null : Number(r.average),
      photo: r.photoPath,
      saved: r.saved,
      shortlisted: r.shortlisted,
    });
  }
  const shortlist = userId ? await readShortlist(db, userId) : [];
  return { rails, towns: [...towns], kinds, shortlist };
}

/** The person's shortlist, listed businesses only, in the order they added them (as the person). */
export async function readShortlist(db: Db, userId: string): Promise<ShortlistItem[]> {
  const rows = await db.execute<Omit<ShortlistItem, 'photo'> & { photoPath: string | null }>(sql`
    select v.slug::text as slug, v.display_name as name, coalesce(top.name, '') as kind, cp.path as "photoPath"
    from shortlist s join vendor v on v.id = s.vendor_id
    left join lateral (
      select coalesce(c.parent_id, c.id) as top_id from vendor_category vc join category c on c.id = vc.category_id
      where vc.vendor_id = v.id order by vc.is_primary desc, c.name limit 1) pc on true
    left join category top on top.id = pc.top_id
    ${CARD_PHOTO}
    where s.user_id = ${userId} and v.listing_status = 'published'
    order by s.created_at`);
  return rows.map(({ photoPath, ...r }) => ({ ...r, photo: photoPath }));
}

/** The page's data, photos turned into their small versions' addresses. */
export async function browse(env: ServerEnv, userId: string | null, f: BrowseFilters): Promise<Browse> {
  const result = userId
    ? await actingAs(env, { side: 'person', userId }, (tx) => readBrowse(tx, f, userId))
    : await withDb(env, (db) => readBrowse(db, f, null));
  const url = (path: string | null) => smallPhotoUrl(env, path);
  return {
    towns: result.towns,
    kinds: result.kinds,
    rails: result.rails.map((rail) => ({ ...rail, items: rail.items.map((c) => ({ ...c, photo: url(c.photo) })) })),
    shortlist: result.shortlist.map((s) => ({ ...s, photo: url(s.photo) })),
  };
}

/** The filters from the page's address, anything unknown left out. */
export function readFilters(params: URLSearchParams, clean: (s: string) => string): BrowseFilters {
  const cost = Number(params.get('cost'));
  const sort = params.get('sort') as Sort;
  const town = clean(params.get('town') ?? '').slice(0, 80);
  return {
    q: clean(params.get('q') ?? '').slice(0, 100),
    town: /^[a-z0-9]+(-[a-z0-9]+)*$/.test(town) ? town : null,
    cost: cost === 1 || cost === 2 || cost === 3 ? cost : null,
    minRating: params.get('rating') === '4' ? 4 : null,
    sort: SORTS.includes(sort) ? sort : 'match',
  };
}
