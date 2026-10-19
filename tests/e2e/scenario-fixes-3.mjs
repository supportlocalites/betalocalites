// Scenario-test fixes, round 3 (D-54, migration 0048): the author edits a message at any time;
// it shows "Edited", and both sides can see what it said before (the team too, through a report);
// the person deletes a conversation: gone from both sides, nobody can write in it, and they can
// message the business afresh. The database's own rules are checked in db/tests/0048.
//
// Usage: npm run test:e2e
import { account, check, cookieFor, finish, passwordSession, run, site, sql, twoStepSession } from './helpers.mjs';

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const words = (html) => decode(html.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ');

const [town] = await sql`select id from municipality where is_active order by sort_order limit 1`;
const [V] = await sql`
  insert into vendor (slug, display_name, primary_municipality_id, listing_status, published_at, claim_status, source)
  values (${`e2e-fix3-${run}`}, ${`Fixes Three Bakery ${run}`}, ${town.id}, 'published', now(), 'claimed', 'admin_entered')
  returning id, slug::text as slug, display_name as name`;
const email = (who) => `e2e-fix3-${who}-${run}@example.test`;
const ids = {};
for (const who of ['a', 'b', 'o', 's', 'm']) ids[who] = await account(email(who));
await sql`insert into platform_role (user_id, role) values (${ids.m}, 'admin')`;
await sql`insert into vendor_member (vendor_id, user_id, role) values (${V.id}, ${ids.o}, 'owner'), (${V.id}, ${ids.s}, 'staff')`;
const cookie = {};
for (const who of ['a', 'b', 'o', 's']) cookie[who] = cookieFor(await passwordSession(email(who)));
cookie.m = cookieFor(await twoStepSession(email('m')));

const FIRST = `See you at three ${run}`;
let r = await site(`/vendors/${V.slug}/message`, { cookie: cookie.a, method: 'POST', form: { body: FIRST } });
const conversationId = /^\/messages\/([0-9a-f-]{36})/.exec(r.location)?.[1];
const THREAD = `/messages/${conversationId}`;
const BIZ = `/vendors/${V.slug}/messages/${conversationId}`;
await site(BIZ, { cookie: cookie.o, method: 'POST', form: { intent: 'send', body: 'Three works for us' } });
const messagesIn = () => sql`select id, author_user_id, body, edited_at from message where conversation_id = ${conversationId} order by created_at`;
const [mine, theirs] = await messagesIn();

console.log('Editing a message');
r = await site(THREAD, { cookie: cookie.a });
check('Ava’s own message offers Edit; the business’s doesn’t', r.body.includes(`value="${mine.id}"`) && words(r.body).includes('Edit') && !r.body.includes(`id="edit-${theirs.id}"`));
r = await site(THREAD, { cookie: cookie.a, method: 'POST', form: { intent: 'edit', messageId: theirs.id, body: 'Hijacked' } });
check('Ava can’t edit the business’s message', r.status === 404 && (await messagesIn())[1].body === 'Three works for us', String(r.status));
r = await site(THREAD, { cookie: cookie.b, method: 'POST', form: { intent: 'edit', messageId: mine.id, body: 'Hijacked' } });
check('someone else can’t edit Ava’s message', r.status === 404 && (await messagesIn())[0].body === FIRST, String(r.status));
r = await site(THREAD, { cookie: cookie.a, method: 'POST', form: { intent: 'edit', messageId: mine.id, body: 'See you at four' } });
check('Ava changes her message', r.status === 302 && (await messagesIn())[0].body === 'See you at four', String(r.status));
r = await site(THREAD, { cookie: cookie.a });
check('…it shows “Edited”, and what it said before', words(r.body).includes('See you at four') && words(r.body).includes('Edited') && r.body.includes(FIRST));
r = await site(BIZ, { cookie: cookie.o });
check('…the business sees the new words, “Edited”, and what it said before', words(r.body).includes('See you at four') && words(r.body).includes('Edited') && r.body.includes(FIRST));
r = await site(BIZ, { cookie: cookie.o, method: 'POST', form: { intent: 'edit', messageId: theirs.id, body: 'Four works for us' } });
check('the owner changes the business’s reply', r.status === 302 && (await messagesIn())[1].body === 'Four works for us', String(r.status));
r = await site(BIZ, { cookie: cookie.s, method: 'POST', form: { intent: 'edit', messageId: theirs.id, body: 'Staff took over' } });
check('…staff can’t change the owner’s message', r.status === 404 && (await messagesIn())[1].body === 'Four works for us', String(r.status));
r = await site(BIZ, { cookie: cookie.o, method: 'POST', form: { intent: 'edit', messageId: theirs.id, body: '   ' } });
check('a message can’t be emptied by editing', r.status === 409 && (await messagesIn())[1].body === 'Four works for us', String(r.status));

console.log('\nThe team, through a report');
await site(`${BIZ}/report`, { cookie: cookie.o, method: 'POST', form: { reason: 'other', details: 'Keeps changing the time' } });
const [report] = await sql`select id from moderation_report where conversation_id = ${conversationId}`;
r = await site(`/admin/reports/${report.id}`, { cookie: cookie.m });
check('the team’s report page shows what a message said before', r.status === 200 && r.body.includes(FIRST) && words(r.body).includes('it said'), String(r.status));

console.log('\nDeleting a conversation');
r = await site(THREAD, { cookie: cookie.a });
check('Ava’s conversation offers “Delete this conversation”, with a confirm step', words(r.body).includes('Delete this conversation') && words(r.body).includes('Yes, delete it'));
r = await site(BIZ, { cookie: cookie.o, method: 'POST', form: { intent: 'delete' } });
check('the business can’t delete it', r.status === 400 && (await sql`select person_deleted_at from conversation where id = ${conversationId}`)[0].person_deleted_at === null, String(r.status));
r = await site(THREAD, { cookie: cookie.b, method: 'POST', form: { intent: 'delete' } });
check('…nor can someone else', r.status === 404 && (await sql`select person_deleted_at from conversation where id = ${conversationId}`)[0].person_deleted_at === null, String(r.status));
r = await site(THREAD, { cookie: cookie.a, method: 'POST', form: { intent: 'delete' } });
check('Ava deletes it', r.status === 302 && r.location === '/messages?deleted=1', `${r.status} ${r.location}`);
r = await site('/messages?deleted=1', { cookie: cookie.a });
check('…it’s gone from her messages, and she’s told', words(r.body).includes('The conversation is deleted') && !r.body.includes(conversationId));
r = await site(THREAD, { cookie: cookie.a });
check('…and opening it is “not found”', r.status === 404, String(r.status));
r = await site(BIZ, { cookie: cookie.o });
check('the business can’t open it', r.status === 404, String(r.status));
r = await site(`/vendors/${V.slug}/messages`, { cookie: cookie.o });
check('…nor see it in its messages (no link to it)', r.status === 200 && !r.body.includes(`/messages/${conversationId}`), String(r.status));
r = await site(BIZ, { cookie: cookie.o, method: 'POST', form: { intent: 'send', body: 'Still there?' } });
check('…nor write in it', r.status === 404 && (await sql`select count(*)::int as n from message where conversation_id = ${conversationId}`)[0].n === 2, String(r.status));
r = await site(`/admin/reports/${report.id}`, { cookie: cookie.m });
check('the team still reads it through the report', r.status === 200 && words(r.body).includes('See you at four'), String(r.status));
r = await site(`/vendors/${V.slug}/messages`, { cookie: cookie.o });
check('the business is told the customer deleted it (and that it was reported)', words(r.body).includes('Deleted by the customer') && words(r.body).includes('You reported it'));

// Bo messages, says something abusive, and deletes it at once: the business can still report it.
r = await site(`/vendors/${V.slug}/message`, { cookie: cookie.b, method: 'POST', form: { body: `Abusive words ${run}` } });
const boConversation = /^\/messages\/([0-9a-f-]{36})/.exec(r.location)?.[1];
await site(`/messages/${boConversation}`, { cookie: cookie.b, method: 'POST', form: { intent: 'delete' } });
r = await site(`/vendors/${V.slug}/messages`, { cookie: cookie.o });
check('…a conversation deleted straight away offers “Report it”, without its words', r.body.includes(`value="${boConversation}"`) && !r.body.includes(`Abusive words ${run}`));
r = await site(`/vendors/${V.slug}/messages`, { cookie: cookie.b, method: 'POST', form: { conversationId: boConversation, reason: 'harassment' } });
check('…someone not on the team can’t report through it', r.status === 404, String(r.status));
r = await site(`/vendors/${V.slug}/messages`, { cookie: cookie.o, method: 'POST', form: { conversationId: boConversation, reason: 'harassment', details: 'Then deleted it' } });
const [boReport] = await sql`select id from moderation_report where conversation_id = ${boConversation}`;
check('the owner reports it', r.status === 302 && Boolean(boReport), String(r.status));
r = await site(`/admin/reports/${boReport.id}`, { cookie: cookie.m });
check('…and the team reads it through the report', r.status === 200 && r.body.includes(`Abusive words ${run}`), String(r.status));
r = await site(`/vendors/${V.slug}/message`, { cookie: cookie.a });
check('Ava can message the business afresh', r.status === 200 && r.body.includes('name="body"'), String(r.status));
r = await site(`/vendors/${V.slug}/message`, { cookie: cookie.a, method: 'POST', form: { body: 'Starting over' } });
check('…and it’s a new conversation', r.status === 302 && !r.location.includes(conversationId), `${r.status} ${r.location}`);

await finish('scenario fix (round 3)');
