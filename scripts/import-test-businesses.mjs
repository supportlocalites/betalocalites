// Loads the 28 test businesses (PO-08) into a TEST database as DRAFTS: name, town,
// category and, only where the research found it, the business's own website. Nobody
// sees a draft until an admin checks it and presses Publish (D-03). Runs once per
// database: a second run sees its own audit_log entry and does nothing, so listings the
// team has since edited, published or archived are never touched.
//
// Usage: DATABASE_ADMIN_URL=postgres://.../localites_dev npm run db:import:test-businesses
//        (add -- --supabase-test-project for the Supabase test project, as CI does)
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { normalizeDatabaseUrl, requiresTls } from '../src/lib/db-url.mjs';
import { slugify, uuidv7 } from '../src/lib/ids.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'db', 'data', 'test-businesses-2026-10-10.json');
const MARKER = 'import.test_businesses_2026_10_10';

if (!process.env.DATABASE_ADMIN_URL) {
  console.error('Set DATABASE_ADMIN_URL.');
  process.exit(1);
}
const url = normalizeDatabaseUrl(process.env.DATABASE_ADMIN_URL);
const dbName = new URL(url).pathname.slice(1);
if (!/test|dev/.test(dbName) && !process.argv.includes('--supabase-test-project')) {
  console.error(`Refusing to load test businesses into "${dbName}". Use a test or dev database.`);
  process.exit(1);
}

const { businesses } = JSON.parse(await readFile(FILE, 'utf8'));
const sql = postgres(url, { max: 1, onnotice: () => {}, ssl: requiresTls(url) ? 'require' : false });
try {
  const [{ done }] = await sql`select exists (select 1 from audit_log where action = ${MARKER}) as done`;
  if (done) {
    console.log('The test businesses were already loaded into this database; nothing to do.');
  } else {
    await sql.begin(async (tx) => {
      const towns = Object.fromEntries((await tx`select slug::text, id from municipality`).map((r) => [r.slug, r.id]));
      const cats = Object.fromEntries((await tx`select slug::text, id from category`).map((r) => [r.slug, r.id]));
      for (const b of businesses) {
        if (!towns[b.town]) throw new Error(`Unknown town "${b.town}" for ${b.name}`);
        for (const c of [b.category, ...(b.also ?? [])]) if (!cats[c]) throw new Error(`Unknown category "${c}" for ${b.name}`);
        let slug = slugify(b.name);
        for (let i = 2; ; i++) {
          const [{ taken }] = await tx`select exists (select 1 from vendor where slug = ${slug})
                                              or exists (select 1 from vendor_slug_history where slug = ${slug}) as taken`;
          if (!taken) break;
          slug = `${slugify(b.name).slice(0, 76)}-${i}`;
        }
        const id = uuidv7();
        await tx`insert into vendor (id, slug, display_name, primary_municipality_id, website_url, source)
                 values (${id}, ${slug}, ${b.name}, ${towns[b.town]}, ${b.website}, 'admin_entered')`;
        await tx`insert into vendor_category (vendor_id, category_id, is_primary) values (${id}, ${cats[b.category]}, true)`;
        for (const c of b.also ?? []) await tx`insert into vendor_category (vendor_id, category_id) values (${id}, ${cats[c]})`;
        const reason = [
          'Loaded as a draft from the vendor research list (10 Oct 2026, PO-08).',
          `Research link: ${b.research}.`,
          b.note,
          'Check the business’s own website, fill in the details, then publish.',
        ].filter(Boolean).join(' ');
        await tx`insert into audit_log (id, actor_user_id, action, subject_type, subject_id, reason)
                 values (${uuidv7()}, null, 'vendor.create', 'vendor', ${id}, ${reason})`;
      }
      await tx`insert into audit_log (id, actor_user_id, action, subject_type, subject_id, reason)
               values (${uuidv7()}, null, ${MARKER}, 'import', null, ${`${businesses.length} draft listings from db/data/test-businesses-2026-10-10.json`})`;
    });
    console.log(`Loaded ${businesses.length} test businesses into ${dbName} as drafts.`);
  }
} finally {
  await sql.end({ timeout: 5 });
}
