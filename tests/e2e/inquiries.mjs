// Inquire (screen C10, ADR-024, D-04, D-05): on a business that isn't on Localites yet, a
// signed-in person tells the team they're interested, with an optional note and event. The
// team is emailed (honestly recorded, even when the email fails); the business is sent
// nothing; the person is told when it joins. Only the person and the team see an inquiry.
// The site reaches the database as app_server, so the database's rules are really tested.
//
// Usage: npm run test:e2e
import { account, check, cookieFor, finish, MAIL, mailFor, passwordSession, run, site, sql, twoStepSession } from './helpers.mjs';

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
async function listing(label, { claim = 'unclaimed', status = 'published' } = {}) {
  const [v] = await sql`
    insert into vendor (slug, display_name, primary_municipality_id, website_url, public_phone, listing_status, published_at, claim_status, source)
    values (${`e2e-inq-${label}-${run}`}, ${`Inquiry ${label} ${run}`}, ${town.id}, 'https://inquiry.example/', '705 555 0101', ${status},
            now(), ${claim}, 'admin_entered')
    returning id, slug::text as slug, display_name as name`;
  return v;
}
const U = await listing('unclaimed');
const U2 = await listing('second');
const U3 = await listing('third');
const U4 = await listing('fourth');
const U5 = await listing('fifth');
const X = await listing('own');
const C = await listing('claimed', { claim: 'claimed' });
const H = await listing('hidden', { status: 'unpublished' });

const email = (who) => `e2e-inq-${who}-${run}@example.test`;
const TEAM = 'supportlocalites@gmail.com';
const ids = {};
for (const who of ['a', 'b', 'd', 'o', 'm', 'n']) ids[who] = await account(email(who));
await sql`update app_user set display_name = ${`Ava Asker ${run}`} where id = ${ids.a}`;
await sql`insert into platform_role (user_id, role) values (${ids.m}, 'admin')`;
await sql`insert into vendor_member (vendor_id, user_id, role) values (${C.id}, ${ids.o}, 'owner'), (${X.id}, ${ids.o}, 'manager')`;
const cookie = {};
for (const who of ['a', 'b', 'd', 'o', 'n']) cookie[who] = cookieFor(await passwordSession(email(who)));
cookie.m = cookieFor(await twoStepSession(email('m')));

const date = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10);
const SECRET_TITLE = `SECRET-INQ-TITLE-${run}`;
async function newEvent(who, title) {
  const r = await site('/events/new', { cookie: cookie[who], method: 'POST', form: { intent: 'create', title, typeId: 'none', date, townId: town.id, guests: '25' } });
  return /^\/events\/([0-9a-f-]{36})/.exec(r.location ?? '')?.[1];
}
const aEvent = await newEvent('a', SECRET_TITLE);
const bEvent = await newEvent('b', `B party ${run}`);
const rowOf = async (vendorId, userId) =>
  (await sql`select note, shared_event, team_email_status, team_email_error, notified_joined_at from vendor_interest where vendor_id = ${vendorId} and user_id = ${userId}`)[0];
const teamMail = async () => (await mailFor(TEAM)).filter((m) => m.subject.includes(run));

console.log('Inquire');

// ------------------------------------------------------------------ 1. Who sees Inquire
let r = await page(`/vendors/${U.slug}`);
check('a business not on Localites yet offers Inquire', r.status === 200 && r.body.includes(`/vendors/${U.slug}/inquire`), String(r.status));
r = await page(`/vendors/${C.slug}`);
check('a business on Localites doesn’t', r.status === 200 && !r.body.includes('/inquire'), String(r.status));
r = await page(`/vendors/${U.slug}/inquire`);
check('signed out: Inquire asks you to sign in, then comes back',
  [302, 303].includes(r.status) && r.location === `/join?next=${encodeURIComponent(`/vendors/${U.slug}/inquire`)}`, `${r.status} ${r.location}`);
r = await page(`/vendors/${U.slug}/inquire`, { method: 'POST', form: { note: 'hi' } });
check('signed out: nothing is saved', [302, 303].includes(r.status) && !(await rowOf(U.id, ids.a)), String(r.status));

// ------------------------------------------------------------------ 2. Asking
r = await page(`/vendors/${U.slug}/inquire`, { cookie: cookie.a });
let text = words(r.body);
check('the page says the business isn’t on Localites and exactly what the team receives',
  r.status === 200 && text.includes('isn’t on Localites yet, so you can’t message them here') && text.includes('The business isn’t sent anything'),
  String(r.status));
check('…and offers the person’s own events to mention', r.body.includes(aEvent) && text.includes(SECRET_TITLE) && !r.body.includes(bEvent));
const NOTE = `Do you deliver to the lake? ${run}`;
r = await page(`/vendors/${U.slug}/inquire`, { cookie: cookie.a, method: 'POST', form: { note: NOTE, eventId: aEvent } });
let row = await rowOf(U.id, ids.a);
check('sent: saved, with the event as a summary (never its name), and the team email recorded as sent',
  r.status === 302 && r.location === `/vendors/${U.slug}/inquire?sent=1` && row?.note === NOTE && row?.team_email_status === 'sent' &&
    row.shared_event.includes(town.name) && row.shared_event.includes('about 25 guests') && !row.shared_event.includes(SECRET_TITLE),
  `${r.status} ${r.location} ${JSON.stringify(row)}`);
const mail1 = (await teamMail()).find((m) => m.subject === `Inquiry about ${U.name}`);
check('the team is emailed: the business, who, their note and event summary; replies reach the person',
  mail1 && mail1.body.includes(email('a')) && mail1.body.includes(NOTE) && mail1.body.includes('about 25 guests') && mail1.replyTo === email('a'),
  JSON.stringify(mail1 ?? null).slice(0, 300));
check('…never the event’s name', mail1 && !mail1.body.includes(SECRET_TITLE));
r = await page(`/vendors/${U.slug}/inquire?sent=1`, { cookie: cookie.a });
text = words(r.body);
check('the person is told plainly what happens next (ADR-024’s words)',
  text.includes('We’ve passed your interest to our team, who’ll get in touch with them. We’ll let you know if they join.') && text.includes('Sent to our team.'));
r = await page(`/vendors/${U.slug}/inquire`, { cookie: cookie.a, method: 'POST', form: { note: 'again' } });
check('once per business: a second one is refused in plain words, and the first is kept',
  r.status === 409 && words(r.body).includes('You’ve already told us you’re interested in this business.') && (await rowOf(U.id, ids.a))?.note === NOTE,
  String(r.status));

// ------------------------------------------------------------------ 3. Refusals
r = await page(`/vendors/${C.slug}/inquire`, { cookie: cookie.a });
check('a business on Localites: the page goes back to its own page', [302, 303].includes(r.status) && r.location === `/vendors/${C.slug}`, `${r.status} ${r.location}`);
r = await page(`/vendors/${C.slug}/inquire`, { cookie: cookie.a, method: 'POST', form: { note: 'x' } });
check('…and sending anyway is refused (back to its page), nothing saved',
  [302, 303].includes(r.status) && r.location === `/vendors/${C.slug}` && !(await rowOf(C.id, ids.a)), `${r.status} ${r.location}`);
r = await page(`/vendors/${H.slug}/inquire`, { cookie: cookie.a });
check('a business that isn’t listed is "not found"', r.status === 404, String(r.status));
r = await page(`/vendors/${U2.slug}/inquire`, { cookie: cookie.a, method: 'POST', form: { eventId: bEvent } });
check('someone else’s event can’t be mentioned: refused, nothing saved', r.status === 409 && !(await rowOf(U2.id, ids.a)), String(r.status));
r = await page(`/vendors/${U2.slug}/inquire`, { cookie: cookie.a, method: 'POST', form: { note: 'x'.repeat(1001) } });
check('a note over 1,000 characters is refused', r.status === 400 && !(await rowOf(U2.id, ids.a)), String(r.status));
r = await page(`/vendors/${X.slug}/inquire`, { cookie: cookie.o });
check('on your own business (not yet joined), the page says so and offers no form',
  r.status === 200 && words(r.body).includes('This is your own business.') && !r.body.includes('name="note"'), String(r.status));
r = await page(`/vendors/${X.slug}/inquire`, { cookie: cookie.o, method: 'POST', form: { note: 'x' } });
check('…and sending anyway is refused, nothing saved', r.status === 409 && !(await rowOf(X.id, ids.o)), String(r.status));

// ------------------------------------------------------------------ 4. The email fails: said honestly, and can be sent again
/** Runs with the pretend email service refusing every email, and always turns it back on. */
async function emailDown(fn) {
  await fetch(`${MAIL}/emails/fail?on=1`, { method: 'POST' });
  try {
    return await fn();
  } finally {
    await fetch(`${MAIL}/emails/fail?on=0`, { method: 'POST' });
  }
}
r = await emailDown(() => page(`/vendors/${U2.slug}/inquire`, { cookie: cookie.b, method: 'POST', form: { note: `First try ${run}` } }));
row = await rowOf(U2.id, ids.b);
check('when the team email fails, the inquiry is kept and recorded as failed, with the reason',
  r.status === 302 && r.location === `/vendors/${U2.slug}/inquire` && row?.team_email_status === 'failed' && Boolean(row.team_email_error),
  `${r.status} ${r.location} ${JSON.stringify(row)}`);
r = await page(`/vendors/${U2.slug}/inquire`, { cookie: cookie.b });
check('…the person is told so, and can try again', words(r.body).includes('couldn’t email our team just now') && words(r.body).includes('Try sending again'));
r = await page(`/vendors/${U2.slug}/inquire`, { cookie: cookie.b, method: 'POST', form: { note: `Second try ${run}`, eventId: bEvent } });
row = await rowOf(U2.id, ids.b);
check('sent again: the email goes and the new note is kept',
  r.status === 302 && row?.team_email_status === 'sent' && row.note === `Second try ${run}` && (await teamMail()).some((m) => m.body.includes(`Second try ${run}`)),
  `${r.status} ${JSON.stringify(row)}`);

// An email interrupted (left "pending" over 10 minutes) counts as failed: it can be sent again.
await sql`insert into vendor_interest (vendor_id, user_id, note, updated_at) values (${U5.id}, ${ids.b}, 'Interrupted', now() - interval '15 minutes')`;
r = await page(`/vendors/${U5.slug}/inquire`, { cookie: cookie.b });
check('an interrupted email is shown as not sent, with Try sending again', words(r.body).includes('couldn’t email our team just now') && words(r.body).includes('Try sending again'));
r = await page(`/vendors/${U5.slug}/inquire`, { cookie: cookie.b, method: 'POST', form: { note: `After interruption ${run}` } });
check('…and sending again works', r.status === 302 && (await rowOf(U5.id, ids.b))?.team_email_status === 'sent', String(r.status));

// A failed email, then the business joins: no sending again, and the page says it joined.
r = await emailDown(() => page(`/vendors/${U4.slug}/inquire`, { cookie: cookie.a, method: 'POST', form: { note: `Before it joined ${run}` } }));
await sql`update vendor set claim_status = 'claimed' where id = ${U4.id}`;
r = await page(`/vendors/${U4.slug}/inquire`, { cookie: cookie.a });
check('once the business has joined, the page says so and offers no form',
  words(r.body).includes(`${U4.name} has joined Localites.`) && !r.body.includes('Try sending again'));
r = await page(`/vendors/${U4.slug}/inquire`, { cookie: cookie.a, method: 'POST', form: { note: 'again' } });
check('…and sending again is refused; the team isn’t emailed about a business that joined',
  r.status === 409 && !(await teamMail()).some((m) => m.subject === `Inquiry about ${U4.name}`), String(r.status));

// ------------------------------------------------------------------ 5. A daily limit
const many = [];
for (let i = 0; i < 10; i++) many.push(await listing(`many${i}`));
await sql`insert into vendor_interest (vendor_id, user_id) select unnest(${many.slice(0, 10).map((v) => v.id)}::uuid[]), ${ids.d}`;
const extra = await listing('eleventh');
r = await page(`/vendors/${extra.slug}/inquire`, { cookie: cookie.d, method: 'POST', form: {} });
check('the 11th inquiry in a day is refused (429), in plain words',
  r.status === 429 && words(r.body).includes('You’ve sent a lot of inquiries today.') && !(await rowOf(extra.id, ids.d)), String(r.status));

// ------------------------------------------------------------------ 6. The team's list
const views = async () => (await sql`select count(*)::int as n from audit_log where action = 'vendor_interest.list_view' and actor_user_id = ${ids.m}`)[0].n;
r = await page('/admin/inquiries', { cookie: cookie.m });
text = words(r.body);
check('the team’s Inquiries page lists who asked about which business, their note and event',
  r.status === 200 && text.includes(U.name) && text.includes(email('a')) && text.includes(NOTE) && text.includes('about 25 guests'), String(r.status));
check('…never the event’s name', !r.body.includes(SECRET_TITLE));
check('…the team menu counts the inquiries waiting', /Inquiries \(\d+ waiting\)/.test(text));
check('…and each look is recorded', (await views()) === 1);
for (const [who, c] of [['a person', cookie.a], ['a business owner', cookie.o], ['someone not on the team', cookie.n]]) {
  r = await page('/admin/inquiries', { cookie: c });
  check(`${who}: the team’s Inquiries page is refused (403)`, r.status === 403 && !r.body.includes(NOTE), String(r.status));
}
r = await page(`/vendors/${U.slug}/inquire`, { cookie: cookie.b });
check('another person sees nothing of the first person’s inquiry', r.status === 200 && !r.body.includes(NOTE) && !words(r.body).includes('You told us on'));

// ------------------------------------------------------------------ 7. The business joins
const [claimant] = await sql`select id from app_user where id = ${ids.n}`;
const [claimRow] = await sql`
  insert into vendor_claim (vendor_id, claimant_user_id, relationship, status) values (${U.id}, ${claimant.id}, 'owner', 'submitted') returning id`;
r = await page('/admin/claims', { cookie: cookie.m, method: 'POST', form: { intent: 'approve', id: claimRow.id, check: 'phoned_business' } });
const joined = await waitFor(() => mailFor(email('a')), (list) => list.some((m) => m.subject === `${U.name} has joined Localites`));
check('when the team approves its claim, the person who asked is emailed that it joined',
  r.status === 302 && joined.some((m) => m.subject === `${U.name} has joined Localites` && m.body.includes(`/vendors/${U.slug}`)), String(r.status));
row = await waitFor(() => rowOf(U.id, ids.a), (x) => Boolean(x?.notified_joined_at));
const [told] = await sql`select status from notification where kind = 'vendor_joined' and user_id = ${ids.a}`;
check('…recorded honestly, and marked so they’re told only once', Boolean(row?.notified_joined_at) && told?.status === 'sent', JSON.stringify(told));
r = await page(`/vendors/${U.slug}/inquire`, { cookie: cookie.a });
check('the person’s Inquire page now says it joined', words(r.body).includes(`${U.name} has joined Localites.`));
r = await page(`/vendors/${U.slug}`);
check('…and the business’s page no longer offers Inquire', !r.body.includes(`/vendors/${U.slug}/inquire`));

// The "it joined" email fails: recorded as failed, and the team's page says so.
await page(`/vendors/${U3.slug}/inquire`, { cookie: cookie.b, method: 'POST', form: { note: `About three ${run}` } });
const [claim3] = await sql`
  insert into vendor_claim (vendor_id, claimant_user_id, relationship, status) values (${U3.id}, ${ids.o}, 'owner', 'submitted') returning id`;
await emailDown(async () => {
  await page('/admin/claims', { cookie: cookie.m, method: 'POST', form: { intent: 'approve', id: claim3.id, check: 'phoned_business' } });
  return waitFor(
    () => sql`select n.status from notification n join vendor_interest vi on vi.id = n.subject_id where n.kind = 'vendor_joined' and vi.vendor_id = ${U3.id}`,
    (rows) => rows.length > 0 && rows[0].status !== 'queued',
  );
});
const [joinedFail] = await sql`select n.status, n.failure_reason from notification n join vendor_interest vi on vi.id = n.subject_id
  where n.kind = 'vendor_joined' and vi.vendor_id = ${U3.id}`;
check('when the "it joined" email fails, it’s recorded as failed with the reason', joinedFail?.status === 'failed' && Boolean(joinedFail.failure_reason), JSON.stringify(joinedFail));
r = await page('/admin/inquiries?show=all', { cookie: cookie.m });
check('…and the team’s page says so, so they can email the person themselves', words(r.body).includes('“It joined” email failed: email them yourself'));

// ------------------------------------------------------------------ 8. Wording (D-16, D-24; ADR-024)
const banned = /book now|booking confirmed|deposit|checkout|confirmed|message sent|we('|’)ve sent your message|delivered/i;
const wrong = seen.filter((s) => banned.test(words(s.body)));
check('no page suggests the business received a message, or any payment', wrong.length === 0,
  wrong.map((s) => `${s.path}: ${banned.exec(words(s.body))?.[0]}`).slice(0, 5).join('; '));

await finish('inquiry');
