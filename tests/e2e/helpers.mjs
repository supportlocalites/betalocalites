// Shared by the end-to-end tests. They run against a LOCAL site (npm run preview), a LOCAL
// Supabase Auth server, a LOCAL pretend email service and a LOCAL database, never hosted
// ones: they create accounts, listings and claims.
//
//   E2E_BASE_URL            the site, e.g. http://localhost:4173
//   E2E_AUTH_URL            the local sign-in server, e.g. http://127.0.0.1:9999
//   E2E_MAIL_URL            the pretend email service (scripts/e2e/mail-server.mjs)
//   E2E_AUTH_JWT_SECRET     that server's own throwaway signing secret (creates test accounts)
//   E2E_DATABASE_ADMIN_URL  the local database the site uses, as a superuser
import { createHmac } from 'node:crypto';
import postgres from 'postgres';

export const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:4173';
export const AUTH = process.env.E2E_AUTH_URL ?? 'http://127.0.0.1:9999';
export const MAIL = process.env.E2E_MAIL_URL ?? 'http://127.0.0.1:8787';
const SECRET = process.env.E2E_AUTH_JWT_SECRET;
const DB_URL = process.env.E2E_DATABASE_ADMIN_URL;
for (const [name, value] of Object.entries({
  E2E_BASE_URL: BASE,
  E2E_AUTH_URL: AUTH,
  E2E_MAIL_URL: MAIL,
  E2E_DATABASE_ADMIN_URL: DB_URL ?? '',
})) {
  if (!/^(https?|postgres(ql)?):\/\/([^@/]*@)?(localhost|127\.0\.0\.1)[:/]/.test(value)) {
    console.error(`${name} must point at this computer (localhost). These tests create accounts and listings.`);
    process.exit(1);
  }
}
if (!SECRET) {
  console.error('Set E2E_AUTH_JWT_SECRET to the local sign-in server’s signing secret.');
  process.exit(1);
}

export const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
export const run = Date.now().toString(36);

const failures = [];
let passes = 0;
export const check = (label, ok, detail = '') => {
  if (ok) {
    passes++;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ''}`);
  }
};
export async function finish(what) {
  await sql.end();
  console.log(`\n${passes} of ${passes + failures.length} ${what} checks passed`);
  process.exit(failures.length ? 1 : 0);
}

// ------------------------------------------------------- sign-in server helpers
export const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function serviceToken() {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 600 });
  return `${head}.${body}.${createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url')}`;
}
const adminHeaders = () => ({ Authorization: `Bearer ${serviceToken()}`, 'Content-Type': 'application/json' });
export async function auth(path, { method = 'GET', token, body } = {}) {
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
/** A team-style account with a password (made through the sign-in server's admin interface). */
export async function account(email) {
  const list = await (await fetch(`${AUTH}/admin/users?per_page=200`, { headers: adminHeaders() })).json();
  let user = list.users?.find((u) => u.email === email);
  if (!user) {
    const res = await fetch(`${AUTH}/admin/users`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        email,
        password: 'e2e-password-123',
        email_confirm: true,
        user_metadata: { display_name: email.split('@')[0] },
      }),
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
export const passwordSession = (email) =>
  auth('/token?grant_type=password', { method: 'POST', body: { email, password: 'e2e-password-123' } });
const authenticators = new Map(); // email → { id, secret } of the app set up in this run
export async function twoStepSession(email) {
  const s = await passwordSession(email);
  let factor = authenticators.get(email);
  if (!factor) {
    // First time: set up an authenticator app (Supabase allows a second one only after two-step).
    const made = await auth('/factors', {
      method: 'POST',
      token: s.access_token,
      body: { factor_type: 'totp', friendly_name: `e2e ${Date.now()}` },
    });
    factor = { id: made.id, secret: made.totp.secret };
    authenticators.set(email, factor);
  }
  const challenge = await auth(`/factors/${factor.id}/challenge`, { method: 'POST', token: s.access_token, body: {} });
  return auth(`/factors/${factor.id}/verify`, {
    method: 'POST',
    token: s.access_token,
    body: { challenge_id: challenge.id, code: totp(factor.secret) },
  });
}
export const cookieFor = (s) => `__Host-lc_at=${s.access_token}; __Host-lc_rt=${s.refresh_token}`;

/** The emails the pretend email service received for an address, oldest first. */
export async function mailFor(email) {
  return (await fetch(`${MAIL}/messages?to=${encodeURIComponent(email)}`)).json();
}
/** The newest sign-in code emailed to an address (waits briefly for it to arrive). */
export async function latestCode(email, after = 0) {
  for (let i = 0; i < 20; i++) {
    // Only sign-in codes: the site's own emails (a claim received, …) can arrive in between.
    const code = (await mailFor(email))
      .filter((m) => m.at > after && /\b\d{6}\b/.test(m.subject))
      .at(-1)
      ?.subject.match(/\b(\d{6})\b/)?.[1];
    if (code) return code;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

// --------------------------------------------------------------- site helpers
/**
 * One request to the site, as a browser would send it. `ip` stands in for the visitor's
 * internet address (Cloudflare sets CF-Connecting-IP itself on the real site).
 */
export async function site(path, { cookie, method = 'GET', form, origin = BASE, ip } = {}) {
  // Sign-in forms carry a passed "are you human" check, as a browser's would (unless the test sends its own).
  if (form && path.startsWith('/join') && !('cf-turnstile-response' in form)) form = { ...form, 'cf-turnstile-response': humanPass() };
  if (form?.['cf-turnstile-response'] === null)
    form = Object.fromEntries(Object.entries(form).filter(([k]) => k !== 'cf-turnstile-response'));
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (ip) headers['CF-Connecting-IP'] = ip;
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (origin) headers.Origin = origin;
  }
  const res = await fetch(BASE + path, { method, headers, body: form ? new URLSearchParams(form) : undefined, redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location') ?? '', headers: res.headers, body: await res.text() };
}
let humanAnswers = 0;
/** A fresh answer the pretend checker passes, once, for the sign-in form on this site. */
export const humanPass = (action = 'join', host = new URL(BASE).hostname) => `pass:${action}:${host}:${run}-${++humanAnswers}`;
/** What the site sent the pretend checker. */
export const humanChecks = async () => (await fetch(`${MAIL}/turnstile/checks`)).json();

/** The cookies a response set, ready to send back. */
export const cookiesFrom = (r) =>
  r.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .filter((c) => !c.endsWith('='))
    .join('; ');
