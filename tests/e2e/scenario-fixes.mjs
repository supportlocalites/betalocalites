// Scenario-test fixes, round 1 (D-54, migration 0046): what people typed is cleaned before it's
// read; a name needs a visible letter and passes the word list; saving the same event twice in a
// moment makes one; a report can block the conversation too; a message refused because the
// conversation is blocked says it wasn't sent. The database's own rules (reviews that come back,
// a business's note kept, declined words erased) are checked in db/tests/0046.
//
// Usage: npm run test:e2e
import { account, check, cookieFor, finish, passwordSession, run, site, sql } from './helpers.mjs';

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const words = (html) => decode(html.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ');

const [town] = await sql`select id from municipality where is_active order by sort_order limit 1`;
const [V] = await sql`
  insert into vendor (slug, display_name, primary_municipality_id, listing_status, published_at, claim_status, source)
  values (${`e2e-fix-${run}`}, ${`Fixes Bakery ${run}`}, ${town.id}, 'published', now(), 'claimed', 'admin_entered')
  returning id, slug::text as slug, display_name as name`;
const email = (who) => `e2e-fix-${who}-${run}@example.test`;
const ids = {};
for (const who of ['a', 'o']) ids[who] = await account(email(who));
await sql`insert into vendor_member (vendor_id, user_id, role) values (${V.id}, ${ids.o}, 'owner')`;
const cookie = {};
for (const who of ['a', 'o']) cookie[who] = cookieFor(await passwordSession(email(who)));

console.log('Names and typed words');
let r = await site('/account', { cookie: cookie.a, method: 'POST', form: { intent: 'details', firstName: 'Fi​ona‮', lastName: 'Lee﻿' } });
const [named] = await sql`select given_name, family_name from app_user where id = ${ids.a}`;
check('invisible and direction-changing characters are taken out before saving', r.status === 302 && named.given_name === 'Fiona' && named.family_name === 'Lee', `${r.status} ${JSON.stringify(named)}`);
r = await site('/account', { cookie: cookie.a, method: 'POST', form: { intent: 'details', firstName: '　', lastName: 'Lee' } });
check('a name with nothing visible in it is refused', r.status === 400 && (await sql`select given_name from app_user where id = ${ids.a}`)[0].given_name === 'Fiona', String(r.status));
r = await site('/account', { cookie: cookie.a, method: 'POST', form: { intent: 'details', firstName: 'Shit', lastName: 'Lee' } });
check('a name on the word list is refused, in plain words', r.status === 400 && words(r.body).includes('Please use your real name'), String(r.status));

console.log('\nSaving an event twice');
const date = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
const TITLE = `Double tap ${run}`;
const form = { intent: 'create', title: TITLE, typeId: 'none', date, townId: town.id };
const first = await site('/events/new', { cookie: cookie.a, method: 'POST', form });
const second = await site('/events/new', { cookie: cookie.a, method: 'POST', form });
const made = await sql`select count(*)::int as n from event where host_user_id = ${ids.a}`;
check('pressing Save twice makes one event, and both go to it', made[0].n === 1 && first.location === second.location && first.location.startsWith('/events/'), `${made[0].n} ${first.location} ${second.location}`);

console.log('\nReporting and blocking');
r = await site(`/vendors/${V.slug}/message`, { cookie: cookie.a, method: 'POST', form: { body: 'Hello there' } });
const conversationId = /^\/messages\/([0-9a-f-]{36})/.exec(r.location)?.[1];
check('a conversation starts', r.status === 302 && Boolean(conversationId), `${r.status} ${r.location}`);
r = await site(`/messages/${conversationId}/report`, { cookie: cookie.a });
check('the report page offers to block as well', r.status === 200 && r.body.includes('name="block"'), String(r.status));
r = await site(`/messages/${conversationId}/report`, { cookie: cookie.a, method: 'POST', form: { reason: 'spam', block: 'on' } });
const [after] = await sql`select status from conversation where id = ${conversationId}`;
const reports = await sql`select count(*)::int as n from moderation_report where conversation_id = ${conversationId}`;
check('reporting with “also block” sends the report and blocks the conversation', r.status === 302 && r.location.includes('blocked=1') && after.status === 'blocked_by_consumer' && reports[0].n === 1, `${r.status} ${r.location} ${after.status} ${reports[0].n}`);
r = await site(`/vendors/${V.slug}/messages/${conversationId}/report`, { cookie: cookie.o, method: 'POST', form: { reason: 'spam', block: 'on' } });
check('…the business can still report it, and is told it couldn’t block; it stays blocked by the person', r.status === 302 && r.location.includes('blocked=0') && (await sql`select status from conversation where id = ${conversationId}`)[0].status === 'blocked_by_consumer', `${r.status} ${r.location}`);

console.log('\nA message that wasn’t sent');
await sql`update conversation set status = 'blocked_by_vendor' where id = ${conversationId}`;
const before = (await sql`select count(*)::int as n from message where conversation_id = ${conversationId}`)[0].n;
r = await site(`/vendors/${V.slug}/message`, { cookie: cookie.a, method: 'POST', form: { body: 'From an old tab' } });
check('sending from an old “Message” page goes to the conversation, saying so', r.status === 302 && r.location === `/messages/${conversationId}?unsent=1`, `${r.status} ${r.location}`);
r = await site(r.location, { cookie: cookie.a });
check('…which says it wasn’t sent, and nothing was', words(r.body).includes('Your message wasn’t sent') && (await sql`select count(*)::int as n from message where conversation_id = ${conversationId}`)[0].n === before);

await finish('scenario fix');
