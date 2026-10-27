import { sql } from 'drizzle-orm';
import { PROVINCES, type Province } from '@/lib/claim-terms';
import { searchUrl } from './address.server';
import { type Db, withDb } from './db.server';
import type { ServerEnv } from './env';

/**
 * A person's own address, found on the map (the owner, 27 October 2026: "bring up that address
 * looker and make sure I select the right address and then can autofill in my info"). They type
 * it and press Find; OpenStreetMap's free address search (Nominatim, $0) offers a few places, and
 * the one they choose fills in the boxes and puts a house on their own Browse local map. Pressing
 * Find is one look-up: never while typing (Nominatim's usage policy allows no type-ahead). The
 * point is exact, for that person only (migration 0060): never shown to anyone else.
 */

export type FoundPlace = {
  label: string;
  streetAddress: string | null;
  town: string | null;
  province: Province | null;
  postalCode: string | null;
  lat: number;
  lng: number;
};

const PROVINCE_BY_NAME = new Map(Object.entries(PROVINCES).map(([k, v]) => [v.toLowerCase(), k as Province]));

/** Up to five places for what they typed, in Canada; null when the search isn't answering. */
export async function findPlaces(env: ServerEnv, typed: string): Promise<FoundPlace[] | null> {
  // One look-up a second for the whole site (Nominatim's usage policy); busier, try again shortly.
  if (env.GEOCODE_LIMIT && !(await env.GEOCODE_LIMIT.limit({ key: 'nominatim' })).success) return null;
  const url = new URL(searchUrl(env));
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '5');
  url.searchParams.set('countrycodes', 'ca');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('q', typed);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Localites (supportlocalites@gmail.com)', Accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const hits = (await res.json()) as {
      lat?: string;
      lon?: string;
      address?: Record<string, string | undefined>;
    }[];
    const places: FoundPlace[] = [];
    for (const h of Array.isArray(hits) ? hits : []) {
      const lat = Number(h.lat);
      const lng = Number(h.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 41 || lat > 57 || lng < -96 || lng > -74) continue;
      const a = h.address ?? {};
      const street = [a.house_number, a.road].filter(Boolean).join(' ') || null;
      const town = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality ?? null;
      const province = a.state ? (PROVINCE_BY_NAME.get(a.state.toLowerCase()) ?? null) : null;
      const postal = a.postcode && /^[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d$/.test(a.postcode) ? a.postcode.toUpperCase().replace(/^(.{3}) ?/, '$1 ') : null;
      const label = [street, town, province && postal ? `${province} ${postal}` : (province ?? postal)].filter(Boolean).join(', ');
      if (!label || places.some((p) => p.label === label)) continue;
      places.push({ label, streetAddress: street, town, province, postalCode: postal, lat, lng });
    }
    return places;
  } catch (err) {
    console.error('address search failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Where their home is on the map, if they chose it from the search (their own only). */
export async function homePoint(env: ServerEnv, userId: string): Promise<{ lat: number; lng: number } | null> {
  const [row] = await withDb(env, (db) =>
    db.execute<{ lat: number; lng: number }>(sql`
      select home_lat as lat, home_lng as lng from person_profile
      where user_id = ${userId} and home_lookup = 'found' and home_lat is not null`),
  );
  return row ? { lat: Number(row.lat), lng: Number(row.lng) } : null;
}

/**
 * Keeps the place they chose, after their details are saved. Changing the address clears it
 * (0060's trigger), so this runs after, on the address as it now is.
 */
export async function writeHomePoint(db: Db, userId: string, home: { lat: number; lng: number }): Promise<void> {
  await db.execute(sql`
    update person_profile set home_lat = ${home.lat}, home_lng = ${home.lng}, home_lookup = 'found', home_looked_up_at = now()
    where user_id = ${userId}`);
}
