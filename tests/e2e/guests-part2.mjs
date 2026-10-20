// Guests, part 2 (Stage 4; D-08, E §4.6 and §5, migration 0037): the group link (anyone with it
// replies with their name and sees only their own reply; the host matches replies to the list,
// replaces the link or switches it off), a printable QR code, the host's questions and the
// guests' answers, and updates on every invitation. Only the host sees or changes any of it.
//
// Usage: npm run test:e2e
import { account, check, cookieFor, cookiesFrom, finish, passwordSession, run, site, sql, twoStepSession } from './helpers.mjs';

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const words = (html) => decode(html.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ');

// ------------------------------------------------------------------ set-up
const [town] = await sql`select id from municipality where is_active order by sort_order limit 1`;
const email = (who) => `e2e-guest2-${who}-${run}@example.test`;
const ids = {};
for (const who of ['a', 'b', 'm']) ids[who] = await account(email(who));
await sql`update app_user set given_name = 'Ann', family_name = 'Host' where id = ${ids.a}`;
await sql`insert into platform_role (user_id, role) values (${ids.m}, 'admin')`;
const cookie = { a: cookieFor(await passwordSession(email('a'))), b: cookieFor(await passwordSession(email('b'))) };
cookie.m = cookieFor(await twoStepSession(email('m')));
const [ev] = await sql`
  insert into event (host_user_id, event_date, start_time, municipality_id) values (${ids.a}, current_date + 14, '14:00', ${town.id}) returning id`;
const TITLE = `Pool party ${run}`;
await sql`insert into event_private (event_id, host_user_id, title, notes) values (${ev.id}, ${ids.a}, ${TITLE}, ${`Secret notes ${run}`})`;
const GUESTS = `/events/${ev.id}/guests`;
const post = (form, who = 'a') => site(GUESTS, { cookie: cookie[who], method: 'POST', form });
await post({ intent: 'add', name: `Grandma Jo ${run}` });
await post({ intent: 'add', name: `Uncle Rob ${run}` });
const [jo] = await sql`select id from guest where event_id = ${ev.id} and name = ${`Grandma Jo ${run}`}`;

console.log('Guests, part 2');

// ------------------------------------------------------------------ 1. Questions and updates
let r = await post({ intent: 'question-add', question: 'Any allergies?' });
check('the host asks a question', r.status === 302 && (await sql`select count(*)::int as n from event_question where event_id = ${ev.id}`)[0].n === 1, String(r.status));
r = await post({ intent: 'question-add', question: '  ' });
check('…a question needs words', r.status === 400 && words(r.body).includes('Write the question'), String(r.status));
for (let i = 2; i <= 5; i++) await post({ intent: 'question-add', question: `Question ${i}` });
r = await post({ intent: 'question-add', question: 'Sixth?' });
check('…up to 5', r.status === 409 && words(r.body).includes('up to 5 questions'), String(r.status));
const extra = await sql`select id from event_question where event_id = ${ev.id} and question like 'Question %'`;
for (const q of extra) await post({ intent: 'question-remove', questionId: q.id });
const [allergy] = await sql`select id from event_question where event_id = ${ev.id}`;
r = await post({ intent: 'update-post', body: `We moved to 3 pm ${run}` });
check('the host posts an update', r.status === 302 && (await sql`select count(*)::int as n from event_update where event_id = ${ev.id}`)[0].n === 1, String(r.status));
for (const [who, c] of [['another person', 'b'], ['the team', 'm']]) {
  r = await post({ intent: 'update-post', body: 'Party cancelled lol' }, c);
  check(`${who}: can’t post an update or ask a question`, r.status === 404 && (await sql`select count(*)::int as n from event_update where event_id = ${ev.id}`)[0].n === 1, String(r.status));
}

// ------------------------------------------------------------------ 2. The group link
r = await post({ intent: 'group-new' });
r = await site(GUESTS, { cookie: cookie.a });
const groupLink = /https?:\/\/[^\s"<]+\/g\/([A-Za-z0-9_-]{43})/.exec(decode(r.body));
check('the host makes a group link, with words to send, WhatsApp, text and Print', Boolean(groupLink) && r.body.includes('https://wa.me/?text=') && r.body.includes(`${GUESTS}/print`));
r = await site(GUESTS, { cookie: cookie.b, method: 'POST', form: { intent: 'group-new' } });
check('another person can’t make or replace it', r.status === 404, String(r.status));
r = await site(`${GUESTS}/print`, { cookie: cookie.a });
check('the print page shows the event, a QR code and the link', r.status === 200 && r.body.includes('<svg') && decode(r.body).includes(groupLink[0]) && words(r.body).includes(TITLE));
r = await site(`${GUESTS}/print`, { cookie: cookie.b });
check('…only for the host', r.status === 404, String(r.status));
r = await site(`${GUESTS}/print?guest=${jo.id}`, { cookie: cookie.a });
check('a guest’s own link can be printed too', r.status === 200 && r.body.includes('<svg') && words(r.body).includes(`For Grandma Jo ${run}`));

// A guest opens the group link (no account).
r = await site(`/g/${groupLink[1]}`);
const sam = cookiesFrom(r);
check('the group link is swapped for cookies (the link and this browser’s own key), then the page',
  r.status === 302 && r.location === '/group-invite' && sam.includes('__Host-localites-group=') && sam.includes('__Host-localites-gkey='), `${r.status} ${sam}`);
r = await site('/group-invite', { cookie: sam });
let text = words(r.body);
check('the group invitation: the event, the host’s first name, the update and the question, a name box',
  r.status === 200 && text.includes(TITLE) && text.includes('Host Ann') && text.includes(`We moved to 3 pm ${run}`) &&
    text.includes('Any allergies?') && r.body.includes('name="name"'), String(r.status));
check('…never the plan’s private notes, or other guests', !text.includes(`Secret notes ${run}`) && !text.includes('Grandma Jo') && !text.includes('Uncle Rob'));
r = await site('/group-invite', { cookie: sam, method: 'POST', form: { name: ' ', response: 'yes', partySize: '2' } });
check('a name is needed', r.status === 400 && words(r.body).includes('Please write your name'), String(r.status));
r = await site('/group-invite', { cookie: sam, method: 'POST', form: { name: `Sam ${run}`, response: 'yes', partySize: '2', [`answer.${allergy.id}`]: 'Peanuts' } });
check('Sam replies, with an answer', r.status === 302 && r.location === '/group-invite?replied=1', `${r.status} ${r.location}`);
r = await site('/group-invite', { cookie: sam });
check('…and sees their own reply and answer back', r.body.includes(`value="Sam ${run}"`) && r.body.includes('value="Peanuts"'));
const tia = cookiesFrom(await site(`/g/${groupLink[1]}`));
r = await site('/group-invite', { cookie: tia });
check('another browser with the same link sees nobody else’s reply', r.status === 200 && !r.body.includes(`Sam ${run}`) && !r.body.includes('Peanuts'));
r = await site('/group-invite', { cookie: tia, method: 'POST', form: { name: `Tia ${run}`, response: 'no' } });
r = await site('/group-invite', { cookie: sam, method: 'POST', form: { name: `Sam ${run}`, response: 'maybe', partySize: '1', [`answer.${allergy.id}`]: 'Peanuts' } });
check('Sam changes their reply from the same browser: still one reply', (await sql`select count(*)::int as n from group_reply where event_id = ${ev.id} and name = ${`Sam ${run}`}`)[0].n === 1);
r = await site('/group-invite/calendar.ics', { cookie: sam });
check('the calendar file works by the group link too', r.status === 200 && r.body.includes('BEGIN:VCALENDAR'), String(r.status));

// ------------------------------------------------------------------ 3. The host matches
r = await site(GUESTS, { cookie: cookie.a });
text = words(r.body);
check('the host sees the group replies, not yet matched, with the answer, counted in the totals',
  text.includes('Replies from the group link, not matched yet (2)') && text.includes(`Sam ${run}`) && text.includes('Any allergies? Peanuts') && text.includes('maybe 1'));
const [samReply] = await sql`select id from group_reply where event_id = ${ev.id} and name = ${`Sam ${run}`}`;
r = await site(GUESTS, { cookie: cookie.b, method: 'POST', form: { intent: 'match', replyId: samReply.id, guestId: jo.id } });
check('another person can’t match a reply', r.status === 404 && (await sql`select response from guest where id = ${jo.id}`)[0].response === null, String(r.status));
r = await post({ intent: 'match', replyId: samReply.id, guestId: jo.id });
const [joNow] = await sql`select response, party_size from guest where id = ${jo.id}`;
check('the host matches Sam’s reply to Grandma Jo: she shows it', r.status === 302 && joNow.response === 'maybe' && joNow.party_size === 1, String(r.status));
r = await site(GUESTS, { cookie: cookie.a });
check('…with the answer, and the reply leaves the unmatched list', words(r.body).includes('Replies from the group link, not matched yet (1)') && words(r.body).includes('Any allergies? Peanuts'));
const [tiaReply] = await sql`select id from group_reply where event_id = ${ev.id} and name = ${`Tia ${run}`}`;
r = await post({ intent: 'remove-reply', replyId: tiaReply.id });
check('the host removes a reply that isn’t from their guests', r.status === 302 && (await sql`select count(*)::int as n from group_reply where id = ${tiaReply.id}`)[0].n === 0);

for (const n of [1, 2]) {
  const spam = cookiesFrom(await site(`/g/${groupLink[1]}`));
  await site('/group-invite', { cookie: spam, method: 'POST', form: { name: `Spam ${n} ${run}`, response: 'yes', partySize: '20' } });
}
r = await post({ intent: 'remove-unmatched' }, 'b');
check('another person can’t clear the replies', r.status === 404, String(r.status));
r = await post({ intent: 'remove-unmatched' });
const left = await sql`select name, matched_guest_id is not null as matched from group_reply where event_id = ${ev.id}`;
check('the host removes all the unmatched replies at once; the matched one stays',
  r.status === 302 && left.length === 1 && left[0].matched && left[0].name === `Sam ${run}`, JSON.stringify(left));

// ------------------------------------------------------------------ 4. A guest's own link answers too
r = await site(`${GUESTS}/${jo.id}`, { cookie: cookie.a });
const joLink = /\/i\/([A-Za-z0-9_-]{43})/.exec(decode(r.body));
const joCookie = cookiesFrom(await site(`/i/${joLink[1]}`));
r = await site('/invite', { cookie: joCookie });
check('Grandma Jo’s own invitation shows the update and her answer', words(r.body).includes(`We moved to 3 pm ${run}`) && r.body.includes('Peanuts'));
r = await site('/invite', { cookie: joCookie, method: 'POST', form: { response: 'yes', partySize: '2', [`answer.${allergy.id}`]: 'None now' } });
const [joAnswer] = await sql`select answer from guest_answer where guest_id = ${jo.id}`;
check('…she changes her reply and answer by her own link', r.status === 302 && joAnswer?.answer === 'None now', String(r.status));

// ------------------------------------------------------------------ 5. Switching the link off and replacing it
r = await post({ intent: 'group-off' }, 'b');
check('another person can’t switch the group link off', r.status === 404 && (await site('/group-invite', { cookie: sam })).status === 200, String(r.status));
r = await post({ intent: 'group-off' });
r = await site('/group-invite', { cookie: sam });
check('switched off: the group link no longer opens', r.status === 404, String(r.status));
r = await post({ intent: 'group-new' });
r = await site(GUESTS, { cookie: cookie.a });
const newLink = /\/g\/([A-Za-z0-9_-]{43})/.exec(decode(r.body));
check('a new group link differs from the old one', Boolean(newLink) && newLink[1] !== groupLink[1]);
r = await site('/group-invite', { cookie: cookiesFrom(await site(`/g/${groupLink[1]}`)) });
check('…and the old one still doesn’t open', r.status === 404, String(r.status));
r = await site(`/g/not-a-token`);
check('a made-up group link opens nothing', r.status === 302 && (await site('/group-invite', { cookie: cookiesFrom(r) })).status === 404);

await finish('guests part 2');
