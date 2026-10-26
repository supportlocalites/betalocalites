import { sql } from 'drizzle-orm';
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
