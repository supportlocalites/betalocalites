// Messages (Stage 2B; D-13, D-17, E §4.3 and §6, migrations 0023 to 0025): a person messages a
// business that has joined; anyone on its team replies (never starts); emails once per unread
// stretch, never the message itself, never to someone who has seen it; unread counts are each
// person's own; block both ways; only the two sides read a conversation, never another person,
// business or the team, nor a business's next team; paused while a business isn't listed.
// The site reaches the database as app_server, so the database's rules are really tested.
//
// Usage: npm run test:e2e
import { account, check, cookieFor, finish, mailFor, passwordSession, run, site, sql, twoStepSession } from './helpers.mjs';

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
const seen = [];
async function page(path, options) {
  const r = await site(path, options);
  seen.push({ path, body: r.body });
  return r;
}

// ------------------------------------------------------------------ set-up
const [town] = await sql`select id, name from municipality where is_active order by sort_order limit 1`;
async function listing(label, claim = 'claimed') {
  const [v] = await sql`
    insert into vendor (slug, display_name, primary_municipality_id, listing_status, published_at, claim_status, source)
    values (${`e2e-msg-${label}-${run}`}, ${`Messages ${label} ${run}`}, ${town.id}, 'published', now(), ${claim}, 'admin_entered')
    returning id, slug::text as slug, display_name as name`;
  return v;
}
const V = await listing('cakes');
const W = await listing('balloons');
const U = await listing('unclaimed', 'unclaimed');

const email = (who) => `e2e-msg-${who}-${run}@example.test`;
const ids = {};
for (const who of ['a', 'b', 'o', 'g', 's', 'p', 'n', 'm']) ids[who] = await account(email(who));
const A_NAME = `Ava Messenger ${run}`;
const S_NAME = `Sam Staff ${run}`;
await sql`update app_user set display_name = ${A_NAME} where id = ${ids.a}`;
await sql`update app_user set display_name = ${S_NAME} where id = ${ids.s}`;
await sql`insert into platform_role (user_id, role) values (${ids.m}, 'admin')`;
await sql`insert into vendor_member (vendor_id, user_id, role) values
  (${V.id}, ${ids.o}, 'owner'), (${V.id}, ${ids.g}, 'manager'), (${V.id}, ${ids.s}, 'staff'), (${W.id}, ${ids.p}, 'owner')`;
const cookie = {};
for (const who of ['a', 'b', 'o', 'g', 's', 'p', 'n']) cookie[who] = cookieFor(await passwordSession(email(who)));
cookie.m = cookieFor(await twoStepSession(email('m')));

const date = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
const SECRET_TITLE = `SECRET-MSG-TITLE-${run}`;
const made = await site('/events/new', {
  cookie: cookie.a,
  method: 'POST',
  form: { intent: 'create', title: SECRET_TITLE, typeId: 'none', date, townId: town.id, guests: '30' },
});
const aEvent = /^\/events\/([0-9a-f-]{36})/.exec(made.location ?? '')?.[1];
const newMail = async (who, after) => (await mailFor(email(who))).filter((m) => m.at > after && m.subject.startsWith('New message from'));
const messagesIn = async (conversationId) => sql`select id, author_side, body, removed_at from message where conversation_id = ${conversationId} order by created_at`;

let text = '';
console.log('Messages');

// ------------------------------------------------------------------ 1. Where you can message
let r = await page(`/vendors/${V.slug}`);
check('a business that has joined offers Message', r.status === 200 && r.body.includes(`/vendors/${V.slug}/message"`), String(r.status));
r = await page(`/vendors/${U.slug}`);
check('a business that hasn’t joined offers Inquire instead', r.body.includes(`/vendors/${U.slug}/inquire`) && !r.body.includes(`/vendors/${U.slug}/message"`));
for (const path of ['/messages', `/vendors/${V.slug}/message`, `/vendors/${V.slug}/messages`]) {
  r = await page(path);
  check(`signed out: ${path} asks you to sign in`, [302, 303].includes(r.status) && r.location.startsWith('/join?next='), `${r.status} ${r.location}`);
}
r = await page(`/vendors/${V.slug}/message`, { method: 'POST', form: { body: 'hi' } });
check('signed out: nothing is sent', [302, 303].includes(r.status) && (await sql`select count(*)::int as n from conversation where vendor_id = ${V.id}`)[0].n === 0);
r = await page(`/vendors/${U.slug}/message`, { cookie: cookie.a });
check('a business that hasn’t joined: Message goes to Inquire', [302, 303].includes(r.status) && r.location === `/vendors/${U.slug}/inquire`, `${r.status} ${r.location}`);
r = await page(`/vendors/${U.slug}/message`, { cookie: cookie.a, method: 'POST', form: { body: 'hi' } });
check('…and sending anyway is refused, nothing saved',
  [302, 303, 409].includes(r.status) && (await sql`select count(*)::int as n from conversation where vendor_id = ${U.id}`)[0].n === 0, String(r.status));
r = await page(`/vendors/${V.slug}/message`, { cookie: cookie.o });
check('your own business: said plainly, no form', r.status === 200 && words(r.body).includes('This is your own business.') && !r.body.includes('name="body"'));

// ------------------------------------------------------------------ 2. Starting a conversation
r = await page(`/vendors/${V.slug}/message`, { cookie: cookie.a });
check('the person can write, and mention one of their events (what the business sees is said)',
  r.status === 200 && r.body.includes(aEvent) && words(r.body).includes('sees only the date, the town and about how many guests'), String(r.status));
r = await page(`/vendors/${V.slug}/message`, { cookie: cookie.a, method: 'POST', form: { body: '   ' } });
check('an empty message is refused in plain words', r.status === 400 && words(r.body).includes('Write a message first.'), String(r.status));
r = await page(`/vendors/${V.slug}/message`, { cookie: cookie.a, method: 'POST', form: { body: 'x'.repeat(5001) } });
check('a message over 5,000 characters is refused', r.status === 400, String(r.status));
const FIRST = `Are you free on the 14th? ${run}`;
const before = Date.now();
r = await page(`/vendors/${V.slug}/message`, { cookie: cookie.a, method: 'POST', form: { body: FIRST, eventId: aEvent } });
const conversationId = /^\/messages\/([0-9a-f-]{36})\?sent=/.exec(r.location ?? '')?.[1];
const [conv] = await sql`select consumer_user_id, event_id, status from conversation where id = ${conversationId ?? '00000000-0000-0000-0000-000000000000'}`;
check('sent: one conversation, about their event, with the message',
  r.status === 302 && conv?.consumer_user_id === ids.a && conv.event_id === aEvent && (await messagesIn(conversationId)).length === 1,
  `${r.status} ${r.location}`);
const THREAD = `/messages/${conversationId}`;
const BIZ_THREAD = `/vendors/${V.slug}/messages/${conversationId}`;
const teamMail = await waitFor(
  async () => Promise.all(['o', 'g', 's'].map((w) => newMail(w, before))),
  (lists) => lists.every((l) => l.length > 0),
);
check('everyone on the business’s team is emailed, with a link to the conversation',
  teamMail.every((l) => l.length === 1 && l[0].subject === `New message from ${A_NAME} on Localites` && l[0].body.includes(BIZ_THREAD)),
  JSON.stringify(teamMail.map((l) => l.length)));
check('…never the message itself, or the event’s name', teamMail.flat().every((m) => !m.body.includes(FIRST) && !m.body.includes(SECRET_TITLE)));
check('…and the person isn’t emailed about their own message', (await newMail('a', before)).length === 0);
r = await page(`/vendors/${V.slug}/message`, { cookie: cookie.a });
check('one conversation per person and business: Message goes back to it', [302, 303].includes(r.status) && r.location === THREAD, `${r.status} ${r.location}`);
r = await page('/messages', { cookie: cookie.a });
check('the person’s Messages lists it, with their last message', r.status === 200 && words(r.body).includes(V.name) && words(r.body).includes(`You: ${FIRST}`));

// ------------------------------------------------------------------ 3. The business's side
r = await page('/business', { cookie: cookie.s });
check('staff see the new message on My business', r.status === 200 && words(r.body).includes('Messages (1 new)'), String(r.status));
r = await page(`/vendors/${V.slug}/messages`, { cookie: cookie.s });
check('the business’s Messages lists the person, with one new', r.status === 200 && words(r.body).includes(A_NAME) && r.body.includes('aria-label="1 new"'), String(r.status));
r = await page(BIZ_THREAD, { cookie: cookie.s });
text = words(r.body);
check('the business reads the message, and the event’s summary only (date, town, guests)',
  r.status === 200 && text.includes(FIRST) && text.includes(town.name) && text.includes('about 30 guests') && !r.body.includes(SECRET_TITLE), String(r.status));
check('…with the line about payments', text.includes('Localites doesn’t process payments.'));
r = await page('/business', { cookie: cookie.s });
check('read: no longer new for that staff member', !words(r.body).includes('Messages (1 new)'));
r = await page('/business', { cookie: cookie.o });
check('…but still new for the owner (each person’s own count)', words(r.body).includes('Messages (1 new)'));

const REPLY = `Yes, we are! ${run}`;
const beforeReply = Date.now();
r = await page(BIZ_THREAD, { cookie: cookie.s, method: 'POST', form: { intent: 'send', body: REPLY } });
check('staff reply for the business', r.status === 302 && (await messagesIn(conversationId)).at(-1)?.author_side === 'vendor', String(r.status));
const personMail = await waitFor(() => newMail('a', beforeReply), (l) => l.length > 0);
check('the person is emailed: “New message from <business>”, with a link',
  personMail.length === 1 && personMail[0].subject === `New message from ${V.name} on Localites` && personMail[0].body.includes(THREAD), JSON.stringify(personMail));
await page(BIZ_THREAD, { cookie: cookie.g, method: 'POST', form: { intent: 'send', body: `And we deliver. ${run}` } });
await new Promise((res) => setTimeout(res, 3000)); // the site waits 2 seconds here before emailing (20 when live)
check('a second reply before they’ve read it: no second email', (await newMail('a', beforeReply)).length === 1);
r = await page('/messages', { cookie: cookie.a });
check('the person sees 2 new', r.body.includes('aria-label="2 new"'));
r = await page(THREAD, { cookie: cookie.a });
text = words(r.body);
check('the person reads the replies under the business’s name, never the staff member’s', text.includes(REPLY) && text.includes(V.name) && !text.includes(S_NAME));

// ------------------------------------------------------------------ 4. Nobody else
const ZERO = '00000000-0000-7000-8000-000000000000';
for (const [who, path] of [
  ['another person', THREAD],
  ['another business’s owner', THREAD],
]) {
  r = await page(path, { cookie: who === 'another person' ? cookie.b : cookie.p });
  check(`${who}: the conversation is "not found"`, r.status === 404 && !r.body.includes(FIRST), String(r.status));
}
const countBefore = (await messagesIn(conversationId)).length;
r = await page(THREAD, { cookie: cookie.b, method: 'POST', form: { intent: 'send', body: 'sneaky' } });
check('another person can’t write in it', r.status === 404 && (await messagesIn(conversationId)).length === countBefore, String(r.status));
for (const [who, c, path] of [
  ['the person (not on the team)', cookie.a, `/vendors/${V.slug}/messages`],
  ['another business’s owner', cookie.p, `/vendors/${V.slug}/messages`],
  ['another business’s owner, through their own business', cookie.p, `/vendors/${W.slug}/messages/${conversationId}`],
  ['someone with no business', cookie.n, BIZ_THREAD],
  ['a Localites team member', cookie.m, BIZ_THREAD],
]) {
  r = await page(path, { cookie: c });
  check(`${who}: the business’s messages are "not found"`, r.status === 404 && !r.body.includes(FIRST), `${r.status} ${path}`);
}
r = await page(`/vendors/${W.slug}/messages/${conversationId}`, { cookie: cookie.p, method: 'POST', form: { intent: 'send', body: 'sneaky' } });
check('…and can’t reply to it', r.status === 404 && (await messagesIn(conversationId)).length === countBefore, String(r.status));
r = await page(`/messages/${ZERO}`, { cookie: cookie.a });
check('a made-up conversation is "not found"', r.status === 404, String(r.status));

// ------------------------------------------------------------------ 5. Removing, blocking, the event
const [aMessage] = await sql`select id from message where conversation_id = ${conversationId} and author_side = 'consumer' limit 1`;
r = await page(BIZ_THREAD, { cookie: cookie.s, method: 'POST', form: { intent: 'remove', messageId: aMessage.id } });
check('the business can’t remove the person’s message', r.status === 404 && !(await sql`select removed_at from message where id = ${aMessage.id}`)[0].removed_at, String(r.status));
r = await page(THREAD, { cookie: cookie.a, method: 'POST', form: { intent: 'remove', messageId: aMessage.id } });
const [removed] = await sql`select body, removed_at from message where id = ${aMessage.id}`;
check('the person removes their own: blanked, shown as removed', r.status === 302 && removed.body === '' && Boolean(removed.removed_at), String(r.status));
r = await page(BIZ_THREAD, { cookie: cookie.s });
check('…the business sees “Message removed”, not the words', words(r.body).includes('Message removed') && !r.body.includes(FIRST));

r = await page(BIZ_THREAD, { cookie: cookie.s, method: 'POST', form: { intent: 'block' } });
check('staff can’t block', r.status === 404 && (await sql`select status from conversation where id = ${conversationId}`)[0].status === 'open', String(r.status));
r = await page(BIZ_THREAD, { cookie: cookie.g, method: 'POST', form: { intent: 'block' } });
check('a manager blocks', r.status === 302 && (await sql`select status from conversation where id = ${conversationId}`)[0].status === 'blocked_by_vendor', String(r.status));
r = await page(THREAD, { cookie: cookie.a });
check('the person is told, and has no reply box', words(r.body).includes(`${V.name} has blocked this conversation`) && !r.body.includes('name="body"'));
r = await page(THREAD, { cookie: cookie.a, method: 'POST', form: { intent: 'send', body: 'Hello?' } });
check('…sending anyway is refused in plain words', r.status === 409 && words(r.body).includes('This conversation is blocked'), String(r.status));
r = await page(THREAD, { cookie: cookie.a, method: 'POST', form: { intent: 'unblock' } });
check('…and they can’t undo the business’s block', r.status === 409 && (await sql`select status from conversation where id = ${conversationId}`)[0].status === 'blocked_by_vendor', String(r.status));
await page(BIZ_THREAD, { cookie: cookie.o, method: 'POST', form: { intent: 'unblock' } });
r = await page(THREAD, { cookie: cookie.a, method: 'POST', form: { intent: 'block' } });
check('the owner unblocks; the person blocks', (await sql`select status from conversation where id = ${conversationId}`)[0].status === 'blocked_by_consumer', String(r.status));
r = await page(BIZ_THREAD, { cookie: cookie.o });
check('…the business is told', words(r.body).includes(`${A_NAME} has blocked this conversation`) && !r.body.includes('name="body"'));
await page(THREAD, { cookie: cookie.a, method: 'POST', form: { intent: 'unblock' } });
r = await page(THREAD, { cookie: cookie.a, method: 'POST', form: { intent: 'event', eventId: '' } });
r = await page(BIZ_THREAD, { cookie: cookie.o });
check('the person takes the event off: the business no longer sees it', !words(r.body).includes('Their event'));

// ------------------------------------------------------------------ 5b. Reporting (part 2)
const [staffReply] = await sql`select id from message where conversation_id = ${conversationId} and body = ${REPLY}`;
r = await page(`${THREAD}/report?message=${staffReply.id}`, { cookie: cookie.a });
check('the person can report a message: the page shows it, and says the team will read the conversation',
  r.status === 200 && words(r.body).includes(REPLY) && words(r.body).includes('our team can read this conversation'), String(r.status));
r = await page(`${THREAD}/report`, { cookie: cookie.a, method: 'POST', form: { messageId: staffReply.id, reason: 'nonsense' } });
check('a report needs a reason', r.status === 400, String(r.status));
const beforeReport = Date.now();
r = await page(`${THREAD}/report`, { cookie: cookie.a, method: 'POST', form: { messageId: staffReply.id, reason: 'scam_or_fraud', details: `Asked for gift cards ${run}` } });
const [report] = await sql`select id, reporter_side, message_id, status from moderation_report where conversation_id = ${conversationId} and reporter_user_id = ${ids.a}`;
check('reported: saved, about that message, and the person is thanked',
  r.status === 302 && r.location === `${THREAD}/report?sent=1` && report?.reporter_side === 'consumer' && report.message_id === staffReply.id,
  `${r.status} ${r.location}`);
const reportMail = await waitFor(
  async () => (await mailFor('supportlocalites@gmail.com')).filter((m) => m.at > beforeReport && m.subject === `Report: a conversation with ${V.name}`),
  (l) => l.length > 0,
);
check('the team is emailed, with a link to the report (never the messages)',
  reportMail.length === 1 && reportMail[0].body.includes(`/admin/reports/${report?.id}`) && !reportMail[0].body.includes(REPLY), JSON.stringify(reportMail).slice(0, 200));
r = await page(`${THREAD}/report`, { cookie: cookie.b, method: 'POST', form: { reason: 'spam' } });
check('another person can’t report it', r.status === 404, String(r.status));
r = await page(`/vendors/${W.slug}/messages/${conversationId}/report`, { cookie: cookie.p, method: 'POST', form: { reason: 'spam' } });
check('another business can’t report it', r.status === 404, String(r.status));
r = await page(`${BIZ_THREAD}/report`, { cookie: cookie.o, method: 'POST', form: { reason: 'harassment' } });
check('the business reports the whole conversation',
  r.status === 302 && (await sql`select count(*)::int as n from moderation_report where conversation_id = ${conversationId} and reporter_side = 'vendor'`)[0].n === 1,
  String(r.status));

r = await page('/admin/reports', { cookie: cookie.m });
text = words(r.body);
check('the team’s Reports list shows who reported what and why, never the messages',
  r.status === 200 && text.includes('A scam or fraud') && text.includes(A_NAME) && text.includes(V.name) && !text.includes(REPLY), String(r.status));
check('…the team menu counts open reports', /Reports \(\d+ open\)/.test(text));
const looks = async () => (await sql`select count(*)::int as n from audit_log where action = 'conversation.report_view' and subject_id = ${report.id}`)[0].n;
r = await page(`/admin/reports/${report.id}`, { cookie: cookie.m });
check('opening a report shows the whole conversation, the reported message marked',
  r.status === 200 && words(r.body).includes(REPLY) && words(r.body).includes('Reported'), String(r.status));
check('…and that look is recorded with the report', (await looks()) === 1);
for (const [who, c] of [['a person', cookie.a], ['a business owner', cookie.o], ['someone not on the team', cookie.n]]) {
  r = await page(`/admin/reports/${report.id}`, { cookie: c });
  check(`${who}: a report is refused (403)`, r.status === 403 && !r.body.includes(REPLY), String(r.status));
}
r = await page(`/admin/reports/${report.id}`, { cookie: cookie.m, method: 'POST', form: { intent: 'hide' } });
r = await page(THREAD, { cookie: cookie.a });
check('the team hides the message: the person sees “Hidden by Localites”, not the words',
  words(r.body).includes('Hidden by Localites') && !words(r.body).includes(REPLY));
await page(`/admin/reports/${report.id}`, { cookie: cookie.m, method: 'POST', form: { intent: 'block' } });
r = await page(THREAD, { cookie: cookie.a });
check('the team blocks the conversation: the person is told, and has no reply box',
  words(r.body).includes('The Localites team has closed this conversation') && !r.body.includes('name="body"'));
r = await page(THREAD, { cookie: cookie.a, method: 'POST', form: { intent: 'unblock' } });
check('…and can’t undo it', r.status === 409 && (await sql`select status from conversation where id = ${conversationId}`)[0].status === 'blocked_by_team', String(r.status));
r = await page(`/admin/reports/${report.id}`, { cookie: cookie.m, method: 'POST', form: { intent: 'actioned', note: '' } });
check('closing a report needs a note', r.status === 400, String(r.status));
r = await page(`/admin/reports/${report.id}`, { cookie: cookie.m, method: 'POST', form: { intent: 'actioned', note: `Hid the message and closed the conversation ${run}` } });
check('the team closes it as dealt with, recorded',
  (await sql`select status from moderation_report where id = ${report.id}`)[0].status === 'actioned' &&
    (await sql`select count(*)::int as n from audit_log where action = 'moderation_report.actioned' and subject_id = ${report.id}`)[0].n === 1);
await page(`/admin/reports/${report.id}`, { cookie: cookie.m, method: 'POST', form: { intent: 'unblock' } });
check('…and can open the conversation again', (await sql`select status from conversation where id = ${conversationId}`)[0].status === 'open');

// ------------------------------------------------------------------ 5c. After review (migration 0025)
// An open conversation's quick look for anything new: one small read; nothing marked read.
const look = async (path, c) => {
  const res = await site(`${path}/check`, { cookie: c });
  let version = null;
  try {
    version = JSON.parse(res.body).version ?? null;
  } catch {
    // not an answer from the quick look
  }
  return { status: res.status, version };
};
const firstLook = await look(THREAD, cookie.a);
check('an open conversation’s quick look answers with its version',
  firstLook.status === 200 && typeof firstLook.version === 'string' && firstLook.version.length > 0, String(firstLook.status));
const bizLook = await look(BIZ_THREAD, cookie.o);
check('…the same version for the business’s team', bizLook.status === 200 && bizLook.version === firstLook.version, String(bizLook.status));
for (const [who, path, c] of [
  ['another person', THREAD, cookie.b],
  ['another business’s owner', `/vendors/${W.slug}/messages/${conversationId}`, cookie.p],
  ['a Localites team member', BIZ_THREAD, cookie.m],
]) {
  const other = await look(path, c);
  check(`${who}: the quick look is "not found"`, other.status === 404 && other.version === null, String(other.status));
}
r = await site(`${THREAD}/check`);
check('signed out: the quick look asks you to sign in', [302, 303].includes(r.status), String(r.status));
const readAt = async (who) =>
  (await sql`select last_read_at::text as t from conversation_read where conversation_id = ${conversationId} and user_id = ${ids[who]}`)[0]?.t ?? null;
const ownerReadAt = await readAt('o');
await look(BIZ_THREAD, cookie.o);
check('…and looking marks nothing read', (await readAt('o')) === ownerReadAt);

const AGAIN = `Is the 14th still free? ${run}`;
const beforeAgain = Date.now();
const countAgain = (await messagesIn(conversationId)).length;
r = await page(THREAD, { cookie: cookie.a, method: 'POST', form: { intent: 'send', body: AGAIN } });
const second = await page(THREAD, { cookie: cookie.a, method: 'POST', form: { intent: 'send', body: AGAIN } });
check('Send pressed twice: one message', r.status === 302 && second.status === 302 && (await messagesIn(conversationId)).length === countAgain + 1,
  `${r.status} ${second.status}`);
await page(BIZ_THREAD, { cookie: cookie.o }); // the owner has the conversation open, and sees it at once
check('a new message changes the version', (await look(THREAD, cookie.a)).version !== firstLook.version);
await waitFor(
  async () => Promise.all(['g', 's'].map((w) => newMail(w, beforeAgain))),
  (lists) => lists.every((l) => l.length > 0),
);
await new Promise((res) => setTimeout(res, 1500)); // a second email would be here by now
const againMail = await Promise.all(['o', 'g', 's'].map((w) => newMail(w, beforeAgain)));
check('…the team is emailed once about it, not twice', againMail[1].length === 1 && againMail[2].length === 1, JSON.stringify(againMail.map((l) => l.length)));
check('…and not someone who had the conversation open (they’ve seen it)', againMail[0].length === 0, JSON.stringify(againMail.map((l) => l.length)));

const START = `Do you do helium? ${run}`;
const both = await Promise.all([1, 2].map(() => site(`/vendors/${W.slug}/message`, { cookie: cookie.b, method: 'POST', form: { body: START } })));
const bStarted = await sql`select id from conversation where consumer_user_id = ${ids.b} and vendor_id = ${W.id}`;
check('two quick sends to a business: both answered, one conversation, one message',
  both.every((x) => x.status === 302) && bStarted.length === 1 && (await messagesIn(bStarted[0].id)).length === 1,
  `${both.map((x) => x.status).join(' ')} ${bStarted.length}`);
const B_THREAD = `/messages/${bStarted[0]?.id}`;
const W_THREAD = `/vendors/${W.slug}/messages/${bStarted[0]?.id}`;

await sql`update vendor set listing_status = 'unpublished' where id = ${W.id}`;
r = await page(B_THREAD, { cookie: cookie.b });
check('a business taken down: the person is told messages are paused, and has no reply box',
  r.status === 200 && words(r.body).includes(`${W.name} isn’t listed on Localites at the moment, so messages are paused.`) && !r.body.includes('name="body"'),
  String(r.status));
r = await page(B_THREAD, { cookie: cookie.b, method: 'POST', form: { intent: 'send', body: 'Hello?' } });
check('…sending anyway is refused in plain words', r.status === 409 && words(r.body).includes('messages to it are paused'), String(r.status));
r = await page(`/vendors/${W.slug}/messages`, { cookie: cookie.p });
check('…its team’s Messages says why', r.status === 200 && words(r.body).includes('so messages are paused'), String(r.status));
r = await page(W_THREAD, { cookie: cookie.p });
check('…its team still reads the conversation, with no reply box',
  r.status === 200 && words(r.body).includes(START) && words(r.body).includes('Your business isn’t listed on Localites at the moment') && !r.body.includes('name="body"'),
  String(r.status));
r = await page(W_THREAD, { cookie: cookie.p, method: 'POST', form: { intent: 'send', body: 'Hi' } });
check('…and replying anyway is refused', r.status === 409 && words(r.body).includes('messages are paused until it is'), String(r.status));
await sql`update vendor set listing_status = 'published' where id = ${W.id}`;

// The team removes W's owner (W is unclaimed again); later someone else's claim is approved.
await sql`update vendor_member set ended_at = now() where vendor_id = ${W.id} and user_id = ${ids.p}`;
await sql`update vendor set claim_status = 'unclaimed' where id = ${W.id}`;
r = await page(B_THREAD, { cookie: cookie.b });
check('a business’s team ends: the person keeps the conversation, and is told it has ended',
  r.status === 200 && words(r.body).includes(`${W.name} isn’t on Localites any more, so this conversation has ended.`) && !r.body.includes('name="body"'),
  String(r.status));
await sql`insert into vendor_member (vendor_id, user_id, role) values (${W.id}, ${ids.n}, 'owner')`;
await sql`update vendor set claim_status = 'claimed' where id = ${W.id}`;
r = await page(`/vendors/${W.slug}/messages`, { cookie: cookie.n });
check('a new owner sees none of the last team’s conversations',
  r.status === 200 && words(r.body).includes('No messages yet.') && !r.body.includes(bStarted[0]?.id), String(r.status));
r = await page(W_THREAD, { cookie: cookie.n });
check('…can’t open one', r.status === 404 && !r.body.includes(START), String(r.status));
check('…nor look at one', (await look(W_THREAD, cookie.n)).status === 404);
r = await page(W_THREAD, { cookie: cookie.n, method: 'POST', form: { intent: 'send', body: 'Hi' } });
check('…nor reply to one', r.status === 404, String(r.status));
r = await page(`/vendors/${W.slug}/message`, { cookie: cookie.b });
check('the person can message the business afresh', r.status === 200 && r.body.includes('name="body"'), `${r.status} ${r.location}`);
r = await page(`/vendors/${W.slug}/message`, { cookie: cookie.b, method: 'POST', form: { body: `Hello again ${run}` } });
const fresh = /^\/messages\/([0-9a-f-]{36})\?sent=/.exec(r.location ?? '')?.[1];
r = await page(`/vendors/${W.slug}/messages`, { cookie: cookie.n });
check('…a new conversation, which the new team sees', Boolean(fresh) && fresh !== bStarted[0]?.id && r.body.includes(fresh), String(fresh));

r = await page('/account/delete', { cookie: cookie.b, method: 'POST', form: { intent: 'delete', confirm: email('b') } });
r = await page(`/vendors/${W.slug}/messages/${fresh}`, { cookie: cookie.n });
check('a person deletes their account: the business keeps its copy, and is told no new messages can be sent',
  r.status === 200 && words(r.body).includes('This person has left Localites') && !r.body.includes('name="body"'), String(r.status));
r = await page(`/vendors/${W.slug}/messages/${fresh}`, { cookie: cookie.n, method: 'POST', form: { intent: 'send', body: 'Hello?' } });
check('…replying anyway is refused in plain words', r.status === 409 && words(r.body).includes('This person has left Localites'), String(r.status));

// ------------------------------------------------------------------ 6. Leaving
await sql`update vendor_member set ended_at = now() where vendor_id = ${V.id} and user_id = ${ids.s}`;
r = await page(BIZ_THREAD, { cookie: cookie.s });
check('someone who leaves the business’s team loses access at once', r.status === 404, String(r.status));
r = await page(THREAD, { cookie: cookie.a });
check('…their past replies stay, as the business’s',
  (await sql`select author_side from message where conversation_id = ${conversationId} and author_user_id = ${ids.s}`).every((m) => m.author_side === 'vendor') &&
    words(r.body).includes(V.name));
await sql`update vendor set listing_status = 'archived', archived_at = now() where id = ${V.id}`;
r = await page(THREAD, { cookie: cookie.a });
check('a business that leaves Localites: the person keeps the conversation, and is told they can’t send',
  r.status === 200 && words(r.body).includes(`${V.name} isn’t on Localites any more`) && !r.body.includes('name="body"'), String(r.status));
r = await page(BIZ_THREAD, { cookie: cookie.o });
check('…and its team can no longer open it', r.status === 404, String(r.status));

// ------------------------------------------------------------------ 7. Wording (D-16, D-24; E §6)
const banned = /book now|booking confirmed|deposit|checkout|pay now|payment received|confirmed/i;
const wrong = seen.filter((s) => banned.test(words(s.body)));
check('no page suggests paying through Localites or a confirmed booking', wrong.length === 0,
  wrong.map((s) => `${s.path}: ${banned.exec(words(s.body))?.[0]}`).slice(0, 5).join('; '));

await finish('message');
