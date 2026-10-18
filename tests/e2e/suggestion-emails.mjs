// Suggest a business, signed in (D-25, migration 0038): the suggestion is linked to the person's
// account (from their session, never the form) and they're emailed once when the business is
// listed: when the team publishes the listing made from it, or straight away when the team
// marks it as a business that's already listed. A signed-out suggestion is linked to nobody.
//
// Usage: npm run test:e2e
import { account, check, cookieFor, finish, mailFor, passwordSession, run, site, sql, twoStepSession } from './helpers.mjs';

async function waitFor(read, done, ms = 5000) {
  const end = Date.now() + ms;
  let value = await read();
  while (!done(value) && Date.now() < end) {
    await new Promise((res) => setTimeout(res, 150));
    value = await read();
  }
  return value;
}

const email = (who) => `e2e-sugg-${who}-${run}@example.test`;
const ids = { p: await account(email('p')), m: await account(email('m')) };
await sql`insert into platform_role (user_id, role) values (${ids.m}, 'admin')`;
const cookie = { p: cookieFor(await passwordSession(email('p'))), m: cookieFor(await twoStepSession(email('m'))) };
// Today's site-wide limit counts earlier runs' suggestions (local database only).
await sql`delete from vendor_suggestion where business_name like 'E2E %'`;
const suggested = async (name) => (await sql`select id, suggested_by from vendor_suggestion where business_name = ${name}`)[0];
const listedMail = async (business) => (await mailFor(email('p'))).filter((m) => m.subject === `${business} is on Localites`);

console.log('Suggestions from signed-in people');
const NEW = `E2E Brand New Bakery ${run}`;
let r = await site('/suggest', { cookie: cookie.p, method: 'POST', form: { businessName: NEW }, ip: '10.9.0.1' });
const s1 = await suggested(NEW);
check('signed in: the suggestion is linked to them, and they’re told they’ll be emailed',
  r.status === 200 && s1?.suggested_by === ids.p && r.body.includes('We’ll email you when it’s on Localites'), String(r.status));
r = await site('/suggest', { method: 'POST', form: { businessName: `E2E Anonymous ${run}`, suggested_by: ids.p }, ip: '10.9.0.2' });
check('signed out: linked to nobody, even if the form names someone', (await suggested(`E2E Anonymous ${run}`))?.suggested_by === null && !r.body.includes('We’ll email you'));

// The team adds it as a draft, then publishes it.
const [town] = await sql`select id from municipality where is_active order by sort_order limit 1`;
const [cat] = await sql`select id from category where parent_id is null and is_active order by sort_order limit 1`;
r = await site('/admin/listings/new', {
  cookie: cookie.m,
  method: 'POST',
  form: { name: NEW, slug: '', tagline: '', description: '', municipalityId: town.id, primaryCategoryId: cat.id, websiteUrl: '', publicEmail: '', publicPhone: '', suggestionId: s1.id },
});
const vendorId = /\/admin\/listings\/([0-9a-f-]{36})/.exec(r.location)?.[1];
check('the team adds it as a draft listing from the suggestion', r.status === 302 && Boolean(vendorId), `${r.status} ${r.location}`);
await new Promise((res) => setTimeout(res, 800));
check('…no email yet: a draft isn’t listed', (await listedMail(NEW)).length === 0);
r = await site(`/admin/listings/${vendorId}`, { cookie: cookie.m, method: 'POST', form: { intent: 'status', to: 'published' } });
const mail = await waitFor(() => listedMail(NEW), (l) => l.length > 0);
const [v] = await sql`select slug::text as slug from vendor where id = ${vendorId}`;
check('published: they’re emailed, with a link to it', r.status === 302 && mail.length === 1 && mail[0].body.includes(`/vendors/${v.slug}`), `${r.status} ${mail.length}`);
await site(`/admin/listings/${vendorId}`, { cookie: cookie.m, method: 'POST', form: { intent: 'status', to: 'unpublished', reason: 'e2e' } });
await site(`/admin/listings/${vendorId}`, { cookie: cookie.m, method: 'POST', form: { intent: 'status', to: 'published' } });
await new Promise((res) => setTimeout(res, 800));
check('…only once, even if it’s published again', (await listedMail(NEW)).length === 1);

// A suggestion of a business that's listed, one that isn't, and from someone who then deleted their account.
const [town2] = await sql`select id from municipality where is_active order by sort_order limit 1`;
const [listed] = await sql`
  insert into vendor (slug, display_name, primary_municipality_id, listing_status, published_at, source)
  values (${`e2e-sugg-listed-${run}`}, ${`Listed Shop ${run}`}, ${town2.id}, 'published', now(), 'admin_entered') returning id, display_name as name`;
const [hidden] = await sql`
  insert into vendor (slug, display_name, primary_municipality_id, listing_status, source)
  values (${`e2e-sugg-draft-${run}`}, ${`Draft Shop ${run}`}, ${town2.id}, 'draft', 'admin_entered') returning id, display_name as name`;
r = await site('/suggest', { cookie: cookie.p, method: 'POST', form: { businessName: `E2E draft ${run}` }, ip: '10.9.0.4' });
const s3 = await suggested(`E2E draft ${run}`);
await site('/admin/suggestions', { cookie: cookie.m, method: 'POST', form: { intent: 'duplicate', id: s3.id, vendorId: hidden.id } });
await new Promise((res) => setTimeout(res, 800));
check('matched to a business that isn’t listed: no email', (await listedMail(hidden.name)).length === 0);
const goneId = await account(email('gone'));
const gone = cookieFor(await passwordSession(email('gone')));
r = await site('/suggest', { cookie: gone, method: 'POST', form: { businessName: `E2E gone ${run}` }, ip: '10.9.0.5' });
const s4 = await suggested(`E2E gone ${run}`);
await sql`update app_user set deleted_at = now() where id = ${goneId}`;
await site('/admin/suggestions', { cookie: cookie.m, method: 'POST', form: { intent: 'duplicate', id: s4.id, vendorId: listed.id } });
await new Promise((res) => setTimeout(res, 800));
check('someone who deleted their account isn’t emailed',
  s4?.suggested_by === goneId && (await mailFor(email('gone'))).filter((m) => m.subject.endsWith('is on Localites')).length === 0);
r = await site('/suggest', { cookie: cookie.p, method: 'POST', form: { businessName: `E2E ${listed.name} ${run}` }, ip: '10.9.0.3' });
const s2 = await suggested(`E2E ${listed.name} ${run}`);
r = await site('/admin/suggestions', { cookie: cookie.m, method: 'POST', form: { intent: 'duplicate', id: s2.id, vendorId: listed.id } });
const dupMail = await waitFor(() => listedMail(listed.name), (l) => l.length > 0);
check('marked as a business already listed: they’re emailed straight away', dupMail.length === 1, String(dupMail.length));

await finish('suggestion emails');
