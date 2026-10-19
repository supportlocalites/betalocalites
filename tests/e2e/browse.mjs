// Browse local (D-57, migration 0053): rows by kind with each listed business's photo or name, the
// filter bar (words, town, cost set by the team, rating, sort), the + (shortlist) and the bookmark
// (favourites) on each card, the shortlist bar, and moving the shortlist onto an event. The
// database's own rules (only the person, only listed businesses, at most 30) are in db/tests/0053.
//
// Usage: npm run test:e2e
import { account, BASE, check, cookieFor, finish, passwordSession, run, site, sql, twoStepSession } from './helpers.mjs';

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const words = (html) => decode(html.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ');

const [town] = await sql`select id, slug::text as slug, name from municipality where is_active order by sort_order limit 1`;
const [other] = await sql`select id, slug::text as slug from municipality where is_active and id <> ${town.id} order by sort_order limit 1`;
const [kind] = await sql`select id, slug::text as slug, name from category where parent_id is null and is_active order by sort_order limit 1`;
const business = async (key, name, { place = town, cost = null, status = 'published', tagline = null } = {}) => {
  const [v] = await sql`
    insert into vendor (slug, display_name, primary_municipality_id, listing_status, published_at, claim_status, source, cost_level, tagline)
    values (${`e2e-browse-${key}-${run}`}, ${`${name} ${run}`}, ${place.id}, ${status}, now(), 'claimed', 'admin_entered', ${cost}, ${tagline})
    returning id, slug::text as slug, display_name as name`;
  await sql`insert into vendor_category (vendor_id, category_id, is_primary) values (${v.id}, ${kind.id}, true)`;
  return v;
};
const A = await business('a', 'Browse Alpha Bakery', { cost: 1, tagline: 'Cakes for every party' });
const B = await business('b', 'Browse Beta Bakery', { cost: 3, place: other });
const H = await business('h', 'Browse Hidden Bakery', { status: 'unpublished' });
const email = (who) => `e2e-browse-${who}-${run}@example.test`;
const ids = {};
for (const who of ['p', 'q', 'o', 't']) ids[who] = await account(email(who));
await sql`insert into vendor_member (vendor_id, user_id, role) values (${A.id}, ${ids.o}, 'owner')`;
await sql`insert into platform_role (user_id, role) values (${ids.t}, 'admin')`;
const cookie = {};
for (const who of ['p', 'q', 'o']) cookie[who] = cookieFor(await passwordSession(email(who)));
cookie.t = cookieFor(await twoStepSession(email('t')));
const W = `e2e-browse-${run}`;

console.log('Rows by kind, and the filters');
let r = await site(`/explore?q=${encodeURIComponent(W)}`);
check('signed out, Browse local shows its listed businesses in their kind’s row', r.status === 200 && r.body.includes(`id="rail-${kind.slug}"`)
  && r.body.includes(A.name) && r.body.includes(B.name) && !r.body.includes(H.name), String(r.status));
check('…a business without a photo shows its name on a plain panel, and its cost', words(r.body).includes(`${A.name} ${kind.name} ${town.name} ${A.name} Cakes for every party`)
  && r.body.includes('Low cost'));
check('…the + and bookmark ask to sign in first, and come back here',
  r.body.includes(`href="/join?next=${encodeURIComponent(`/explore?q=${encodeURIComponent(W)}`).replace(/%20/g, '%20')}`)
  && r.body.includes(`Sign in to add ${A.name} to your shortlist`) && r.body.includes(`Sign in to save ${A.name} as a favourite`));
check('…with “Add to shortlist” and “Save as favourite” on hover', r.body.includes('title="Add to shortlist"') && r.body.includes('title="Save as favourite"'));
check('…and no shortlist bar', !r.body.includes('aria-label="Your shortlist"'));
r = await site(`/explore?q=${encodeURIComponent(W)}&cost=3`);
check('the cost filter keeps only that cost', r.body.includes(B.name) && !r.body.includes(A.name));
r = await site(`/explore?q=${encodeURIComponent(W)}&town=${other.slug}`);
check('the town filter keeps only that town', r.body.includes(B.name) && !r.body.includes(A.name));
r = await site(`/explore?q=${encodeURIComponent(W)}&rating=4`);
check('“4 stars and up” leaves out businesses with fewer than 3 reviews (no average yet)', !r.body.includes(A.name) && words(r.body).includes('No businesses match yet'));
r = await site(`/explore?q=${encodeURIComponent(W)}&cost=7&town=../x&sort=evil`);
check('anything unknown in the address is ignored', r.status === 200 && r.body.includes(A.name) && r.body.includes(B.name), String(r.status));
r = await site('/explore');
check('“Your favourites first” is offered only when signed in', !r.body.includes('Your favourites first'));
// Counting (ADR-030): a new browser is one visitor for the whole page, however many rows it has.
const asBrowser = await fetch(`${BASE}/explore`, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130 Safari/537.36' } });
r = { body: await asBrowser.text(), headers: asBrowser.headers };
const rows = (r.body.match(/id="rail-/g) ?? []).length;
const notes = [...new Set([...r.body.matchAll(/(eyJ[A-Za-z0-9_-]+)\.[A-Za-z0-9_-]{20,}/g)].map((m) => m[1]))]
  .map((t) => JSON.parse(Buffer.from(t, 'base64url').toString()))
  .filter((n) => n.k === 'list');
const browsers = new Set(notes.map((n) => n.b));
check('a new browser is one visitor for the whole page, with a note for each row', rows > 1 && notes.length === rows && browsers.size === 1
  && r.headers.getSetCookie().filter((c) => /visitor/i.test(c)).length <= 1, `${rows} rows, ${notes.length} notes, ${browsers.size} browsers`);

console.log('\nThe + and the bookmark');
r = await site('/shortlist', { cookie: cookie.p, method: 'POST', form: { intent: 'add', slug: A.slug, back: '/explore' } });
check('the + adds a business to the shortlist and goes back', r.status === 302 && r.location === '/explore', `${r.status} ${r.location}`);
r = await site('/shortlist', { cookie: cookie.p, method: 'POST', form: { intent: 'add', slug: A.slug, inline: '1' } });
check('…twice is the same as once', r.status === 200 && (await sql`select count(*)::int as n from shortlist where user_id = ${ids.p}`)[0].n === 1, String(r.status));
r = await site('/shortlist', { cookie: cookie.p, method: 'POST', form: { intent: 'add', slug: H.slug } });
check('a business that isn’t listed can’t be added', r.status === 404, String(r.status));
r = await site('/shortlist', { cookie: cookie.p, method: 'POST', form: { intent: 'save', slug: B.slug, inline: '1' } });
check('the bookmark saves as a favourite (the saved list)', r.status === 200
  && (await sql`select count(*)::int as n from saved_vendor where user_id = ${ids.p} and vendor_id = ${B.id}`)[0].n === 1, String(r.status));
r = await site('/shortlist', { method: 'POST', form: { intent: 'add', slug: B.slug } });
check('signed out, nothing is added (sent to sign in)', r.status === 302 && r.location.startsWith('/join'), `${r.status} ${r.location}`);
r = await site('/shortlist', { cookie: cookie.p, method: 'POST', form: { intent: 'add', slug: A.slug, back: 'https://evil.example/' } });
check('…and it only ever goes back to a page on this site', r.status === 302 && r.location === '/', r.location);

r = await site(`/explore?q=${encodeURIComponent(W)}`, { cookie: cookie.p });
check('signed in: the shortlist bar shows what’s on it, with “Add these to an event”', r.body.includes('aria-label="Your shortlist"')
  && words(r.body).includes('1 business') && r.body.includes(`Remove ${A.name} from your shortlist`) && r.body.includes('href="/shortlist"'));
check('…the card says it’s on the shortlist, and the other is a favourite', r.body.includes(`aria-label="Remove ${A.name} from your shortlist"`)
  && r.body.includes(`aria-label="Remove ${B.name} from your favourites"`) && r.body.includes('title="Remove from shortlist"'));
r = await site(`/explore?q=${encodeURIComponent(W)}&sort=saved`, { cookie: cookie.p });
check('“Your favourites first” puts the favourite first', r.body.indexOf(B.name) < r.body.indexOf(A.name) && r.body.indexOf(B.name) > 0);
r = await site(`/explore?q=${encodeURIComponent(W)}`, { cookie: cookie.q });
check('someone else sees none of it: no bar, nothing marked', !r.body.includes('aria-label="Your shortlist"')
  && r.body.includes(`aria-label="Add ${A.name} to your shortlist"`) && r.body.includes(`aria-label="Save ${B.name} as a favourite"`));
r = await site('/shortlist', { cookie: cookie.q });
check('…and their shortlist page is empty', words(r.body).includes('Nothing on your shortlist yet') && !r.body.includes(A.name));
r = await site('/shortlist', { cookie: cookie.q, method: 'POST', form: { intent: 'remove', slug: A.slug } });
check('…removing it as them changes nobody else’s', (await sql`select count(*)::int as n from shortlist where user_id = ${ids.p}`)[0].n === 1);

console.log('\nOnto an event');
const [mine] = await sql`insert into event (host_user_id, event_date, start_time, municipality_id) values (${ids.p}, current_date + 20, '13:00', ${town.id}) returning id`;
await sql`insert into event_private (event_id, host_user_id, title) values (${mine.id}, ${ids.p}, ${`P party ${run}`})`;
const [theirs] = await sql`insert into event (host_user_id, event_date, start_time, municipality_id) values (${ids.q}, current_date + 20, '13:00', ${town.id}) returning id`;
await sql`insert into event_private (event_id, host_user_id, title) values (${theirs.id}, ${ids.q}, ${`Q party ${run}`})`;
r = await site('/shortlist', { cookie: cookie.p });
check('the shortlist page lists it and offers their own events, and a new one', r.body.includes(A.name) && r.body.includes(`P party ${run}`)
  && !r.body.includes(`Q party ${run}`) && r.body.includes('href="/events/new?shortlist=1"'));
r = await site('/shortlist', { cookie: cookie.p, method: 'POST', form: { intent: 'to-event', eventId: theirs.id } });
check('someone else’s event is refused, and nothing moves', r.status === 404 && (await sql`select count(*)::int as n from event_vendor where event_id = ${theirs.id}`)[0].n === 0
  && (await sql`select count(*)::int as n from shortlist where user_id = ${ids.p}`)[0].n === 1, String(r.status));
r = await site('/shortlist', { cookie: cookie.p, method: 'POST', form: { intent: 'to-event', eventId: mine.id } });
const onPlan = await sql`select vendor_id, status from event_vendor where event_id = ${mine.id}`;
check('their own event: the shortlist goes on it as Considering, and leaves the shortlist', r.status === 302 && r.location === `/events/${mine.id}?moved=1`
  && onPlan.length === 1 && onPlan[0].vendor_id === A.id && onPlan[0].status === 'considering'
  && (await sql`select count(*)::int as n from shortlist where user_id = ${ids.p}`)[0].n === 0, `${r.status} ${r.location}`);
r = await site(r.location, { cookie: cookie.p });
check('…and the plan says so', words(r.body).includes('Added 1 business from your shortlist as Considering'));

await site('/shortlist', { cookie: cookie.p, method: 'POST', form: { intent: 'add', slug: B.slug } });
r = await site('/events/new?shortlist=1', { cookie: cookie.p });
check('planning a new event from the shortlist says its businesses go on it', words(r.body).includes('The businesses on your shortlist go on this event as Considering')
  && r.body.includes('name="fromShortlist" value="1"'));

r = await site('/shortlist', { cookie: cookie.o, method: 'POST', form: { intent: 'add', slug: A.slug } });
const [ownEvent] = await sql`insert into event (host_user_id, event_date, start_time, municipality_id) values (${ids.o}, current_date + 20, '13:00', ${town.id}) returning id`;
await sql`insert into event_private (event_id, host_user_id, title) values (${ownEvent.id}, ${ids.o}, ${`O party ${run}`})`;
r = await site('/shortlist', { cookie: cookie.o, method: 'POST', form: { intent: 'to-event', eventId: ownEvent.id } });
check('a business owner’s own business never goes on their own event plan', (await sql`select count(*)::int as n from event_vendor where event_id = ${ownEvent.id}`)[0].n === 0);

console.log('\nThe team sets the cost');
r = await site(`/admin/listings/${B.id}`, { cookie: cookie.t });
check('the team’s listing page has the cost guide', r.body.includes('Cost guide') && r.body.includes('<option value="3" selected=""'));
r = await site(`/admin/listings/${B.id}`, { cookie: cookie.t, method: 'POST', form: { intent: 'cost', cost: '2' } });
check('…the team changes it, and it’s in the history', r.status === 302 && (await sql`select cost_level from vendor where id = ${B.id}`)[0].cost_level === 2
  && (await sql`select count(*)::int as n from audit_log where subject_id = ${B.id} and action = 'vendor.cost_level'`)[0].n === 1, String(r.status));
r = await site(`/admin/listings/${B.id}`, { cookie: cookie.o, method: 'POST', form: { intent: 'cost', cost: '1' } });
check('a business owner can’t set a cost', r.status !== 302 && (await sql`select cost_level from vendor where id = ${B.id}`)[0].cost_level === 2, String(r.status));
r = await site(`/admin/listings/${B.id}`, { cookie: cookie.t, method: 'POST', form: { intent: 'cost', cost: '9' } });
check('…and only $ to $$$ is accepted', r.status === 400 && (await sql`select cost_level from vendor where id = ${B.id}`)[0].cost_level === 2, String(r.status));

await finish('browse local');
