// Loads OBVIOUSLY FAKE test businesses ("Test Vendor …", example.com) into a TEST
// database, for development and the hosting fit test. Never run against production:
// it refuses unless the database name contains "test" or "dev".
//
// Usage: DATABASE_ADMIN_URL=postgres://.../localites_dev npm run db:seed:test
import postgres from 'postgres';
import { requiresTls } from './migrate.mjs';

const url = process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error('Set DATABASE_ADMIN_URL.');
  process.exit(1);
}
const dbName = new URL(url).pathname.slice(1);
const isSupabaseTestProject = process.argv.includes('--supabase-test-project');
if (!/test|dev/.test(dbName) && !isSupabaseTestProject) {
  console.error(`Refusing to load test data into "${dbName}". Use a test or dev database.`);
  process.exit(1);
}

const vendors = [
  ['test-vendor-face-painting', 'Test Vendor 1: Face Painting', 'face-painting', 'orillia', 'Face painting for kids’ parties (test listing).', [['Party package, 2 hours', 'fixed', 25000], ['Extra hour', 'hourly', 9000]]],
  ['test-vendor-magic', 'Test Vendor 2: Magic Shows', 'magicians', 'orillia', 'Close-up magic and stage shows (test listing).', [['Birthday show', 'starting_at', 30000]]],
  ['test-vendor-cakes', 'Test Vendor 3: Custom Cakes', 'custom-cakes', 'orillia', 'Custom birthday cakes (test listing).', [['Custom cake', 'on_request', null]]],
  ['test-vendor-party-room', 'Test Vendor 4: Party Room', 'party-rooms', 'severn', 'A party room for up to 30 guests (test listing).', [['Room for 3 hours', 'fixed', 40000]]],
  ['test-vendor-bouncy', 'Test Vendor 5: Bouncy Castles', 'bouncy-castles', 'oro-medonte', 'Bouncy castle rentals (test listing).', [['Day rental', 'not_listed', null]]],
  ['test-vendor-photos', 'Test Vendor 6: Party Photos', 'photographers', 'ramara', 'Event photography (test listing).', [['Two hours of coverage', 'starting_at', 35000]]],
];

const sql = postgres(url, { max: 1, onnotice: () => {}, ssl: requiresTls(url) ? 'require' : undefined });
try {
  const [{ real }] = await sql`select count(*)::int as real from vendor where slug not like 'test-%'`;
  if (real > 0) {
    console.error(`Refusing: this database has ${real} real listing(s). Test data never goes next to real businesses.`);
    process.exitCode = 1;
  } else await sql.begin(async (tx) => {
    for (const [slug, name, catSlug, town, tagline, services] of vendors) {
      const [v] = await tx`
        insert into vendor (slug, display_name, tagline, primary_municipality_id, website_url, source, listing_status, published_at)
        select ${slug}, ${name}, ${tagline}, m.id, 'https://example.com', 'admin_entered', 'published', now()
        from municipality m where m.slug = ${town}
        on conflict (slug) do update set display_name = excluded.display_name
        returning id`;
      await tx`
        insert into vendor_category (vendor_id, category_id, is_primary)
        select ${v.id}, c.id, true from category c where c.slug = ${catSlug}
        on conflict do nothing`;
      await tx`delete from vendor_service where vendor_id = ${v.id}`;
      let order = 0;
      for (const [sname, model, cents] of services) {
        await tx`insert into vendor_service (vendor_id, name, pricing_model, price_cents, sort_order)
                 values (${v.id}, ${sname}, ${model}, ${cents}, ${order++})`;
      }
    }
  });
  if (!process.exitCode) console.log(`Loaded ${vendors.length} test businesses into ${dbName}.`);
} finally {
  await sql.end({ timeout: 5 });
}
