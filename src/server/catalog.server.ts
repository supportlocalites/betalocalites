import { and, asc, eq, sql } from 'drizzle-orm';
import { category, municipality, vendor, vendorCategory, vendorService } from '@/db/generated/schema';
import { describePrice, type PricingModel } from '@/lib/price';
import { type Db, withDb } from './db.server';
import type { ServerEnv } from './env';
import { type Photo, readPhotos, toPhotos } from './photo-store.server';

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

/** photoPath: where the main photo is stored (pages turn it into an address with smallPhotoUrl). */
export type VendorResult = { id: string; slug: string; name: string; tagline: string | null; town: string; photoPath: string | null };

/**
 * Published listings matching the words typed, ordered only by how well they match
 * (search results are never paid for). Tolerates small typos via trigram similarity.
 */
export async function searchVendors(db: Db, query: string, categorySlug?: string): Promise<VendorResult[]> {
  const q = query.trim().slice(0, 100);
  const rows = await db.execute<VendorResult>(sql`
    select v.id, v.slug, v.display_name as name, v.tagline, m.name as town,
           (select a.storage_path from vendor_media vm join media_asset a on a.id = vm.media_asset_id
            where vm.vendor_id = v.id and a.deleted_at is null order by vm.sort_order, a.created_at limit 1) as "photoPath"
    from vendor v
    join municipality m on m.id = v.primary_municipality_id
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
  services: { name: string; description: string | null; price: string | null }[];
  photos: Photo[];
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
      })
      .from(vendor)
      .innerJoin(municipality, eq(municipality.id, vendor.primaryMunicipalityId))
      .where(and(eq(vendor.slug, slug), eq(vendor.listingStatus, 'published')))
      .limit(1);
    if (!v) return null;

    const [cats, services, photos] = await Promise.all([
      db
        .select({ name: category.name })
        .from(vendorCategory)
        .innerJoin(category, eq(category.id, vendorCategory.categoryId))
        .where(eq(vendorCategory.vendorId, v.id))
        .orderBy(sql`${vendorCategory.isPrimary} desc`, asc(category.name)),
      db
        .select({
          name: vendorService.name,
          description: vendorService.description,
          pricingModel: vendorService.pricingModel,
          priceCents: vendorService.priceCents,
          currency: vendorService.currency,
        })
        .from(vendorService)
        .where(and(eq(vendorService.vendorId, v.id), eq(vendorService.isActive, true)))
        .orderBy(asc(vendorService.sortOrder), asc(vendorService.name)),
      readPhotos(db, v.id),
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
      services: services.map((s) => ({
        name: s.name,
        description: s.description,
        price: describePrice(s.pricingModel as PricingModel, s.priceCents, s.currency),
      })),
      photos: toPhotos(env, photos),
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
