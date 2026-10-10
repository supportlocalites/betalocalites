// Admin access tests (E §1.7 "prove it"; testing-strategy: cross-account and role
// escalation). Runs against a LOCAL site (npm run preview), a LOCAL Supabase Auth server
// and a LOCAL database, never a hosted one: it creates accounts and test listings.
//
//   E2E_BASE_URL            the site, e.g. http://localhost:4173
//   E2E_AUTH_URL            the local sign-in server, e.g. http://127.0.0.1:9999
//   E2E_AUTH_JWT_SECRET     that server's own throwaway signing secret (creates test accounts)
//   E2E_DATABASE_ADMIN_URL  the local database the site uses, as a superuser
//
// Usage: npm run test:e2e
import { createHmac } from 'node:crypto';
import postgres from 'postgres';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:4173';
const AUTH = process.env.E2E_AUTH_URL ?? 'http://127.0.0.1:9999';
const SECRET = process.env.E2E_AUTH_JWT_SECRET;
const DB_URL = process.env.E2E_DATABASE_ADMIN_URL;
for (const [name, value] of Object.entries({ E2E_BASE_URL: BASE, E2E_AUTH_URL: AUTH, E2E_DATABASE_ADMIN_URL: DB_URL ?? '' })) {
  if (!/^(https?|postgres(ql)?):\/\/([^@/]*@)?(localhost|127\.0\.0\.1)[:/]/.test(value)) {
    console.error(`${name} must point at this computer (localhost). These tests create accounts and listings.`);
    process.exit(1);
  }
}
if (!SECRET) {
  console.error('Set E2E_AUTH_JWT_SECRET to the local sign-in server’s signing secret.');
  process.exit(1);
}

const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
const failures = [];
let passes = 0;
const check = (label, ok, detail = '') => {
  if (ok) {
    passes++;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ''}`);
  }
};

// ------------------------------------------------------- sign-in server helpers
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function serviceToken() {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 600 });
  return `${head}.${body}.${createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url')}`;
}
const adminHeaders = () => ({ Authorization: `Bearer ${serviceToken()}`, 'Content-Type': 'application/json' });
async function auth(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(AUTH + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path}: ${res.status} ${json?.msg ?? ''}`);
  return json;
}
function totp(secret, t = Date.now()) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/=+$/, '')) bits += abc.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = createHmac('sha1', key).update(counter).digest();
  return String((h.readUInt32BE(h[19] & 15) & 0x7fffffff) % 1e6).padStart(6, '0');
}
async function account(email) {
  const list = await (await fetch(`${AUTH}/admin/users?per_page=200`, { headers: adminHeaders() })).json();
  let user = list.users?.find((u) => u.email === email);
  if (!user) {
    const res = await fetch(`${AUTH}/admin/users`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ email, password: 'e2e-password-123', email_confirm: true, user_metadata: { display_name: email.split('@')[0] } }),
    });
    user = await res.json();
  }
  // Start each run without an authenticator app, so the test can set one up and know its key.
  const factors = (await (await fetch(`${AUTH}/admin/users/${user.id}/factors`, { headers: adminHeaders() })).json()) ?? [];
  for (const f of factors) await fetch(`${AUTH}/admin/users/${user.id}/factors/${f.id}`, { method: 'DELETE', headers: adminHeaders() });
  await sql`insert into app_user (id, display_name, email) values (${user.id}, ${email.split('@')[0]}, ${email})
            on conflict (id) do nothing`;
  return user.id;
}
const passwordSession = (email) => auth('/token?grant_type=password', { method: 'POST', body: { email, password: 'e2e-password-123' } });
async function twoStepSession(email) {
  const s = await passwordSession(email);
  const factor = await auth('/factors', { method: 'POST', token: s.access_token, body: { factor_type: 'totp', friendly_name: `e2e ${Date.now()}` } });
  const challenge = await auth(`/factors/${factor.id}/challenge`, { method: 'POST', token: s.access_token, body: {} });
  return auth(`/factors/${factor.id}/verify`, {
    method: 'POST',
    token: s.access_token,
    body: { challenge_id: challenge.id, code: totp(factor.totp.secret) },
  });
}
const cookieFor = (s) => `__Host-lc_at=${s.access_token}; __Host-lc_rt=${s.refresh_token}`;

// --------------------------------------------------------------- site helpers
async function site(path, { cookie, method = 'GET', form, origin = BASE } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (origin) headers.Origin = origin;
  }
  const res = await fetch(BASE + path, { method, headers, body: form ? new URLSearchParams(form) : undefined, redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location') ?? '', headers: res.headers, body: await res.text() };
}
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
const run = Date.now().toString(36);

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

// 11. Public pages are unaffected.
r = await site('/explore');
check('public pages need no account and set no cookies', r.status === 200 && !r.headers.get('set-cookie'));

await sql.end();
console.log(`\n${passes} of ${passes + failures.length} admin access checks passed`);
process.exit(failures.length ? 1 : 0);
