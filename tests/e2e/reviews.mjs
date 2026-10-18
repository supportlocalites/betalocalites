// Reviews (Stage 3, parts 1 and 2; D-06, D-48, ADR-026, migrations 0031 and 0032): a person reviews a business they
// booked, after the event; the team approves or denies every review (from the email's links, D-51:
// a denied review leaves its author no trace); the business replies once;
// the public sees published reviews only, the author as "Sarah M."; nobody else writes or reads
// what they shouldn't; reports of a review; "How was it?" emails and turning them off. The site reaches the database as app_server, so its rules are really tested.
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
const [V] = await sql`
  insert into vendor (slug, display_name, primary_municipality_id, listing_status, published_at, claim_status, source)
  values (${`e2e-rev-${run}`}, ${`Reviews Bakery ${run}`}, ${town.id}, 'published', now(), 'claimed', 'admin_entered')
  returning id, slug::text as slug, display_name as name`;
const email = (who) => `e2e-rev-${who}-${run}@example.test`;
const ids = {};
for (const who of ['a', 'b', 'o', 's', 'm']) ids[who] = await account(email(who));
await sql`update app_user set display_name = ${`Sarah Tester ${run}`}, given_name = 'Sarah', family_name = ${`Tester${run}`} where id = ${ids.a}`;
await sql`insert into platform_role (user_id, role) values (${ids.m}, 'admin')`;
await sql`insert into vendor_member (vendor_id, user_id, role) values (${V.id}, ${ids.o}, 'owner'), (${V.id}, ${ids.s}, 'staff')`;
const cookie = {};
for (const who of ['a', 'b', 'o', 's']) cookie[who] = cookieFor(await passwordSession(email(who)));
cookie.m = cookieFor(await twoStepSession(email('m')));

// A's party 5 days ago, and a party next month, each with V marked booked.
async function eventWith(daysFromNow, title) {
  const [e] = await sql`
    insert into event (host_user_id, event_date, municipality_id) values (${ids.a}, current_date + ${daysFromNow}::int, ${town.id}) returning id`;
  await sql`insert into event_private (event_id, host_user_id, title) values (${e.id}, ${ids.a}, ${title})`;
  const [row] = await sql`
    insert into event_vendor (event_id, host_user_id, vendor_id, status, booked_at)
    values (${e.id}, ${ids.a}, ${V.id}, 'booked', now() - interval '20 days') returning id`;
  return { id: e.id, row: row.id };
}
const past = await eventWith(-5, `Past party ${run}`);
const future = await eventWith(30, `Future party ${run}`);
const REVIEW = (e) => `/events/${e.id}/review/${e.row}`;
const BODY = `The cake was perfect and on time ${run}`;

console.log('Reviews');

// ------------------------------------------------------------------ 1. Writing a review
let r = await page(`/events/${past.id}`, { cookie: cookie.a });
check('after the event, the plan offers to review the business it booked', r.status === 200 && r.body.includes(REVIEW(past)), String(r.status));
r = await page(`/events/${future.id}`, { cookie: cookie.a });
check('…not before the event', r.status === 200 && !r.body.includes(REVIEW(future)));
r = await page(REVIEW(future), { cookie: cookie.a });
check('the review page says when it can be reviewed', r.status === 200 && words(r.body).includes('once your event has happened') && !r.body.includes('name="body"'));
r = await page(REVIEW(future), { cookie: cookie.a, method: 'POST', form: { rating: '5', body: 'Too early' } });
check('…and sending one anyway is refused in plain words', r.status === 409 && words(r.body).includes('once your event has happened'), String(r.status));
r = await page(REVIEW(past), { cookie: cookie.a });
check('the form says plainly what is shown and that the team reads it first',
  r.status === 200 && words(r.body).includes('Our team reads every review before it’s published') && words(r.body).includes('first letter of your last name'));
r = await page(REVIEW(past), { cookie: cookie.a, method: 'POST', form: { rating: '9', body: 'x' } });
check('a rating must be 1 to 5', r.status === 400 && words(r.body).includes('Choose from 1 to 5 stars'), String(r.status));
r = await page(REVIEW(past), { cookie: cookie.a, method: 'POST', form: { rating: '4', body: '   ' } });
check('some words are needed', r.status === 400 && words(r.body).includes('Write a few words'), String(r.status));
for (const [who, c] of [['another person', cookie.b], ['the business’s owner', cookie.o]]) {
  r = await page(REVIEW(past), { cookie: c });
  check(`${who}: someone else’s booking is "not found"`, r.status === 404, String(r.status));
  r = await page(REVIEW(past), { cookie: c, method: 'POST', form: { rating: '1', body: 'Sneaky' } });
  check(`${who}: can’t review it`, r.status === 404 && (await sql`select count(*)::int as n from review where vendor_id = ${V.id}`)[0].n === 0, String(r.status));
}
const before = Date.now();
r = await page(REVIEW(past), { cookie: cookie.a, method: 'POST', form: { rating: '4', body: BODY } });
const [rev] = await sql`select id, status, rating, planned_on_localites from review where event_vendor_id = ${past.row}`;
check('the host sends a review: it waits for the team', r.status === 302 && rev?.status === 'pending' && rev.rating === 4, `${r.status} ${JSON.stringify(rev)}`);
const teamMail = await waitFor(
  async () => (await mailFor('supportlocalites@gmail.com')).filter((m) => m.at > before && m.subject === `New review of ${V.name} to check`),
  (l) => l.length > 0,
);
check('the team is emailed a link to it, never the words', teamMail.length === 1 && teamMail[0].body.includes(`/admin/reviews/${rev?.id}`) && !teamMail[0].body.includes(BODY));
r = await page(`/vendors/${V.slug}`);
check('nothing is public yet', !r.body.includes(BODY));
r = await page(`/vendors/${V.slug}/reviews`, { cookie: cookie.o });
check('…nor shown to the business', r.status === 200 && !r.body.includes(BODY), String(r.status));
const staleSeen = (await sql`select updated_at::text as t from review where id = ${rev.id}`)[0].t;
r = await page(REVIEW(past), { cookie: cookie.a, method: 'POST', form: { rating: '5', body: `${BODY}!` } });
check('the author changes it while it waits', r.status === 302 && (await sql`select rating from review where id = ${rev.id}`)[0].rating === 5);
r = await page(`/events/${past.id}`, { cookie: cookie.a });
check('the plan says it’s waiting', words(r.body).includes('Your review: waiting for our team'));

// ------------------------------------------------------------------ 2. The team decides
r = await page('/admin/reviews', { cookie: cookie.m });
check('the team’s Reviews page lists it as waiting, and the menu counts it',
  r.status === 200 && r.body.includes(`/admin/reviews/${rev.id}`) && /Reviews \(\d+ waiting\)/.test(words(r.body)), String(r.status));
for (const [who, c] of [['a person', cookie.a], ['a business owner', cookie.o]]) {
  r = await page(`/admin/reviews/${rev.id}`, { cookie: c });
  check(`${who}: the team’s review page is refused (403)`, r.status === 403 && !r.body.includes(BODY), String(r.status));
}
r = await page(`/admin/reviews/${rev.id}`, { cookie: cookie.m, method: 'POST', form: { intent: 'publish', seen: staleSeen } });
check('words changed since the team read them: not published, "look again"',
  r.status === 409 && (await sql`select status from review where id = ${rev.id}`)[0].status === 'pending', String(r.status));
r = await page(`/admin/reviews/${rev.id}`, { cookie: cookie.m });
const seenNow = /name="seen" value="([^"]+)"/.exec(r.body)?.[1] ?? '';
const beforePublish = Date.now();
r = await page(`/admin/reviews/${rev.id}`, { cookie: cookie.m, method: 'POST', form: { intent: 'publish', seen: seenNow } });
check('the team publishes it, recorded',
  r.status === 302 && (await sql`select status from review where id = ${rev.id}`)[0].status === 'published' &&
    (await sql`select count(*)::int as n from audit_log where action = 'review.publish' and subject_id = ${rev.id}`)[0].n === 1, String(r.status));
const authorMail = await waitFor(async () => (await mailFor(email('a'))).filter((m) => m.at > beforePublish), (l) => l.length > 0);
check('the author is told, and how they’re shown', authorMail.some((m) => m.subject === `Your review of ${V.name} is on Localites` && m.body.includes('Sarah T.')));
const ownerMail = await waitFor(async () => (await mailFor(email('o'))).filter((m) => m.at > beforePublish), (l) => l.length > 0);
check('the owner is told, with a link to reply', ownerMail.some((m) => m.subject === `A new review of ${V.name} on Localites` && m.body.includes(`/vendors/${V.slug}/reviews`)));

// ------------------------------------------------------------------ 3. The public and the business
r = await page(`/vendors/${V.slug}`);
let text = words(r.body);
check('the public sees it: "Sarah T.", the stars, the month, planned outside Localites',
  text.includes(`${BODY}!`) && text.includes('Sarah T.') && !text.includes(`Tester${run}`) && text.includes('Planned outside Localites') && r.body.includes('5 out of 5 stars'));
check('…and no average until 3 reviews', text.includes('1 review (the average shows from 3)'));
r = await page(REVIEW(past), { cookie: cookie.a, method: 'POST', form: { rating: '1', body: 'Changed my mind' } });
check('once published, the author can’t change it', r.status === 409 && (await sql`select rating from review where id = ${rev.id}`)[0].rating === 5, String(r.status));
r = await page(`/vendors/${V.slug}/reviews`, { cookie: cookie.s });
check('staff read the business’s reviews, with no reply box', r.status === 200 && r.body.includes(`${BODY}!`) && !r.body.includes('name="reply"'), String(r.status));
r = await page(`/vendors/${V.slug}/reviews`, { cookie: cookie.s, method: 'POST', form: { reviewId: rev.id, reply: 'Staff reply' } });
check('…and can’t reply', r.status === 404 && !(await sql`select vendor_reply from review where id = ${rev.id}`)[0].vendor_reply, String(r.status));
r = await page(`/vendors/${V.slug}/reviews`, { cookie: cookie.b });
check('someone not on the team: "not found"', r.status === 404, String(r.status));
const REPLY = `Thank you, Sarah ${run}`;
r = await page(`/vendors/${V.slug}/reviews`, { cookie: cookie.o, method: 'POST', form: { reviewId: rev.id, reply: REPLY } });
check('the owner replies', r.status === 302 && (await sql`select vendor_reply from review where id = ${rev.id}`)[0].vendor_reply === REPLY, String(r.status));
r = await page(`/vendors/${V.slug}/reviews`, { cookie: cookie.o, method: 'POST', form: { reviewId: rev.id, reply: 'Again' } });
check('…once', r.status === 409, String(r.status));
r = await page(`/vendors/${V.slug}`);
check('the reply shows under the review', words(r.body).includes(REPLY));

// ------------------------------------------------------------------ 3b. Reporting a review (part 2)
check('the public page offers "Report this review"', r.body.includes(`/reviews/${rev.id}/report`));
r = await page(`/reviews/${rev.id}/report`);
check('signed out: reporting asks you to sign in', r.status === 302 && /\/join/.test(r.headers.get('location') ?? ''), String(r.status));
r = await page(`/reviews/${rev.id}/report`, { cookie: cookie.a });
check('the author can open it…', r.status === 200);
r = await page(`/reviews/${rev.id}/report`, { cookie: cookie.a, method: 'POST', form: { reason: 'other' } });
check('…but can’t report their own review', r.status === 409 && words(r.body).includes('can’t report your own review'), String(r.status));
r = await page(`/reviews/${rev.id}/report`, { cookie: cookie.b, method: 'POST', form: { reason: 'nonsense' } });
check('a reason is needed', r.status === 400, String(r.status));
const beforeReport = Date.now();
r = await page(`/reviews/${rev.id}/report`, { cookie: cookie.b, method: 'POST', form: { reason: 'offensive', details: `Rude ${run}` } });
check('another person reports it, as themselves',
  r.status === 302 && (await sql`select reporter_side from review_report where review_id = ${rev.id} and reporter_user_id = ${ids.b}`)[0]?.reporter_side === 'consumer',
  String(r.status));
const reportMail = await waitFor(
  async () => (await mailFor('supportlocalites@gmail.com')).filter((m) => m.at > beforeReport && m.subject === `A review of ${V.name} was reported`),
  (l) => l.length > 0,
);
check('the team is emailed, with a link, never the reporter’s words', reportMail.length === 1 && reportMail[0].body.includes(`/admin/reviews/${rev.id}`) && !reportMail[0].body.includes(`Rude ${run}`));
r = await page(`/reviews/${rev.id}/report`, { cookie: cookie.b, method: 'POST', form: { reason: 'offensive' } });
check('…once while it’s open', r.status === 409 && words(r.body).includes('already reported'), String(r.status));
r = await page(`/vendors/${V.slug}/reviews/${rev.id}/report`, { cookie: cookie.b });
check('someone not on the business’s team can’t report as the business', r.status === 404, String(r.status));
r = await page(`/vendors/${V.slug}/reviews`, { cookie: cookie.s });
check('the business’s page offers "Report this review"', r.body.includes(`/vendors/${V.slug}/reviews/${rev.id}/report`));
r = await page(`/vendors/${V.slug}/reviews/${rev.id}/report`, { cookie: cookie.s, method: 'POST', form: { reason: 'not_genuine' } });
check('anyone on its team reports it as the business; the team isn’t emailed twice',
  r.status === 302 && (await sql`select team_email_status from review_report where review_id = ${rev.id} and reporter_user_id = ${ids.s}`)[0]?.team_email_status === 'not_needed',
  String(r.status));
r = await page('/admin/reviews', { cookie: cookie.m });
const reportedList = /aria-label="Reported reviews"[\s\S]*?<\/ul>/.exec(r.body)?.[0] ?? '';
check('the team sees it under Reported, with 2 open reports', reportedList.includes(`/admin/reviews/${rev.id}`) && words(reportedList).includes(`${V.name}`) && words(reportedList).includes('2 open reports'));
r = await page(`/admin/reviews/${rev.id}`, { cookie: cookie.m });
check('…and each report, its reason, words and who sent it', words(r.body).includes('It’s abusive or offensive') && words(r.body).includes(`Rude ${run}`) && words(r.body).includes('(the business)'));
r = await page(`/admin/reviews/${rev.id}`, { cookie: cookie.o, method: 'POST', form: { intent: 'dismiss_reports', reason: 'mine' } });
check('only the team closes reports (403)', r.status === 403, String(r.status));
r = await page(`/admin/reviews/${rev.id}`, { cookie: cookie.m, method: 'POST', form: { intent: 'dismiss_reports', reason: `Honest review ${run}` } });
check('the team keeps the review and closes the reports, recorded',
  r.status === 302 && (await sql`select count(*)::int as n from review_report where review_id = ${rev.id} and status = 'open'`)[0].n === 0 &&
    (await sql`select count(*)::int as n from audit_log where action = 'review.dismiss_reports' and subject_id = ${rev.id}`)[0].n === 1,
  String(r.status));

// ------------------------------------------------------------------ 4. The team removes
r = await page(`/admin/reviews/${rev.id}`, { cookie: cookie.m, method: 'POST', form: { intent: 'remove_reply', reason: `Off topic ${run}` } });
r = await page(`/vendors/${V.slug}`);
check('the team removes the reply, with a reason: it’s no longer shown', !words(r.body).includes(REPLY) && words(r.body).includes(`${BODY}!`));
r = await page(`/vendors/${V.slug}/reviews`, { cookie: cookie.o });
check('…and the business isn’t offered a second reply', r.status === 200 && !r.body.includes('name="reply"'), String(r.status));
r = await page(`/admin/reviews/${rev.id}`, { cookie: cookie.m, method: 'POST', form: { intent: 'remove', reason: `Personal details ${run}` } });
r = await page(`/vendors/${V.slug}`);
check('…and the review, with a reason: it’s no longer shown', !r.body.includes(`${BODY}!`) && words(r.body).includes('No reviews yet'));
r = await page(REVIEW(past), { cookie: cookie.a });
check('the author is told it was removed, and why', words(r.body).includes('Our team removed your review') && words(r.body).includes(`Personal details ${run}`));

// ------------------------------------------------------------------ 5. "How was it?" emails (part 2)
// Locally, earlier runs' emails count towards the site's 20 a day: move them to yesterday.
await sql`update notification set created_at = created_at - interval '1 day'
          where kind in ('review_request', 'review_reminder') and created_at > now() - interval '1 day'`;
async function bEvent(daysAgo) {
  const [e] = await sql`
    insert into event (host_user_id, event_date, municipality_id) values (${ids.b}, current_date - ${daysAgo}::int, ${town.id}) returning id`;
  await sql`insert into event_private (event_id, host_user_id, title) values (${e.id}, ${ids.b}, ${`Secret title ${run}`})`;
  const [row] = await sql`
    insert into event_vendor (event_id, host_user_id, vendor_id, status, booked_at)
    values (${e.id}, ${ids.b}, ${V.id}, 'booked', now() - interval '20 days') returning id`;
  return { id: e.id, row: row.id };
}
const bPast = await bEvent(2);
const beforeAsk = Date.now();
await site('/cdn-cgi/handler/scheduled?cron=0+12+*+*+*');
const askMail = await waitFor(async () => (await mailFor(email('b'))).filter((m) => m.at > beforeAsk && m.subject.startsWith('How was your event')), (l) => l.length > 0, 15000);
check('the morning after: the host is asked how it went, with a link to review the business',
  askMail.length === 1 && askMail[0].body.includes(`/events/${bPast.id}/review/${bPast.row}`) && askMail[0].body.includes('/account#emails'));
check('…never the event’s name', askMail.length === 1 && !askMail[0].body.includes(`Secret title ${run}`) && !askMail[0].subject.includes('Secret'));
await site('/cdn-cgi/handler/scheduled?cron=0+14+*+*+*');
await new Promise((res) => setTimeout(res, 1500));
check('…once (the second morning run doesn’t send it again)',
  (await mailFor(email('b'))).filter((m) => m.at > beforeAsk && m.subject.startsWith('How was your event')).length === 1);
r = await page('/account', { cookie: cookie.b });
check('the account page has the choice, on by default', r.status === 200 && /name="reviewRequests"[^>]*checked/.test(r.body));
r = await page('/account', { cookie: cookie.b, method: 'POST', form: { intent: 'emails' } });
check('the person turns them off', r.status === 302 && (await sql`select review_requests from email_choice where user_id = ${ids.b}`)[0]?.review_requests === false, String(r.status));
r = await page('/account', { cookie: cookie.b });
check('…and the page says so', !/name="reviewRequests"[^>]*checked/.test(r.body));
await bEvent(3);
const beforeOff = Date.now();
await site('/cdn-cgi/handler/scheduled?cron=0+12+*+*+*');
await new Promise((res) => setTimeout(res, 2000));
check('turned off: no more "How was it?" emails',
  (await mailFor(email('b'))).filter((m) => m.at > beforeOff && /How was your event|A reminder/.test(m.subject)).length === 0);
r = await page('/account', { cookie: cookie.b, method: 'POST', form: { intent: 'emails', reviewRequests: 'on' } });
check('…and back on', r.status === 302 && (await sql`select review_requests from email_choice where user_id = ${ids.b}`)[0]?.review_requests === true, String(r.status));

// ------------------------------------------------------------------ 6. Approve or deny from the email (D-51)
const bDeny = await bEvent(4);
const beforeDeny = Date.now();
r = await page(`/events/${bDeny.id}/review/${bDeny.row}`, { cookie: cookie.b, method: 'POST', form: { rating: '2', body: `Not for us ${run}` } });
const [denyRev] = await sql`select id from review where event_vendor_id = ${bDeny.row}`;
const denyMail = await waitFor(
  async () => (await mailFor('supportlocalites@gmail.com')).filter((m) => m.at > beforeDeny && m.subject === `New review of ${V.name} to check`),
  (l) => l.length > 0,
);
check('the team’s email has an Approve and a Deny link to the review',
  denyMail.length === 1 && denyMail[0].body.includes(`/admin/reviews/${denyRev.id}?choose=approve`) && denyMail[0].body.includes(`/admin/reviews/${denyRev.id}?choose=deny`));
r = await page(`/admin/reviews/${denyRev.id}?choose=deny`, { cookie: cookie.b });
check('the Deny link is no use to anyone not on the team (403)', r.status === 403, String(r.status));
r = await page(`/admin/reviews/${denyRev.id}?choose=deny`, { cookie: cookie.m });
check('the Deny link opens the review with one button to confirm', r.status === 200 && words(r.body).includes('Deny this review?') && words(r.body).includes(`Not for us ${run}`) && !/value="publish"/.test(r.body));
r = await page(`/admin/reviews/${denyRev.id}?choose=approve`, { cookie: cookie.m });
check('the Approve link likewise', r.status === 200 && words(r.body).includes('Approve this review?') && !/value="decline"/.test(r.body));
const seenDeny = /name="seen" value="([^"]+)"/.exec(r.body)?.[1] ?? '';
r = await page(`/admin/reviews/${denyRev.id}`, { cookie: cookie.m, method: 'POST', form: { intent: 'decline', seen: seenDeny } });
const [denied] = await sql`select status, decision_reason from review where id = ${denyRev.id}`;
check('the team denies it, no reason needed (recorded for the team)', r.status === 302 && denied.status === 'declined' && denied.decision_reason === 'Denied by the team', String(r.status));
check('…in the audit log', (await sql`select count(*)::int as n from audit_log where action = 'review.decline' and subject_id = ${denyRev.id}`)[0].n === 1);
await new Promise((res) => setTimeout(res, 1500));
check('its author isn’t emailed', (await mailFor(email('b'))).filter((m) => m.at > beforeDeny && /review/i.test(m.subject)).length === 0);
r = await page(`/events/${bDeny.id}`, { cookie: cookie.b });
check('…their event plan shows nothing about it, and doesn’t offer to review again',
  r.status === 200 && !words(r.body).includes('Your review') && !r.body.includes(`/review/${bDeny.row}`));
r = await page(`/events/${bDeny.id}/review/${bDeny.row}`, { cookie: cookie.b });
check('…the review page shows neither the review nor that it was denied',
  r.status === 200 && !words(r.body).includes(`Not for us ${run}`) && !/didn’t publish|declined|denied/i.test(words(r.body)) && !r.body.includes('name="body"'));
r = await page(`/events/${bDeny.id}/review/${bDeny.row}`, { cookie: cookie.b, method: 'POST', form: { rating: '5', body: `Second try ${run}` } });
check('…sending the form anyway gets the plain "can’t be reviewed", never a hint the team looked at it',
  r.status === 409 && words(r.body).includes('This booking can’t be reviewed') && !/looked at it/.test(words(r.body)) &&
    (await sql`select body from review where id = ${denyRev.id}`)[0].body === `Not for us ${run}`, String(r.status));
r = await page(`/vendors/${V.slug}`);
check('…and the public never sees it', !r.body.includes(`Not for us ${run}`));
r = await page(`/admin/reviews/${rev.id}`, { cookie: cookie.m, method: 'POST', form: { intent: 'remove', reason: '' } });
check('removing a published review still needs a reason', r.status === 400, String(r.status));

// ------------------------------------------------------------------ 7. Wording (D-16, D-24)
const banned = /book now|booking confirmed|deposit|checkout|pay now|payment received/i;
const wrong = seen.filter((s) => banned.test(words(s.body)));
check('no page suggests paying through Localites', wrong.length === 0, wrong.map((s) => s.path).join(', '));

await finish('review');
