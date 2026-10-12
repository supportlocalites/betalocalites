import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { uuidv7 } from '@/lib/ids.mjs';
import { PRICING_MODELS } from '@/lib/listing-status';
import { describePrice } from '@/lib/price';
import { audit } from './admin/audit.server';
import type { Member } from './auth/member.server';
import { type Db, withDb } from './db.server';
import { sendEmail, TEAM_ADDRESS } from './email.server';
import type { ServerEnv } from './env';
import { type ChangeSet, describeChanges, findClashes, flatten, ownerDiff, riskFlags, serviceIdOf } from './owner-changes';
import { MAX_SHOWN_SERVICES, type OwnerValues } from './owner-input';

/**
 * An owner editing their own listing (D-34, ADR-029). Every request checks, in the
 * database, that this person is the business's current owner; nothing from the page is
 * trusted for that. Saves go live at once, are recorded in audit_log (the one record of
 * what changed) with an owner_change row for the team's daily note and undo.
 */

/** Saves one business may make in a day (D-34 keeps edits live; this keeps them reviewable). */
export const SAVES_PER_DAY = 20;
/** "Check now" emails: at most one per business an hour, and this many a day site-wide. */
const ALERTS_PER_DAY = 20;

export class OwnerRefused extends Error {}
/** Not (or no longer) this business's owner: the page answers "You can't edit this listing". */
export class NotOwner extends Error {}

type ServiceRow = { id: string; name: string; description: string | null; pricingModel: string; priceCents: number | null; isActive: boolean };

async function readServices(db: Db, vendorId: string): Promise<ServiceRow[]> {
  return [
    ...(await db.execute<ServiceRow>(sql`
      select id, name, description, pricing_model as "pricingModel", price_cents as "priceCents", is_active as "isActive"
      from vendor_service where vendor_id = ${vendorId}
      order by sort_order, created_at`)),
  ];
}

const toValues = (
  v: { tagline: string | null; description: string | null; websiteUrl: string | null; publicPhone: string | null },
  services: ServiceRow[],
): OwnerValues => ({
  tagline: v.tagline,
  description: v.description,
  websiteUrl: v.websiteUrl,
  publicPhone: v.publicPhone,
  services: services.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    price: { pricingModel: s.pricingModel as OwnerValues['services'][number]['price']['pricingModel'], priceCents: s.priceCents },
    shown: s.isActive,
  })),
});

/** Today's owner-editable values as flat keys, with service names (for the team's tools). */
export async function readCurrent(db: Db, vendorId: string): Promise<{ flat: Record<string, unknown>; names: Map<string, string> }> {
  const [v] = await db.execute<{ tagline: string | null; description: string | null; websiteUrl: string | null; publicPhone: string | null }>(sql`
    select tagline, description, website_url as "websiteUrl", public_phone as "publicPhone" from vendor where id = ${vendorId}`);
  const services = await readServices(db, vendorId);
  return {
    flat: v ? flatten(toValues(v, services)) : {},
    names: new Map(services.map((s) => [s.id, s.name])),
  };
}

type Owned = {
  id: string;
  slug: string;
  name: string;
  status: string;
  tagline: string | null;
  description: string | null;
  websiteUrl: string | null;
  publicPhone: string | null;
};

/**
 * The listing, if this person is its current owner and it isn't archived. When asked, it
 * locks the listing and the membership too: a save that waited for "Remove owner" then
 * sees the ended membership, so the team's decision always wins.
 */
async function findOwned(db: Db, userId: string, by: { slug: string } | { id: string }, lock = false): Promise<Owned | null> {
  const where = 'slug' in by ? sql`v.slug = ${by.slug}` : sql`v.id = ${by.id}`;
  const [v] = await db.execute<Owned>(sql`
    select v.id, v.slug::text as slug, v.display_name as name, v.listing_status as status, v.tagline, v.description,
           v.website_url as "websiteUrl", v.public_phone as "publicPhone"
    from vendor v
    join vendor_member m on m.vendor_id = v.id and m.user_id = ${userId} and m.role = 'owner' and m.ended_at is null
    where ${where} and v.listing_status <> 'archived'
    ${lock ? sql`for update of v for share of m` : sql``}`);
  return v ?? null;
}

/** By web address, or by an old one the team has since changed (vendor_slug_history). */
async function findOwnedBySlug(db: Db, userId: string, slug: string, lock = false): Promise<Owned | null> {
  const v = await findOwned(db, userId, { slug }, lock);
  if (v) return v;
  const [old] = await db.execute<{ vendorId: string }>(sql`
    select h.vendor_id as "vendorId" from vendor_slug_history h join vendor v on v.id = h.vendor_id
    where h.slug = ${slug} and v.slug <> ${slug}`);
  return old ? findOwned(db, userId, { id: old.vendorId }, lock) : null;
}

export type UndoNotice = { at: string; lines: string[]; reason: string | null };
export type OwnedListing = {
  vendorId: string;
  slug: string;
  hidden: boolean;
  view: { name: string; town: string; categories: string[] };
  values: OwnerValues;
  undone: UndoNotice[];
};

/**
 * The edit page's data, or a redirect for an old web address, or why not: "archived" (their
 * listing is no longer on Localites) or null (not this person's).
 */
export async function ownedListing(
  env: ServerEnv,
  userId: string,
  slug: string,
): Promise<OwnedListing | { renamedTo: string } | { archived: true } | null> {
  return withDb(env, async (db) => {
    const v = await findOwnedBySlug(db, userId, slug);
    if (!v) {
      const [archived] = await db.execute<{ id: string }>(sql`
        select v.id from vendor v join vendor_member m on m.vendor_id = v.id
        where v.slug = ${slug} and v.listing_status = 'archived'
          and m.user_id = ${userId} and m.role = 'owner' and m.ended_at is null`);
      return archived ? { archived: true } : null;
    }
    if (v.slug !== slug) return { renamedTo: v.slug };
    const [services, [where], undos] = await Promise.all([
      readServices(db, v.id),
      db.execute<{ town: string; categories: string[] }>(sql`
        select m.name as town,
               coalesce((select json_agg(c.name order by vc.is_primary desc, c.name)
                         from vendor_category vc join category c on c.id = vc.category_id
                         where vc.vendor_id = v.id), '[]'::json) as categories
        from vendor v join municipality m on m.id = v.primary_municipality_id where v.id = ${v.id}`),
      // Only this person's own saves: a new owner never sees what the team told the last one.
      db.execute<{ at: string; changes: ChangeSet; reason: string | null }>(sql`
        select u.created_at::text as at, u.changes, u.reason
        from owner_change oc join audit_log a on a.id = oc.audit_id join audit_log u on u.id = oc.undo_audit_id
        where oc.vendor_id = ${v.id} and a.actor_user_id = ${userId} and oc.undone_at > now() - interval '14 days'
        order by oc.undone_at desc limit 5`),
    ]);
    const names = new Map(services.map((s) => [s.id, s.name]));
    return {
      vendorId: v.id,
      slug: v.slug,
      hidden: v.status !== 'published',
      view: { name: v.name, town: where?.town ?? '', categories: where?.categories ?? [] },
      values: toValues(v, services),
      undone: undos.map((u) => ({
        at: u.at,
        reason: u.reason,
        lines: describeChanges(u.changes ?? {}, (id) => names.get(id) ?? 'a service'),
      })),
    };
  });
}

// The page's own copy of what it loaded, sent back with the form: anything it says is
// checked again against the database before a single value is written.
const priceSchema = z.object({ pricingModel: z.enum(PRICING_MODELS), priceCents: z.number().int().min(0).nullable() });
const baseSchema = z.object({
  tagline: z.string().nullable(),
  description: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  publicPhone: z.string().nullable(),
  services: z
    .array(z.object({ id: z.uuid(), name: z.string(), description: z.string().nullable(), price: priceSchema, shown: z.boolean() }))
    .max(500),
});

export function readBase(json: string): OwnerValues | null {
  try {
    const r = baseSchema.safeParse(JSON.parse(json));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** The page's starting values with some fields replaced by today's (after a clash). */
export function rebase(base: OwnerValues, current: Record<string, unknown>): OwnerValues {
  const next: OwnerValues = { ...base, services: base.services.map((s) => ({ ...s })) };
  for (const [key, value] of Object.entries(current)) {
    if (key in VENDOR_COLUMNS) (next as Record<string, unknown>)[key] = value;
    const id = serviceIdOf(key);
    const service = id ? next.services.find((s) => s.id === id) : undefined;
    if (service) (service as Record<string, unknown>)[key.split(':')[2]!] = value;
  }
  return next;
}

export type SaveResult =
  | { status: 'saved'; auditId: string; flags: ('website' | 'phone')[]; slug: string }
  | { status: 'nothing' }
  | { status: 'clash'; current: Record<string, unknown>; nextBase: OwnerValues };

const VENDOR_COLUMNS = { tagline: 'tagline', description: 'description', websiteUrl: 'website_url', publicPhone: 'public_phone' } as const;

/** Saves an owner's edits, all or nothing. Only what they changed is written. */
export async function saveOwnerEdits(env: ServerEnv, member: Member, slug: string, base: OwnerValues, submitted: OwnerValues): Promise<SaveResult> {
  return withDb(env, (db) =>
    db.transaction(async (tx) => {
      // Still the owner, checked again with the business locked, so a team decision made
      // while the page was open (removed as owner, archived) always wins. A web address
      // the team changed meanwhile still finds the listing.
      const v = await findOwnedBySlug(tx, member.userId, slug, true);
      if (!v) throw new NotOwner();
      const vendorId = v.id;
      const [count] = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from owner_change where vendor_id = ${vendorId} and created_at > now() - interval '1 day'`);
      if ((count?.n ?? 0) >= SAVES_PER_DAY) {
        throw new OwnerRefused('You’ve saved a lot of changes today. Please try again tomorrow, or email supportlocalites@gmail.com.');
      }

      const diff = ownerDiff(base, submitted, () => uuidv7());
      if (!diff) throw new OwnerRefused('Something on the page was out of date. Please reload it and try again.');
      const { changes, added } = diff;
      if (Object.keys(changes).length === 0) return { status: 'nothing' };

      const services = await readServices(tx, vendorId);
      const shownBefore = services.filter((s) => s.isActive).length;
      const current = flatten(toValues(v, services));
      const clashes = findClashes(changes, current);
      if (clashes.length > 0) {
        // Next time, the owner's version of those fields is compared with today's, so
        // saving again uses theirs; everything else still compares with what they loaded.
        const nextBase = rebase(base, Object.fromEntries(clashes.map((k) => [k, current[k] ?? null])));
        return { status: 'clash', current: Object.fromEntries(clashes.map((k) => [k, current[k] ?? null])), nextBase };
      }

      // The business's own fields: only the ones the owner changed.
      const has = (k: keyof typeof VENDOR_COLUMNS) => k in changes;
      const val = (k: keyof typeof VENDOR_COLUMNS) => (changes[k]?.to ?? null) as string | null;
      if (Object.keys(VENDOR_COLUMNS).some((k) => has(k as keyof typeof VENDOR_COLUMNS))) {
        await tx.execute(sql`
          update vendor set
            tagline = case when ${has('tagline')} then ${val('tagline')} else tagline end,
            description = case when ${has('description')} then ${val('description')} else description end,
            website_url = case when ${has('websiteUrl')} then ${val('websiteUrl')} else website_url end,
            public_phone = case when ${has('publicPhone')} then ${val('publicPhone')} else public_phone end
          where id = ${vendorId}`);
      }

      // Services, each one scoped to this business: an id from elsewhere changes nothing
      // and stops the whole save.
      const byService = new Map<string, Record<string, unknown>>();
      for (const [key, c] of Object.entries(changes)) {
        const id = serviceIdOf(key);
        if (!id) continue;
        const fields = byService.get(id) ?? {};
        fields[key.split(':')[2]!] = c.to;
        byService.set(id, fields);
      }
      for (const [id, f] of byService) {
        const price = f.price as { pricingModel: string; priceCents: number | null } | undefined;
        if (added.includes(id)) {
          await tx.execute(sql`
            insert into vendor_service (id, vendor_id, name, description, pricing_model, price_cents, is_active, sort_order)
            values (${id}, ${vendorId}, ${f.name as string}, ${(f.description as string | undefined) ?? null},
                    ${price!.pricingModel}, ${price!.priceCents}, ${f.shown as boolean},
                    (select coalesce(max(sort_order), 0) + 1 from vendor_service where vendor_id = ${vendorId}))`);
          continue;
        }
        const updated = await tx.execute(sql`
          update vendor_service set
            name = case when ${'name' in f} then ${(f.name as string | undefined) ?? null} else name end,
            description = case when ${'description' in f} then ${(f.description as string | null | undefined) ?? null} else description end,
            pricing_model = case when ${price !== undefined} then ${price?.pricingModel ?? null} else pricing_model end,
            price_cents = case when ${price !== undefined} then ${price?.priceCents ?? null}::int else price_cents end,
            is_active = case when ${'shown' in f} then ${(f.shown as boolean | undefined) ?? null}::boolean else is_active end
          where id = ${id} and vendor_id = ${vendorId} returning id`);
        if (updated.length === 0) throw new OwnerRefused('Something on the page was out of date. Please reload it and try again.');
      }
      const [shown] = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from vendor_service where vendor_id = ${vendorId} and is_active`);
      // Over the limit only by showing more than before (the team may have shown more).
      if ((shown?.n ?? 0) > MAX_SHOWN_SERVICES && (shown?.n ?? 0) > shownBefore) {
        throw new OwnerRefused(`You can show up to ${MAX_SHOWN_SERVICES} services. Hide one to add another.`);
      }

      const flags = riskFlags(changes);
      const auditId = await audit(tx, { actor: member.userId, action: 'vendor.owner_edit', subjectType: 'vendor', subjectId: vendorId, changes });
      await tx.execute(sql`
        insert into owner_change (audit_id, vendor_id, flags) values (${auditId}, ${vendorId}, ${`{${flags.join(',')}}`}::text[])`);
      return { status: 'saved', auditId, flags, slug: v.slug };
    }),
  );
}

/**
 * The "check now" email for a new website or phone (ADR-029), sent after the owner sees
 * "Saved". At most one per business an hour and ALERTS_PER_DAY across the site (Resend's
 * free 100 a day are shared); over that, it waits for the daily note. Each email's place
 * is taken under one lock before it goes, so quick saves can't all get one. Recorded
 * either way.
 */
export async function alertTeam(env: ServerEnv, auditId: string, siteUrl: string): Promise<void> {
  await withDb(env, async (db) => {
    type Row = { vendorId: string; business: string; owner: string; changes: ChangeSet; recent: number; today: number };
    const row = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('localites.owner-alert', 0))`);
      const [r] = await tx.execute<Row>(sql`
        select oc.vendor_id as "vendorId", v.display_name as business, coalesce(u.display_name, 'the owner') as owner, a.changes,
               (select count(*) from owner_change x where x.vendor_id = oc.vendor_id and x.alert_status in ('sending', 'sent')
                  and x.created_at > now() - interval '1 hour')::int as recent,
               (select count(*) from owner_change x where x.alert_status in ('sending', 'sent')
                  and x.created_at > now() - interval '1 day')::int as today
        from owner_change oc join audit_log a on a.id = oc.audit_id join vendor v on v.id = oc.vendor_id
        left join app_user u on u.id = a.actor_user_id
        where oc.audit_id = ${auditId} and oc.alert_status = 'none' and cardinality(oc.flags) > 0
        for update of oc`);
      if (!r) return null;
      const send = r.recent === 0 && r.today < ALERTS_PER_DAY;
      await tx.execute(sql`update owner_change set alert_status = ${send ? 'sending' : 'skipped'} where audit_id = ${auditId}`);
      return send ? r : null;
    });
    if (!row) return;
    const lines = describeChanges(row.changes, () => 'a service').filter((l) => /^(Website|Phone):/.test(l));
    const what = lines.map((l) => l.split(':')[0]!.toLowerCase()).join(' and ');
    const result = await sendEmail(env, {
      to: TEAM_ADDRESS,
      subject: `Check now: ${row.business} changed its ${what}`.slice(0, 150),
      text: [
        `${row.owner}, the owner of ${row.business}, just changed:`,
        '',
        ...lines,
        '',
        'It’s already live. If it looks wrong (another website, a number that isn’t theirs), undo it on the listing’s admin page:',
        `${siteUrl}/admin/listings/${row.vendorId}#owner-changes`,
      ].join('\n'),
    });
    const [status, error] = result.sent ? ['sent', null] : env.RESEND_API_KEY ? ['failed', result.reason.slice(0, 300)] : ['skipped', null];
    await db.execute(sql`update owner_change set alert_status = ${status}, alert_error = ${error} where audit_id = ${auditId}`);
  });
}

/** Plain words for a service's price, the same as the public page. */
export const priceWords = (p: { pricingModel: string; priceCents: number | null }) =>
  describePrice(p.pricingModel as Parameters<typeof describePrice>[0], p.priceCents) ?? 'No price shown';
