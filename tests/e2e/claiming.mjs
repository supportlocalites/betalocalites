// Sign in with an emailed code, and claiming a business (D-27, D-32 to D-35, ADR-028).
// Covers the promises in E §2–3: replies that never say whether an address has an
// account, our limits on codes, code sign-ins kept out of the team pages, people seeing
// only their own claims, and only the team (never the claimant) deciding a claim.
// Settings and safety checks: tests/e2e/helpers.mjs.
//
// Usage: npm run test:e2e
import { createHash, randomInt } from 'node:crypto';
import { account, check, cookiesFrom, finish, latestCode, mailFor, run, site, sql, twoStepSession, cookieFor } from './helpers.mjs';

const CODE_FAILED = 'That code didn’t work or has expired';
const hashOf = (email) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
// A different visitor address for every call in a run, so no two scenarios share a limit.
let visitors = randomInt(0, 200) * 250;
const ip = () => {
  visitors++;
  return `198.18.${Math.floor(visitors / 250) % 256}.${(visitors % 250) + 1}`;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Earlier runs' code events would count towards today's limit (local database only).
await sql`delete from sign_in_code_event`;

/** Signs in through /join as a person would: email, the emailed code, then (if new) a name. */
async function codeSignIn(email, name) {
  const from = ip();
  const before = Date.now();
  await site('/join', { method: 'POST', form: { intent: 'send', email, next: '/account' }, ip: from });
  const code = await latestCode(email, before - 1);
  let r = await site('/join', { method: 'POST', form: { intent: 'verify', email, code, next: '/account' }, ip: from });
  const cookie = cookiesFrom(r);
  if (r.location.startsWith('/join')) {
    const [firstName, ...rest] = name.split(' ');
    r = await site('/join', { method: 'POST', cookie, form: { intent: 'name', firstName, lastName: rest.join(' ') || 'Test', next: '/account' }, ip: from });
  }
  return cookie;
}

// ------------------------------------------------------------- test listings
const [town] = await sql`select id from municipality where is_active order by sort_order limit 1`;
async function listing(label, { website = null, status = 'published' } = {}) {
  const slug = `e2e-${label}-${run}`;
  const [v] = await sql`
    insert into vendor (slug, display_name, primary_municipality_id, website_url, public_phone, listing_status, published_at, source)
    values (${slug}, ${`E2E ${label} ${run}`}, ${town.id}, ${website}, '705 555 0142', ${status},
            ${status === 'published' ? sql`now()` : null}, 'admin_entered')
    returning id, slug`;
  return v;
}
const bakeryDomain = `bakery-${run}.example.test`;
const bakery = await listing('bakery', { website: `https://www.${bakeryDomain}/` });
const florist = await listing('florist');
const draft = await listing('draft', { status: 'draft' });
const spares = [await listing('spare1'), await listing('spare2'), await listing('spare3')];

console.log('Sign in with an emailed code');

// 1. The screen.
let r = await site('/join');
check('anyone can open "Sign in or create an account"', r.status === 200 && r.body.includes('Email me a code') && r.headers.get('cache-control') === 'no-store');
r = await site('/explore');
check('the header offers "Sign in" to people who aren’t', r.body.includes('href="/join"'));

// 2. Sending a code.
const alice = `alice@${bakeryDomain}`;
let from = ip();
let before = Date.now();
r = await site('/join', { method: 'POST', form: { intent: 'send', email: alice, next: '/account' }, ip: from });
const sentReply = r.body.includes('We’ve emailed a 6-digit code to');
check('a new address is told a code is on its way', r.status === 200 && sentReply, String(r.status));
const [mail] = (await mailFor(alice)).filter((m) => m.at >= before - 1);
check('the email holds only a 6-digit code, no link', /Your Localites code: \d{6}/.test(mail?.subject ?? '') && !/href=|https?:\/\//.test(mail?.body ?? ''), mail?.subject);
check('the email warns never to share the code', (mail?.body ?? '').includes('Never share this code'));
r = await site('/join', { method: 'POST', form: { intent: 'send', email: alice, next: '/account' }, ip: from });
const mailsNow = (await mailFor(alice)).filter((m) => m.at >= before - 1).length;
check('asking again straight away: the same reply, and no second email yet', r.status === 200 && r.body.includes('We’ve emailed a 6-digit code to') && mailsNow === 1, `${r.status} ${mailsNow}`);
r = await site('/join', { method: 'POST', form: { intent: 'send', email: 'not-an-address', next: '/account' }, ip: from });
check('a mistyped address is pointed out', r.status === 400 && r.body.includes('Please check the email address'));

// 3. Wrong codes, and our limit on them (Supabase has none per code).
const code = await latestCode(alice, before - 1);
const wrong = String((Number(code) + 1) % 1e6).padStart(6, '0');
let wrongReplies = 0;
for (let i = 0; i < 5; i++) {
  r = await site('/join', { method: 'POST', form: { intent: 'verify', email: alice, code: wrong, next: '/account' }, ip: ip() });
  if (r.status === 400 && r.body.includes(CODE_FAILED) && !cookiesFrom(r).includes('lc_at')) wrongReplies++;
}
check('a wrong code is refused, with no cookies', wrongReplies === 5, `${wrongReplies} of 5`);
r = await site('/join', { method: 'POST', form: { intent: 'verify', email: alice, code, next: '/account' }, ip: ip() });
check('after 5 wrong tries even the right code is refused (same words)', r.status === 400 && r.body.includes(CODE_FAILED) && !cookiesFrom(r).includes('lc_at'), String(r.status));
await wait(5500); // the local server's wait between codes (60 seconds on the real one)
before = Date.now();
r = await site('/join', { method: 'POST', form: { intent: 'send', email: alice, next: '/account' }, ip: from });
const fresh = await latestCode(alice, before - 1);
check('a new code can be sent after the wait', r.status === 200 && Boolean(fresh) && fresh !== code, `${r.status} ${fresh}`);

// Many guesses sent at the same moment still count one by one.
const racer = `racer-${run}@example.test`;
before = Date.now();
await site('/join', { method: 'POST', form: { intent: 'send', email: racer, next: '/account' }, ip: ip() });
const racerCode = await latestCode(racer, before - 1);
const racerWrong = String((Number(racerCode) + 7) % 1e6).padStart(6, '0');
const burst = await Promise.all(
  Array.from({ length: 12 }, () => site('/join', { method: 'POST', form: { intent: 'verify', email: racer, code: racerWrong, next: '/account' }, ip: ip() })),
);
const [counted] = await sql`select count(*)::int as n from sign_in_code_event where email_hash = ${hashOf(racer)} and kind = 'wrong_code'`;
r = await site('/join', { method: 'POST', form: { intent: 'verify', email: racer, code: racerCode, next: '/account' }, ip: ip() });
check('12 guesses sent at once: only 5 are tried, and the right code is then refused',
  counted.n === 5 && burst.every((b) => b.status === 400) && r.status === 400 && !cookiesFrom(r).includes('lc_at'), `${counted.n} tried, then ${r.status}`);

// 4. The right code, then the name.
r = await site('/join', { method: 'POST', form: { intent: 'verify', email: alice, code: fresh, next: `/vendors/${bakery.slug}/claim` }, ip: from });
let aliceCookie = cookiesFrom(r);
check('the right code signs in a new person and asks their name next', r.status === 302 && r.location === `/join?next=${encodeURIComponent(`/vendors/${bakery.slug}/claim`)}` && aliceCookie.includes('__Host-lc_at='), `${r.status} ${r.location}`);
const [noRecordYet] = await sql`select count(*)::int as n from app_user where email = ${alice}`;
check('nobody is added to Localites until they give their name', noRecordYet.n === 0);
r = await site(r.location, { cookie: aliceCookie });
check('the name step greets them, and asks about them without demanding it', r.status === 200 && r.body.includes('Welcome to Localites') && r.body.includes(alice)
  && r.body.includes('First name') && r.body.includes('Last name') && r.body.includes('Date of birth') && r.body.includes('Street address')
  && !/optional|required/i.test(r.body.replace(/required=""/g, '')));
r = await site('/join', { method: 'POST', cookie: aliceCookie, form: { intent: 'name', firstName: 'Visit https://evil.example', lastName: 'Baker', next: '/account' } });
check('a web address as a name is refused', r.status === 400);
r = await site('/join', { method: 'POST', cookie: aliceCookie, form: { intent: 'name', firstName: 'Alice', lastName: '  ', next: '/account' } });
const [stillNone] = await sql`select count(*)::int as n from app_user where email = ${alice}`;
check('without a last name: "Please enter your first and last name to continue", and nothing saved',
  r.status === 400 && r.body.includes('Please enter your first and last name to continue') && stillNone.n === 0, String(r.status));
const aliceDetails = { gender: 'woman', genderOther: '', dateOfBirth: '1988-04-12', streetAddress: `${run} Example Street`, unit: '', town: 'Orillia', province: 'ON', postalCode: 'l3v1a1' };
r = await site('/join', { method: 'POST', cookie: aliceCookie, form: { intent: 'name', firstName: 'Alice', lastName: 'Baker', ...aliceDetails, postalCode: 'L3V', next: '/account' } });
const [notYet] = await sql`select count(*)::int as n from app_user where email = ${alice}`;
check('a postal code in the wrong shape is pointed out, and nothing is saved', r.status === 400 && r.body.includes('Check the postal code') && notYet.n === 0, String(r.status));
r = await site('/join', { method: 'POST', cookie: aliceCookie, form: { intent: 'name', firstName: '  Alice ', lastName: ' Baker ', ...aliceDetails, next: 'https://evil.example/' } });
check('after the name, a link to another website goes to the account page instead', r.status === 302 && r.location === '/account', `${r.status} ${r.location}`);
const [aliceRow] = await sql`select id, display_name, given_name, family_name from app_user where email = ${alice}`;
check('their first and last name are saved (tidied) with the address they proved',
  aliceRow?.display_name === 'Alice Baker' && aliceRow?.given_name === 'Alice' && aliceRow?.family_name === 'Baker');
const [aliceProfile] = await sql`select gender, date_of_birth::text as dob, street_address, town, province, postal_code from person_profile where user_id = ${aliceRow.id}`;
check('the details they chose to give are saved, tidied', aliceProfile?.gender === 'woman' && aliceProfile?.dob === '1988-04-12'
  && aliceProfile?.town === 'Orillia' && aliceProfile?.province === 'ON' && aliceProfile?.postal_code === 'L3V 1A1', JSON.stringify(aliceProfile));
r = await site('/join', { cookie: aliceCookie });
check('signed in already: the sign-in screen sends them on', r.status === 302 && r.location === '/account', `${r.status} ${r.location}`);
r = await site('/explore', { cookie: aliceCookie });
check('the header offers "Your account" once signed in', r.body.includes('href="/account"'));
let offsite = 0;
for (const trick of ['/%09/evil.example', '/%0a/evil.example', '/%5c/evil.example', '//evil.example', 'https://evil.example']) {
  r = await site(`/join?next=${trick}`, { cookie: aliceCookie });
  if (!(r.status === 302 && r.location === '/account')) offsite++;
}
check('a "next" address hiding another website (tab, line break, backslash) goes to the account page instead', offsite === 0, `${offsite} not caught`);

// 5. Limits.
const busy = `busy-${run}@example.test`;
for (let i = 0; i < 3; i++) await sql`insert into sign_in_code_event (email_hash, kind) values (${hashOf(busy)}, 'sent')`;
before = Date.now();
r = await site('/join', { method: 'POST', form: { intent: 'send', email: busy, next: '/account' }, ip: ip() });
check('3 codes to one address in an hour: asked to use the newest, no fourth email', r.status === 429 && r.body.includes('already sent 3 codes') && (await mailFor(busy)).length === 0, String(r.status));
await sql`insert into sign_in_code_event (email_hash, kind) select repeat('0', 64), 'sent' from generate_series(1, 60)`;
r = await site('/join', { method: 'POST', form: { intent: 'send', email: `daily-${run}@example.test`, next: '/account' }, ip: ip() });
check('60 codes in a day across the site: an honest "try again tomorrow"', r.status === 429 && r.body.includes('try again tomorrow'), String(r.status));
await sql`delete from sign_in_code_event where email_hash = ${'0'.repeat(64)}`;
from = ip();
let limited = false;
// 25 tries: even if a minute ends part-way through, one minute sees more than 10.
for (let i = 0; i < 25 && !limited; i++) {
  r = await site('/join', { method: 'POST', form: { intent: 'verify', email: `nobody-${run}@example.test`, code: '000000', next: '/account' }, ip: from });
  limited = r.status === 429;
}
check('many tries in a minute from one internet address are slowed down', limited);
r = await site('/join', { method: 'POST', form: { intent: 'verify', email: `nobody-${run}@example.test`, code: '123456', next: '/account' }, ip: ip() });
check('an address with no code sent gets the same reply as a wrong code', r.status === 400 && r.body.includes(CODE_FAILED), String(r.status));
r = await site('/join', { method: 'POST', form: { intent: 'send', email: alice, next: '/account' }, origin: 'https://evil.example' });
check('a sign-in form sent from another website is refused', r.status === 403, String(r.status));

// 6. A team member signing in with a code doesn't get into the team pages.
const adminEmail = `e2e-claims-admin-${run}@example.test`;
const adminId = await account(adminEmail);
await sql`insert into platform_role (user_id, role) values (${adminId}, 'admin')`;
const adminCodeCookie = await codeSignIn(adminEmail, 'unused');
r = await site('/admin', { cookie: adminCodeCookie });
check('an emailed-code sign-in can’t open the team pages, even for an admin', r.status === 302 && r.location.includes('/sign-in?') && r.location.includes('team=1'), `${r.status} ${r.location}`);

console.log('Claiming a business');

// 7. Claiming needs an account.
r = await site(`/vendors/${bakery.slug}`);
check('an unclaimed listing invites the business to claim it', r.body.includes(`/vendors/${bakery.slug}/claim`) && r.body.includes('Ask us to remove it'));
r = await site(`/vendors/${bakery.slug}/claim`);
check('signed out: claiming asks you to sign in, then comes back', r.status === 302 && r.location === `/join?next=${encodeURIComponent(`/vendors/${bakery.slug}/claim`)}`, `${r.status} ${r.location}`);
r = await site(`/vendors/${bakery.slug}/claim`, { method: 'POST', form: { relationship: 'owner', authorised: 'yes' } });
const countClaims = async (vendorId) => (await sql`select count(*)::int as n from vendor_claim where vendor_id = ${vendorId}`)[0].n;
check('signed out: a claim can’t be sent', r.status === 302 && (await countClaims(bakery.id)) === 0, String(r.status));

// 8. Alice claims the bakery (her email is at its website).
r = await site(`/vendors/${bakery.slug}/claim`, { cookie: aliceCookie });
check('the claim page says her email matches the business’s website', r.status === 200 && r.body.includes('matches the business’s own website') && r.headers.get('cache-control') === 'no-store');
r = await site(`/vendors/${bakery.slug}/claim`, { cookie: aliceCookie, method: 'POST', form: { relationship: 'owner', note: '' } });
check('a claim needs her to confirm she’s allowed to manage the listing', r.status === 400 && (await countClaims(bakery.id)) === 0, String(r.status));
r = await site(`/vendors/${bakery.slug}/claim`, { cookie: aliceCookie, method: 'POST', form: { relationship: 'boss', authorised: 'yes' } });
check('an unknown connection to the business is refused', r.status === 400 && (await countClaims(bakery.id)) === 0, String(r.status));
r = await site(`/vendors/${bakery.slug}/claim`, { cookie: aliceCookie, method: 'POST', form: { relationship: 'owner', note: 'Call the shop after 2pm', authorised: 'yes' } });
const [aliceClaim] = await sql`select id, status, relationship, claimant_note from vendor_claim where vendor_id = ${bakery.id} and claimant_user_id = ${aliceRow.id}`;
const [pending] = await sql`select claim_status from vendor where id = ${bakery.id}`;
check('her claim is saved and waits for the team', r.status === 302 && aliceClaim?.status === 'submitted' && aliceClaim?.relationship === 'owner', `${r.status} ${aliceClaim?.status}`);
check('the listing shows a claim is pending', pending.claim_status === 'claim_pending', pending.claim_status);
r = await site(`/vendors/${bakery.slug}/claim`, { cookie: aliceCookie });
check('her claim page now says it’s waiting', r.body.includes('Your claim is waiting for our team'));
r = await site(`/vendors/${bakery.slug}/claim`, { cookie: aliceCookie, method: 'POST', form: { relationship: 'owner', authorised: 'yes' } });
check('claiming the same business twice is refused', r.status === 409 && (await countClaims(bakery.id)) === 1, String(r.status));
await wait(500);
const [received] = await sql`select status, failure_reason from notification where subject_id = ${aliceClaim.id} and kind = 'claim_received'`;
check('her "we’ve received your claim" email is recorded honestly', received && (received.status === 'sent' || (received.status === 'failed' && received.failure_reason)), JSON.stringify(received));
r = await site(`/vendors/${draft.slug}/claim`, { cookie: aliceCookie });
check('an unpublished listing can’t be claimed', r.status === 404, String(r.status));
r = await site(`/vendors/${draft.slug}/claim`, { cookie: aliceCookie, method: 'POST', form: { relationship: 'owner', authorised: 'yes' } });
check('… not even by sending the form directly', r.status === 404 && (await countClaims(draft.id)) === 0, String(r.status));

// 9. Bob claims the same bakery (his email proves nothing).
const bob = `bob-${run}@example.test`;
const bobCookie = await codeSignIn(bob, 'Bob Other');
const [bobRow] = await sql`select id from app_user where email = ${bob}`;
r = await site(`/vendors/${bakery.slug}/claim`, { cookie: bobCookie });
check('Bob is told the team will contact the business itself', r.body.includes('contact the business using the phone number or email it publishes itself'));
r = await site(`/vendors/${bakery.slug}/claim`, { cookie: bobCookie, method: 'POST', form: { relationship: 'manager', authorised: 'yes' } });
const [bobClaim] = await sql`select id from vendor_claim where vendor_id = ${bakery.id} and claimant_user_id = ${bobRow.id} and status = 'submitted'`;
check('two people can claim the same business', r.status === 302 && Boolean(bobClaim), String(r.status));

// 10. People see only their own claims.
r = await site('/account', { cookie: bobCookie });
check('Bob’s account shows his claim, not Alice’s', r.status === 200 && r.body.includes(`E2E bakery ${run}`) && !r.body.includes('Alice') && !r.body.includes('Call the shop'));
r = await site('/account.data', { cookie: bobCookie });
check('… nor does his account page’s data', !r.body.includes(aliceClaim.id) && !r.body.includes('Call the shop'));
check('… and never her personal details', !r.body.includes(`${run} Example Street`) && !r.body.includes('1988-04-12'));
const [bobProfile] = await sql`select count(*)::int as n from person_profile where user_id = ${bobRow.id}`;
check('someone who gave only a name has no personal details kept', bobProfile.n === 0);
r = await site('/account', { cookie: aliceCookie });
check('Alice sees her own details on her account page', r.body.includes(`${run} Example Street`) && r.body.includes('1988-04-12'));
r = await site('/account', { cookie: bobCookie, method: 'POST', form: { intent: 'details', firstName: 'Bob', lastName: 'Other', gender: '', genderOther: '', dateOfBirth: '', streetAddress: '', unit: '', town: 'Severn', province: 'ON', postalCode: '' } });
const [bobLater] = await sql`select town, province from person_profile where user_id = ${bobRow.id}`;
check('details can be added later on Your account', r.status === 302 && bobLater?.town === 'Severn', `${r.status} ${JSON.stringify(bobLater)}`);
r = await site('/account', { cookie: bobCookie, method: 'POST', form: { intent: 'details', firstName: 'Bob', lastName: 'Other', userId: aliceRow.id, gender: '', genderOther: '', dateOfBirth: '', streetAddress: '', unit: '', town: '', province: 'ON', postalCode: '' } });
const [bobCleared] = await sql`select count(*)::int as n from person_profile where user_id = ${bobRow.id}`;
const [aliceKept] = await sql`select street_address from person_profile where user_id = ${aliceRow.id}`;
check('clearing every detail removes them; a form naming someone else changes only your own', r.status === 302 && bobCleared.n === 0 && aliceKept?.street_address === `${run} Example Street`);
r = await site('/account');
check('signed out: the account page asks you to sign in', r.status === 302 && r.location === '/join?next=%2Faccount', `${r.status} ${r.location}`);

// 11. Open-claim limit.
for (const s of spares) {
  await site(`/vendors/${s.slug}/claim`, { cookie: bobCookie, method: 'POST', form: { relationship: 'other', authorised: 'yes' } });
}
r = await site(`/vendors/${florist.slug}/claim`, { cookie: bobCookie, method: 'POST', form: { relationship: 'owner', authorised: 'yes' } });
check('a fourth open claim from one person is refused', r.status === 409 && (await countClaims(florist.id)) === 0, String(r.status));

// 12. Only the team decides, never a claimant.
r = await site('/admin/claims', { cookie: aliceCookie, method: 'POST', form: { intent: 'approve', id: aliceClaim.id, check: 'email_domain' } });
let [stillOpen] = await sql`select status from vendor_claim where id = ${aliceClaim.id}`;
check('a claimant can’t approve her own claim through the team page', r.status === 302 && r.location.startsWith('/sign-in') && stillOpen.status === 'submitted', `${r.status} ${stillOpen.status}`);
// That attempt signed her out. She has used her 3 codes this hour; start a new hour.
await sql`delete from sign_in_code_event where email_hash = ${hashOf(alice)}`;
aliceCookie = await codeSignIn(alice, 'unused');
const staffEmail = `e2e-claims-staff-${run}@example.test`;
await account(staffEmail);
r = await site('/admin/claims', { cookie: cookieFor(await twoStepSession(staffEmail)), method: 'POST', form: { intent: 'approve', id: aliceClaim.id, check: 'phoned_business' } });
[stillOpen] = await sql`select status from vendor_claim where id = ${aliceClaim.id}`;
check('someone not on the team can’t approve a claim (403)', r.status === 403 && stillOpen.status === 'submitted', `${r.status} ${stillOpen.status}`);

// 13. The team page.
const adminCookie = cookieFor(await twoStepSession(adminEmail));
r = await site('/admin/claims', { cookie: adminCookie });
check('the team sees the claim with its evidence and the business’s own phone number',
  r.status === 200 && r.body.includes('Email matches the business’s own website') && r.body.includes('705 555 0142') && r.body.includes('Call the shop after 2pm'));
check('the team menu counts claims waiting', /Claims(<!-- -->)? \(\d+ waiting\)/.test(r.body));

// 14. A team member can't approve their own claim.
r = await site(`/vendors/${florist.slug}/claim`, { cookie: adminCookie, method: 'POST', form: { relationship: 'owner', authorised: 'yes' } });
const [ownClaim] = await sql`select id from vendor_claim where vendor_id = ${florist.id} and claimant_user_id = ${adminId}`;
r = await site('/admin/claims', { cookie: adminCookie, method: 'POST', form: { intent: 'approve', id: ownClaim.id, check: 'phoned_business' } });
let [ownStatus] = await sql`select status from vendor_claim where id = ${ownClaim.id}`;
check('a team member can’t approve their own claim', r.status === 409 && ownStatus.status === 'submitted', `${r.status} ${ownStatus.status}`);

// 15. "Their email matches the website" only when it does.
r = await site('/admin/claims', { cookie: adminCookie, method: 'POST', form: { intent: 'approve', id: bobClaim.id, check: 'email_domain' } });
let [bobStatus] = await sql`select status from vendor_claim where id = ${bobClaim.id}`;
check('approving on a matching email is refused when the email doesn’t match', r.status === 409 && bobStatus.status === 'submitted', `${r.status} ${bobStatus.status}`);
r = await site('/admin/claims', { cookie: adminCookie, method: 'POST', form: { intent: 'approve', id: bobClaim.id, check: '' } });
check('approving needs to say how it was confirmed', r.status === 400, String(r.status));

// 16. First approved wins.
r = await site('/admin/claims', { cookie: adminCookie, method: 'POST', form: { intent: 'approve', id: aliceClaim.id, check: 'email_domain' } });
const [approved] = await sql`select status, reviewed_by, decision_note from vendor_claim where id = ${aliceClaim.id}`;
const [claimed] = await sql`select claim_status, verification_status from vendor where id = ${bakery.id}`;
const owners = await sql`select user_id, added_by from vendor_member where vendor_id = ${bakery.id} and role = 'owner' and ended_at is null`;
[bobStatus] = await sql`select status, decision_note from vendor_claim where id = ${bobClaim.id}`;
check('approving makes Alice the owner, added by the admin', r.status === 302 && approved.status === 'approved' && approved.reviewed_by === adminId && owners.length === 1 && owners[0].user_id === aliceRow.id && owners[0].added_by === adminId, `${r.status} ${approved.status} ${owners.length}`);
check('the listing is claimed, and approving doesn’t make it verified', claimed.claim_status === 'claimed' && claimed.verification_status === 'unverified');
check('Bob’s claim for the same business is declined automatically, with the reason', bobStatus.status === 'rejected' && bobStatus.decision_note === 'Another claim for this business was approved.');
const [history] = await sql`select count(*)::int as n from status_change where subject_id in (${aliceClaim.id}, ${bobClaim.id}, ${bakery.id}) and actor_user_id = ${adminId}`;
const [logged] = await sql`select count(*)::int as n from audit_log where actor_user_id = ${adminId} and subject_id in (${aliceClaim.id}, ${bobClaim.id}) and action in ('vendor_claim.approve', 'vendor_claim.decline')`;
check('every change is in the status history and the audit log', history.n === 3 && logged.n === 2, `${history.n} ${logged.n}`);
await wait(500);
const decisions = await sql`select user_id, status from notification where kind = 'claim_decision' and subject_id in (${aliceClaim.id}, ${bobClaim.id})`;
check('both are emailed the decision, each recorded honestly', decisions.length === 2 && decisions.every((d) => d.status === 'sent' || d.status === 'failed'), JSON.stringify(decisions));
r = await site('/admin/claims', { cookie: adminCookie, method: 'POST', form: { intent: 'approve', id: bobClaim.id, check: 'phoned_business' } });
const [stillOneOwner] = await sql`select count(*)::int as n from vendor_member where vendor_id = ${bakery.id} and role = 'owner' and ended_at is null`;
check('a declined claim can’t be approved afterwards; still one owner', r.status === 409 && stillOneOwner.n === 1, `${r.status} ${stillOneOwner.n}`);

// 17. After the decision.
r = await site(`/vendors/${bakery.slug}`);
check('the public page says the business manages its own listing', r.body.includes('manages its own listing') && !r.body.includes(`/vendors/${bakery.slug}/claim`));
r = await site(`/vendors/${bakery.slug}/claim`, { cookie: bobCookie, method: 'POST', form: { relationship: 'owner', authorised: 'yes' } });
check('a claimed business can’t be claimed again', r.status === 409 && (await countClaims(bakery.id)) === 2, String(r.status));
r = await site('/account', { cookie: aliceCookie });
check('Alice’s account lists the business she now manages', r.body.includes('Your businesses') && r.body.includes(`/vendors/${bakery.slug}`) && r.body.includes('Owner'));
r = await site('/account', { cookie: bobCookie });
check('Bob’s account shows his claim wasn’t approved, and why', r.body.includes('Not approved') && r.body.includes('Another claim for this business was approved.'));

// 18. Declining needs a reason, and frees the listing when nobody else is waiting.
r = await site('/admin/claims', { cookie: adminCookie, method: 'POST', form: { intent: 'decline', id: ownClaim.id, reason: '  ' } });
check('declining needs a reason', r.status === 400, String(r.status));
r = await site('/admin/claims', { cookie: adminCookie, method: 'POST', form: { intent: 'decline', id: ownClaim.id, reason: 'E2E: not the owner' } });
[ownStatus] = await sql`select status, decision_note from vendor_claim where id = ${ownClaim.id}`;
const [freed] = await sql`select claim_status from vendor where id = ${florist.id}`;
check('declined with its reason; the listing is unclaimed again', r.status === 302 && ownStatus.status === 'rejected' && ownStatus.decision_note === 'E2E: not the owner' && freed.claim_status === 'unclaimed', `${r.status} ${ownStatus.status} ${freed.claim_status}`);

// 19. Signing out.
r = await site('/sign-out', { cookie: aliceCookie, method: 'POST' });
r = await site('/account', { cookie: aliceCookie });
check('after signing out, the old cookies no longer open the account page', r.status === 302 && r.location.startsWith('/join'), `${r.status} ${r.location}`);

await finish('sign-in and claiming');
