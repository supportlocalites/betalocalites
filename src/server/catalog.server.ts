import type { Address } from '@/lib/address';
import { and, asc, eq, sql } from 'drizzle-orm';
import { category, municipality, vendor, vendorCategory, vendorService } from '@/db/generated/schema';
import { type Db, withDb } from './db.server';
import type { ServerEnv } from './env';
import {
  LIST_PHOTO,
  LIST_PHOTO_COLUMNS,
  type ListPhotoColumns,
  type Photo,
  readPhotos,
  readProfilePhoto,
  toPhotos,
} from './photo-store.server';

export type CategorySummary = { slug: string; name: string; vendorCount: number };

/** Top-level categories, in the order the team set, with how many published listings each has. */
export async function listCategories(env: ServerEnv): Promise<CategorySummary[]> {
  return withDb(env, readCategories);
}

/** The same, on a connection the caller already has. */
export async function readCategories(db: Db): Promise<CategorySummary[]> {
  const rows = await db.execute<CategorySummary>(sql`
    select top.slug, top.name, (
      select count(distinct vc.vendor_id)::int
      from vendor_category vc
      join category c on c.id = vc.category_id
      join vendor v on v.id = vc.vendor_id
      where (c.id = top.id or c.parent_id = top.id)
        and v.listing_status = 'published'
    ) as "vendorCount"
    from category top
    where top.parent_id is null and top.is_active
    order by top.sort_order, top.name
  `);
  return [...rows];
}

/** A kind of business's name by its web address, shown or hidden (old links keep their heading). */
export async function categoryName(db: Db, slug: string): Promise<string | null> {
  const [c] = await db.execute<{ name: string }>(sql`select name from category where slug = ${slug}`);
  return c?.name ?? null;
}

/** The list photo's columns (LIST_PHOTO): pages turn them into a picture with toListPhoto. */
export type VendorResult = { id: string; slug: string; name: string; tagline: string | null; town: string } & ListPhotoColumns;

/**
 * Published listings matching the words typed, ordered only by how well they match
 * (search results are never paid for). Tolerates small typos via trigram similarity.
 */
export async function searchVendors(db: Db, query: string, categorySlug?: string): Promise<VendorResult[]> {
  const q = query.trim().slice(0, 100);
  const rows = await db.execute<VendorResult>(sql`
    select v.id, v.slug, v.display_name as name, v.tagline, m.name as town,
           ${LIST_PHOTO_COLUMNS}
    from vendor v
    join municipality m on m.id = v.primary_municipality_id
    ${LIST_PHOTO}
    where v.listing_status = 'published'
      and (${q} = ''
           or v.search_document @@ websearch_to_tsquery('english', ${q})
           or extensions.word_similarity(${q}, v.display_name) > 0.45
           or exists (
             select 1 from vendor_category vc
             join category c on c.id = vc.category_id
             where vc.vendor_id = v.id
               and (to_tsvector('english', c.name) @@ websearch_to_tsquery('english', ${q})
                    or extensions.word_similarity(${q}, c.name) > 0.45)))
      and (${categorySlug ?? null}::text is null or exists (
            select 1 from vendor_category vc
            join category c on c.id = vc.category_id
            left join category p on p.id = c.parent_id
            where vc.vendor_id = v.id and (c.slug = ${categorySlug ?? null} or p.slug = ${categorySlug ?? null})))
    order by
      ts_rank(v.search_document, websearch_to_tsquery('english', ${q})) desc,
      extensions.word_similarity(${q}, v.display_name) desc,
      v.display_name asc
    limit 30
  `);
  return [...rows];
}

export type VendorProfile = {
  /** For signing the page's activity note only; not shown. */
  id: string;
  name: string;
  tagline: string | null;
  description: string | null;
  town: string;
  websiteUrl: string | null;
  publicPhone: string | null;
  claimed: boolean;
  categories: string[];
  /** $ to $$$, set by our team (D-56). */
  cost: number | null;
  /** Its address and pin (0054); the number only when it isn't hidden. */
  address: Address;
  services: { name: string; description: string | null }[];
  photos: Photo[];
  /** The square profile photo, if the business has one. */
  profile: Photo | null;
};

/** One published listing by its web address, or null if there's no such public listing. */
export async function getVendor(env: ServerEnv, slug: string): Promise<VendorProfile | null> {
  return withDb(env, async (db) => {
    const [v] = await db
      .select({
        id: vendor.id,
        name: vendor.displayName,
        tagline: vendor.tagline,
        description: vendor.description,
        town: municipality.name,
        websiteUrl: vendor.websiteUrl,
        publicPhone: vendor.publicPhone,
        claimStatus: vendor.claimStatus,
        cost: sql<number | null>`${vendor}.cost_level`,
        // A hidden number is never kept (0054), so it can't show here.
        street: sql<string | null>`${vendor}.address_street`,
        number: sql<string | null>`case when ${vendor}.hide_address_number then null else ${vendor}.address_number end`,
        hidden: sql<boolean>`${vendor}.hide_address_number`,
        lat: sql<number | null>`${vendor}.map_lat`,
        lng: sql<number | null>`${vendor}.map_lng`,
        approximate: sql<boolean>`${vendor}.map_approximate`,
      })
      .from(vendor)
      .innerJoin(municipality, eq(municipality.id, vendor.primaryMunicipalityId))
      .where(and(eq(vendor.slug, slug), eq(vendor.listingStatus, 'published')))
      .limit(1);
    if (!v) return null;

    const [cats, services, photos, profile] = await Promise.all([
      db
        .select({ name: category.name })
        .from(vendorCategory)
        .innerJoin(category, eq(category.id, vendorCategory.categoryId))
        .where(eq(vendorCategory.vendorId, v.id))
        .orderBy(sql`${vendorCategory.isPrimary} desc`, asc(category.name)),
      db
        // No prices, anywhere (D-58).
        .select({ name: vendorService.name, description: vendorService.description })
        .from(vendorService)
        .where(and(eq(vendorService.vendorId, v.id), eq(vendorService.isActive, true)))
        .orderBy(asc(vendorService.sortOrder), asc(vendorService.name)),
      readPhotos(db, v.id),
      readProfilePhoto(db, v.id),
    ]);

    return {
      id: v.id,
      name: v.name,
      tagline: v.tagline,
      description: v.description,
      town: v.town,
      websiteUrl: v.websiteUrl,
      publicPhone: v.publicPhone,
      claimed: v.claimStatus === 'claimed',
      categories: cats.map((c) => c.name),
      cost: v.cost,
      address: { street: v.street, number: v.number, hidden: v.hidden, lat: v.lat, lng: v.lng, approximate: v.approximate },
      services,
      photos: toPhotos(env, photos),
      profile: toPhotos(env, profile)[0] ?? null,
    };
  });
}

/** The current web address of a published listing that used to be at `oldSlug`, if any. */
export async function findRenamed(env: ServerEnv, oldSlug: string): Promise<string | null> {
  return withDb(env, async (db) => {
    const [row] = await db.execute<{ slug: string }>(sql`
      select v.slug::text as slug
      from vendor_slug_history h join vendor v on v.id = h.vendor_id
      where h.slug = ${oldSlug} and v.listing_status = 'published' and v.slug <> ${oldSlug}
    `);
    return row?.slug ?? null;
  });
}

/** A published listing's id by its web address, or null. */
export async function getVendorId(env: ServerEnv, slug: string): Promise<string | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return null;
  return withDb(env, async (db) => {
    const [v] = await db.execute<{ id: string }>(sql`select id from vendor where slug = ${slug} and listing_status = 'published'`);
    return v?.id ?? null;
  });
}
