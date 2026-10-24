// Scenario-test fixes, round 5 part 1 (D-54, migration 0050): the owner hides the business's page
// or shows it again, hands the business to someone on the team (who is emailed), or, with nobody
// else on the team, takes it off Localites; a manager or staff member leaves a team; someone on a
// business's team sees its page as theirs, has "My business" in the header, and an old
// conversation says they're on the team now, not that the business left; one connection can
// suggest at most 10 businesses a day. The database's own rules are checked in db/tests/0050.
//
// Usage: npm run test:e2e
import { account, check, cookieFor, finish, mailFor, passwordSession, run, site, sql } from './helpers.mjs';

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const words = (html) => decode(html.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ');
async function waitFor(read, done, ms = 5000) {
  const end = Date.now() + ms;
  let value = await read();
  while (!done(value) && Date.now() < end) {
    await new Promise((res) => setTimeout(res, 150));
    value = await read();
  }
  return value;
}

const [town] = await sql`select id from municipality where is_active order by sort_order limit 1`;
const business = async (key, name) =>
  (
    await sql`
    insert into vendor (slug, display_name, primary_municipality_id, listing_status, published_at, claim_status, source)
    values (${`e2e-fix5-${key}-${run}`}, ${`${name} ${run}`}, ${town.id}, 'published', now(), 'claimed', 'admin_entered')
    returning id, slug::text as slug, display_name as name`
  )[0];
const V = await business('v', 'Fixes Five Bakery');
const W = await business('w', 'Fixes Five Florist');
const C = await business('c', 'Fixes Five Caterer');
const email = (who) => `e2e-fix5-${who}-${run}@example.test`;
const ids = {};
for (const who of ['o', 'm', 'a', 'w', 's', 'q']) ids[who] = await account(email(who));
await sql`update app_user set given_name = 'Mo', family_name = 'Manager' where id = ${ids.m}`;
await sql`insert into vendor_member (vendor_id, user_id, role) values
  (${V.id}, ${ids.o}, 'owner'), (${V.id}, ${ids.m}, 'manager'),
  (${W.id}, ${ids.w}, 'owner'), (${W.id}, ${ids.s}, 'staff'),
  (${C.id}, ${ids.q}, 'owner')`;
const cookie = {};
for (const who of ['o', 'm', 'a', 'w', 's']) cookie[who] = cookieFor(await passwordSession(email(who)));
const TEAM = `/vendors/${V.slug}/team`;
const listing = async (id) => (await sql`select listing_status, owner_hidden_at is not null as hidden, claim_status from vendor where id = ${id}`)[0];

console.log('Two hats: on the team, and a customer');
let r = await site(`/vendors/${V.slug}`, { cookie: cookie.o });
check('the owner sees their own page as theirs, without Message, Save or Add to event',
  words(r.body).includes('This is your business') && !r.body.includes(`/vendors/${V.slug}/message"`) && !r.body.includes(`/vendors/${V.slug}/add"`));
r = await site(`/vendors/${V.slug}`, { cookie: cookie.a });
// Add to event is hidden since the Base44 design (D-59, G8).
check('…a customer sees Message', r.body.includes(`/vendors/${V.slug}/message"`) && !words(r.body).includes('This is your business'));
r = await site('/events', { cookie: cookie.o });
check('the header offers “My business” to someone on a team', r.body.includes('href="/business"'));
r = await site('/events', { cookie: cookie.a });
check('…and not to someone who isn’t', !r.body.includes('href="/business"'));

console.log('\nHiding the page');
r = await site(TEAM, { cookie: cookie.m, method: 'POST', form: { intent: 'hide' } });
check('a manager can’t hide the page', r.status === 404 && (await listing(V.id)).listing_status === 'published', String(r.status));
r = await site(TEAM, { cookie: cookie.o, method: 'POST', form: { intent: 'hide' } });
check('the owner hides it', r.status === 302 && r.location.includes('hidden=1') && (await listing(V.id)).hidden, r.location);
r = await site(`/vendors/${V.slug}`, { cookie: cookie.a });
check('…it’s no longer on Localites', r.status === 404, String(r.status));
r = await site('/business', { cookie: cookie.m });
check('…the team sees it’s hidden by its owner', words(r.body).includes('Hidden by its owner'));
r = await site(TEAM, { cookie: cookie.o });
check('…and the owner can show it again', words(r.body).includes('Show my page again'));
r = await site(TEAM, { cookie: cookie.o, method: 'POST', form: { intent: 'show' } });
check('the owner shows it again', r.status === 302 && (await listing(V.id)).listing_status === 'published' && !(await listing(V.id)).hidden, r.location);
// A page the Localites team took down stays down.
await sql`update vendor set listing_status = 'unpublished' where id = ${V.id}`;
r = await site(TEAM, { cookie: cookie.o, method: 'POST', form: { intent: 'show' } });
check('…but not a page the Localites team took down', r.status === 409 && (await listing(V.id)).listing_status === 'unpublished', String(r.status));
await sql`update vendor set listing_status = 'published' where id = ${V.id}`;

console.log('\nHanding over');
const [mMember] = await sql`select id from vendor_member where vendor_id = ${V.id} and user_id = ${ids.m} and ended_at is null`;
const [sMember] = await sql`select id from vendor_member where vendor_id = ${W.id} and user_id = ${ids.s} and ended_at is null`;
r = await site(TEAM, { cookie: cookie.o });
check('the owner has no “Remove” for themselves, and can hand over to Mo', words(r.body).includes('Hand the business to someone on your team') && r.body.includes(`value="${mMember.id}"`) && !words(r.body).includes('Take my business off Localites'));
r = await site(TEAM, { cookie: cookie.m, method: 'POST', form: { intent: 'hand-over', id: mMember.id } });
check('a manager can’t hand the business to themselves', r.status === 404, String(r.status));
r = await site(TEAM, { cookie: cookie.o, method: 'POST', form: { intent: 'hand-over', id: sMember.id } });
check('…nor can the owner hand it to someone on another business’s team', r.status === 409, String(r.status));
const since = Date.now();
r = await site(TEAM, { cookie: cookie.o, method: 'POST', form: { intent: 'hand-over', id: mMember.id } });
const roles = async () => Object.fromEntries((await sql`select user_id, role from vendor_member where vendor_id = ${V.id} and ended_at is null`).map((x) => [x.user_id, x.role]));
check('the owner hands it to Mo: Mo is the owner, they stay on as a manager', r.status === 302 && r.location === '/business?handed=1'
  && (await roles())[ids.m] === 'owner' && (await roles())[ids.o] === 'manager', r.location);
const mail = await waitFor(() => mailFor(email('m')), (ms) => ms.some((x) => x.at > since));
check('…Mo is emailed', mail.some((x) => x.at > since && x.subject.includes('You\'re now the owner') && x.body.includes(`/vendors/${V.slug}/team`)));
r = await site(TEAM, { cookie: cookie.o });
check('…the former owner can’t open the team page any more', r.status === 403 || r.status === 404, String(r.status));
r = await site(TEAM, { cookie: cookie.m });
check('…Mo can', r.status === 200, String(r.status));
r = await site(TEAM, { cookie: cookie.o, method: 'POST', form: { intent: 'take-off', confirm: 'yes' } });
check('…and, as a manager now, can’t take the business off or hide it', r.status === 404 && (await listing(V.id)).listing_status === 'published', String(r.status));
// Five hand-overs today already (each emails the new owner): no more until tomorrow.
await sql`insert into audit_log (actor_user_id, action, subject_type, subject_id)
  select ${ids.w}, 'vendor_member.hand_over', 'vendor', ${W.id} from generate_series(1, 5)`;
r = await site(`/vendors/${W.slug}/team`, { cookie: cookie.w, method: 'POST', form: { intent: 'hand-over', id: sMember.id } });
check('a business can change hands at most 5 times a day', r.status === 409 && words(r.body).includes('changed hands a lot today'), String(r.status));

console.log('\nLeaving a team');
r = await site('/business', { cookie: cookie.a, method: 'POST', form: { intent: 'leave', vendorId: V.id } });
check('someone not on the team can’t “leave” it', r.status === 404, String(r.status));
r = await site('/business', { cookie: cookie.m, method: 'POST', form: { intent: 'leave', vendorId: V.id } });
check('the owner can’t just leave (they hand over first)', r.status === 404 && (await roles())[ids.m] === 'owner', String(r.status));
r = await site('/business?handed=1', { cookie: cookie.o });
check('the former owner, now a manager, is offered “Leave this team”', words(r.body).includes('Leave this team'));
r = await site('/business', { cookie: cookie.o, method: 'POST', form: { intent: 'leave', vendorId: V.id } });
check('…and leaves', r.status === 302 && r.location === '/business?left=1' && !(ids.o in (await roles())), r.location);
r = await site('/business?left=1', { cookie: cookie.o });
check('…and is told, with no businesses left', r.status === 200 && words(r.body).includes('You’ve left the team'), String(r.status));

console.log('\nTaking a business off Localites');
r = await site(`/vendors/${W.slug}/team`, { cookie: cookie.w, method: 'POST', form: { intent: 'take-off', confirm: 'yes' } });
check('not while someone else is on the team', r.status === 409 && (await listing(W.id)).listing_status === 'published', String(r.status));
r = await site('/business', { cookie: cookie.s, method: 'POST', form: { intent: 'leave', vendorId: W.id } });
check('staff can leave a team too', r.status === 302 && (await sql`select count(*)::int as n from vendor_member where vendor_id = ${W.id} and ended_at is null`)[0].n === 1, String(r.status));
r = await site(TEAM, { cookie: cookie.m });
check('with nobody else on the team, the owner is offered “Take my business off Localites”', words(r.body).includes('Take my business off Localites') && !words(r.body).includes('Hand the business'));
r = await site(TEAM, { cookie: cookie.m, method: 'POST', form: { intent: 'take-off' } });
check('…it asks them to confirm first', r.status === 400 && (await listing(V.id)).listing_status === 'published', String(r.status));
r = await site(TEAM, { cookie: cookie.m, method: 'POST', form: { intent: 'take-off', confirm: 'yes' } });
const off = await listing(V.id);
check('…and takes it off: archived, unclaimed, their place on it ended', r.status === 302 && r.location === '/business?off=1'
  && off.listing_status === 'archived' && off.claim_status === 'unclaimed' && Object.keys(await roles()).length === 0, `${r.location} ${JSON.stringify(off)}`);
check('…recorded in the change log', (await sql`select count(*)::int as n from audit_log where action = 'vendor.owner_take_off' and subject_id = ${V.id}`)[0].n === 1);
r = await site('/business?off=1', { cookie: cookie.m });
check('…and they’re told', r.status === 200 && words(r.body).includes('Your business is off Localites'), String(r.status));

console.log('\nAn old conversation, once you run the business');
r = await site(`/vendors/${C.slug}/message`, { cookie: cookie.a, method: 'POST', form: { body: `Do you cater weddings? ${run}` } });
const conversationId = /^\/messages\/([0-9a-f-]{36})/.exec(r.location)?.[1];
// The old owner leaves (its conversations end), and Ava, who wrote to it, now runs it.
await sql`update vendor_member set ended_at = now() where vendor_id = ${C.id} and user_id = ${ids.q}`;
await sql`insert into vendor_member (vendor_id, user_id, role) values (${C.id}, ${ids.a}, 'owner')`;
r = await site(`/messages/${conversationId}`, { cookie: cookie.a });
check('it says she’s on the team now, not that the business left, and offers no “message afresh”',
  words(r.body).includes(`You’re on ${C.name}’s team now`) && !words(r.body).includes('left Localites') && !r.body.includes(`/vendors/${C.slug}/message"`));

console.log('\nSuggestions from one connection');
const IP = `10.55.${Number.parseInt(run.slice(-4), 36) % 250}.7`;
r = await site('/suggest', { method: 'POST', form: { businessName: `E2E fix5 first ${run}` }, ip: IP });
const [first] = await sql`select connection_hash from vendor_suggestion where business_name = ${`E2E fix5 first ${run}`}`;
check('a suggestion keeps a fingerprint of the connection (never the address)', r.status === 200 && first?.connection_hash?.length === 32, String(r.status));
// Nine more from the same connection today, from different browsers.
for (let i = 0; i < 9; i++) {
  await sql`insert into vendor_suggestion (business_name, visitor_id, connection_hash) values (${`E2E fix5 more ${run} ${i}`}, gen_random_uuid(), ${first.connection_hash})`;
}
r = await site('/suggest', { method: 'POST', form: { businessName: `E2E fix5 eleventh ${run}` }, ip: IP });
check('the 11th from one connection in a day is refused, kindly', r.status === 429 && words(r.body).includes('most suggestions from one place in a day')
  && (await sql`select count(*)::int as n from vendor_suggestion where business_name = ${`E2E fix5 eleventh ${run}`}`)[0].n === 0, String(r.status));
r = await site('/suggest', { method: 'POST', form: { businessName: `E2E fix5 elsewhere ${run}` }, ip: `${IP}1` });
check('…another connection still can', r.status === 200, String(r.status));

await finish('scenario fix (round 5a)');
