// Guests and replies (Stage 4, part 1; D-08, D-10, E §4.6 and §5, migration 0033): the host keeps
// a guest list for their own event; each guest's personal link opens only their own invitation and
// reply, with no account; nobody else sees the list. The site reaches the database as app_server,
// so its rules are really tested.
//
// Usage: npm run test:e2e
import { account, check, cookieFor, finish, mailFor, passwordSession, run, site, sql, twoStepSession } from './helpers.mjs';

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const words = (html) => decode(html.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ');
const cookieValue = (r) => (r.headers.getSetCookie().find((c) => c.startsWith('__Host-localites-invite=')) ?? '').split(';')[0];

// ------------------------------------------------------------------ set-up
const [town] = await sql`select id, name from municipality where is_active order by sort_order limit 1`;
const email = (who) => `e2e-guest-${who}-${run}@example.test`;
const ids = {};
for (const who of ['a', 'b', 'm']) ids[who] = await account(email(who));
await sql`update app_user set given_name = 'Ann', family_name = ${`Host${run}`}, display_name = ${`Ann Host${run}`} where id = ${ids.a}`;
await sql`insert into platform_role (user_id, role) values (${ids.m}, 'admin')`;
const cookie = { a: cookieFor(await passwordSession(email('a'))), b: cookieFor(await passwordSession(email('b'))) };
cookie.m = cookieFor(await twoStepSession(email('m')));
const [ev] = await sql`
  insert into event (host_user_id, event_date, start_time, municipality_id) values (${ids.a}, current_date + 14, '14:00', ${town.id}) returning id`;
const TITLE = `Sam’s 8th ${run}`;
await sql`insert into event_private (event_id, host_user_id, title, venue_note, budget_cents, notes)
          values (${ev.id}, ${ids.a}, ${TITLE}, 'Our backyard', 50000, ${`Secret notes ${run}`})`;
const GUESTS = `/events/${ev.id}/guests`;

console.log('Guests');

// ------------------------------------------------------------------ 1. The host's list
let r = await site(`/events/${ev.id}`, { cookie: cookie.a });
check('the event plan links to Guests', r.status === 200 && r.body.includes(GUESTS), String(r.status));
r = await site(GUESTS, { cookie: cookie.a });
check('the guest list says plainly who sees what', r.status === 200 && words(r.body).includes('Only you see your guest list') && words(r.body).includes('Localites never contacts your guests'));
for (const [who, c] of [['another person', cookie.b], ['the team', cookie.m]]) {
  r = await site(GUESTS, { cookie: c });
  check(`${who}: someone else’s guest list is "not found"`, r.status === 404, String(r.status));
  r = await site(GUESTS, { cookie: c, method: 'POST', form: { intent: 'add', name: 'Sneaky' } });
  check(`${who}: can’t add a guest to it`, r.status === 404 && (await sql`select count(*)::int as n from guest where event_id = ${ev.id}`)[0].n === 0, String(r.status));
}
r = await site(GUESTS);
check('signed out: asked to sign in', r.status === 302 && /\/join/.test(r.location), String(r.status));
r = await site(GUESTS, { cookie: cookie.a, method: 'POST', form: { intent: 'add', name: '  ' } });
check('a guest needs a name', r.status === 400 && words(r.body).includes('Write the guest’s name'), String(r.status));
r = await site(GUESTS, { cookie: cookie.a, method: 'POST', form: { intent: 'add', name: 'Jo', phone: 'call me' } });
check('a phone number must look like one', r.status === 400 && words(r.body).includes('doesn’t look like a phone number'), String(r.status));
r = await site(GUESTS, { cookie: cookie.a, method: 'POST', form: { intent: 'add', name: `Grandma Jo ${run}`, phone: '705-555-0101' } });
const [jo] = await sql`select id, token_hash from guest where event_id = ${ev.id} and name = ${`Grandma Jo ${run}`}`;
check('the host adds a guest and goes to send their invitation', r.status === 302 && r.location === `${GUESTS}/${jo?.id}?added=1`, `${r.status} ${r.location}`);
r = await site(GUESTS, { cookie: cookie.a, method: 'POST', form: { intent: 'add', name: `Uncle Rob ${run}`, email: 'rob@example.test' } });
const [rob] = await sql`select id from guest where event_id = ${ev.id} and name = ${`Uncle Rob ${run}`}`;
check('…and another', r.status === 302 && Boolean(rob));

// ------------------------------------------------------------------ 2. Sending a link
r = await site(`${GUESTS}/${jo.id}`, { cookie: cookie.a });
const link = /https?:\/\/[^\s"<]+\/i\/([A-Za-z0-9_-]{43})/.exec(decode(r.body));
check('the send page shows Jo’s own link, with text, WhatsApp, Gmail, Outlook.com, Yahoo Mail and email-app buttons',
  r.status === 200 && Boolean(link) && r.body.includes('href="sms:7055550101?&amp;body=') && r.body.includes('https://wa.me/7055550101?text=') && r.body.includes('mailto:') &&
    r.body.includes('https://mail.google.com/mail/?view=cm') && r.body.includes('outlook.live.com/mail/') && r.body.includes('compose.mail.yahoo.com'),
  String(r.status));
const token = link?.[1] ?? '';
check('…the link isn’t stored, only its fingerprint', !(await sql`select count(*)::int as n from guest where token_hash::text like ${'%' + token + '%'}`)[0].n);
r = await site(`${GUESTS}/${jo.id}`, { cookie: cookie.b });
check('another person: someone else’s guest is "not found"', r.status === 404, String(r.status));
r = await site(`/events/${ev.id}/guests/${rob.id}`, { cookie: cookie.a });
const robToken = /\/i\/([A-Za-z0-9_-]{43})/.exec(r.body)?.[1] ?? '';
check('each guest has a different link', robToken && robToken !== token);

// ------------------------------------------------------------------ 3. The guest (no account)
r = await site(`/i/${token}`);
const jar = cookieValue(r);
check('the link swaps itself for a cookie and the address bar shows /invite', r.status === 302 && r.location === '/invite' && jar.includes(token) && r.headers.get('x-robots-tag') === 'noindex',
  `${r.status} ${r.location}`);
r = await site('/invite', { cookie: jar });
let text = words(r.body);
check('the invitation: Jo’s name, the event, the date and time, where, the host’s first name',
  r.status === 200 && text.includes(`Hi Grandma Jo ${run}`) && text.includes(TITLE) && text.includes('Our backyard') && text.includes('Ann invites you') && text.includes('14:00'),
  String(r.status));
check('…never the budget, notes, other guests, or the host’s last name',
  // "$500", not "500": the run's random code (in the event's name) can contain those digits.
  !/\$\s?500/.test(text) && !text.includes('50000') && !text.includes(`Secret notes ${run}`) && !text.includes(`Uncle Rob ${run}`) && !text.includes(`Host${run}`));
check('…not for search engines', r.body.includes('noindex') && r.headers.get('x-robots-tag') === 'noindex');
check('…and the host sees it was opened', (await sql`select first_opened_at is not null as o from guest where id = ${jo.id}`)[0].o);
r = await site('/invite', { cookie: jar, method: 'POST', form: { response: 'yes', partySize: '50' } });
check('a party of 50 is refused in plain words', r.status === 400 && words(r.body).includes('From 1 to 20'), String(r.status));
r = await site('/invite', { cookie: jar, method: 'POST', form: { response: 'yes', partySize: '3', note: 'Can’t wait!' } });
check('Jo replies yes, 3 people, with a note', r.status === 302 && (await sql`select response, party_size from guest where id = ${jo.id}`)[0].party_size === 3, String(r.status));
r = await site('/invite?replied=1', { cookie: jar });
check('…and is thanked, and told they can change it', words(r.body).includes('Thanks!') && words(r.body).includes('change it'));
r = await site('/invite', { cookie: jar, method: 'POST', form: { response: 'maybe', partySize: '2' } });
check('…changes it (latest wins)', r.status === 302 && (await sql`select response from guest where id = ${jo.id}`)[0].response === 'maybe');
r = await site('/invite');
check('no link: "this link doesn’t work"', r.status === 404 && words(r.body).includes('This link doesn’t work'), String(r.status));
r = await site(`/i/${'x'.repeat(43)}`);
r = await site('/invite', { cookie: cookieValue(r) });
check('a made-up link: the same', r.status === 404, String(r.status));
r = await site('/invite', { cookie: `__Host-localites-invite=${'y'.repeat(43)}`, method: 'POST', form: { response: 'yes', partySize: '1' } });
check('…and can’t reply', r.status === 404 && (await sql`select count(*)::int as n from guest where event_id = ${ev.id} and response = 'yes'`)[0].n === 0, String(r.status));

// ------------------------------------------------------------------ 4. Back to the host
r = await site(GUESTS, { cookie: cookie.a });
text = words(r.body);
check('the host sees the replies: Jo maybe (2 people), Rob no reply yet, and the totals',
  text.includes('Maybe · 2 people') && text.includes('No reply yet') && text.includes('0 coming · 2 maybe · 0 can’t come · 1 no reply yet'));
r = await site(GUESTS, { cookie: cookie.a, method: 'POST', form: { intent: 'message', message: `Bring a swimsuit ${run}` } });
r = await site('/invite', { cookie: jar });
check('the host’s message shows on the invitation', words(r.body).includes(`Bring a swimsuit ${run}`));
// The guest adds it to their calendar (coming or maybe).
r = await site('/invite', { cookie: jar });
check('coming or maybe: "Add it to your calendar" with Google, Apple, Outlook, Microsoft 365, Yahoo and a file',
  words(r.body).includes('Add it to your calendar') && r.body.includes('calendar.google.com') && r.body.includes('outlook.live.com') &&
    r.body.includes('outlook.office.com') && r.body.includes('calendar.yahoo.com') && r.body.includes('/invite/calendar.ics'));
check('…and the page never shows the guest’s own link (not in any calendar link either)', !r.body.includes(token));
r = await site('/invite/calendar.ics', { cookie: jar });
check('the calendar file: the event, in calendar form, with no link in it',
  r.status === 200 && (r.headers.get('content-type') ?? '').startsWith('text/calendar') && r.body.includes('BEGIN:VEVENT') &&
    r.body.includes('SUMMARY:Sam’s 8th') && r.body.includes('LOCATION:Our backyard\\, ') && !r.body.includes('/i/'),
  String(r.status));
r = await site('/invite/calendar.ics');
check('…only with the guest’s link', r.status === 404, String(r.status));

// The host changes a guest's reply (D-49): the guest is emailed if the host gave their email.
const beforeChange = Date.now();
r = await site(`${GUESTS}/${rob.id}`, { cookie: cookie.a, method: 'POST', form: { intent: 'set-reply', response: 'yes', partySize: '4' } });
check('the host sets Rob’s reply: coming, 4 people',
  r.status === 302 && r.location.endsWith('?changed=emailed') && (await sql`select response, party_size, reply_by from guest where id = ${rob.id}`)[0].reply_by === 'host',
  `${r.status} ${r.location}`);
const robMail = (await mailFor('rob@example.test')).filter((m) => m.at > beforeChange);
check('…Rob is emailed: what changed, and his own link to change it back',
  robMail.length === 1 && robMail[0].subject.includes('Ann updated your reply') && robMail[0].body.includes('Coming (4 people)') && robMail[0].body.includes(`/i/${robToken}`) && !robMail[0].body.includes(email('a')));
r = await site(`/i/${robToken}`);
r = await site('/invite', { cookie: cookieValue(r) });
check('…and his invitation says Ann set it', words(r.body).includes('Ann set your reply to: Yes, I’ll be there (4 people)'));
r = await site(`${GUESTS}/${jo.id}`, { cookie: cookie.a, method: 'POST', form: { intent: 'set-reply', response: 'no' } });
check('a guest with no email: changed, not emailed', r.status === 302 && r.location.endsWith('?changed=not_emailed'), r.location);
r = await site(`${GUESTS}/${rob.id}`, { cookie: cookie.b, method: 'POST', form: { intent: 'set-reply', response: 'no' } });
check('another person can’t change a reply', r.status === 404 && (await sql`select response from guest where id = ${rob.id}`)[0].response === 'yes', String(r.status));
r = await site(`${GUESTS}/${jo.id}`, { cookie: cookie.a, method: 'POST', form: { intent: 'set-reply', response: 'maybe', partySize: '2' } });

r = await site(`${GUESTS}/${jo.id}`, { cookie: cookie.a, method: 'POST', form: { intent: 'new-link' } });
check('the host makes Jo a new link', r.status === 302 && r.location.endsWith('?new=1'), String(r.status));
r = await site('/invite', { cookie: jar });
check('…the old one stops working at once', r.status === 404, String(r.status));
check('…and Jo’s reply is kept', (await sql`select response from guest where id = ${jo.id}`)[0].response === 'maybe');
r = await site(GUESTS, { cookie: cookie.a, method: 'POST', form: { intent: 'remove', guestId: rob.id } });
check('the host removes Rob', r.status === 302 && (await sql`select count(*)::int as n from guest where id = ${rob.id}`)[0].n === 0, String(r.status));
r = await site(`/i/${robToken}`);
r = await site('/invite', { cookie: cookieValue(r) });
check('…and his link no longer works', r.status === 404, String(r.status));

// ------------------------------------------------------------------ 5. Cancelled, and over
await sql`update event set status = 'cancelled', cancelled_at = now() where id = ${ev.id}`;
r = await site(`${GUESTS}/${jo.id}`, { cookie: cookie.a });
const newToken = /\/i\/([A-Za-z0-9_-]{43})/.exec(r.body)?.[1] ?? '';
r = await site(`/i/${newToken}`);
const jar2 = cookieValue(r);
r = await site('/invite', { cookie: jar2 });
check('cancelled: the guest is told, with no reply form', words(r.body).includes('This event was cancelled') && !r.body.includes('name="response"'));
r = await site('/invite', { cookie: jar2, method: 'POST', form: { response: 'yes', partySize: '1' } });
check('…and a reply is refused in plain words', r.status === 409 && words(r.body).includes('cancelled'), String(r.status));
r = await site(GUESTS, { cookie: cookie.a, method: 'POST', form: { intent: 'add', name: 'Late' } });
check('…the host can’t add guests', r.status === 409, String(r.status));

// ------------------------------------------------------------------ 6. Wording (D-16, D-24)
const banned = /book now|booking confirmed|deposit|checkout|pay now|payment received/i;
check('no page suggests paying through Localites', !banned.test(text));

await finish('guest');
