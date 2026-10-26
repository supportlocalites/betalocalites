import { sql } from 'drizzle-orm';
import { findHomePoint } from './address.server';
import { type Db, withDb } from './db.server';
import type { ServerEnv } from './env';
import { isEmptyProfile, type Profile } from './member-input';

/**
 * A person's own details (D-36): only ever read or written for the signed-in person
 * themselves. Businesses never see them (D-30: totals only). Nothing given, nothing kept.
 */

export async function getProfile(env: ServerEnv, userId: string): Promise<Profile | null> {
  const [row] = await withDb(env, (db) =>
    db.execute<Profile>(sql`
      select gender, gender_self_described as "genderSelfDescribed", date_of_birth::text as "dateOfBirth",
             street_address as "streetAddress", unit, town, province, postal_code as "postalCode"
      from person_profile where user_id = ${userId}`),
  );
  return row ?? null;
}

/** Saves the details, or removes them when every one is blank. Call inside a transaction. */
export async function writeProfile(db: Db, userId: string, p: Profile): Promise<void> {
  if (isEmptyProfile(p)) {
    await db.execute(sql`delete from person_profile where user_id = ${userId}`);
    return;
  }
  await db.execute(sql`
    insert into person_profile (user_id, gender, gender_self_described, date_of_birth, street_address, unit, town, province, postal_code)
    values (${userId}, ${p.gender}, ${p.genderSelfDescribed}, ${p.dateOfBirth}::date, ${p.streetAddress}, ${p.unit}, ${p.town},
            ${p.province}, ${p.postalCode})
    on conflict (user_id) do update set
      gender = excluded.gender, gender_self_described = excluded.gender_self_described,
      date_of_birth = excluded.date_of_birth, street_address = excluded.street_address, unit = excluded.unit,
      town = excluded.town, province = excluded.province, postal_code = excluded.postal_code`);
}

/**
 * Distances from home (D-64): the person's own home point, sent only to their own browser.
 * `lookUp`: they have an address that hasn't been looked up yet.
 */
export async function homeFor(env: ServerEnv, userId: string): Promise<{ home: { lat: number; lng: number } | null; hasAddress: boolean; lookUp: boolean }> {
  const [row] = await withDb(env, (db) =>
    db.execute<{ lat: number | null; lng: number | null; lookup: string | null; hasAddress: boolean }>(sql`
      select home_lat as lat, home_lng as lng, home_lookup as lookup,
             (street_address is not null or postal_code is not null) as "hasAddress"
      from person_profile where user_id = ${userId}`),
  );
  if (!row) return { home: null, hasAddress: false, lookUp: false };
  const home = row.lat !== null && row.lng !== null ? { lat: Number(row.lat), lng: Number(row.lng) } : null;
  return { home, hasAddress: row.hasAddress, lookUp: row.hasAddress && row.lookup === null };
}

/**
 * Looks up where the person's address is, and keeps it (or that it wasn't found). Only if the
 * address is still the one looked up: a change in the meantime clears it again (0060's trigger).
 * The search not answering leaves it to try again on their next visit.
 */
export async function lookUpHome(env: ServerEnv, userId: string): Promise<void> {
  const [p] = await withDb(env, (db) =>
    db.execute<{ street: string | null; town: string | null; province: string | null; postalCode: string | null }>(sql`
      select street_address as street, town, province, postal_code as "postalCode"
      from person_profile where user_id = ${userId} and home_lookup is null`),
  );
  if (!p) return;
  const point = await findHomePoint(env, p);
  if (point === 'failed') return;
  await withDb(env, (db) =>
    db.execute(sql`
      update person_profile
      set home_lat = ${point?.lat ?? null}, home_lng = ${point?.lng ?? null},
          home_lookup = ${point ? 'found' : 'not_found'}, home_looked_up_at = now()
      where user_id = ${userId} and home_lookup is null
        and street_address is not distinct from ${p.street} and town is not distinct from ${p.town}
        and province is not distinct from ${p.province} and postal_code is not distinct from ${p.postalCode}`),
  );
}
