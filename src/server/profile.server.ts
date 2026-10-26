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
    db.execute<{ lat: number | null; lng: number | null; lookup: string | null; hasAddress: boolean; tried: boolean }>(sql`
      select home_lat as lat, home_lng as lng, home_lookup as lookup,
             (street_address is not null or postal_code is not null) as "hasAddress",
             coalesce(home_tried_at > now() - interval '1 hour', false) as tried
      from person_profile where user_id = ${userId}`),
  );
  if (!row) return { home: null, hasAddress: false, lookUp: false };
  const home = row.lat !== null && row.lng !== null ? { lat: Number(row.lat), lng: Number(row.lng) } : null;
  return { home, hasAddress: row.hasAddress, lookUp: row.hasAddress && row.lookup === null && !row.tried };
}

/** A database error's code only: its message would carry the address (drizzle puts the values in it). */
const quiet = (err: unknown) => (err as { cause?: { code?: string } })?.cause?.code ?? (err instanceof Error ? err.name : 'unknown');

/**
 * Looks up where the person's address is, and keeps it (or that it wasn't found). One at a time:
 * the look-up is claimed first, so two pages at once don't both ask, and one the search didn't
 * answer isn't tried again within the hour. Only kept if the address is still the one looked up
 * (a change in the meantime clears it again, 0060's trigger). `again`: they've just saved their
 * address, so one not found before is tried once more. Never throws, and never logs the address.
 */
export async function lookUpHome(env: ServerEnv, userId: string, again = false): Promise<void> {
  try {
    const [p] = await withDb(env, (db) =>
      db.execute<{ street: string | null; town: string | null; province: string | null; postalCode: string | null }>(sql`
        update person_profile
        set home_tried_at = now(),
            home_lookup = case when ${again} and home_lookup = 'not_found' then null else home_lookup end,
            home_looked_up_at = case when ${again} and home_lookup = 'not_found' then null else home_looked_up_at end
        where user_id = ${userId}
          and (home_lookup is null or (${again} and home_lookup = 'not_found'))
          and (home_tried_at is null or home_tried_at < now() - interval '1 hour' or ${again})
        returning street_address as street, town, province, postal_code as "postalCode"`),
    );
    if (!p) return;
    // Background look-ups wait their turn behind owners' saves (D-64).
    if (!again && env.HOME_GEOCODE_LIMIT && !(await env.HOME_GEOCODE_LIMIT.limit({ key: 'home' })).success) {
      await withDb(env, (db) => db.execute(sql`update person_profile set home_tried_at = null where user_id = ${userId} and home_lookup is null`));
      return;
    }
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
  } catch (err) {
    console.error('home look-up not recorded:', quiet(err));
  }
}
