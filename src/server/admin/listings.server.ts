import type { Address } from '@/lib/address';
import type { ProfileDetails } from '@/lib/profile-details';
import { readAddress } from '../address.server';
import { claimFromSuggestion } from '../business-requests.server';
import { sql } from 'drizzle-orm';
import { uuidv7 } from '@/lib/ids.mjs';
import type { Admin } from '../auth/admin.server';
import { type Db, withDb } from '../db.server';
import type { ServerEnv } from '../env';
import { audit, diff } from './audit.server';
import { ADMIN_TRANSITIONS, type ListingStatus, STATUS_LABEL } from '@/lib/listing-status';
import type { ListingInput, LoadedListing, LoadedService, ServiceInput } from './listing-input';

export { ADMIN_TRANSITIONS, type ListingStatus, STATUS_LABEL };

/**
 * The admin side of listings (D-28, screens X1–X2). Every change runs in one
 * transaction with its audit_log entry; status changes also write status_change
 * (ADR-017). Callers must have passed adminGate.
 */

export class ListingConflict extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

export type ListingRow = {
  id: string;
  name: string;
  slug: string;
  town: string;
  status: ListingStatus;
  claimStatus: string;
  updatedAt: string;
};

export async function listListings(env: ServerEnv, filter: { q: string; status: string }): Promise<ListingRow[]> {
  const q = filter.q.trim().slice(0, 100);
  const status = filter.status in STATUS_LABEL ? filter.status : null;
  return withDb(env, async (db) => [
    ...(await db.execute<ListingRow>(sql`
      select v.id, v.display_name as name, v.slug, m.name as town, v.listing_status as status,
             v.claim_status as "claimStatus", v.updated_at::text as "updatedAt"
      from vendor v join municipality m on m.id = v.primary_municipality_id
      where (${q} = '' or v.display_name ilike '%' || ${q} || '%' or v.slug ilike '%' || ${q} || '%')
        and (${status}::text is null or v.listing_status = ${status})
      order by v.updated_at desc
      limit 200
    `)),
  ]);
}

export type FormOptions = {
  towns: { id: string; name: string }[];
  categories: { id: string; name: string; group: string }[];
};

export async function formOptions(env: ServerEnv): Promise<FormOptions> {
  return withDb(env, readFormOptions);
}

/**
 * The same, on a connection the caller already has. `keep`: a listing's own town and kinds,
 * offered (marked "hidden") even when the team has hidden them since, so saving the listing
 * never quietly drops them or forces a new town (Categories and towns, migration 0017).
 */
export async function readFormOptions(db: Db, keep: { municipalityId: string; categoryIds: string[] } | null = null): Promise<FormOptions> {
  // As one Postgres array value (a plain list would be spread into the query, and can be empty).
  // The listing's own ids arrive as that text already when read without type lookups.
  const ids: unknown = keep?.categoryIds ?? [];
  const keepIds = Array.isArray(ids) ? `{${ids.join(',')}}` : String(ids);
  const [towns, categories] = await Promise.all([
    db.execute<{ id: string; name: string }>(sql`
      select id, name || case when is_active then '' else ' (hidden)' end as name
      from municipality where is_active or id = ${keep?.municipalityId ?? null}::uuid order by sort_order, name`),
    db.execute<{ id: string; name: string; group: string }>(sql`
      select c.id, c.name || case when c.is_active and (p.id is null or p.is_active) then '' else ' (hidden)' end as name,
             coalesce(p.name, c.name) as "group"
      from category c left join category p on p.id = c.parent_id
      where (c.is_active and (p.id is null or p.is_active)) or c.id = any(${keepIds}::uuid[])
      order by coalesce(p.sort_order, c.sort_order), coalesce(p.name, c.name), p.id is not null, c.sort_order, c.name`),
  ]);
  return { towns: [...towns], categories: [...categories] };
}

type VendorRecord = {
  name: string;
  slug: string;
  tagline: string | null;
  description: string | null;
  municipalityId: string;
  websiteUrl: string | null;
  publicEmail: string | null;
  publicPhone: string | null;
  primaryCategoryId: string | null;
  categoryIds: string[];
};

export type ServiceRow = {
  id: string;
  name: string;
  description: string | null;
  pricingModel: string;
  priceCents: number | null;
  priceNote: string | null;
  isActive: boolean;
};

export type HistoryRow = { action: string; actor: string | null; reason: string | null; changes: unknown; at: string };

export type ListingDetail = VendorRecord & {
  id: string;
  status: ListingStatus;
  claimStatus: string;
  services: ServiceRow[];
  history: HistoryRow[];
  /** $ to $$$, as the team judges it (D-56); null until set. */
  costLevel: number | null;
  /** The business's address and pin (0054). */
  address: Address;
  /** Neighbourhood, tags and the team's note, shown on the Base44 profile (0056). */
  details: ProfileDetails;
};

async function readVendor(
  db: Db,
  id: string,
  lock = false,
): Promise<(VendorRecord & { status: ListingStatus; claimStatus: string }) | null> {
  const [v] = await db.execute<VendorRecord & { status: ListingStatus; claimStatus: string }>(sql`
    select v.display_name as name, v.slug::text as slug, v.tagline, v.description,
           v.primary_municipality_id as "municipalityId", v.website_url as "websiteUrl",
           v.public_email::text as "publicEmail", v.public_phone as "publicPhone",
           v.listing_status as status, v.claim_status as "claimStatus",
           (select category_id from vendor_category where vendor_id = v.id and is_primary) as "primaryCategoryId",
           coalesce((select array_agg(category_id::text order by category_id) from vendor_category where vendor_id = v.id), '{}') as "categoryIds"
    from vendor v where v.id = ${id}
    ${lock ? sql`for update of v` : sql``}
  `);
  return v ?? null;
}

// The boxes owners can change too (ADR-029). Compared ignoring line-break style and the
// spaces at either end, which the forms tidy anyway.
const OWNER_FIELDS = ['tagline', 'description', 'websiteUrl', 'publicPhone'] as const;
const plain = (v: unknown) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim() : (v ?? ''));
const sameText = (a: unknown, b: unknown) => plain(a) === plain(b);
const quoted = (v: unknown) => {
  const s = String(plain(v)).replace(/\s+/g, ' ');
  return s ? `“${s.length > 80 ? `${s.slice(0, 79)}…` : s}”` : 'nothing';
};
const changedByOwner = (now: unknown) =>
  `The owner changed this while you were editing. It now says ${quoted(now)}. Reload the page, then make your change again.`;

/** One listing for the team's page, on a connection the caller already has. */
export async function readListing(db: Db, id: string): Promise<ListingDetail | null> {
  const vendor = await readVendor(db, id);
  if (!vendor) return null;
  const [services, history] = await Promise.all([
    db.execute<ServiceRow>(sql`
      select id, name, description, pricing_model as "pricingModel", price_cents as "priceCents",
             price_note as "priceNote", is_active as "isActive"
      from vendor_service where vendor_id = ${id}
      order by is_active desc, sort_order, created_at`),
    db.execute<HistoryRow>(sql`
      select a.action, u.display_name as actor, a.reason, a.changes, a.created_at::text as at
      from audit_log a left join app_user u on u.id = a.actor_user_id
      where a.subject_type = 'vendor' and a.subject_id = ${id} and a.action not like 'activity.%'
      order by a.created_at desc limit 30`),
  ]);
  const [extra] = await db.execute<{ costLevel: number | null; neighbourhood: string | null; tags: string | null; curatorNote: string | null }>(sql`
    select cost_level as "costLevel", neighbourhood, array_to_string(tags, chr(31)) as tags, curator_note as "curatorNote"
    from vendor where id = ${id}`);
  return {
    id,
    ...vendor,
    services: [...services],
    history: [...history],
    costLevel: extra?.costLevel ?? null,
    address: await readAddress(db, id),
    details: { neighbourhood: extra?.neighbourhood ?? null, tags: extra?.tags ? extra.tags.split('\u001f') : [], curatorNote: extra?.curatorNote ?? null },
  };
}

async function assertSlugFree(db: Db, slug: string, vendorId: string | null) {
  const [taken] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from (
      select id as vendor_id from vendor where slug = ${slug}
      union all select vendor_id from vendor_slug_history where slug = ${slug}
    ) s where ${vendorId}::uuid is null or s.vendor_id <> ${vendorId}::uuid
  `);
  if ((taken?.n ?? 0) > 0) throw new ListingConflict('slug', 'Another listing uses that web address. Choose a different one.');
}

async function freeSlug(db: Db, base: string): Promise<string> {
  for (let i = 1; i < 50; i++) {
    const candidate = i === 1 ? base : `${base.slice(0, 76)}-${i}`;
    try {
      await assertSlugFree(db, candidate, null);
      return candidate;
    } catch (err) {
      if (!(err instanceof ListingConflict)) throw err;
    }
  }
  throw new ListingConflict('slug', 'Choose a web address for this listing.');
}

async function setCategories(db: Db, vendorId: string, primaryId: string, ids: string[]) {
  await db.execute(sql`delete from vendor_category where vendor_id = ${vendorId}`);
  for (const categoryId of ids) {
    await db.execute(sql`
      insert into vendor_category (vendor_id, category_id, is_primary)
      values (${vendorId}, ${categoryId}, ${categoryId === primaryId})`);
  }
}

/** Creates a draft listing entered by the team. Returns its id. */
export async function createListing(
  env: ServerEnv,
  admin: Admin,
  input: ListingInput,
  fromSuggestionId: string | null = null,
): Promise<string> {
  return withDb(env, (db) =>
    db.transaction(async (tx) => {
      const id = uuidv7();
      const slug = input.slug ? await freeSlug(tx, input.slug) : await freeSlug(tx, 'listing');
      await tx.execute(sql`
        insert into vendor (id, slug, display_name, tagline, description, primary_municipality_id,
                            website_url, public_email, public_phone, source, created_by)
        values (${id}, ${slug}, ${input.name}, ${input.tagline}, ${input.description}, ${input.municipalityId},
                ${input.websiteUrl}, ${input.publicEmail}, ${input.publicPhone}, 'admin_entered', ${admin.userId})`);
      await setCategories(tx, id, input.primaryCategoryId, input.categoryIds);
      await audit(tx, {
        actor: admin.userId,
        action: 'vendor.create',
        subjectType: 'vendor',
        subjectId: id,
        reason: fromSuggestionId ? 'From a suggested business (D-25)' : null,
        changes: diff({}, { ...input, slug }),
        sessionRef: admin.sessionId,
      });
      if (fromSuggestionId) {
        // Suggest a business (X19): the suggestion becomes "added", linked to this draft.
        const linked = await tx.execute(sql`
          update vendor_suggestion set status = 'added', vendor_id = ${id}, reviewed_by = ${admin.userId}, reviewed_at = now()
          where id = ${fromSuggestionId} and status = 'new' returning id`);
        if (linked.length === 0) throw new ListingConflict('form', 'This suggestion was already dealt with.');
        await audit(tx, {
          actor: admin.userId,
          action: 'vendor_suggestion.added',
          subjectType: 'vendor_suggestion',
          subjectId: fromSuggestionId,
          changes: { vendorId: { from: null, to: id } },
          sessionRef: admin.sessionId,
        });
        // Their own business (D-63): a claim is started for them, confirmed as any claim is.
        await claimFromSuggestion(tx, admin, fromSuggestionId, id);
      }
      return id;
    }),
  );
}

/**
 * Saves the listing's details. Old web addresses keep working (vendor_slug_history). A box
 * an owner can also change is written only if the team member changed it, and refused if
 * the owner changed it too since the page loaded (`loaded`).
 */
export type TeamRename = {
  from: string;
  to: string;
  slug: string;
  owner: { userId: string; name: string; email: string } | null;
};

export async function updateListing(
  env: ServerEnv,
  admin: Admin,
  id: string,
  edited: ListingInput,
  loaded: LoadedListing,
): Promise<TeamRename | null> {
  return withDb(env, (db) =>
    db.transaction(async (tx) => {
      const before = await readVendor(tx, id, true);
      if (!before) throw new ListingConflict('form', 'This listing no longer exists.');
      if (before.status === 'archived') throw new ListingConflict('form', 'Archived listings can’t be edited.');
      const input = { ...edited };
      for (const k of OWNER_FIELDS) {
        if (sameText(edited[k], loaded[k])) input[k] = before[k];
        else if (!sameText(before[k], loaded[k])) throw new ListingConflict(k, changedByOwner(before[k]));
      }
      if (input.slug !== before.slug) {
        await assertSlugFree(tx, input.slug, id);
        await tx.execute(sql`
          insert into vendor_slug_history (slug, vendor_id) values (${before.slug}, ${id})
          on conflict (slug) do update set vendor_id = excluded.vendor_id, retired_at = now()`);
      }
      await tx.execute(sql`
        update vendor set slug = ${input.slug}, display_name = ${input.name}, tagline = ${input.tagline},
               description = ${input.description}, primary_municipality_id = ${input.municipalityId},
               website_url = ${input.websiteUrl}, public_email = ${input.publicEmail}, public_phone = ${input.publicPhone}
        where id = ${id}`);
      await setCategories(tx, id, input.primaryCategoryId, input.categoryIds);
      const changes = diff(before as unknown as Record<string, unknown>, {
        ...input,
        categoryIds: [...input.categoryIds].sort(),
      });
      if (Object.keys(changes).length > 0) {
        await audit(tx, {
          actor: admin.userId,
          action: 'vendor.update',
          subjectType: 'vendor',
          subjectId: id,
          changes,
          sessionRef: admin.sessionId,
        });
      }
      // A new name: the owner is told (M20, D-54). The database keeps the old one (vendor_name_kept).
      if (input.name === before.name) return null;
      const [owner] = await tx.execute<{ userId: string; name: string; email: string }>(sql`
        select u.id as "userId", u.display_name as name, u.email::text as email
        from vendor_member m join app_user u on u.id = m.user_id and u.deleted_at is null
        where m.vendor_id = ${id} and m.role = 'owner' and m.ended_at is null`);
      return { from: before.name, to: input.name, slug: input.slug, owner: owner ?? null };
    }),
  );
}

/**
 * How costly a business is, $ to $$$ (D-56): set by the team only, from what people say their
 * events cost; null takes it off. Recorded in the history.
 */
export async function setCostLevel(env: ServerEnv, admin: Admin, id: string, level: 1 | 2 | 3 | null): Promise<void> {
  await withDb(env, (db) =>
    db.transaction(async (tx) => {
      const [before] = await tx.execute<{ costLevel: number | null; status: string }>(sql`
        select cost_level as "costLevel", listing_status as status from vendor where id = ${id} for update`);
      if (!before) throw new ListingConflict('form', 'This listing no longer exists.');
      if (before.status === 'archived') throw new ListingConflict('form', 'Archived listings can’t be edited.');
      if (before.costLevel === level) return;
      await tx.execute(sql`update vendor set cost_level = ${level} where id = ${id}`);
      await audit(tx, {
        actor: admin.userId,
        action: 'vendor.cost_level',
        subjectType: 'vendor',
        subjectId: id,
        changes: { costLevel: { from: before.costLevel, to: level } },
        sessionRef: admin.sessionId,
      });
    }),
  );
}

/**
 * The neighbourhood, word tags and Curator's note on the Base44 profile (0056, D-59): set by the
 * team (G36). Only what changed is written, and recorded in the history.
 */
export async function setProfileDetails(env: ServerEnv, admin: Admin, id: string, next: ProfileDetails): Promise<void> {
  await withDb(env, (db) =>
    db.transaction(async (tx) => {
      const [before] = await tx.execute<{ status: string; neighbourhood: string | null; tags: string | null; curatorNote: string | null }>(sql`
        select listing_status as status, neighbourhood, array_to_string(tags, chr(31)) as tags, curator_note as "curatorNote"
        from vendor where id = ${id} for update`);
      if (!before) throw new ListingConflict('form', 'This listing no longer exists.');
      if (before.status === 'archived') throw new ListingConflict('form', 'Archived listings can’t be edited.');
      const was: ProfileDetails = {
        neighbourhood: before.neighbourhood,
        tags: before.tags ? before.tags.split('\u001f') : [],
        curatorNote: before.curatorNote,
      };
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (was.neighbourhood !== next.neighbourhood) changes.neighbourhood = { from: was.neighbourhood, to: next.neighbourhood };
      if (was.tags.join('\u001f') !== next.tags.join('\u001f')) changes.tags = { from: was.tags, to: next.tags };
      if (was.curatorNote !== next.curatorNote) changes.curatorNote = { from: was.curatorNote, to: next.curatorNote };
      if (Object.keys(changes).length === 0) return;
      // Only what changed is written, so another team member's change to the others stays.
      const sets = [
        changes.neighbourhood ? sql`neighbourhood = ${next.neighbourhood}` : null,
        changes.curatorNote ? sql`curator_note = ${next.curatorNote}` : null,
        // One text, split in the database (a list here would be sent as separate values).
        changes.tags ? sql`tags = string_to_array(${next.tags.join('\u001f')}, chr(31))` : null,
      ].filter((x) => x !== null);
      await tx.execute(sql`update vendor set ${sql.join(sets, sql`, `)} where id = ${id}`);
      await audit(tx, { actor: admin.userId, action: 'vendor.profile_details', subjectType: 'vendor', subjectId: id, changes, sessionRef: admin.sessionId });
    }),
  );
}

/** The one gatekeeper for listing status (ADR-017). */
export async function changeListingStatus(
  env: ServerEnv,
  admin: Admin,
  id: string,
  to: ListingStatus,
  reason: string | null,
): Promise<void> {
  await withDb(env, (db) =>
    db.transaction(async (tx) => {
      const [row] = await tx.execute<{ status: ListingStatus }>(sql`
        select listing_status as status from vendor where id = ${id} for update`);
      if (!row) throw new ListingConflict('form', 'This listing no longer exists.');
      if (!ADMIN_TRANSITIONS[row.status].includes(to)) {
        throw new ListingConflict(
          'form',
          `A listing that is ${STATUS_LABEL[row.status].toLowerCase()} can’t become ${STATUS_LABEL[to].toLowerCase()}.`,
        );
      }
      await tx.execute(sql`
        update vendor set listing_status = ${to},
               published_at = case when ${to} = 'published' then coalesce(published_at, now()) else published_at end,
               archived_at = case when ${to} = 'archived' then now() else archived_at end,
               owner_hidden_at = null   -- the team's decision replaces the owner's hiding (D-54)
        where id = ${id}`);
      await tx.execute(sql`
        insert into status_change (id, subject_type, subject_id, field, from_status, to_status, actor_user_id, actor_kind, reason)
        values (${uuidv7()}, 'vendor', ${id}, 'listing_status', ${row.status}, ${to}, ${admin.userId}, 'admin', ${reason})`);
      await audit(tx, {
        actor: admin.userId,
        action: `vendor.status.${to}`,
        subjectType: 'vendor',
        subjectId: id,
        reason,
        changes: { listing_status: { from: row.status, to } },
        sessionRef: admin.sessionId,
      });
    }),
  );
}

async function assertEditable(db: Db, vendorId: string) {
  const [v] = await db.execute<{ status: ListingStatus }>(sql`select listing_status as status from vendor where id = ${vendorId}`);
  if (!v) throw new ListingConflict('form', 'This listing no longer exists.');
  if (v.status === 'archived') throw new ListingConflict('form', 'Archived listings can’t be edited.');
}

/**
 * Adds a service, or saves an existing one of this listing. As with the details, the name,
 * description and price (which owners can change too) are written only if the team member
 * changed them, and refused if the owner changed them since the page loaded.
 */
export async function saveService(
  env: ServerEnv,
  admin: Admin,
  vendorId: string,
  serviceId: string | null,
  edited: ServiceInput,
  loaded: LoadedService | null,
): Promise<void> {
  await withDb(env, (db) =>
    db.transaction(async (tx) => {
      await assertEditable(tx, vendorId);
      const input = { ...edited };
      if (serviceId === null) {
        const id = uuidv7();
        await tx.execute(sql`
          insert into vendor_service (id, vendor_id, name, description, pricing_model, price_cents, price_note, sort_order)
          values (${id}, ${vendorId}, ${input.name}, ${input.description}, ${input.pricingModel}, ${input.priceCents}, ${input.priceNote},
                  (select coalesce(max(sort_order), 0) + 1 from vendor_service where vendor_id = ${vendorId}))`);
        await audit(tx, {
          actor: admin.userId,
          action: 'vendor.service.add',
          subjectType: 'vendor',
          subjectId: vendorId,
          changes: diff({}, { serviceId: id, ...input }),
          sessionRef: admin.sessionId,
        });
        return;
      }
      // The service must belong to this listing: the id in the form is never trusted alone.
      const [before] = await tx.execute<ServiceInput>(sql`
        select name, description, pricing_model as "pricingModel", price_cents as "priceCents", price_note as "priceNote"
        from vendor_service where id = ${serviceId} and vendor_id = ${vendorId}
        for update`);
      if (!before) throw new ListingConflict('form', 'That service isn’t part of this listing.');
      if (!loaded) throw new ListingConflict('form', 'This page was out of date. Reload it and try again.');
      for (const k of ['name', 'description'] as const) {
        if (sameText(edited[k], loaded[k])) (input as Record<string, unknown>)[k] = before[k];
        else if (!sameText(before[k], loaded[k])) throw new ListingConflict(k, changedByOwner(before[k]));
      }
      const samePrice = (a: Pick<ServiceInput, 'pricingModel' | 'priceCents'>, b: Pick<ServiceInput, 'pricingModel' | 'priceCents'>) =>
        a.pricingModel === b.pricingModel && a.priceCents === b.priceCents;
      if (samePrice(edited, loaded)) {
        input.pricingModel = before.pricingModel;
        input.priceCents = before.priceCents;
      } else if (!samePrice(before, loaded)) {
        throw new ListingConflict(
          'price',
          'The owner changed the price while you were editing. Reload the page, then make your change again.',
        );
      }
      await tx.execute(sql`
        update vendor_service set name = ${input.name}, description = ${input.description}, pricing_model = ${input.pricingModel},
               price_cents = ${input.priceCents}, price_note = ${input.priceNote}
        where id = ${serviceId} and vendor_id = ${vendorId}`);
      const changes = diff(before, input);
      if (Object.keys(changes).length > 0) {
        await audit(tx, {
          actor: admin.userId,
          action: 'vendor.service.update',
          subjectType: 'vendor',
          subjectId: vendorId,
          changes: { serviceId: { from: serviceId, to: serviceId }, ...changes },
          sessionRef: admin.sessionId,
        });
      }
    }),
  );
}

/** Hides or shows a service. Services are never deleted, so history stays complete. */
export async function setServiceActive(env: ServerEnv, admin: Admin, vendorId: string, serviceId: string, active: boolean) {
  await withDb(env, (db) =>
    db.transaction(async (tx) => {
      await assertEditable(tx, vendorId);
      const updated = await tx.execute(sql`
        update vendor_service set is_active = ${active}
        where id = ${serviceId} and vendor_id = ${vendorId} returning id`);
      if (updated.length === 0) throw new ListingConflict('form', 'That service isn’t part of this listing.');
      await audit(tx, {
        actor: admin.userId,
        action: active ? 'vendor.service.show' : 'vendor.service.hide',
        subjectType: 'vendor',
        subjectId: vendorId,
        changes: { serviceId: { from: serviceId, to: serviceId }, isActive: { from: !active, to: active } },
        sessionRef: admin.sessionId,
      });
    }),
  );
}
