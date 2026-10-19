// Scenario-test fixes, round 2 (D-54, migration 0047): a person withdraws a waiting review, or
// asks the team to remove a published one; the reviewer is emailed when the business replies, and
// whoever sent a report is told the outcome; the team decides a business's "this wasn't booked"
// note (and a review of a booking that wasn't real is removed); a business marked booked after
// the event can be reviewed 24 hours later, and the team sees when a booking was marked. The
// database's own rules are checked in db/tests/0047.
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

const [town] = await sql`select id from municipality where is_active order by sort_order limit 1`;
const [V] = await sql`
  insert into vendor (slug, display_name, primary_municipality_id, listing_status, published_at, claim_status, source)
  values (${`e2e-fix2-${run}`}, ${`Fixes Two Bakery ${run}`}, ${town.id}, 'published', now(), 'claimed', 'admin_entered')
  returning id, slug::text as slug, display_name as name`;
const email = (who) => `e2e-fix2-${who}-${run}@example.test`;
const ids = {};
for (const who of ['a', 'b', 'o', 'm']) ids[who] = await account(email(who));
await sql`update app_user set display_name = ${`Ava Fixer ${run}`}, given_name = 'Ava', family_name = 'Fixer' where id = ${ids.a}`;
await sql`insert into platform_role (user_id, role) values (${ids.m}, 'admin')`;
await sql`insert into vendor_member (vendor_id, user_id, role) values (${V.id}, ${ids.o}, 'owner')`;
const cookie = {};
for (const who of ['a', 'b', 'o']) cookie[who] = cookieFor(await passwordSession(email(who)));
cookie.m = cookieFor(await twoStepSession(email('m')));

// A's events 5 days ago, each with V marked booked (20 days ago unless said).
async function eventWith(title, bookedAgo = '20 days') {
  const [e] = await sql`insert into event (host_user_id, event_date, municipality_id) values (${ids.a}, current_date - 5, ${town.id}) returning id`;
  await sql`insert into event_private (event_id, host_user_id, title) values (${e.id}, ${ids.a}, ${title})`;
  const [row] = await sql`
    insert into event_vendor (event_id, host_user_id, vendor_id, status, booked_at)
    values (${e.id}, ${ids.a}, ${V.id}, 'booked', now() - ${bookedAgo}::interval) returning id`;
  return { id: e.id, row: row.id };
}
async function publishedReview(e, body) {
  const [rv] = await sql`
    insert into review (event_vendor_id, vendor_id, author_user_id, event_date, rating, body, status, decided_at, decided_by, published_at)
    values (${e.row}, ${V.id}, ${ids.a}, current_date - 5, 4, ${body}, 'published', now(), ${ids.m}, now()) returning id`;
  return rv.id;
}
const REVIEW = (e) => `/events/${e.id}/review/${e.row}`;
const mailTo = (who, subject, after) => waitFor(() => mailFor(email(who)), (ms) => ms.some((m) => m.at > after && m.subject.startsWith(subject)));

console.log('Withdrawing a waiting review');
const w = await eventWith(`Withdraw party ${run}`);
let r = await site(REVIEW(w), { cookie: cookie.a, method: 'POST', form: { rating: '3', body: `Changed my mind ${run}` } });
check('Ava writes a review', r.status === 302, String(r.status));
r = await site(REVIEW(w), { cookie: cookie.a });
check('…the page offers to withdraw it, with a confirm step', r.body.includes('value="withdraw"') && words(r.body).includes('Yes, withdraw it'));
r = await site(REVIEW(w), { cookie: cookie.b, method: 'POST', form: { intent: 'withdraw' } });
check('someone else can’t withdraw it', r.status === 404, String(r.status));
r = await site(REVIEW(w), { cookie: cookie.a, method: 'POST', form: { intent: 'withdraw' } });
const [withdrawn] = await sql`select status, withdrawn_by_author from review where event_vendor_id = ${w.row}`;
check('Ava withdraws it', r.status === 302 && withdrawn.status === 'withdrawn' && withdrawn.withdrawn_by_author, `${r.status} ${withdrawn.status}`);
r = await site(r.location, { cookie: cookie.a });
check('…and is told it won’t be published and can’t be written again', words(r.body).includes('You withdrew this review') && !r.body.includes('name="body"'));

console.log('\nAsking for a published review to be removed');
const p = await eventWith(`Published party ${run}`);
const pubId = await publishedReview(p, `Old words ${run}`);
r = await site(REVIEW(p), { cookie: cookie.a });
check('a published review offers “Ask us to remove this review”', words(r.body).includes('Ask us to remove this review'));
let since = Date.now();
r = await site(REVIEW(p), { cookie: cookie.a, method: 'POST', form: { intent: 'ask_removal', details: 'I wrote it in a hurry' } });
const [asked] = await sql`select reason, status from review_report where review_id = ${pubId}`;
check('Ava asks; the request waits for the team', r.status === 302 && asked?.reason === 'author_request' && asked.status === 'open', `${r.status} ${JSON.stringify(asked)}`);
r = await site(REVIEW(p), { cookie: cookie.a });
check('…the page says it’s been asked', words(r.body).includes('You’ve asked our team to remove this review'));
r = await site(`/admin/reviews/${pubId}`, { cookie: cookie.m });
check('the team sees who asked and why', words(r.body).includes('Its author asks for it to be removed') && r.body.includes('I wrote it in a hurry'));
r = await site(`/admin/reviews/${pubId}`, { cookie: cookie.m, method: 'POST', form: { intent: 'remove', reason: 'Its author asked' } });
const outcome = await mailTo('a', 'About your report', since);
check('the team removes it; Ava is told, without the team’s note',
  r.status === 302 && outcome.some((m) => m.at > since && m.body.includes('as you asked') && !m.body.includes('Its author asked')), String(r.status));

console.log('\nA reply to your review');
const rp = await eventWith(`Reply party ${run}`);
const replyId = await publishedReview(rp, `Nice cake ${run}`);
since = Date.now();
r = await site(`/vendors/${V.slug}/reviews`, { cookie: cookie.o, method: 'POST', form: { reviewId: replyId, reply: 'Thank you for having us!' } });
const replied = await mailTo('a', `${V.name} replied to your review`, since);
check('the business replies; Ava is emailed with a link, not the reply itself',
  r.status === 302 && replied.some((m) => m.at > since && m.body.includes(`/vendors/${V.slug}`) && !m.body.includes('Thank you for having us')), String(r.status));

console.log('\nMarked booked after the event');
const late = await eventWith(`Late party ${run}`, '10 minutes');
r = await site(REVIEW(late), { cookie: cookie.a });
check('the review page says when reviews open', words(r.body).includes('after your event, so you can review them from') && !r.body.includes('name="body"'));
r = await site(REVIEW(late), { cookie: cookie.a, method: 'POST', form: { rating: '5', body: 'Too quick' } });
check('…sending one anyway is refused in plain words', r.status === 409 && words(r.body).includes('24 hours after marking it'), String(r.status));
await sql`update event_vendor set booked_at = now() - interval '25 hours' where id = ${late.row}`;
r = await site(REVIEW(late), { cookie: cookie.a, method: 'POST', form: { rating: '5', body: `Worth the wait ${run}` } });
const [lateReview] = await sql`select id from review where event_vendor_id = ${late.row}`;
check('…a day later it can be reviewed', r.status === 302 && Boolean(lateReview), String(r.status));
r = await site(`/admin/reviews/${lateReview.id}`, { cookie: cookie.m });
check('the team sees it was marked after the event', words(r.body).includes('only after the event'));

console.log('\nThe team decides a business’s note');
const fake = await eventWith(`Fake party ${run}`);
const fakeReview = await publishedReview(fake, `Fake words ${run}`);
const real = await eventWith(`Real party ${run}`);
await sql`update event_vendor set vendor_flagged_at = now(), vendor_flagged_by = ${ids.o} where id in (${fake.row}, ${real.row})`;
r = await site(`/reviews/${fakeReview}/report`, { cookie: cookie.b, method: 'POST', form: { reason: 'not_genuine' } });
check('Bo reports the fake review', r.status === 302 && (await sql`select count(*)::int as n from review_report where review_id = ${fakeReview}`)[0].n === 1, String(r.status));
r = await site('/admin/booking-flags', { cookie: cookie.a });
check('a person can’t open Booking flags', r.status !== 200, String(r.status));
r = await site('/admin/booking-flags', { cookie: cookie.a, method: 'POST', form: { rowId: real.row, intent: 'stands' } });
check('…nor decide one: nothing changes', r.status !== 302 && (await sql`select flag_outcome from event_vendor where id = ${real.row}`)[0].flag_outcome === null, String(r.status));
since = Date.now();
r = await site('/admin/booking-flags', { cookie: cookie.m, method: 'POST', form: { rowId: fake.row, intent: 'not_real' } });
const [fakeNow] = await sql`select ev.flag_outcome, r.status from event_vendor ev join review r on r.event_vendor_id = ev.id where ev.id = ${fake.row}`;
check('“not a real booking”: decided, and its review removed', fakeNow.flag_outcome === 'booking_not_real' && fakeNow.status === 'removed', JSON.stringify(fakeNow));
const personMail = await mailTo('a', `About your booking with ${V.name}`, since);
const ownerMail = await mailTo('o', 'About the booking you told us about', since);
check('…Ava and the owner are emailed', personMail.some((m) => m.body.includes('Your review of it has been removed')) && ownerMail.some((m) => m.body.includes('and agreed')));
const reporterMail = await mailTo('b', 'About your report', since);
check('…and so is Bo, who reported the review', reporterMail.some((m) => m.at > since && m.body.includes('we’ve removed it')));
r = await site('/admin/booking-flags', { cookie: cookie.m, method: 'POST', form: { rowId: fake.row, intent: 'stands' } });
check('…and it stays decided', r.status === 409 && (await sql`select flag_outcome from event_vendor where id = ${fake.row}`)[0].flag_outcome === 'booking_not_real', String(r.status));
r = await site(REVIEW(real), { cookie: cookie.a });
check('before the team decides, a flagged booking can’t be reviewed', !r.body.includes('name="body"'));
r = await site('/admin/booking-flags', { cookie: cookie.m, method: 'POST', form: { rowId: real.row, intent: 'stands' } });
r = await site(REVIEW(real), { cookie: cookie.a });
check('“the booking stands”: now it can be reviewed', r.body.includes('name="body"'));
r = await site('/admin/booking-flags', { cookie: cookie.m });
check('the page shows both decisions', words(r.body).includes('The booking stands') && words(r.body).includes('Not a real booking') && words(r.body).includes('Decided'));

console.log('\nThe outcome of a conversation report');
r = await site(`/vendors/${V.slug}/message`, { cookie: cookie.a, method: 'POST', form: { body: 'Hello' } });
const conversationId = /^\/messages\/([0-9a-f-]{36})/.exec(r.location)?.[1];
await site(`/messages/${conversationId}/report`, { cookie: cookie.a, method: 'POST', form: { reason: 'spam' } });
const [report] = await sql`select id from moderation_report where conversation_id = ${conversationId}`;
since = Date.now();
r = await site(`/admin/reports/${report.id}`, { cookie: cookie.m, method: 'POST', form: { intent: 'dismissed', note: 'Team-only note here' } });
const reportMail = await mailTo('a', 'About your report', since);
check('the team closes it; Ava is told the outcome, never the note',
  r.status === 302 && reportMail.some((m) => m.at > since && m.body.includes(`your conversation with ${V.name}`) && !m.body.includes('Team-only note')), String(r.status));

await finish('scenario fix (round 2)');
