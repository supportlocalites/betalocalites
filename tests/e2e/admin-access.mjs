// Admin access tests (E §1.7 "prove it"; testing-strategy: cross-account and role
// escalation). Settings and safety checks: tests/e2e/helpers.mjs.
//
// Usage: npm run test:e2e
import { randomUUID } from 'node:crypto';
import { account, b64, check, cookieFor, finish, passwordSession, run, site, sql, twoStepSession } from './helpers.mjs';

const countVendors = async (name) => (await sql`select count(*)::int as n from vendor where display_name = ${name}`)[0].n;
const towns = await sql`select id from municipality where is_active order by sort_order limit 1`;
const cats = await sql`select id from category where parent_id is null order by sort_order limit 1`;
const listingForm = (name) => ({
  name,
  slug: '',
  tagline: '',
  description: '',
  municipalityId: towns[0].id,
  primaryCategoryId: cats[0].id,
  websiteUrl: '',
  publicEmail: '',
  publicPhone: '',
});

// ------------------------------------------------------------------ accounts
const adminEmail = `e2e-admin-${run}@example.test`;
const staffEmail = `e2e-staff-${run}@example.test`;
const adminId = await account(adminEmail);
await account(staffEmail);
// Make the test admin an admin directly in the database (the console path is tested in db/tests).
await sql`insert into platform_role (user_id, role) values (${adminId}, 'admin')`;

console.log('Admin access');

// 1. Nobody signed in.
let r = await site('/admin');
check('signed out: the admin page sends you to sign in', r.status === 302 && r.location === '/sign-in?next=%2Fadmin', `${r.status} ${r.location}`);
r = await site('/admin.data');
check('signed out: the admin page’s data gives away nothing', !/test-vendor-|Test Vendor/i.test(r.body), r.body.slice(0, 80));
r = await site('/admin/listings/new', { method: 'POST', form: listingForm(`E2E nobody ${run}`) });
check('signed out: creating a listing is refused', (await countVendors(`E2E nobody ${run}`)) === 0, `status ${r.status}`);

// 2. Signed in, not on the team.
const staff1 = await passwordSession(staffEmail);
r = await site('/admin', { cookie: cookieFor(staff1) });
check('not on the team: admin page refused (403)', r.status === 403, String(r.status));
const staff2 = await twoStepSession(staffEmail);
r = await site('/admin', { cookie: cookieFor(staff2) });
check('not on the team, even with a two-step code: refused (403)', r.status === 403, String(r.status));
r = await site('/admin/listings/new', { cookie: cookieFor(staff2), method: 'POST', form: listingForm(`E2E staff ${run}`) });
check('not on the team: creating a listing is refused', r.status === 403 && (await countVendors(`E2E staff ${run}`)) === 0, String(r.status));

// 3. On the team, password only (no two-step code yet).
const admin1 = await passwordSession(adminEmail);
r = await site('/admin', { cookie: cookieFor(admin1) });
check('admin without the two-step code: sent to the two-step page', r.status === 302 && r.location.startsWith('/two-step?next=%2Fadmin'), `${r.status} ${r.location}`);
r = await site('/admin/listings/new', { cookie: cookieFor(admin1), method: 'POST', form: listingForm(`E2E aal1 ${run}`) });
check('admin without the two-step code: creating a listing is refused', (await countVendors(`E2E aal1 ${run}`)) === 0, String(r.status));

// 4. A tampered token: claims the two-step level, keeps the old signature.
const [h, p, s] = admin1.access_token.split('.');
const forged = { ...JSON.parse(Buffer.from(p, 'base64url')), aal: 'aal2' };
r = await site('/admin', { cookie: `__Host-lc_at=${h}.${b64(forged)}.${s}` });
check('tampered token claiming two-step: rejected, sent to sign in', r.status === 302 && r.location.startsWith('/sign-in'), `${r.status} ${r.location}`);

// 5. On the team with the two-step code.
const admin2 = await twoStepSession(adminEmail);
const adminCookie = cookieFor(admin2);
r = await site('/admin', { cookie: adminCookie });
check('admin with two-step code: admin page opens', r.status === 200, String(r.status));
check('admin pages are never stored by browsers or shown to search engines',
  r.headers.get('cache-control') === 'no-store' && r.headers.get('x-robots-tag') === 'noindex', `${r.headers.get('cache-control')} ${r.headers.get('x-robots-tag')}`);
r = await site('/admin/listings/new', { cookie: adminCookie, method: 'POST', form: listingForm(`E2E cross-site ${run}`), origin: 'https://evil.example' });
check('a form sent from another website is refused (403)', r.status === 403 && (await countVendors(`E2E cross-site ${run}`)) === 0, String(r.status));

r = await site('/admin/listings/new', { cookie: adminCookie, method: 'POST', form: listingForm(`E2E listing A ${run}`) });
const idA = r.location.match(/\/admin\/listings\/([0-9a-f-]{36})/)?.[1];
check('admin creates a listing (saved as a draft)', r.status === 302 && Boolean(idA), `${r.status} ${r.location}`);
const [created] = await sql`select listing_status, created_by from vendor where id = ${idA ?? '00000000-0000-0000-0000-000000000000'}`;
check('the new listing is a draft, credited to the admin', created?.listing_status === 'draft' && created?.created_by === adminId);
const sessionId = JSON.parse(Buffer.from(admin2.access_token.split('.')[1], 'base64url')).session_id;
const [logged] = await sql`select count(*)::int as n from audit_log where action = 'vendor.create' and subject_id = ${idA} and actor_user_id = ${adminId} and session_ref = ${sessionId}`;
check('the audit log records who created it, in which session', logged.n === 1);

// 6. One listing's form can't change another listing's service.
r = await site('/admin/listings/new', { cookie: adminCookie, method: 'POST', form: listingForm(`E2E listing B ${run}`) });
const idB = r.location.match(/\/admin\/listings\/([0-9a-f-]{36})/)?.[1];
await site(`/admin/listings/${idB}`, { cookie: adminCookie, method: 'POST', form: { intent: 'service', serviceId: '', name: 'B service', description: '', pricingModel: 'on_request', price: '', priceNote: '' } });
const [serviceB] = await sql`select id, name from vendor_service where vendor_id = ${idB}`;
r = await site(`/admin/listings/${idA}`, { cookie: adminCookie, method: 'POST', form: { intent: 'service', serviceId: serviceB.id, name: 'Hijacked', description: '', pricingModel: 'on_request', price: '', priceNote: '' } });
const [afterB] = await sql`select name, vendor_id from vendor_service where id = ${serviceB.id}`;
check('editing listing B’s service through listing A is refused', r.status === 409 && afterB.name === 'B service' && afterB.vendor_id === idB, `${r.status} ${afterB.name}`);
r = await site(`/admin/listings/${idA}`, { cookie: adminCookie, method: 'POST', form: { intent: 'service-visibility', serviceId: serviceB.id, active: 'false' } });
const [stillShown] = await sql`select is_active from vendor_service where id = ${serviceB.id}`;
check('hiding listing B’s service through listing A is refused', r.status === 409 && stillShown.is_active === true, String(r.status));

// 7. The status gatekeeper.
await site(`/admin/listings/${idB}`, { cookie: adminCookie, method: 'POST', form: { intent: 'status', to: 'archived', reason: 'e2e' } });
r = await site(`/admin/listings/${idB}`, { cookie: adminCookie, method: 'POST', form: { intent: 'status', to: 'published' } });
const [archived] = await sql`select listing_status from vendor where id = ${idB}`;
check('an archived listing can’t be published again', r.status === 409 && archived.listing_status === 'archived', `${r.status} ${archived.listing_status}`);
r = await site(`/admin/listings/${idA}`, { cookie: adminCookie, method: 'POST', form: { intent: 'status', to: 'banana' } });
check('an unknown status is refused', r.status === 400, String(r.status));
const [changes] = await sql`select count(*)::int as n from status_change where subject_id = ${idB} and to_status = 'archived' and actor_kind = 'admin'`;
check('status history is kept (status_change)', changes.n === 1);

// 8. Admin role removed: access ends at once.
await sql`update platform_role set revoked_at = now() where user_id = ${adminId} and revoked_at is null`;
r = await site('/admin', { cookie: adminCookie });
check('admin role removed: refused straight away (403)', r.status === 403, String(r.status));
await sql`insert into platform_role (user_id, role) values (${adminId}, 'admin')`;

// 9. Signing out ends the session everywhere.
r = await site('/sign-out', { cookie: adminCookie, method: 'POST' });
check('sign out clears the cookies', r.status === 302 && (r.headers.get('set-cookie') ?? '').includes('Max-Age=0'));
r = await site('/admin', { cookie: adminCookie });
check('after sign-out, the old cookies no longer work', r.status === 302 && r.location.startsWith('/sign-in'), `${r.status} ${r.location}`);
r = await site('/admin', { cookie: `__Host-lc_rt=${admin2.refresh_token}` });
check('after sign-out, the old refresh token no longer works', r.status === 302 && r.location.startsWith('/sign-in'), `${r.status} ${r.location}`);

// 10. Sign-in can't be used to send people to another website.
r = await site('/sign-in', { method: 'POST', form: { email: adminEmail, password: 'e2e-password-123', next: 'https://evil.example/' } });
check('after sign-in, a link to another website goes to /admin instead', r.status === 302 && r.location === '/admin', `${r.status} ${r.location}`);
r = await site('/sign-in', { method: 'POST', form: { email: adminEmail, password: 'wrong' } });
check('wrong password: refused, no cookies set', r.status === 400 && !(r.headers.get('set-cookie') ?? '').includes('lc_at='), String(r.status));

// 11. Suggest a business (D-25): open to everyone, limited, and only the team acts on it.
console.log('Suggest a business');
const countSuggestions = async (name) => (await sql`select count(*)::int as n from vendor_suggestion where business_name = ${name}`)[0].n;
// Per-visitor limit first (Cloudflare's per-address limit allows 3 a minute; this uses 1).
const busyVisitor = randomUUID();
for (let i = 0; i < 5; i++) {
  await sql`insert into vendor_suggestion (business_name, visitor_id) values (${`E2E earlier ${run} ${i}`}, ${busyVisitor})`;
}
r = await site('/suggest', { method: 'POST', cookie: `__Host-lc_vid=${busyVisitor}`, form: { businessName: `E2E too many ${run}` } });
check('a visitor who sent 5 suggestions this hour is asked to wait', r.status === 429 && (await countSuggestions(`E2E too many ${run}`)) === 0, String(r.status));
r = await site('/suggest', { method: 'POST', form: { businessName: `E2E suggestion ${run}`, website: 'example.com', contact: '705 555 0100', category: 'sweets', q: 'cakes' } });
const [suggested] = await sql`select id, visitor_id, team_email_status, category_id is not null as has_category, search_text from vendor_suggestion where business_name = ${`E2E suggestion ${run}`}`;
check('anyone can suggest a business, no account needed', r.status === 200 && r.body.includes('Our team will look into this business') && Boolean(suggested), String(r.status));
check('the suggestion keeps where they were looking and a visitor ID', suggested?.has_category === true && suggested?.search_text === 'cakes' && Boolean(suggested?.visitor_id));
check('without email set up, the team email is honestly "pending"', suggested?.team_email_status === 'pending', suggested?.team_email_status);
check('the visitor cookie is this-site-only and unreadable by page scripts', /__Host-lc_vid=[0-9a-f-]{36}; Path=\/; HttpOnly; Secure; SameSite=Lax/.test(r.headers.get('set-cookie') ?? ''));
r = await site('/suggest', { method: 'POST', form: { businessName: `E2E bot ${run}`, company_url: 'http://spam.example' } });
check('a bot filling the hidden field is thanked, and nothing is kept', r.status === 200 && (await countSuggestions(`E2E bot ${run}`)) === 0, String(r.status));
r = await site('/suggest', { method: 'POST', form: { businessName: `E2E cross-site ${run}` }, origin: 'https://evil.example' });
check('a suggestion sent from another website is refused', r.status === 403 && (await countSuggestions(`E2E cross-site ${run}`)) === 0, String(r.status));
let limited = false;
for (let i = 0; i < 4 && !limited; i++) {
  r = await site('/suggest', { method: 'POST', form: { businessName: `E2E burst ${run} ${i}` } });
  limited = r.status === 429;
}
check('many suggestions in a minute from one address are slowed down', limited);

r = await site('/admin/suggestions');
check('signed out: the suggestions list sends you to sign in', r.status === 302 && r.location.startsWith('/sign-in'), `${r.status} ${r.location}`);
r = await site('/admin/suggestions', { cookie: cookieFor(staff2), method: 'POST', form: { intent: 'decline', id: suggested.id, reason: 'nope' } });
const [stillNew] = await sql`select status from vendor_suggestion where id = ${suggested.id}`;
check('not on the team: declining a suggestion is refused', r.status === 403 && stillNew.status === 'new', `${r.status} ${stillNew.status}`);

const admin3 = await twoStepSession(adminEmail);
const admin3Cookie = cookieFor(admin3);
r = await site('/admin/suggestions', { cookie: admin3Cookie });
check('the team sees the suggestion, with the phone or email for vetting', r.status === 200 && r.body.includes(`E2E suggestion ${run}`) && r.body.includes('705 555 0100'));
r = await site('/admin/suggestions', { cookie: admin3Cookie, method: 'POST', form: { intent: 'decline', id: suggested.id, reason: '' } });
check('declining needs a reason', r.status === 400);
r = await site('/admin/listings/new', { cookie: admin3Cookie, method: 'POST', form: { ...listingForm(`E2E from suggestion ${run}`), suggestionId: suggested.id } });
const fromSuggestionId = r.location.match(/\/admin\/listings\/([0-9a-f-]{36})/)?.[1];
const [added] = await sql`select status, vendor_id, reviewed_by from vendor_suggestion where id = ${suggested.id}`;
check('"Add as a draft listing" links the suggestion to the new draft', r.status === 302 && added.status === 'added' && added.vendor_id === fromSuggestionId && added.reviewed_by === adminId, `${r.status} ${added.status}`);
r = await site('/admin/suggestions', { cookie: admin3Cookie, method: 'POST', form: { intent: 'decline', id: suggested.id, reason: 'changed my mind' } });
const [afterTwice] = await sql`select status from vendor_suggestion where id = ${suggested.id}`;
check('a suggestion can’t be decided twice', r.status === 409 && afterTwice.status === 'added', `${r.status} ${afterTwice.status}`);
const [{ id: other }] = await sql`select id from vendor_suggestion where business_name = ${`E2E earlier ${run} 0`}`;
r = await site('/admin/suggestions', { cookie: admin3Cookie, method: 'POST', form: { intent: 'duplicate', id: other, vendorId: '01900000-0000-7000-8000-000000000000' } });
check('marking as already listed needs a real listing', r.status === 409, String(r.status));
r = await site('/admin/suggestions', { cookie: admin3Cookie, method: 'POST', form: { intent: 'decline', id: other, reason: 'E2E: not in our area' } });
const [declined] = await sql`select status, decline_reason from vendor_suggestion where id = ${other}`;
const [declineLogged] = await sql`select count(*)::int as n from audit_log where action = 'vendor_suggestion.declined' and subject_id = ${other} and actor_user_id = ${adminId}`;
check('declining is recorded with its reason, in the audit log', declined.status === 'declined' && declined.decline_reason === 'E2E: not in our area' && declineLogged.n === 1);

// 12. Public pages are unaffected.
r = await site('/explore');
check('public pages need no account and set no cookies', r.status === 200 && !r.headers.get('set-cookie'));

await finish('admin access');
