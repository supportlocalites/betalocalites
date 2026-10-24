// Loads the sample businesses (demo-businesses.mjs) into a TEST database, fully filled in:
// published, with a description, services, cost level, phone, email, website, towns served,
// address and map pin, page photos and a profile photo (drawings in public/sample-photos/).
// Each says on its page that it's a sample. Never runs against production: it refuses unless the
// database name contains "test" or "dev", or --supabase-test-project is given (as CI does).
//
// Safe to run on every push: a sample business already there is left as it is, so changes the
// team makes to it stay. To take them all down (before launch): add --remove. They're archived,
// not deleted (the audit log keeps them), and later runs never bring them back.
//
// Usage: DATABASE_ADMIN_URL=postgres://.../localites_dev npm run db:demo [-- --remove]
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { normalizeDatabaseUrl, requiresTls } from '../../src/lib/db-url.mjs';
import { uuidv7 } from '../../src/lib/ids.mjs';
import { SAMPLE_NOTE } from './demo-businesses.mjs';
import { SAMPLE_BUSINESSES_D60 } from './sample-businesses-d60.mjs';

// Since the Base44 design (D-59, D-60) the samples are the 60 in sample-businesses-d60.mjs. The
// first ten (demo-businesses.mjs, the old kinds of business) are taken down once (RETIRED).
const DEMO_BUSINESSES = SAMPLE_BUSINESSES_D60;
const RETIRED = 'demo.first_samples_retired';

const here = path.dirname(fileURLToPath(import.meta.url));
const PHOTOS = path.join(here, '..', '..', 'public', 'sample-photos');
const REMOVED = 'demo.sample_businesses_removed';
const TEST_HIDDEN = 'demo.test_vendors_hidden';

if (!process.env.DATABASE_ADMIN_URL) {
  console.error('Set DATABASE_ADMIN_URL.');
  process.exit(1);
}
const url = normalizeDatabaseUrl(process.env.DATABASE_ADMIN_URL);
const dbName = new URL(url).pathname.slice(1);
if (!/test|dev/.test(dbName) && !process.argv.includes('--supabase-test-project')) {
  console.error(`Refusing to load sample businesses into "${dbName}". Use a test or dev database.`);
  process.exit(1);
}
const remove = process.argv.includes('--remove');

const sql = postgres(url, { max: 1, onnotice: () => {}, ssl: requiresTls(url) ? 'require' : false });
try {
  const [{ removed }] = await sql`select exists (select 1 from audit_log where action = ${REMOVED}) as removed`;
  if (remove) {
    await sql.begin(async (tx) => {
      const gone = await tx`
        select id, listing_status as status from vendor where slug like 'sample-%' and listing_status <> 'archived' for update`;
      for (const { id, status } of gone) {
        await tx`update vendor set listing_status = 'archived', archived_at = now() where id = ${id}`;
        await tx`insert into status_change (id, subject_type, subject_id, field, from_status, to_status, actor_user_id, actor_kind, reason)
                 values (${uuidv7()}, 'vendor', ${id}, 'listing_status', ${status}, 'archived', null, 'system', 'Sample business taken down.')`;
        await tx`insert into audit_log (id, actor_user_id, action, subject_type, subject_id, reason)
                 values (${uuidv7()}, null, 'vendor.status.archived', 'vendor', ${id}, 'Sample business taken down (scripts/demo).')`;
      }
      if (!removed) {
        await tx`insert into audit_log (id, actor_user_id, action, subject_type, subject_id, reason)
                 values (${uuidv7()}, null, ${REMOVED}, 'import', null, 'The sample businesses were taken down; they are not loaded again.')`;
      }
      console.log(`Took down ${gone.length} sample businesses in ${dbName}.`);
    });
  } else if (removed) {
    console.log('The sample businesses were taken down in this database; nothing to do.');
  } else {
    const towns = Object.fromEntries((await sql`select slug::text, id from municipality`).map((r) => [r.slug, r.id]));
    const cats = Object.fromEntries((await sql`select slug::text, id from category`).map((r) => [r.slug, r.id]));
    let added = 0;
    for (const b of DEMO_BUSINESSES) {
      const [{ there }] = await sql`select exists (select 1 from vendor where slug = ${b.slug}) as there`;
      if (there) continue;
      for (const t of [b.town, ...b.areas]) if (!towns[t]) throw new Error(`Unknown town "${t}" for ${b.name}`);
      for (const c of [b.category, ...b.also]) if (!cats[c]) throw new Error(`Unknown category "${c}" for ${b.name}`);
      const sizes = await Promise.all(
        [...b.photos.map((_, i) => `${b.slug}-${i + 1}.jpg`), ...(b.profile === false ? [] : [`${b.slug}-profile.jpg`])].map(
          async (f) => (await stat(path.join(PHOTOS, f))).size,
        ),
      );
      await sql.begin(async (tx) => {
        const id = uuidv7();
        const a = b.address;
        await tx`
          insert into vendor (id, slug, display_name, tagline, description, primary_municipality_id, website_url, public_email,
                              public_phone, source, listing_status, published_at, cost_level,
                              address_street, address_number, hide_address_number, map_lat, map_lng, map_approximate,
                              neighbourhood, tags, curator_note)
          values (${id}, ${b.slug}, ${b.name}, ${b.tagline}, ${`${SAMPLE_NOTE}\n\n${b.about}`}, ${towns[b.town]}, 'https://example.com',
                  ${`${b.slug.replace(/^sample-/, '')}@example.com`}, ${b.phone}, 'admin_entered', 'published', now(), ${b.cost},
                  ${a?.street ?? null}, ${a?.number ?? null}, ${Boolean(a && !a.number)}, ${a?.lat ?? null}, ${a?.lng ?? null},
                  ${a?.approximate ?? false}, ${b.neighbourhood ?? null}, ${b.tags ?? []}, ${b.curatorNote ?? null})`;
        await tx`insert into vendor_category (vendor_id, category_id, is_primary) values (${id}, ${cats[b.category]}, true)`;
        for (const c of b.also) await tx`insert into vendor_category (vendor_id, category_id) values (${id}, ${cats[c]})`;
        for (const t of b.areas) await tx`insert into vendor_service_area (vendor_id, municipality_id) values (${id}, ${towns[t]})`;
        for (const [i, [name, description]] of b.services.entries()) {
          await tx`insert into vendor_service (vendor_id, name, description, pricing_model, sort_order)
                   values (${id}, ${name}, ${description}, 'not_listed', ${i})`;
        }
        const photo = async (file, alt, width, height, role, order, bytes) => {
          const assetId = uuidv7();
          await tx`insert into media_asset (id, owner_kind, owner_id, bucket, storage_path, mime_type, byte_size, width, height, alt_text)
                   values (${assetId}, 'vendor', ${id}, 'public', ${`samples/${file}`}, 'image/jpeg', ${bytes}, ${width}, ${height}, ${alt})`;
          await tx`insert into vendor_media (vendor_id, media_asset_id, role, sort_order) values (${id}, ${assetId}, ${role}, ${order})`;
        };
        for (const [i, alt] of b.photos.entries()) await photo(`${b.slug}-${i + 1}.jpg`, alt, 1600, 1200, 'gallery', i, sizes[i]);
        if (b.profile !== false) {
          await photo(`${b.slug}-profile.jpg`, `${b.name} logo: the letters ${b.initials} in a circle`, 800, 800, 'logo', 0, sizes.at(-1));
        }
        await tx`insert into audit_log (id, actor_user_id, action, subject_type, subject_id, reason)
                 values (${uuidv7()}, null, 'vendor.create', 'vendor', ${id}, 'Sample business for showing how Localites looks (scripts/demo). Not a real business.')`;
      });
      added++;
    }
    console.log(
      added ? `Loaded ${added} sample businesses into ${dbName}.` : 'The sample businesses are already in this database; nothing to do.',
    );

    // Once: take down the first ten samples (the old kinds of business), now that the 60 for the
    // Base44 design are in. Archived, not deleted (the audit log keeps them).
    const [{ retired }] = await sql`select exists (select 1 from audit_log where action = ${RETIRED}) as retired`;
    if (!retired) {
      const keep = DEMO_BUSINESSES.map((b) => b.slug);
      await sql.begin(async (tx) => {
        const old = await tx`
          select id, listing_status as status from vendor
          where slug like 'sample-%' and not (slug::text = any(${keep})) and listing_status <> 'archived' for update`;
        for (const { id, status } of old) {
          await tx`update vendor set listing_status = 'archived', archived_at = now() where id = ${id}`;
          await tx`insert into status_change (id, subject_type, subject_id, field, from_status, to_status, actor_user_id, actor_kind, reason)
                   values (${uuidv7()}, 'vendor', ${id}, 'listing_status', ${status}, 'archived', null, 'system', 'Replaced by the samples for the Base44 design.')`;
          await tx`insert into audit_log (id, actor_user_id, action, subject_type, subject_id, reason)
                   values (${uuidv7()}, null, 'vendor.status.archived', 'vendor', ${id}, 'First sample business replaced (scripts/demo, D-60).')`;
        }
        await tx`insert into audit_log (id, actor_user_id, action, subject_type, subject_id, reason)
                 values (${uuidv7()}, null, ${RETIRED}, 'import', null, ${`${old.length} first sample businesses taken down; not done again.`})`;
        if (old.length) console.log(`Took down ${old.length} first sample businesses.`);
      });
    }

    // Once: hide the bare "Test Vendor" listings (seed-test-data.mjs), which have no photos or
    // details, so the samples show what a filled-in Localites looks like. The team can show them again.
    const [{ hidden }] = await sql`select exists (select 1 from audit_log where action = ${TEST_HIDDEN}) as hidden`;
    if (!hidden) {
      await sql.begin(async (tx) => {
        const bare = await tx`select id from vendor where slug like 'test-vendor-%' and listing_status = 'published' for update`;
        for (const { id } of bare) {
          await tx`update vendor set listing_status = 'unpublished' where id = ${id}`;
          await tx`insert into status_change (id, subject_type, subject_id, field, from_status, to_status, actor_user_id, actor_kind, reason)
                   values (${uuidv7()}, 'vendor', ${id}, 'listing_status', 'published', 'unpublished', null, 'system', 'Hidden in favour of the sample businesses.')`;
          await tx`insert into audit_log (id, actor_user_id, action, subject_type, subject_id, reason)
                   values (${uuidv7()}, null, 'vendor.status.unpublished', 'vendor', ${id}, 'Bare test listing hidden in favour of the sample businesses (scripts/demo).')`;
        }
        await tx`insert into audit_log (id, actor_user_id, action, subject_type, subject_id, reason)
                 values (${uuidv7()}, null, ${TEST_HIDDEN}, 'import', null, ${`${bare.length} bare test listings hidden; not done again.`})`;
        if (bare.length) console.log(`Hid ${bare.length} bare test listings.`);
      });
    }
  }
} finally {
  await sql.end({ timeout: 5 });
}
