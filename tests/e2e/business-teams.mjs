// A business owner's team (screen V4, E §3; migration 0015). Covers: only the owner manages
// the team; an invitation works only for the email address it was sent to, once, within 7
// days; a manager can do everything the owner does except the team; staff see nothing yet;
// removing someone, or the owner leaving, ends their access.
// Settings and safety checks: tests/e2e/helpers.mjs.
//
// Usage: npm run test:e2e
import { account, check, cookieFor, finish, mailFor, passwordSession, run, site, sql } from './helpers.mjs';

const [town] = await sql`select id from municipality where is_active order by sort_order limit 1`;
async function listing(label) {
  const [v] = await sql`
    insert into vendor (slug, display_name, primary_municipality_id, listing_status, published_at, claim_status, source)
    values (${`e2e-team-${label}-${run}`}, ${`Team ${label} ${run}`}, ${town.id}, 'published', now(), 'claimed', 'admin_entered')
    returning id, slug::text as slug, display_name as name`;
  return v;
}
const V = await listing('v');
const W = await listing('w');
const email = (who) => `e2e-team-${who}-${run}@example.test`;
const ids = {};
for (const who of ['o', 'o2', 'mgr', 'stf', 'other']) ids[who] = await account(email(who));
await sql`update app_user set display_name = ${`Olive Owner ${run}`} where id = ${ids.o}`;
await sql`insert into vendor_member (vendor_id, user_id, role) values (${V.id}, ${ids.o}, 'owner'), (${W.id}, ${ids.o2}, 'owner')`;
const cookie = {};
for (const who of ['o', 'o2', 'mgr', 'stf', 'other']) cookie[who] = cookieFor(await passwordSession(email(who)));
const TEAM = `/vendors/${V.slug}/team`;
const membership = async (who) =>
  (await sql`select role from vendor_member where vendor_id = ${V.id} and user_id = ${ids[who]} and ended_at is null`)[0]?.role ?? null;
async function inviteLink(to) {
  for (let i = 0; i < 30; i++) {
    const m = (await mailFor(to)).at(-1);
    const token = m?.body.match(/\/team-invite\/([A-Za-z0-9_-]+)/)?.[1];
    if (token) return { token, mail: m };
    await new Promise((r) => setTimeout(r, 150));
  }
  return { token: null, mail: null };
}

console.log('Only the owner manages the team');
let r = await site(TEAM);
check('signed out: sent to sign in first', r.status === 302 && r.location.startsWith('/join'), `${r.status} ${r.location}`);
for (const who of ['mgr', 'o2']) {
  r = await site(TEAM, { cookie: cookie[who] });
  check(`${who === 'o2' ? 'another business’s owner' : 'someone not on the team'} gets “not found”`, r.status === 404, String(r.status));
}
r = await site(TEAM, { cookie: cookie.o2, method: 'POST', form: { intent: 'invite', email: email('other'), role: 'manager' } });
check(
  '…and can’t invite anyone to it',
  r.status === 404 && (await sql`select count(*)::int as n from vendor_invite where vendor_id = ${V.id}`)[0].n === 0,
  String(r.status),
);
r = await site(TEAM, { cookie: cookie.o });
check(
  'the owner sees the team, with themselves as owner',
  r.status === 200 && r.body.includes(`Olive Owner ${run}`) && r.body.includes('(you)'),
  String(r.status),
);
r = await site(`/vendors/${V.slug}`, { cookie: cookie.o });
r = await site('/account', { cookie: cookie.o });
check('Your account links the owner to Team', r.body.includes(`href="${TEAM}"`));

console.log('\nInviting a manager');
r = await site(TEAM, { cookie: cookie.o, method: 'POST', form: { intent: 'invite', email: email('o'), role: 'manager' } });
check('inviting yourself is refused', r.status === 409 && r.body.includes('You’re already the owner'), String(r.status));
r = await site(TEAM, { cookie: cookie.o, method: 'POST', form: { intent: 'invite', email: email('mgr').toUpperCase(), role: 'owner' } });
check('an invitation can’t make someone an owner', r.status === 400, String(r.status));
r = await site(TEAM, {
  cookie: cookie.o,
  method: 'POST',
  form: { intent: 'invite', email: email('mgr'), role: 'manager' },
  origin: 'https://evil.example',
});
check('a form sent from another website is refused', r.status === 403, String(r.status));
r = await site(TEAM, { cookie: cookie.o, method: 'POST', form: { intent: 'invite', email: email('mgr'), role: 'manager' } });
const { token: mgrToken, mail: mgrMail } = await inviteLink(email('mgr'));
check(
  'the owner invites a manager: the email names the owner and the business, with a link',
  r.status === 302 && Boolean(mgrToken) && mgrMail.subject.includes(`Olive Owner ${run}`) && mgrMail.subject.includes(V.name),
  `${r.status} ${mgrMail?.subject}`,
);
// The email goes out after the reply; its status is written a moment later.
let stored;
for (let i = 0; i < 30; i++) {
  [stored] = await sql`select token_hash, email_status from vendor_invite where vendor_id = ${V.id} and email = ${email('mgr')}`;
  if (stored?.email_status !== 'pending') break;
  await new Promise((r) => setTimeout(r, 150));
}
check(
  'only a fingerprint of the link is stored, and the email is recorded as sent',
  stored && stored.token_hash.length === 64 && !stored.token_hash.includes(mgrToken) && stored.email_status === 'sent',
  JSON.stringify(stored),
);
r = await site(TEAM, { cookie: cookie.o });
check('the team page lists the invitation, waiting', r.body.includes(email('mgr')) && r.body.includes('Invited, waiting to accept'));

console.log('\nAccepting');
r = await site(`/team-invite/${mgrToken}`);
check(
  'signed out: sent to sign in, then back to the invitation',
  r.status === 302 && r.location === `/join?next=${encodeURIComponent(`/team-invite/${mgrToken}`)}`,
  r.location,
);
r = await site(`/team-invite/${mgrToken}`, { cookie: cookie.other });
check(
  'someone else opening the link is told it was sent to another address (without saying which)',
  r.status === 200 && r.body.includes('sent to a different email address') && !r.body.includes(email('mgr')),
  String(r.status),
);
r = await site(`/team-invite/${mgrToken}`, { cookie: cookie.other, method: 'POST', form: { intent: 'accept' } });
check('…and can’t accept it', r.status === 409 && (await membership('other')) === null, String(r.status));
r = await site(`/team-invite/${'x'.repeat(43)}`, { cookie: cookie.mgr });
check('a made-up link is refused plainly', r.status === 200 && r.body.includes('isn’t valid'));
r = await site(`/team-invite/${mgrToken}`, { cookie: cookie.mgr });
check(
  'the invited person sees the business and what a manager does',
  r.status === 200 && r.body.includes(V.name) && r.body.includes('A manager can edit'),
);
r = await site(`/team-invite/${mgrToken}`, { cookie: cookie.mgr, method: 'POST', form: { intent: 'accept' } });
check(
  'accepting puts them on the team as manager (recorded)',
  r.status === 200 &&
    (await membership('mgr')) === 'manager' &&
    (await sql`select count(*)::int as n from audit_log where action = 'vendor_member.join' and actor_user_id = ${ids.mgr}`)[0].n === 1,
  String(r.status),
);
r = await site(`/team-invite/${mgrToken}`, { cookie: cookie.mgr, method: 'POST', form: { intent: 'accept' } });
check('the link works only once', r.status === 409, String(r.status));

console.log('\nWhat a manager can do');
for (const path of [`/vendors/${V.slug}/edit`, `/vendors/${V.slug}/bookings`, '/business']) {
  r = await site(path, { cookie: cookie.mgr });
  check(`the manager can open ${path.replace(V.slug, '<V>')}`, r.status === 200, String(r.status));
}
r = await site(TEAM, { cookie: cookie.mgr });
check('…but not the team page, and is told only the owner can', r.status === 403 && r.body.includes('Only the owner can do this'), String(r.status));
r = await site(TEAM, { cookie: cookie.mgr, method: 'POST', form: { intent: 'invite', email: email('other'), role: 'manager' } });
check('…and can’t invite anyone', r.status === 404, String(r.status));
r = await site(`/vendors/${W.slug}/edit`, { cookie: cookie.mgr });
check('…nor touch another business', r.status === 404, String(r.status));

console.log('\nStaff');
await site(TEAM, { cookie: cookie.o, method: 'POST', form: { intent: 'invite', email: email('stf'), role: 'staff' } });
const { token: stfToken } = await inviteLink(email('stf'));
r = await site(`/team-invite/${stfToken}`, { cookie: cookie.stf, method: 'POST', form: { intent: 'accept' } });
check('staff accept their invitation', r.status === 200 && (await membership('stf')) === 'staff', String(r.status));
r = await site('/business', { cookie: cookie.stf });
check(
  'staff see the business, with its Messages (and nothing they can’t open)',
  r.status === 200 && r.body.includes(V.name) && r.body.includes(`/vendors/${V.slug}/messages`) && !r.body.includes(`/vendors/${V.slug}/edit`),
);
for (const path of [`/vendors/${V.slug}/edit`, `/vendors/${V.slug}/bookings`, TEAM]) {
  r = await site(path, { cookie: cookie.stf });
  check(
    `staff can’t open ${path.replace(V.slug, '<V>')}, and are told who can`,
    r.status === 403 && r.body.includes(path === TEAM ? 'Only the owner can do this' : 'Only the owner or a manager can do this'),
    String(r.status),
  );
}
r = await site(`/vendors/${V.slug}/edit`, { cookie: cookie.other });
check('someone not on the team still gets “not found”, so nothing says who is on it', r.status === 404, String(r.status));

console.log('\nCancelling and expiry');
await site(TEAM, { cookie: cookie.o, method: 'POST', form: { intent: 'invite', email: email('other'), role: 'manager' } });
const { token: otherToken } = await inviteLink(email('other'));
const [otherInvite] =
  await sql`select id from vendor_invite where vendor_id = ${V.id} and email = ${email('other')} and revoked_at is null`;
r = await site(TEAM, { cookie: cookie.o, method: 'POST', form: { intent: 'cancel', id: otherInvite.id } });
check('the owner cancels an invitation', r.status === 302 && r.location.includes('cancelled=1'), `${r.status} ${r.location}`);
r = await site(`/team-invite/${otherToken}`, { cookie: cookie.other, method: 'POST', form: { intent: 'accept' } });
check('…and its link no longer works', r.status === 409 && (await membership('other')) === null, String(r.status));
await site(TEAM, { cookie: cookie.o, method: 'POST', form: { intent: 'invite', email: email('other'), role: 'staff' } });
const { token: lateToken } = await inviteLink(email('other'));
await sql`update vendor_invite set expires_at = now() - interval '1 minute' where vendor_id = ${V.id} and email = ${email('other')} and revoked_at is null`;
r = await site(`/team-invite/${lateToken}`, { cookie: cookie.other });
check('an invitation older than 7 days has expired', r.status === 200 && r.body.includes('has expired'));

console.log('\nRemoving');
const [mgrRow] = await sql`select id from vendor_member where vendor_id = ${V.id} and user_id = ${ids.mgr} and ended_at is null`;
r = await site(TEAM, { cookie: cookie.o2, method: 'POST', form: { intent: 'remove', id: mgrRow.id } });
check('another business’s owner can’t remove V’s manager', r.status === 404 && (await membership('mgr')) === 'manager', String(r.status));
r = await site(TEAM, { cookie: cookie.o, method: 'POST', form: { intent: 'remove', id: mgrRow.id } });
check(
  'the owner removes the manager (recorded)',
  r.status === 302 &&
    (await membership('mgr')) === null &&
    (await sql`select count(*)::int as n from audit_log where action = 'vendor_member.remove' and subject_id = ${V.id}`)[0].n === 1,
  String(r.status),
);
r = await site(`/vendors/${V.slug}/edit`, { cookie: cookie.mgr });
check('…and their access ends at once', r.status === 404, String(r.status));
const [ownerRow] = await sql`select id from vendor_member where vendor_id = ${V.id} and role = 'owner' and ended_at is null`;
r = await site(TEAM, { cookie: cookie.o, method: 'POST', form: { intent: 'remove', id: ownerRow.id } });
check('the owner can’t remove themselves here (ownership goes through the team)', (await membership('o')) === 'owner', String(r.status));

console.log('\nThe owner leaving');
await sql`update vendor_member set ended_at = now() where id = ${ownerRow.id}`;
r = await site('/business', { cookie: cookie.stf });
check(
  'when the owner leaves, staff lose the business too',
  (await membership('stf')) === null && !r.body.includes(V.name),
  String(r.status),
);

await finish('business team');
