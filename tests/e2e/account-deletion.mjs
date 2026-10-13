// Deleting your own account (E §8, D-10; migration 0014). Covers: only the signed-in
// person's own account, after typing their email address; a team member can't; everything
// of theirs in our database is erased or deleted while other people's data is untouched;
// the session ends; and the team's list of Supabase sign-in records to remove.
// Settings and safety checks: tests/e2e/helpers.mjs.
//
// Usage: npm run test:e2e
import { account, check, cookieFor, finish, passwordSession, run, site, sql, twoStepSession } from './helpers.mjs';

const [town] = await sql`select id from municipality where is_active order by sort_order limit 1`;
async function listing(label, claim) {
  const [v] = await sql`
    insert into vendor (slug, display_name, primary_municipality_id, listing_status, published_at, claim_status, source)
    values (${`e2e-del-${label}-${run}`}, ${`Delete ${label} ${run}`}, ${town.id}, 'published', now(), ${claim}, 'admin_entered')
    returning id, slug::text as slug`;
  return v;
}
const B = await listing('own', 'claimed'); // P's own business
const V = await listing('booked', 'claimed'); // someone else's, which P marked booked
const U = await listing('claimable', 'unclaimed'); // P has an open claim on it

const email = (who) => `e2e-del-${who}-${run}@example.test`;
const ids = {};
for (const who of ['p', 'q', 'o', 'm', 'n']) ids[who] = await account(email(who));
await sql`update app_user set display_name = ${`Pat Deleting ${run}`}, given_name = 'Pat', family_name = ${`Deleting ${run}`} where id = ${ids.p}`;
await sql`insert into platform_role (user_id, role) values (${ids.m}, 'admin')`;
await sql`insert into vendor_member (vendor_id, user_id, role) values (${B.id}, ${ids.p}, 'owner'), (${V.id}, ${ids.o}, 'owner')`;
await sql`insert into person_profile (user_id, street_address, town) values (${ids.p}, '1 Test Street', 'Test Town') on conflict do nothing`;
await sql`insert into vendor_claim (vendor_id, claimant_user_id, claimant_note) values (${U.id}, ${ids.p}, ${`My note ${run}`})`;
// An event each for P and Q, with V marked booked on P's, and a save each.
for (const who of ['p', 'q']) {
  const [e] = await sql`
    insert into event (host_user_id, event_date, municipality_id)
    values (${ids[who]}, (now() at time zone 'America/Toronto')::date + 20, ${town.id}) returning id`;
  await sql`insert into event_private (event_id, host_user_id, title, notes) values (${e.id}, ${ids[who]}, ${`Party ${who} ${run}`}, 'Private')`;
  await sql`insert into event_vendor (event_id, host_user_id, vendor_id, status, booked_at) values (${e.id}, ${ids[who]}, ${V.id}, 'booked', now())`;
  await sql`insert into saved_vendor (user_id, vendor_id) values (${ids[who]}, ${V.id})`;
}
const cookie = {};
for (const who of ['p', 'q', 'n']) cookie[who] = cookieFor(await passwordSession(email(who)));
cookie.m = cookieFor(await twoStepSession(email('m')));
const count = async (query) => (await query)[0].n;
const pRows = () =>
  count(sql`select ((select count(*) from event where host_user_id = ${ids.p}) + (select count(*) from event_vendor where host_user_id = ${ids.p})
                   + (select count(*) from saved_vendor where user_id = ${ids.p}))::int as n`);

console.log('Asking');
let r = await site('/account/delete');
check('signed out: sent to sign in first', r.status === 302 && r.location.startsWith('/join'), `${r.status} ${r.location}`);
r = await site('/account', { cookie: cookie.p });
check('Your account links to "Delete your account"', r.status === 200 && r.body.includes('href="/account/delete"'));
r = await site('/account/delete', { cookie: cookie.p });
check('the page says plainly what is deleted, and asks for the email address',
  r.status === 200 && r.body.includes('This can’t be undone') && r.body.includes('goes back to unclaimed') && r.body.includes(email('p')), String(r.status));

console.log('\nRefused');
r = await site('/account/delete', { cookie: cookie.p, method: 'POST', form: { intent: 'delete', confirm: 'someone-else@example.test' } });
check('the wrong email address: refused, nothing deleted', r.status === 400 && (await pRows()) === 3, String(r.status));
r = await site('/account/delete', { cookie: cookie.p, method: 'POST', form: { intent: 'delete', confirm: email('p') }, origin: 'https://evil.example' });
check('a form sent from another website: refused, nothing deleted', r.status === 403 && (await pRows()) === 3, String(r.status));
r = await site('/account/delete', { cookie: cookie.m });
check('a team member is told to have their team role removed first', r.status === 200 && r.body.includes('You’re on the Localites team'));
r = await site('/account/delete', { cookie: cookie.m, method: 'POST', form: { intent: 'delete', confirm: email('m') } });
const [mRow] = await sql`select deleted_at from app_user where id = ${ids.m}`;
check('…and can’t delete it (409), whatever they send', r.status === 409 && mRow.deleted_at === null, String(r.status));

console.log('\nDeleting');
r = await site('/account/delete', { cookie: cookie.p, method: 'POST', form: { intent: 'delete', confirm: email('p').toUpperCase() } });
const cleared = r.headers.getSetCookie().filter((c) => /__Host-lc_(at|rt)=;/.test(c) && /Max-Age=0/.test(c)).length;
check('deleting goes to the goodbye page and clears the sign-in cookies', r.status === 302 && r.location === '/goodbye' && cleared === 2, `${r.status} ${r.location} ${cleared}`);
r = await site('/goodbye');
check('the goodbye page says the account is deleted', r.status === 200 && r.body.includes('Your account is deleted'));
const [p] = await sql`select display_name, email::text as email, given_name, deleted_at from app_user where id = ${ids.p}`;
check('the account row holds nothing personal', p.display_name === 'Former Localites member' && p.email === `deleted-${ids.p}@deleted.invalid` && p.given_name === null && p.deleted_at !== null, JSON.stringify(p));
check('P’s events, plans and saves are deleted', (await pRows()) === 0);
check('Q’s event, plan and save are untouched',
  (await count(sql`select ((select count(*) from event where host_user_id = ${ids.q}) + (select count(*) from saved_vendor where user_id = ${ids.q}))::int as n`)) === 2);
check('personal details are deleted', (await count(sql`select count(*)::int as n from person_profile where user_id = ${ids.p}`)) === 0);
const [claim] = await sql`select status, claimant_note from vendor_claim where claimant_user_id = ${ids.p}`;
check('the open claim is withdrawn and its note erased', claim.status === 'withdrawn' && claim.claimant_note === null, JSON.stringify(claim));
const [own] = await sql`select claim_status from vendor where id = ${B.id}`;
check('P’s own business is unclaimed again, and P is off its team',
  own.claim_status === 'unclaimed' && (await count(sql`select count(*)::int as n from vendor_member where user_id = ${ids.p} and ended_at is null`)) === 0);
check('the other business (V) still has its owner', (await sql`select claim_status from vendor where id = ${V.id}`)[0].claim_status === 'claimed');
r = await site('/account', { cookie: cookie.p });
check('the old cookies no longer open Your account', r.status === 302 && r.location.startsWith('/join'), `${r.status} ${r.location}`);

console.log('\nThe team’s list');
r = await site('/admin/account-deletions', { cookie: cookie.n });
check('not on the team: the list is refused (403)', r.status === 403, String(r.status));
r = await site('/admin/account-deletions', { cookie: cookie.m });
check('the team sees the account id to remove in Supabase, and nothing personal',
  r.status === 200 && r.body.includes(ids.p) && !r.body.includes(email('p')) && !r.body.includes(`Deleting ${run}`), String(r.status));
check('the menu says there is one to finish', r.body.includes('to finish)'));
r = await site('/admin/account-deletions', { cookie: cookie.n, method: 'POST', form: { intent: 'done', userId: ids.p } });
check('not on the team: can’t mark it done', r.status === 403 && (await sql`select auth_removed_at from account_deletion where user_id = ${ids.p}`)[0].auth_removed_at === null, String(r.status));
r = await site('/admin/account-deletions', { cookie: cookie.m, method: 'POST', form: { intent: 'done', userId: ids.p } });
const [done] = await sql`select auth_removed_at, auth_removed_by from account_deletion where user_id = ${ids.p}`;
check('the team marks it done: recorded with who, and in the audit log',
  r.status === 200 && done.auth_removed_at !== null && done.auth_removed_by === ids.m
  && (await count(sql`select count(*)::int as n from audit_log where action = 'account.sign_in_removed' and subject_id = ${ids.p}`)) === 1, String(r.status));

await finish('account deletion');
