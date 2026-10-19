import { sql } from 'drizzle-orm';
import { type Address, type AddressForm, addressWords, NO_ADDRESS } from '@/lib/address';
import { audit } from './admin/audit.server';
import { findRun } from './business-name.server';
import { type Db, withDb } from './db.server';
import type { ServerEnv } from './env';
import { SAVES_PER_DAY } from './owner-listing.server';

/**
 * Business addresses and the map (D-56, D-57, migration 0054). The owner or a manager sets the
 * address on their own page (recorded like any owner change, so the team is told and can undo
 * it); the team sets it on the listing's page. Where the pin goes comes from OpenStreetMap's
 * free address search (Nominatim, $0, one look-up per save). A hidden number is never sent,
 * kept or shown: the pin is then found from the street alone, and marked approximate.
 */

export class AddressRefused extends Error {}

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

/** The address columns, as one value (the team's history and undo treat it as one change). */
export const ADDRESS_COLUMNS = sql`
  address_street as street, address_number as number, hide_address_number as hidden,
  map_lat as lat, map_lng as lng, map_approximate as approximate`;

export async function readAddress(db: Db, vendorId: string): Promise<Address> {
  const [a] = await db.execute<Address>(sql`select ${ADDRESS_COLUMNS} from vendor where id = ${vendorId}`);
  return a ?? NO_ADDRESS;
}

/** The address search's own address: Nominatim, or (tests only) a pretend one on this computer. */
function searchUrl(env: ServerEnv): string {
  const local = env.GEOCODE_URL;
  if (!local) return NOMINATIM;
  const host = new URL(local).hostname;
  return host === '127.0.0.1' || host === 'localhost' ? local : NOMINATIM;
}

/**
 * Where the pin goes, or null when the search doesn't find it (the business is then listed by
 * its town only, and the page says so). Never sent the number when it's hidden.
 */
export async function findPin(
  env: ServerEnv,
  a: AddressForm,
  town: string,
): Promise<{ lat: number; lng: number; approximate: boolean } | null | 'failed'> {
  if (!a.street) return null;
  // One look-up a second for the whole site (Nominatim's usage policy); busier, try again shortly.
  if (env.GEOCODE_LIMIT && !(await env.GEOCODE_LIMIT.limit({ key: 'nominatim' })).success) return 'failed';
  const approximate = a.hidden || !a.number;
  const url = new URL(searchUrl(env));
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'ca');
  url.searchParams.set('street', approximate ? a.street : `${a.number} ${a.street}`);
  url.searchParams.set('city', town);
  url.searchParams.set('state', 'Ontario');
  try {
    // Nominatim asks every site to say who it is (its usage policy).
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Localites (supportlocalites@gmail.com)', Accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return 'failed';
    const [hit] = (await res.json()) as { lat?: string; lon?: string }[];
    const lat = Number(hit?.lat);
    const lng = Number(hit?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 41 || lat > 57 || lng < -96 || lng > -74) return null;
    // Near the street, not at a door (about 100 m): enough for "which part of town".
    const round = (n: number) => (approximate ? Math.round(n * 1000) / 1000 : Math.round(n * 100000) / 100000);
    return { lat: round(lat), lng: round(lng), approximate };
  } catch (err) {
    console.error('address search failed:', err instanceof Error ? err.message : err);
    return 'failed';
  }
}

/** Not answering (down, busy, or over the limit): said plainly, and nothing is saved. */
export const SEARCH_DOWN = 'The map’s address search isn’t answering right now, so nothing was saved. Please try again in a few minutes.';

/** The same street, number and choice to hide as now: nothing to look up or save. */
const sameForm = (a: Address, f: AddressForm) => a.street === f.street && a.number === f.number && a.hidden === f.hidden;

const toAddress = (a: AddressForm, pin: { lat: number; lng: number; approximate: boolean } | null): Address => ({
  ...a,
  lat: pin?.lat ?? null,
  lng: pin?.lng ?? null,
  approximate: pin?.approximate ?? false,
});

/** An earlier address as the history keeps it once the number is hidden: no number, the new approximate pin. */
const withoutNumber = (before: Address, next: Address): Address => ({
  ...before,
  number: null,
  lat: next.lat,
  lng: next.lng,
  approximate: next.lat !== null,
});

async function writeAddress(tx: Db, vendorId: string, a: Address) {
  await tx.execute(sql`
    update vendor set address_street = ${a.street}, address_number = ${a.number}, hide_address_number = ${a.hidden},
                      map_lat = ${a.lat}, map_lng = ${a.lng}, map_approximate = ${a.approximate}
    where id = ${vendorId}`);
}

export type AddressPage = { vendorId: string; slug: string; name: string; town: string; address: Address };

/** The owner's or a manager's address page: null when it isn't their business (or it's archived). */
export async function addressPage(env: ServerEnv, userId: string, slug: string): Promise<AddressPage | null> {
  return withDb(env, async (db) => {
    const v = await findRun(db, userId, slug, false);
    if (!v || v.slug !== slug) return null;
    const [t] = await db.execute<{ town: string }>(sql`
      select m.name as town from vendor v join municipality m on m.id = v.primary_municipality_id where v.id = ${v.id}`);
    return { vendorId: v.id, slug: v.slug, name: v.name, town: t?.town ?? '', address: await readAddress(db, v.id) };
  });
}

const same = (a: Address, b: Address) =>
  a.street === b.street && a.number === b.number && a.hidden === b.hidden && a.lat === b.lat && a.lng === b.lng && a.approximate === b.approximate;

/**
 * The owner or a manager saves the address: checked in the database on this request (their
 * membership, locked), within the day's saves, recorded in audit_log with an owner_change
 * flagged 'address' (the team's "check now" email and undo).
 */
export async function saveOwnerAddress(
  env: ServerEnv,
  userId: string,
  slug: string,
  form: AddressForm,
): Promise<{ auditId: string; address: Address } | 'unchanged'> {
  const page = await addressPage(env, userId, slug);
  if (!page) throw new AddressRefused('not found');
  if (sameForm(page.address, form)) return 'unchanged';
  // The search is outside the step that writes (it's another site, and can take a moment).
  const pin = await findPin(env, form, page.town);
  if (pin === 'failed') throw new AddressRefused(SEARCH_DOWN);
  const next = toAddress(form, pin);
  return withDb(env, (db) =>
    db.transaction(async (tx) => {
      const v = await findRun(tx, userId, slug, true);
      if (!v || v.id !== page.vendorId) throw new AddressRefused('not found');
      const before = await readAddress(tx, v.id);
      if (same(before, next)) return 'unchanged' as const;
      const [today] = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from owner_change where vendor_id = ${v.id} and created_at > now() - interval '1 day'`);
      if ((today?.n ?? 0) >= SAVES_PER_DAY) {
        throw new AddressRefused('You’ve saved a lot of changes today. Please try again tomorrow, or email supportlocalites@gmail.com.');
      }
      await writeAddress(tx, v.id, next);
      const auditId = await audit(tx, {
        actor: userId,
        action: 'vendor.owner_edit',
        subjectType: 'vendor',
        subjectId: v.id,
        // Hiding the number keeps no copy of it, even in the team's history, so an undo can't
        // bring it back ("Never on Localites", the owner, 19 October 2026).
        // Nor the exact pin it had: the earlier one is kept as the new, approximate one.
        changes: { address: { from: next.hidden ? withoutNumber(before, next) : before, to: next } },
      });
      await tx.execute(sql`insert into owner_change (audit_id, vendor_id, flags) values (${auditId}, ${v.id}, '{address}')`);
      return { auditId, address: next };
    }),
  );
}

/** The team sets a listing's address (recorded in audit_log). */
export async function setTeamAddress(
  env: ServerEnv,
  admin: { userId: string; sessionId: string | null },
  vendorId: string,
  form: AddressForm,
): Promise<Address | 'unchanged'> {
  const [t] = await withDb(env, (db) =>
    db.execute<{ town: string }>(sql`
      select m.name as town from vendor v join municipality m on m.id = v.primary_municipality_id where v.id = ${vendorId}`),
  );
  if (!t) throw new AddressRefused('not found');
  if (sameForm(await withDb(env, (db) => readAddress(db, vendorId)), form)) return 'unchanged';
  const pin = await findPin(env, form, t.town);
  if (pin === 'failed') throw new AddressRefused(SEARCH_DOWN);
  const next = toAddress(form, pin);
  return withDb(env, (db) =>
    db.transaction(async (tx) => {
      const [locked] = await tx.execute<{ status: string }>(sql`select listing_status as status from vendor where id = ${vendorId} for update`);
      if (!locked) throw new AddressRefused('not found');
      if (locked.status === 'archived') throw new AddressRefused('Archived listings can’t be edited.');
      const before = await readAddress(tx, vendorId);
      if (same(before, next)) return 'unchanged' as const;
      await writeAddress(tx, vendorId, next);
      await audit(tx, {
        actor: admin.userId,
        sessionRef: admin.sessionId ?? undefined,
        action: 'vendor.address',
        subjectType: 'vendor',
        subjectId: vendorId,
        changes: { address: { from: addressWords(next.hidden ? withoutNumber(before, next) : before), to: addressWords(next) } },
      });
      return next;
    }),
  );
}

/** The team's undo of an owner's address change: all of it at once (the database checks the parts together). */
export async function restoreAddress(tx: Db, vendorId: string, value: unknown) {
  const a = { ...NO_ADDRESS, ...((value ?? {}) as Partial<Address>) };
  // Never a number back onto a business that hides it now ("Never on Localites").
  if (a.number && (await readAddress(tx, vendorId)).hidden) {
    throw new AddressRefused('The business hides its street number now, so the earlier address can’t be put back.');
  }
  await writeAddress(tx, vendorId, a);
}
