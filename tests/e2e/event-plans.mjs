// Planning an event (slice 2A: D-13, D-39–D-43, ADR-031): only the person sees their event;
// a business marked booked sees the person's name, the date, the town and about how many
// guests, nothing else (D-40); a business can say a booking isn't right, and the team and
// the person are told, never the note to the person (D-41); planning counts are for the
// team only (D-42); the team's ideas and featured businesses per kind of event (D-43).
// The site reaches the database as app_server, so the database's rules are really tested.
// Emails go to the pretend email service (EMAIL_API_URL). Settings: tests/e2e/helpers.mjs.
//
// Usage: npm run test:e2e
import { account, check, cookieFor, finish, mailFor, passwordSession, run, site as visit, sql, twoStepSession } from './helpers.mjs';

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** A page's words as a person reads them (no tags, no React's text separators). */
const words = (html) => decode(html.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ');
/** Work done after the page answered (emails, records): waits until it shows, up to 5 seconds. */
async function waitFor(read, done, ms = 5000) {
  const end = Date.now() + ms;
  let value = await read();
  while (!done(value) && Date.now() < end) {
    await new Promise((res) => setTimeout(res, 150));
    value = await read();
  }
  return value;
}
// Every page and email in the run, for the wording check at the end (D-16, D-24).
const seen = [];
async function site(path, options) {
  const r = await visit(path, options);
  seen.push({ path, body: r.body });
  return r;
}
async function mail(email) {
  const list = await mailFor(email);
  for (const m of list) seen.push({ path: `email to ${email}`, body: `${m.subject}\n${m.body}` });
  return list;
}

// ------------------------------------------------------------------ dates, as the pages write them
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const torontoDay = async (offset) => (await sql`select ((now() at time zone 'America/Toronto')::date + ${offset}::int)::text as d`)[0].d;
const parts = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return { weekday: d.getUTCDay(), day: d.getUTCDate(), month: d.getUTCMonth() };
};
/** "14 November" (the long date in emails also has the weekday, and the year if it isn't this year). */
const dayMonth = (iso) => `${parts(iso).day} ${MONTHS[parts(iso).month]}`;
/** "Sat 14 Nov", as V8 shows it. */
const shortDay = (iso) => `${WEEKDAYS[parts(iso).weekday].slice(0, 3)} ${parts(iso).day} ${MONTHS[parts(iso).month].slice(0, 3)}`;
const today = await torontoDay(0);
const eventDate = await torontoDay(20);
const movedDate = await torontoDay(21);
const tooOld = await torontoDay(-61);

// ------------------------------------------------------------------ set-up
const [orillia] = await sql`select id, name from municipality where is_active order by (name = 'Orillia') desc, sort_order limit 1`;
const [otherTown] = await sql`select id, name from municipality where is_active and id <> ${orillia.id} order by sort_order limit 1`;
const suggested = await sql`select id, slug::text as slug, name from category where is_active order by sort_order limit 2`;
async function listing(label, claim = 'claimed') {
  const [v] = await sql`
    insert into vendor (slug, display_name, primary_municipality_id, website_url, public_phone, listing_status, published_at, claim_status, source)
    values (${`e2e-plan-${label}-${run}`}, ${`Plan ${label} ${run}`}, ${orillia.id}, 'https://plans.example/', '705 555 0100', 'published', now(), ${claim}, 'admin_entered')
    returning id, slug::text as slug, display_name as name`;
  await sql`insert into vendor_category (vendor_id, category_id, is_primary) values (${v.id}, ${suggested[0].id}, true)`;
  return v;
}
const V = await listing('cakes');
const Y = await listing('balloons');
const U = await listing('unclaimed', 'unclaimed');
const W = await listing('ended');
const X = await listing('expired');
const Z = await listing('hidden');

const email = (who) => `e2e-plan-${who}-${run}@example.test`;
const TEAM = 'supportlocalites@gmail.com';
const ids = {};
for (const who of ['a', 'b', 'c', 'd', 'o', 'o2', 's', 'm', 'n']) ids[who] = await account(email(who));
const A_NAME = `Ava Planner ${run}`;
await sql`update app_user set display_name = ${A_NAME} where id = ${ids.a}`;
await sql`insert into platform_role (user_id, role) values (${ids.m}, 'admin')`;
await sql`insert into vendor_member (vendor_id, user_id, role) values (${V.id}, ${ids.o}, 'owner'), (${Y.id}, ${ids.o2}, 'owner'), (${V.id}, ${ids.s}, 'staff')`;
const cookie = {};
for (const who of ['a', 'b', 'c', 'd', 'o', 'o2', 's', 'n']) cookie[who] = cookieFor(await passwordSession(email(who)));
cookie.m = cookieFor(await twoStepSession(email('m')));

const SECRETS = [`SECRET-TITLE-${run}`, `SECRET-VENUE-${run}`, `SECRET-NOTE-${run}`];
const TEAM_NOTE = `TEAM-NOTE-${run}`;
const FLAG_NOTE = `FLAG-NOTE-${run}`;
// The budget as a number on its own (not inside a random code or another test's name).
const BUDGET = /(?<![\w-])4,?321(?![\w-])/;
const privateIn = (body) => [...[...SECRETS, email('a')].filter((s) => body.includes(s)), ...(BUDGET.test(body) ? ['the budget'] : [])];
const audits = async (action, subject) => (await sql`select count(*)::int as n from audit_log where action = ${action} and subject_id = ${subject}`)[0].n;
const rowOf = async (eventId, vendorId) =>
  (await sql`select id, status, vendor_flagged_at from event_vendor where event_id = ${eventId} and vendor_id = ${vendorId}`)[0];
const notes = (subjectId, kind) =>
  sql`select user_id, status from notification where subject_type = 'event_vendor' and subject_id = ${subjectId} and kind = ${kind} order by created_at`;
const settled = (rows) => rows.length > 0 && rows.every((n) => n.status !== 'queued');
/** The morning run (D-53): booking emails waiting for the summary go out, one email per person. */
async function morning() {
  const before = Date.now();
  await site('/cdn-cgi/handler/scheduled?cron=0+12+*+*+*');
  return before;
}
const summaryFor = async (who, since) => {
  const list = await waitFor(() => mail(email(who)), (m) => m.some((x) => x.at > since && x.subject.startsWith('Your Localites bookings')));
  return list.filter((x) => x.at > since && x.subject.startsWith('Your Localites bookings'));
};
const BOOKINGS = `/vendors/${V.slug}/bookings`;

console.log('Planning an event');

// ------------------------------------------------------------------ 1. Gate
for (const path of ['/events', '/events/new', '/saved', `/vendors/${V.slug}/add`, '/business', BOOKINGS]) {
  const r = await site(path);
  check(`signed out: ${path} asks you to sign in, then comes back`, [302, 303].includes(r.status) && r.location === `/join?next=${encodeURIComponent(path)}`, `${r.status} ${r.location}`);
}
const savesOfV = async () => (await sql`select count(*)::int as n from saved_vendor where vendor_id = ${V.id}`)[0].n;
let r = await site(`/vendors/${V.slug}/add`, { method: 'POST', form: { intent: 'save', return: 'profile' } });
check('signed out: Save sends you to sign in, and nothing is stored', [302, 303].includes(r.status) && r.location.startsWith('/join') && (await savesOfV()) === 0, `${r.status} ${r.location}`);

// ------------------------------------------------------------------ 2. The team sets up a kind of event (D-43)
r = await site('/admin/event-types', { cookie: cookie.n });
check('not on the team: Event types is refused (403)', r.status === 403, String(r.status));
r = await site('/admin/event-types', { cookie: cookie.n, method: 'POST', form: { intent: 'add', name: `Sneaky ${run}`, sortOrder: '1', shown: 'on' } });
check('not on the team: adding a kind of event is refused, and nothing is added',
  r.status === 403 && (await sql`select count(*)::int as n from event_type where name = ${`Sneaky ${run}`}`)[0].n === 0, String(r.status));
r = await site('/admin/booking-flags', { cookie: cookie.n });
check('not on the team: Booking flags is refused (403)', r.status === 403, String(r.status));

const TYPE_NAME = `Garden gala ${run}`;
r = await site('/admin/event-types', { cookie: cookie.m, method: 'POST', form: { intent: 'add', name: TYPE_NAME, sortOrder: '1', shown: 'on' } });
const typeId = /open=([0-9a-f-]{36})/.exec(r.location)?.[1] ?? null;
check('the team adds a kind of event, recorded in the audit log',
  r.status === 302 && Boolean(typeId) && (await audits('event_type.create', typeId)) === 1, `${r.status} ${r.location}`);
const [typeRow] = await sql`select key, is_active from event_type where id = ${typeId}`;
check('its key is made from the name', typeRow?.key === `garden_gala_${run}`, typeRow?.key);
r = await site('/admin/event-types', {
  cookie: cookie.m,
  method: 'POST',
  form: { intent: 'suggestions', typeId, [`cat.${suggested[0].id}`]: 'on', [`order.${suggested[0].id}`]: '10', [`cat.${suggested[1].id}`]: 'on', [`order.${suggested[1].id}`]: '20' },
});
const mapped = await sql`select category_id from event_type_category where event_type_id = ${typeId} order by sort_order`;
check('the team chooses the kinds of business to suggest for it, recorded',
  r.status === 302 && mapped.map((m) => m.category_id).join() === suggested.map((c) => c.id).join() && (await audits('event_type.suggestions', typeId)) === 1,
  `${r.status} ${mapped.length}`);
const ends = await torontoDay(30);
const feature = (v, note = '') =>
  site('/admin/event-types', { cookie: cookie.m, method: 'POST', form: { intent: 'feature', typeId, vendorSlug: v.slug, startsOn: today, endsOn: ends, note } });
r = await feature(V, TEAM_NOTE);
const [placement] = await sql`select id, note, created_by from featured_placement where vendor_id = ${V.id} and event_type_id = ${typeId}`;
check('the team features a business for it between two dates, recorded (no money anywhere)',
  r.status === 302 && placement?.created_by === ids.m && (await audits('featured_placement.create', placement?.id)) === 1, `${r.status} ${r.location}`);
const money = await sql`select column_name from information_schema.columns where table_name = 'featured_placement'
                        and column_name ~ '(price|amount|cents|fee|paid|payment|cost)'`;
check('a featured placement has no money columns', money.length === 0, money.map((c) => c.column_name).join());
await feature(W);
const [wPlacement] = await sql`select id from featured_placement where vendor_id = ${W.id}`;
r = await site('/admin/event-types', { cookie: cookie.m, method: 'POST', form: { intent: 'end', typeId, placementId: wPlacement.id } });
const [wEnded] = await sql`select ended_at, ended_by from featured_placement where id = ${wPlacement.id}`;
check('the team ends a placement early, recorded', r.status === 302 && wEnded.ended_by === ids.m && (await audits('featured_placement.end', wPlacement.id)) === 1, String(r.status));
await feature(Z);
await sql`update vendor set listing_status = 'unpublished' where id = ${Z.id}`;
// One that's already over: the team's page refuses those, so it's put straight in the database.
const [expiredFrom, expiredTo] = [await torontoDay(-20), await torontoDay(-1)];
await sql.begin(async (tx) => {
  await tx`set local session_replication_role = replica`;
  await tx`insert into featured_placement (vendor_id, event_type_id, starts_on, ends_on, created_by)
           values (${X.id}, ${typeId}, ${expiredFrom}, ${expiredTo}, ${ids.m})`;
});
r = await site('/admin/event-types', { cookie: cookie.m });
check('the team’s page lists the placements', r.status === 200 && r.body.includes(V.name) && words(r.body).includes('Showing now') && words(r.body).includes('Ended early'));

// ------------------------------------------------------------------ 3. Planning an event
r = await site('/events/new', { cookie: cookie.a });
check('the form offers the new kind of event, optional, with None chosen',
  r.status === 200 && r.body.includes(`value="${typeId}"`) && words(r.body).includes('What kind of event? (optional)') && /value="none"[^>]*checked|checked[^>]*value="none"/.test(r.body));
r = await site('/events/new', { cookie: cookie.a, method: 'POST', form: { intent: 'create', title: '', typeId: 'none', date: '', townId: '' } });
check('the name, the date and the town are needed, each said plainly',
  r.status === 400 && ['Give your event a name.', 'Choose the date.', 'Choose the town.'].every((m) => words(r.body).includes(m)), String(r.status));
r = await site('/events/new', { cookie: cookie.a, method: 'POST', form: { intent: 'create', title: 'Too old', typeId: 'none', date: tooOld, townId: orillia.id } });
check('a date more than 60 days ago is refused', r.status === 400 && words(r.body).includes('Choose a date in the last 60 days or the next 3 years.'), String(r.status));
const eventsOf = async (who) => (await sql`select count(*)::int as n from event where host_user_id = ${ids[who]}`)[0].n;
r = await site('/events/new', { cookie: cookie.a, method: 'POST', origin: 'https://evil.example', form: { intent: 'create', title: 'Cross-site', typeId: 'none', date: eventDate, townId: orillia.id } });
check('a form sent from another website is refused, and nothing is planned', r.status === 403 && (await eventsOf('a')) === 0, String(r.status));
const eventForm = (changes = {}) => ({
  intent: 'create',
  title: SECRETS[0],
  typeId,
  date: eventDate,
  townId: orillia.id,
  startTime: '13:00',
  endTime: '16:00',
  venueNote: SECRETS[1],
  guests: '15',
  ageMin: '4',
  ageMax: '7',
  budget: '4321',
  notes: SECRETS[2],
  ...changes,
});
r = await site('/events/new', { cookie: cookie.a, method: 'POST', form: eventForm() });
const eventId = /^\/events\/([0-9a-f-]{36})\?created=1$/.exec(r.location)?.[1] ?? null;
check('A plans an event and goes to its plan', r.status === 302 && Boolean(eventId), `${r.status} ${r.location}`);
const PLAN = `/events/${eventId}`;
r = await site(`${PLAN}?created=1`, { cookie: cookie.a });
let plan = words(r.body);
check('the plan shows the name, the kind of event and "Only you can see this"',
  r.status === 200 && plan.includes(SECRETS[0]) && plan.includes(TYPE_NAME) && plan.includes('Only you can see this') && plan.includes(SECRETS[2]));
check('ideas for the kind of event: the heading in plain words', plan.includes(`Ideas for your garden gala ${run}`));
check('the featured business is shown, labelled, with the line saying the team promotes it',
  plan.includes('Featured') && plan.includes('Featured businesses are promoted by the Localites team.') && r.body.includes(`href="/vendors/${V.slug}"`) && r.body.includes(`href="/vendors/${V.slug}/add"`));
check('an ended, an expired and an unpublished placement aren’t shown', ![W.name, X.name, Z.name].some((n) => plan.includes(n)));
check('the team’s note is never shown to the person', !r.body.includes(TEAM_NOTE));
check('"Still to find" links to search by the suggested kinds (D-58)',
  plan.includes('Still to find') && suggested.every((c) => r.body.includes(`href="/search?category=${c.slug}"`)));
r = await site('/events/new', { cookie: cookie.a, method: 'POST', form: { intent: 'create', title: 'No kind given', typeId: 'none', date: eventDate, townId: orillia.id } });
const plainEventId = /^\/events\/([0-9a-f-]{36})/.exec(r.location)?.[1];
r = await site(`/events/${plainEventId}`, { cookie: cookie.a });
check('with no kind of event: one quiet line, linking to Edit details, and no featured businesses',
  r.status === 200 && words(r.body).includes('Tell us what kind of event it is to see ideas.') && r.body.includes(`/events/${plainEventId}/edit`) && !words(r.body).includes('Featured'));

// ------------------------------------------------------------------ 4. C4: add in two taps, and save
r = await site(`/vendors/${V.slug}/add`, { cookie: cookie.a });
check('Add to an event lists A’s events', r.status === 200 && words(r.body).includes(SECRETS[0]) && r.body.includes(`value="${eventId}"`), String(r.status));
r = await site(`/vendors/${V.slug}/add`, { cookie: cookie.a, method: 'POST', form: { intent: 'add', eventId } });
check('"Add to this event" adds it and goes back to the business', r.status === 302 && r.location === `/vendors/${V.slug}?added=${eventId}`, `${r.status} ${r.location}`);
r = await site(`/vendors/${V.slug}/add`, { cookie: cookie.a, method: 'POST', form: { intent: 'add', eventId } });
check('adding it again says it’s already there', r.status === 302 && r.location === `/vendors/${V.slug}?already=${eventId}`, `${r.status} ${r.location}`);
r = await site(`/vendors/${V.slug}/add`, { cookie: cookie.a, method: 'POST', form: { intent: 'save', return: 'profile' } });
check('Save from the business’s page', r.status === 302 && r.location === `/vendors/${V.slug}?saved=1` && (await savesOfV()) === 1, `${r.status} ${r.location}`);
r = await site(`/vendors/${V.slug}?saved=1`, { cookie: cookie.a });
// Since the Base44 design (D-59) the profile's heart shows it's a favourite.
check('the business’s profile shows it as a favourite', r.body.includes('from favourites"'));
r = await site('/saved', { cookie: cookie.a });
check('Your favourites lists it', r.status === 200 && words(r.body).includes(V.name));
for (const v of [Y, U]) await site(`/vendors/${v.slug}/add`, { cookie: cookie.a, method: 'POST', form: { intent: 'add', eventId } });
const vRow = await rowOf(eventId, V.id);
const yRow = await rowOf(eventId, Y.id);
const uRow = await rowOf(eventId, U.id);
check('three businesses are on the plan as Considering', [vRow, yRow, uRow].every((x) => x?.status === 'considering'));
r = await site(PLAN, { cookie: cookie.a });
check('the featured business now says it’s on the plan', words(r.body).includes('On your plan'));
check('adding and saving tell no one: no email to the owner', (await mail(email('o'))).length === 0);
r = await site(BOOKINGS, { cookie: cookie.o });
check('…and the owner’s Bookings marked doesn’t show A while A is only considering', r.status === 200 && !r.body.includes(A_NAME) && words(r.body).includes('No one has marked'), String(r.status));

// ------------------------------------------------------------------ 5. The owner's own business
r = await site('/events/new', { cookie: cookie.o, method: 'POST', form: { intent: 'create', title: `Owner party ${run}`, typeId: 'none', date: eventDate, townId: orillia.id } });
const ownerEventId = /^\/events\/([0-9a-f-]{36})/.exec(r.location)?.[1];
r = await site(`/vendors/${V.slug}/add`, { cookie: cookie.o, method: 'POST', form: { intent: 'add', eventId: ownerEventId } });
check('an owner can’t put their own business on their own plan (409)',
  r.status === 409 && words(r.body).includes('This is your business, so it can’t go on your own event plan.') && !(await rowOf(ownerEventId, V.id)), String(r.status));

// ------------------------------------------------------------------ 6. Mark booked (D-40)
r = await site(`${PLAN}/plan/${vRow.id}/book`, { cookie: cookie.a });
check('Mark as booked asks first, saying the business will be told',
  r.status === 200 && words(r.body).includes(`We’ll let ${V.name} know you’ve marked them as booked`), String(r.status));
check('…and exactly what it will see (every path to sharing passes this page, D-40)',
  words(r.body).includes(`${V.name} will see your name, the date, the town and about how many guests. Never your event’s name`));
r = await site(`${PLAN}/plan/${vRow.id}/book`, { cookie: cookie.a, method: 'POST' });
check('marking booked goes back to the plan', r.status === 302 && r.location === `${PLAN}?booked=${vRow.id}`, `${r.status} ${r.location}`);
let told = await waitFor(() => notes(vRow.id, 'marked_booked'), settled);
check('the owner’s email waits for the morning summary (D-53)', told.length === 1 && told[0].user_id === ids.o && told[0].status === 'waiting', JSON.stringify(told));
let since = await morning();
let summary = await summaryFor('o', since);
told = await notes(vRow.id, 'marked_booked');
check('…the morning run sends it as the summary, recorded as sent', summary.length === 1 && told[0].status === 'sent', `${summary.length} ${JSON.stringify(told)}`);
const booked = summary[0] ? `${summary[0].subject}\n${summary[0].body}` : '';
check('the email says who, the date, the town and about how many guests',
  booked.includes(A_NAME) && booked.includes(dayMonth(eventDate)) && booked.includes(orillia.name) && booked.includes('about 15 guests'), booked);
check('…and nothing private: not the name, kind of event, place, notes, budget, time or A’s email',
  privateIn(booked).length === 0 && !booked.includes(TYPE_NAME) && !booked.includes('1 pm') && !booked.includes('1–4'), privateIn(booked).join());
const [change] = await sql`select actor_user_id, actor_kind from status_change where subject_type = 'event_vendor' and subject_id = ${vRow.id} and field = 'status' and to_status = 'booked'`;
check('the change is recorded by the database: A, as a customer', change?.actor_user_id === ids.a && change?.actor_kind === 'consumer', JSON.stringify(change));

// ------------------------------------------------------------------ 7. Repeats
r = await site(`${PLAN}/plan/${vRow.id}/unbook`, { cookie: cookie.a, method: 'POST' });
told = await waitFor(() => notes(vRow.id, 'booking_unmarked'), settled);
since = await morning();
summary = await summaryFor('o', since);
check('un-marking tells the business it’s no longer marked (next morning)',
  r.status === 302 && told.length === 1 && summary.length === 1 && summary[0].body.includes('no longer has'), `${JSON.stringify(told)} ${summary.length}`);
// Marked and un-marked before the morning: nothing to tell (their last word was "no longer booked").
r = await site(`${PLAN}/plan/${vRow.id}/book`, { cookie: cookie.a, method: 'POST' });
await waitFor(() => notes(vRow.id, 'marked_booked'), (rows) => rows.length === 2 && settled(rows));
r = await site(`${PLAN}/plan/${vRow.id}/unbook`, { cookie: cookie.a, method: 'POST' });
await waitFor(() => notes(vRow.id, 'booking_unmarked'), (rows) => rows.length === 2 && settled(rows));
since = await morning();
await new Promise((res) => setTimeout(res, 1500));
const cancelledOut = await sql`select status, failure_reason from notification where subject_id = ${vRow.id} and kind in ('marked_booked', 'booking_unmarked') order by created_at desc limit 2`;
check('marked and un-marked before the morning: no summary, recorded as cancelled out',
  (await mail(email('o'))).filter((m) => m.at > since).length === 0 && cancelledOut.every((n) => n.status === 'suppressed' && /Cancelled out/.test(n.failure_reason ?? '')), JSON.stringify(cancelledOut));
r = await site(`${PLAN}/plan/${vRow.id}/book`, { cookie: cookie.a, method: 'POST' });
told = await waitFor(() => notes(vRow.id, 'marked_booked'), (rows) => rows.length === 3 && settled(rows));
since = await morning();
summary = await summaryFor('o', since);
// Their last word was "no longer booked", so marking it again is news: they're told (review fix).
check('marking it again after un-marking tells the business again (its last word was “no longer booked”)',
  r.status === 302 && summary.length === 1 && summary[0].body.includes('marked') && (await notes(vRow.id, 'marked_booked')).at(-1).status === 'sent', `${told.map((n) => n.status)} ${summary.length}`);

const [kept] = await sql`select count(*)::int as n from notification where subject_id = ${vRow.id} and summary_line is not null and status <> 'waiting'`;
check('…and once sent or cancelled out, the line (with the person’s name) isn’t kept', kept.n === 0, String(kept.n));
// A line for someone who isn't (or is no longer) on the business's team: dropped at send time.
const [stale] = await sql`
  insert into notification (user_id, kind, subject_type, subject_id, status, summary_line)
  values (${ids.a}, 'marked_booked', 'event_vendor', ${vRow.id}, 'waiting', 'A line for someone who left the team.') returning id`;
since = await morning();
const [dropped] = await waitFor(() => sql`select status, failure_reason, summary_line from notification where id = ${stale.id}`, (x) => x[0]?.status !== 'waiting');
check('someone no longer on the business’s team isn’t sent the summary',
  dropped?.status === 'suppressed' && /No longer on the business/.test(dropped.failure_reason ?? '') && dropped.summary_line === null &&
    (await mail(email('a'))).filter((m) => m.at > since && m.subject.startsWith('Your Localites bookings')).length === 0, JSON.stringify(dropped));

// ------------------------------------------------------------------ 8. A business not on Localites yet
r = await site(`${PLAN}/plan/${uRow.id}/book`, { cookie: cookie.a });
check('marking an unclaimed business booked says it can’t be told', r.status === 200 && words(r.body).includes(`${U.name} isn’t on Localites yet, so we can’t let them know`), String(r.status));
r = await site(`${PLAN}/plan/${uRow.id}/book`, { cookie: cookie.a, method: 'POST' });
await new Promise((res) => setTimeout(res, 500));
check('…and no one is emailed about it', r.status === 302 && (await rowOf(eventId, U.id)).status === 'booked'
  && (await sql`select count(*)::int as n from notification where subject_id = ${uRow.id}`)[0].n === 0, String(r.status));
r = await site(`${PLAN}/cancel`, { cookie: cookie.a });
check('the cancel page promises to tell only the business that can be told, and says which can’t',
  r.status === 200 && words(r.body).includes('We’ll let the business you marked as booked know it’s cancelled.')
  && words(r.body).includes('One business you marked as booked isn’t on Localites yet, so we can’t tell it. Contact it directly.'), String(r.status));

// ------------------------------------------------------------------ 9. Another person's event
const eventState = async () => (await sql`select e.status, e.event_date::text as date, p.title from event e join event_private p on p.event_id = e.id where e.id = ${eventId}`)[0];
const before = { event: await eventState(), rows: (await sql`select id, status from event_vendor where event_id = ${eventId} order by id`).map((x) => `${x.id}:${x.status}`).join() };
const unchanged = async () =>
  JSON.stringify(await eventState()) === JSON.stringify(before.event)
  && (await sql`select id, status from event_vendor where event_id = ${eventId} order by id`).map((x) => `${x.id}:${x.status}`).join() === before.rows;
const changes = ['book', 'unbook', 'remove', 'readd'];
for (const path of [PLAN, `${PLAN}/edit`, `${PLAN}/cancel`, ...changes.map((c) => `${PLAN}/plan/${vRow.id}/${c}`)]) {
  r = await site(path, { cookie: cookie.b });
  check(`another person can’t open ${path.replace(eventId, '<A’s event>').replace(vRow.id, '<row>')} (404)`, r.status === 404 && privateIn(r.body).length === 0, String(r.status));
}
r = await site(`${PLAN}/edit`, { cookie: cookie.b, method: 'POST', form: { ...eventForm({ title: 'Hijacked' }), intent: 'save' } });
check('…nor change its details', r.status === 404, String(r.status));
r = await site(`${PLAN}/cancel`, { cookie: cookie.b, method: 'POST', form: { intent: 'cancel' } });
check('…nor cancel it', r.status === 404, String(r.status));
for (const c of changes) {
  r = await site(`${PLAN}/plan/${vRow.id}/${c}`, { cookie: cookie.b, method: 'POST' });
  check(`…nor ${c} a business on it`, r.status === 404, String(r.status));
}
r = await site(`/vendors/${Y.slug}/add`, { cookie: cookie.b, method: 'POST', form: { intent: 'add', eventId } });
check('…nor add a business to it', r.status === 404, String(r.status));
check('…and A’s event and plan are exactly as they were', await unchanged());
r = await site('/saved', { cookie: cookie.b });
check('another person’s Saved doesn’t list A’s saves', r.status === 200 && !words(r.body).includes(V.name));

// ------------------------------------------------------------------ 10. Another business, and roles
r = await site(BOOKINGS, { cookie: cookie.o2 });
check('another business’s owner can’t see these bookings (404)', r.status === 404 && !r.body.includes(A_NAME), String(r.status));
r = await site(`/vendors/${Y.slug}/bookings`, { cookie: cookie.o2, method: 'POST', form: { intent: 'flag', rowId: vRow.id, note: 'Not mine' } });
check('…nor flag one through their own business', r.status === 404 && (await rowOf(eventId, V.id)).vendor_flagged_at === null, String(r.status));
r = await site(BOOKINGS, { cookie: cookie.o2, method: 'POST', form: { intent: 'flag', rowId: vRow.id, note: 'Not mine' } });
check('…nor through this one', r.status === 404 && (await rowOf(eventId, V.id)).vendor_flagged_at === null, String(r.status));
r = await site(BOOKINGS, { cookie: cookie.s });
check('staff (not an owner or manager) can’t see them, and are told who can', r.status === 403 && !r.body.includes(A_NAME), String(r.status));
r = await site(BOOKINGS, { cookie: cookie.a });
check('the person who marked it can’t open the business’s page (404)', r.status === 404, String(r.status));
r = await site(PLAN, { cookie: cookie.o });
check('the booked business’s owner can’t open the person’s event (404)', r.status === 404 && privateIn(r.body).length === 0, String(r.status));
for (const c of ['unbook', 'remove']) {
  r = await site(`${PLAN}/plan/${vRow.id}/${c}`, { cookie: cookie.o, method: 'POST' });
  check(`…nor ${c} the booking themselves`, r.status === 404, String(r.status));
}
check('…and the plan is unchanged', await unchanged());

// ------------------------------------------------------------------ 11. What the business sees (D-40)
r = await site(BOOKINGS, { cookie: cookie.o });
const v8 = words(r.body);
check('Bookings marked shows the person, the date, the town and about how many guests',
  r.status === 200 && v8.includes(A_NAME) && v8.includes(shortDay(eventDate)) && v8.includes(`${orillia.name} · about 15 guests`), v8.slice(0, 300));
check('…and nothing else: not the name, kind of event, time, place, ages, budget, notes, email or other businesses',
  privateIn(r.body).length === 0 && !r.body.includes(TYPE_NAME) && !r.body.includes(Y.name) && !r.body.includes(U.name) && !v8.includes('1 pm') && !v8.includes('4 to 7'),
  privateIn(r.body).join());
check('the owner’s own planned event isn’t on it', !r.body.includes(`Owner party ${run}`));
r = await site('/business', { cookie: cookie.o });
check('My business lists V with 1 booking marked coming up', r.status === 200 && words(r.body).includes(V.name) && words(r.body).includes('booking marked coming up 1'));
check('…and never the event’s name or kind', privateIn(r.body).length === 0 && !r.body.includes(TYPE_NAME));
r = await site('/events', { cookie: cookie.o });
check('the owner’s My events shows the switch to My business, and only their own event',
  r.body.includes('aria-label="Switch between your events and your business"') && words(r.body).includes(`Owner party ${run}`) && privateIn(r.body).length === 0 && !r.body.includes(A_NAME));
r = await site('/events', { cookie: cookie.a });
check('A’s My events has no switch (not on a business’s team)', r.status === 200 && !r.body.includes('Switch between your events and your business') && words(r.body).includes(SECRETS[0]));

// ------------------------------------------------------------------ 12. "This isn't right" (D-41)
const flagsBefore = (await mail(TEAM)).length;
r = await site(BOOKINGS, { cookie: cookie.o, method: 'POST', form: { intent: 'flag', rowId: vRow.id, note: FLAG_NOTE } });
check('the owner says a booking isn’t right', r.status === 302 && r.location === `${BOOKINGS}?flagged=${vRow.id}` && Boolean((await rowOf(eventId, V.id)).vendor_flagged_at), `${r.status} ${r.location}`);
const [flagChange] = await sql`select actor_user_id, actor_kind from status_change where subject_id = ${vRow.id} and field = 'vendor_flag'`;
check('the flag is recorded by the database, as the business', flagChange?.actor_user_id === ids.o && flagChange?.actor_kind === 'vendor', JSON.stringify(flagChange));
r = await site(`${BOOKINGS}?flagged=${vRow.id}`, { cookie: cookie.o });
check('the page says the team and the person are told', words(r.body).includes(`You told us this isn’t right on ${dayMonth(today)}. We’ve passed it to the Localites team and let ${A_NAME} know.`));
const teamMail = (await waitFor(() => mail(TEAM), (m) => m.length > flagsBefore)).slice(flagsBefore).map((m) => `${m.subject}\n${m.body}`).join('\n');
check('the team is emailed: the business and a link, no note and no person',
  teamMail.includes(V.name) && teamMail.includes('/admin/booking-flags') && !teamMail.includes(FLAG_NOTE) && !teamMail.includes(A_NAME), teamMail);
told = await waitFor(() => notes(vRow.id, 'booking_flagged'), settled);
const personMail = (await waitFor(() => mail(email('a')), (m) => m.some((x) => x.subject.includes('isn’t booked')))).find((x) => x.subject.includes('isn’t booked'));
check('the person is emailed politely, with a link to their plan, recorded as sent',
  told.length === 1 && told[0].user_id === ids.a && told[0].status === 'sent' && personMail?.subject === `${V.name} says it isn’t booked for your event`
  && personMail.body.includes(`/events/${eventId}`), JSON.stringify(told));
check('…and never the business’s note', personMail && !personMail.body.includes(FLAG_NOTE));
r = await site(BOOKINGS, { cookie: cookie.o, method: 'POST', form: { intent: 'flag', rowId: vRow.id, note: 'Again' } });
check('a second flag is refused (409), saying it’s already been told', r.status === 409 && words(r.body).includes('You’ve already told us about this booking.'), String(r.status));
r = await site(PLAN, { cookie: cookie.a });
check('A’s plan says the business says it isn’t booked, and never shows the note',
  words(r.body).includes(`${V.name} says it isn’t booked for this event.`) && !r.body.includes(FLAG_NOTE));

// ------------------------------------------------------------------ 13. The team
const viewsBefore = (await sql`select count(*)::int as n from audit_log where action = 'event_vendor.flags_view' and actor_user_id = ${ids.m}`)[0].n;
r = await site('/admin/booking-flags', { cookie: cookie.m });
const viewsAfter = (await sql`select count(*)::int as n from audit_log where action = 'event_vendor.flags_view' and actor_user_id = ${ids.m}`)[0].n;
check('the team sees the flag with the note and who marked it, and the look is recorded',
  r.status === 200 && r.body.includes(V.name) && r.body.includes(FLAG_NOTE) && r.body.includes(A_NAME) && viewsAfter === viewsBefore + 1, `${r.status} ${viewsBefore}→${viewsAfter}`);
// The team sees who marked it (their email), but none of the event's private details.
check('…without the event’s private details', privateIn(r.body.replaceAll(email('a'), '')).length === 0, privateIn(r.body.replaceAll(email('a'), '')).join());
const RENAMED = `Garden party ${run}`;
r = await site('/admin/event-types', { cookie: cookie.m, method: 'POST', form: { intent: 'update', id: typeId, name: RENAMED, sortOrder: '1', shown: 'on' } });
check('the team renames the kind of event, recorded', r.status === 302 && (await audits('event_type.update', typeId)) === 1, String(r.status));
r = await site('/admin/event-types', { cookie: cookie.m, method: 'POST', form: { intent: 'update', id: typeId, name: RENAMED, sortOrder: '1' } });
const [hiddenType] = await sql`select key, is_active from event_type where id = ${typeId}`;
check('…and hides it, recorded; its key never changes',
  r.status === 302 && hiddenType.is_active === false && hiddenType.key === typeRow.key && (await audits('event_type.update', typeId)) === 2, JSON.stringify(hiddenType));
r = await site('/events/new', { cookie: cookie.a });
check('a hidden kind of event isn’t offered', r.status === 200 && !r.body.includes(typeId));
const eventsBefore = await eventsOf('a');
r = await site('/events/new', { cookie: cookie.a, method: 'POST', form: { intent: 'create', title: 'Forged', typeId, date: eventDate, townId: orillia.id } });
check('a forged form choosing it is refused (409) and nothing is planned',
  r.status === 409 && words(r.body).includes('That kind of event isn’t offered any more.') && (await eventsOf('a')) === eventsBefore, String(r.status));
r = await site(PLAN, { cookie: cookie.a });
check('A’s event keeps its kind of event (with the new name)', words(r.body).includes(RENAMED));

// ------------------------------------------------------------------ 14. Edit and cancel
r = await site(`${PLAN}/edit`, { cookie: cookie.a });
check('the edit page keeps the hidden kind of event chosen', r.status === 200 && r.body.includes(`value="${typeId}"`), String(r.status));
r = await site(`${PLAN}/edit`, { cookie: cookie.a, method: 'POST', form: { ...eventForm({ date: movedDate }), intent: 'save' } });
told = await waitFor(() => notes(vRow.id, 'booked_event_changed'), settled);
check('changing the date: one email waits for the morning', r.status === 302 && (await eventState()).date === movedDate && told.map((n) => n.status).join() === 'waiting', `${r.status} ${told.map((n) => n.status)}`);
r = await site(`${PLAN}/edit`, { cookie: cookie.a, method: 'POST', form: { ...eventForm({ date: movedDate, townId: otherTown.id }), intent: 'save' } });
told = await waitFor(() => notes(vRow.id, 'booked_event_changed'), (rows) => rows.length === 2 && settled(rows));
since = await morning();
summary = await summaryFor('o', since);
const changedMail = summary[0];
check('…with the new date and the old one, and nothing private',
  changedMail && changedMail.body.includes(dayMonth(movedDate)) && changedMail.body.includes(dayMonth(eventDate)) && privateIn(changedMail.body).length === 0 && !changedMail.body.includes('Garden'));
// A real change is never held back: the business's summary shows both, the newest last.
check('a second change the same day is in the same summary (the newest date and town)',
  r.status === 302 && summary.length === 1 && changedMail.body.includes(otherTown.name) && (await notes(vRow.id, 'booked_event_changed')).map((n) => n.status).join() === 'sent,sent',
  told.map((n) => n.status).join());
r = await site(`${PLAN}/cancel`, { cookie: cookie.a, method: 'POST', form: { intent: 'cancel' } });
told = await waitFor(() => notes(vRow.id, 'booked_event_cancelled'), settled);
since = await morning();
summary = await summaryFor('o', since);
told = await notes(vRow.id, 'booked_event_cancelled');
check('cancelling tells the booked business (in the morning summary)',
  r.status === 302 && (await eventState()).status === 'cancelled' && told.map((n) => `${n.user_id === ids.o}:${n.status}`).join() === 'true:sent' && summary.length === 1, JSON.stringify(told));
await new Promise((res) => setTimeout(res, 300));
check('…but not a business that was only being considered',
  (await sql`select count(*)::int as n from notification where user_id = ${ids.o2}`)[0].n === 0 && (await mail(email('o2'))).length === 0);
const cancelledMail = summary.find((m) => m.body.includes('cancelled their event'));
check('…and the email has nothing private', cancelledMail && privateIn(cancelledMail.body).length === 0 && !cancelledMail.body.includes('Garden'));
r = await site(`${PLAN}/edit`, { cookie: cookie.a });
check('a cancelled event can’t be edited: the edit page goes back to the plan', [302, 303].includes(r.status) && r.location === PLAN, `${r.status} ${r.location}`);
r = await site(`${PLAN}/edit`, { cookie: cookie.a, method: 'POST', form: { ...eventForm({ date: movedDate, townId: otherTown.id, title: 'After' }), intent: 'save' } });
// Without JavaScript the refusal comes back on the edit page, whose loader then goes to the plan.
check('…and a saved form from before changes nothing (refused, back to the plan)',
  (r.status === 409 || ([302, 303].includes(r.status) && r.location === PLAN)) && (await eventState()).title === SECRETS[0], `${r.status} ${r.location}`);

// ------------------------------------------------------------------ 15. Limits
for (let i = 1; i <= 10; i++) {
  r = await site('/events/new', { cookie: cookie.c, method: 'POST', form: { intent: 'create', title: `Party ${i}`, typeId: 'none', date: eventDate, townId: orillia.id } });
}
check('10 events planned in a day', r.status === 302 && (await eventsOf('c')) === 10, String(r.status));
r = await site('/events/new', { cookie: cookie.c, method: 'POST', form: { intent: 'create', title: 'Party 11', typeId: 'none', date: eventDate, townId: orillia.id } });
check('the 11th in a day is refused (429), saying so plainly',
  r.status === 429 && words(r.body).includes('You’ve planned a lot of events today. Please try again tomorrow.') && (await eventsOf('c')) === 10, String(r.status));
let limited = null;
// The limit is 30 a minute, counted per clock minute: 65 in a few seconds trips it even when
// they straddle the turn of a minute (it reset halfway through 45 once, on GitHub).
for (let i = 0; i < 65 && !limited; i++) {
  r = await site(`/vendors/${Y.slug}/add`, { cookie: cookie.d, method: 'POST', form: { intent: i % 2 ? 'unsave' : 'save' } });
  if (r.status === 429) limited = r;
}
check('many changes in a minute from one person are slowed down, in plain words', limited !== null && words(limited.body).includes('You’re going a bit fast.'));

// ------------------------------------------------------------------ 16. Planning counts, for the team only (D-42)
// The pages count whole days up to yesterday, so this run's records are moved to yesterday.
await sql.begin(async (tx) => {
  await tx`set local session_replication_role = replica`;
  const noon = tx`((now() at time zone 'America/Toronto')::date - 1 + time '12:00') at time zone 'America/Toronto'`;
  await tx`update saved_vendor set created_at = ${noon} where user_id = ${ids.a} and vendor_id = ${V.id}`;
  await tx`update event_vendor set created_at = ${noon} where id = ${vRow.id}`;
  await tx`update status_change set created_at = ${noon} where subject_id = ${vRow.id}`;
  await tx`update event set created_at = ${noon} where id in (${eventId}, ${ownerEventId})`;
});
// A period that includes yesterday: this year so far, or on the 1st of a month the month just ended.
r = await site(`/admin/listings/${V.id}/activity?period=${today.endsWith('-01') ? 'month' : 'year'}`, { cookie: cookie.m });
let counts = words(r.body);
check('the team’s page for the business shows its planning counts',
  r.status === 200 && counts.includes('Planning (team only)') && counts.includes('Saved: 1') && counts.includes('Added to an event plan: 1') && counts.includes('Marked booked: 1'),
  counts.slice(counts.indexOf('Planning (team only)'), counts.indexOf('Planning (team only)') + 200));
check('…totals only: never who', !r.body.includes(A_NAME) && !r.body.includes(email('a')) && privateIn(r.body).length === 0);
r = await site('/admin/activity', { cookie: cookie.m });
counts = words(r.body);
const businessRows = (r.body.match(/\/admin\/listings\/[0-9a-f-]{36}\/activity"/g) ?? []).length;
check('the team’s overview lists the business among the most marked booked (or a full top 20)',
  r.status === 200 && counts.includes('Planning (team only)') && (r.body.includes(V.name) || businessRows >= 20), String(r.status));
check('…and the totals by kind of event, with "No type given" as its own row',
  new RegExp(`${RENAMED}</th><td>1</td><td>1</td>`).test(r.body.replace(/<!-- -->/g, '')) && counts.includes('No type given'));
check('…never who or which event', !r.body.includes(A_NAME) && privateIn(r.body).length === 0, privateIn(r.body).join() + (r.body.includes(A_NAME) ? ' name' : ''));
r = await site(`/admin/listings/${V.id}/activity`, { cookie: cookie.m, method: 'POST', form: { intent: 'analytics', enabled: 'on', note: 'E2E: plans' } });
r = await site(`/vendors/${V.slug}/analytics?period=month`, { cookie: cookie.o });
const ownPage = words(r.body);
check('the owner’s own Analytics page shows none of the planning counts',
  r.status === 200 && !['Planning', 'Marked booked', 'marked booked', 'event plan', 'Saved:'].some((w) => ownPage.includes(w)), String(r.status));
for (const path of ['/admin/activity', `/admin/listings/${V.id}/activity`]) {
  r = await site(path, { cookie: cookie.n });
  check(`not on the team: ${path} is refused (403)`, r.status === 403 && !r.body.includes('Planning (team only)'), String(r.status));
}

// ------------------------------------------------------------------ 16b. A business taken down (D-46)
// Hidden from people (they can't book it); kept on the plan of anyone who already booked it;
// the team sees every booking, and whom to check in with.
const T = await listing('taken');
const T2 = await listing('taken2');
const B_TITLE = `SECRET-B-TITLE-${run}`;
r = await site('/events/new', { cookie: cookie.b, method: 'POST', form: { intent: 'create', title: B_TITLE, typeId: 'none', date: eventDate, townId: orillia.id } });
const bEvent = /^\/events\/([0-9a-f-]{36})/.exec(r.location ?? '')?.[1];
for (const v of [T, T2]) await site(`/vendors/${v.slug}/add`, { cookie: cookie.b, method: 'POST', form: { intent: 'add', eventId: bEvent } });
await site(`/vendors/${T2.slug}/add`, { cookie: cookie.b, method: 'POST', form: { intent: 'save' } });
const tRow = await rowOf(bEvent, T.id);
const t2Row = await rowOf(bEvent, T2.id);
await site(`/events/${bEvent}/plan/${tRow.id}/book`, { cookie: cookie.b, method: 'POST' });
check('set-up: one business marked booked, one considered and saved',
  (await rowOf(bEvent, T.id))?.status === 'booked' && t2Row?.status === 'considering', `${tRow?.status} ${t2Row?.status}`);
r = await site(`/admin/listings/${T.id}`, { cookie: cookie.m });
check('the team’s listing page says how many bookings are still to come, before taking it down',
  r.status === 200 && words(r.body).includes('Bookings for events still to come: 1') && words(r.body).includes('There’s 1 booking of this business'), String(r.status));
for (const v of [T, T2]) {
  r = await site(`/admin/listings/${v.id}`, { cookie: cookie.m, method: 'POST', form: { intent: 'status', to: 'unpublished', reason: 'E2E: taken down' } });
}
check('the team takes both businesses down',
  (await sql`select count(*)::int as n from vendor where id in (${T.id}, ${T2.id}) and listing_status = 'unpublished'`)[0].n === 2, String(r.status));
r = await site(`/events/${bEvent}`, { cookie: cookie.b });
const bPlan = words(r.body);
check('the person’s plan keeps the business they booked, by name, as their own record, with no link',
  r.status === 200 && bPlan.includes(T.name) && bPlan.includes('No longer listed on Localites') && !r.body.includes(`/vendors/${T.slug}"`), String(r.status));
check('…and doesn’t show the one they were only considering', !bPlan.includes(T2.name));
check('…and offers no un-marking of it (it couldn’t be marked again)', !r.body.includes(`/plan/${tRow.id}/unbook`));
r = await site(`/events/${bEvent}/plan/${t2Row.id}/book`, { cookie: cookie.b, method: 'POST' });
check('marking a business that isn’t listed as booked is refused (409, in plain words), and nothing changes',
  r.status === 409 && words(r.body).includes('That business isn’t listed on Localites right now.') && (await rowOf(bEvent, T2.id))?.status === 'considering',
  String(r.status));
r = await site(`/events/${bEvent}/plan/${tRow.id}/unbook`, { cookie: cookie.b });
check('un-marking it isn’t offered: the page goes back to the plan', [302, 303].includes(r.status) && r.location === `/events/${bEvent}`, `${r.status} ${r.location}`);
r = await site(`/events/${bEvent}/plan/${tRow.id}/unbook`, { cookie: cookie.b, method: 'POST' });
check('…and sent anyway, it’s refused (back to the plan) and stays booked',
  [302, 303].includes(r.status) && r.location === `/events/${bEvent}` && (await rowOf(bEvent, T.id))?.status === 'booked', `${r.status} ${r.location}`);
r = await site('/saved', { cookie: cookie.b });
check('Your favourites doesn’t show a business that isn’t listed', r.status === 200 && !words(r.body).includes(T2.name), String(r.status));
r = await site('/admin/bookings', { cookie: cookie.m });
const team = words(r.body);
check('the team’s menu counts the bookings to check in about', r.status === 200 && /Bookings \(\d+ to check in\)/.test(team), String(r.status));
check('the team’s Bookings page lists whom to check in with: the business, the person and their email',
  team.includes('Check in with these people') && team.includes(T.name) && team.includes(email('b')));
check('…and never the event’s name, or what a person is only considering', !r.body.includes(B_TITLE) && !team.includes(T2.name));
r = await site(`/admin/bookings?business=${T.id}`, { cookie: cookie.m });
check('one business’s bookings, recorded in the audit log each time they’re looked at',
  r.status === 200 && words(r.body).includes(email('b')) && (await audits('event_vendor.bookings_view', T.id)) === 1, String(r.status));
r = await site(`/admin/bookings?business=${V.id}`, { cookie: cookie.m });
check('…a listed business’s bookings are there too (who it works with)', r.status === 200 && words(r.body).includes(V.name) && words(r.body).includes(A_NAME), String(r.status));
r = await site('/admin/bookings?business=nope', { cookie: cookie.m });
check('a bad address is "not found"', r.status === 404, String(r.status));
for (const [who, c] of [['a person', cookie.b], ['the business’s owner', cookie.o], ['someone not on the team', cookie.n]]) {
  r = await site('/admin/bookings', { cookie: c });
  check(`${who}: the team’s Bookings page is refused (403)`, r.status === 403 && !r.body.includes(email('b')), String(r.status));
}
await sql`update vendor set listing_status = 'published' where id = ${T2.id}`;
r = await site(`/events/${bEvent}`, { cookie: cookie.b });
check('listed again, it’s back on the plan and in Saved',
  words(r.body).includes(T2.name) && words((await site('/saved', { cookie: cookie.b })).body).includes(T2.name));
r = await site(`/events/${bEvent}/plan/${t2Row.id}/book`, { cookie: cookie.b, method: 'POST' });
check('listed again, it can be marked booked', (await rowOf(bEvent, T2.id))?.status === 'booked', String(r.status));

// ------------------------------------------------------------------ 17. Wording (D-16, D-24)
await mail(email('o'));
await mail(email('a'));
await mail(TEAM);
const banned = /book now|booking confirmed|deposit|checkout|confirmed/i;
const wrong = seen.filter((s) => banned.test(words(s.body)));
check('no page or email in the run suggests paying or a confirmed booking', wrong.length === 0, wrong.map((s) => `${s.path}: ${banned.exec(words(s.body))?.[0]}`).slice(0, 5).join('; '));

await finish('event planning');
