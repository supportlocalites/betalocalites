// Scenario-test fixes, round 4 (D-54, migration 0049): after changing when or where, the host is
// offered a ready-made update for guests; names pasted one per line; a group reply with the same
// name as a guest is pointed out, and can be matched to any guest; long guest pages stay light;
// after cancelling, "Let your guests know" (words to send, and emails to guests with an address);
// a cancelled event can be copied or deleted. The database's own rules are checked in db/tests/0049.
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

const [town] = await sql`select id, name from municipality where is_active order by sort_order limit 1`;
const [V] = await sql`
  insert into vendor (slug, display_name, primary_municipality_id, listing_status, published_at, claim_status, source)
  values (${`e2e-fix4-${run}`}, ${`Fixes Four Bakery ${run}`}, ${town.id}, 'published', now(), 'claimed', 'admin_entered')
  returning id, slug::text as slug, display_name as name`;
const email = (who) => `e2e-fix4-${who}-${run}@example.test`;
const ids = {};
for (const who of ['a', 'b', 'o']) ids[who] = await account(email(who));
await sql`insert into vendor_member (vendor_id, user_id, role) values (${V.id}, ${ids.o}, 'owner')`;
await sql`update app_user set given_name = 'Ava', family_name = 'Fixer' where id = ${ids.a}`;
const cookie = {};
for (const who of ['a', 'b']) cookie[who] = cookieFor(await passwordSession(email(who)));

const date = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
const later = new Date(Date.now() + 37 * 864e5).toISOString().slice(0, 10);
const TITLE = `Garden party ${run}`;
const form = (changes = {}) => ({ intent: 'create', title: TITLE, typeId: 'none', date, townId: town.id, startTime: '13:00', ...changes });
let r = await site('/events/new', { cookie: cookie.a, method: 'POST', form: form() });
const eventId = /^\/events\/([0-9a-f-]{36})/.exec(r.location)?.[1];
const PLAN = `/events/${eventId}`;
const GUESTS = `${PLAN}/guests`;
await site(`/vendors/${V.slug}/add`, { cookie: cookie.a, method: 'POST', form: { intent: 'add', eventId } });
await sql`update event_vendor set status = 'booked', booked_at = now() where event_id = ${eventId}`;

console.log('Pasting a guest list');
r = await site(GUESTS, { cookie: cookie.a, method: 'POST', form: { intent: 'add-many', names: 'Mia Lee\n\nOmar Diaz\n  mia lee \nZoë Ng' } });
const guestNames = async () => (await sql`select name from guest where event_id = ${eventId} order by created_at, name`).map((g) => g.name);
check('names pasted one per line are added, blank lines and repeats dropped', r.status === 302 && (await guestNames()).join('|') === 'Mia Lee|Omar Diaz|Zoë Ng', (await guestNames()).join('|'));
r = await site(r.location.replace(/#.*/, ''), { cookie: cookie.a });
check('…and the host is told how many', words(r.body).includes('Added 3 guests'));
r = await site(GUESTS, { cookie: cookie.a, method: 'POST', form: { intent: 'add-many', names: 'Omar Diaz\nPriya Shah' } });
check('names already on the list are skipped', (await guestNames()).length === 4 && r.location.includes('there=1'), r.location);
r = await site(GUESTS, { cookie: cookie.b, method: 'POST', form: { intent: 'add-many', names: 'Intruder' } });
check('someone else can’t add to Ava’s list', r.status === 404 && (await guestNames()).length === 4, String(r.status));
await sql`update guest set email = ${email('mia')} where event_id = ${eventId} and name = 'Mia Lee'`;
await sql`update guest set email = ${email('omar')} where event_id = ${eventId} and name = 'Omar Diaz'`;

console.log('\nGroup replies');
await site(GUESTS, { cookie: cookie.a, method: 'POST', form: { intent: 'group-new' } });
await sql`update guest set response = 'yes', party_size = 2, replied_at = now(), reply_by = 'guest' where event_id = ${eventId} and name = 'Zoë Ng'`;
await sql`insert into group_reply (event_id, host_user_id, name, response, party_size, browser_hash)
  values (${eventId}, ${ids.a}, ' zoë NG ', 'no', null, sha256(convert_to(${`b1-${run}`}, 'UTF8'))),
         (${eventId}, ${ids.a}, 'Stranger', 'yes', 1, sha256(convert_to(${`b2-${run}`}, 'UTF8')))`;
r = await site(GUESTS, { cookie: cookie.a });
check('a reply with the same name as a guest who already replied is pointed out, without a one-tap match',
  words(r.body).includes('Same name as Zoë Ng on your list, who already replied (Coming)') && !words(r.body).includes('Match to Zoë Ng'));
await sql`insert into group_reply (event_id, host_user_id, name, response, party_size, browser_hash)
  values (${eventId}, ${ids.a}, 'Omar Diaz', 'yes', 1, sha256(convert_to(${`b3-${run}`}, 'UTF8')))`;
r = await site(GUESTS, { cookie: cookie.a });
check('…one who hasn’t replied gets a one-tap match', words(r.body).includes('Match to Omar Diaz'));
check('…and any guest can be chosen, including one who already replied', words(r.body).includes('Zoë Ng (already replied: Coming)'));

console.log('\nA long guest list stays light');
const many = Array.from({ length: 140 }, (_, i) => `Guest ${String(i).padStart(3, '0')} ${run}`).join('\n');
await site(GUESTS, { cookie: cookie.a, method: 'POST', form: { intent: 'add-many', names: many } });
r = await site(GUESTS, { cookie: cookie.a });
const options = (r.body.match(/<option /g) ?? []).length;
check('with a long list, the “This is…” choices load one reply at a time', words(r.body).includes('Match to a guest') && options < 10, String(options));
const shown = (r.body.match(/>Send invitation</g) ?? []).length;
check('…and the list shows the first 100, with “Show all”', words(r.body).includes('Show all 144 guests') && shown === 100, String(shown));
const [stranger] = await sql`select id from group_reply where event_id = ${eventId} and name = 'Stranger'`;
r = await site(`${GUESTS}?match=${stranger.id}`, { cookie: cookie.a });
check('…opening one reply’s choices lists every guest for it alone', (r.body.match(/<option /g) ?? []).length > 140);

console.log('\nChanging when or where');
r = await site(`${PLAN}/edit`, { cookie: cookie.a, method: 'POST', form: { ...form({ date: later }), intent: 'save' } });
check('changing the date (with guests) goes to a ready-made update for guests', r.status === 302 && r.location.startsWith(`${GUESTS}?changed=1`), r.location);
r = await site(`${GUESTS}?changed=1`, { cookie: cookie.a });
check('…which says guests aren’t told automatically, and offers the words', words(r.body).includes('Guests aren’t told automatically') && words(r.body).includes('Change of plans:'));
r = await site(`${PLAN}/edit`, { cookie: cookie.a, method: 'POST', form: { ...form({ date: later, title: `${TITLE} (renamed)` }), intent: 'save' } });
check('changing only the name goes back to the plan', r.location === `${PLAN}?saved=1`, r.location);

console.log('\nCancelling, and letting guests know');
r = await site(`${PLAN}/cancel`, { cookie: cookie.a });
check('the cancel page says guests aren’t told automatically', words(r.body).includes('Your guests aren’t told automatically'));
r = await site(`${PLAN}/cancel`, { cookie: cookie.a, method: 'POST', form: { intent: 'cancel' } });
check('after cancelling: “Let your guests know”', r.status === 302 && r.location === `${PLAN}/tell-guests?cancelled=1`, r.location);
r = await site(r.location, { cookie: cookie.a });
check('…with words to send, and an offer to email the 2 guests with an address', words(r.body).includes('is cancelled') && words(r.body).includes('2 guests have an email address'));
r = await site(`${PLAN}/tell-guests`, { cookie: cookie.b, method: 'POST', form: { intent: 'email' } });
check('someone else can’t email Ava’s guests', r.status === 404, String(r.status));
const since = Date.now();
r = await site(`${PLAN}/tell-guests`, { cookie: cookie.a, method: 'POST', form: { intent: 'email' } });
check('Ava has them emailed', r.status === 302 && r.location.includes('sent=2'), r.location);
const mia = await waitFor(() => mailFor(email('mia')), (ms) => ms.some((m) => m.at > since));
check('…each guest is told it’s cancelled, from Ava', mia.some((m) => m.at > since && m.subject.includes('is cancelled') && m.body.includes('Ava has cancelled')));
r = await site(`${PLAN}/tell-guests`, { cookie: cookie.a, method: 'POST', form: { intent: 'email' } });
check('…and asking again emails nobody twice', r.location.includes('sent=0'), r.location);

console.log('\nCopying and deleting a cancelled event');
r = await site(PLAN, { cookie: cookie.a });
check('the cancelled plan offers copy and delete, and says the booking was, not is', words(r.body).includes('Copy this event') && words(r.body).includes('Delete this event'));
r = await site(`/events/new?copy=${eventId}`, { cookie: cookie.a });
check('“Copy this event” starts from its details, its businesses as Considering', words(r.body).includes('Copy your event') && r.body.includes(TITLE));
r = await site(`/events/new?copy=${eventId}`, { cookie: cookie.b });
check('…someone else’s event can’t be copied', !r.body.includes(TITLE));
r = await site('/events/new', { cookie: cookie.a, method: 'POST', form: { ...form({ title: `${TITLE} again`, date: later }), copyFrom: eventId } });
const copyId = /^\/events\/([0-9a-f-]{36})/.exec(r.location)?.[1];
const copied = await sql`select status from event_vendor where event_id = ${copyId}`;
check('the copy has the business as Considering, not booked', copied.length === 1 && copied[0].status === 'considering', JSON.stringify(copied));
r = await site(PLAN, { cookie: cookie.a, method: 'POST', form: { intent: 'delete' } });
check('it can’t be deleted before the business is told it’s cancelled (its morning summary)',
  r.status === 409 && words(r.body).includes('morning summary') && (await sql`select count(*)::int as n from event where id = ${eventId}`)[0].n === 1, String(r.status));
// A day on, the business has had its morning summary.
await sql`update notification set status = 'sent', sent_at = now(), summary_line = null
  where subject_type = 'event_vendor' and status = 'waiting' and subject_id in (select id from event_vendor where event_id = ${eventId})`;
await sql`update event set cancelled_at = now() - interval '25 hours' where id = ${eventId}`;
r = await site(PLAN, { cookie: cookie.b, method: 'POST', form: { intent: 'delete' } });
check('someone else can’t delete it', r.status === 404 && (await sql`select count(*)::int as n from event where id = ${eventId}`)[0].n === 1, String(r.status));
r = await site(`/events/${copyId}`, { cookie: cookie.a, method: 'POST', form: { intent: 'delete' } });
check('a planned event can’t be deleted this way', r.status === 409 && (await sql`select count(*)::int as n from event where id = ${copyId}`)[0].n === 1, String(r.status));
r = await site(PLAN, { cookie: cookie.a, method: 'POST', form: { intent: 'delete' } });
check('Ava deletes the cancelled event, with its guests', r.status === 302 && r.location === '/events?deleted=1'
  && (await sql`select count(*)::int as n from event where id = ${eventId}`)[0].n === 0
  && (await sql`select count(*)::int as n from guest where event_id = ${eventId}`)[0].n === 0, r.location);

await finish('scenario fix (round 4)');
