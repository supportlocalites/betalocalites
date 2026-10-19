// Business addresses, the map and Message all from the shortlist (step 3 of the redesign; D-56,
// D-57, migration 0054). The owner or a manager sets the address (never staff, a customer or
// another business); a hidden number is never sent to the address search, kept or shown, and
// the pin is then marked approximate; no address: listed by its town only. The team is told,
// can undo it, and can set it too. Browse local's map shows pins only for those that shared an
// address. Message all from the shortlist sends to each one on Localites, as messaging one does.
// The address search here is the pretend one (scripts/e2e/mail-server.mjs, GEOCODE_URL).
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

const [town] = await sql`select id, name from municipality where is_active order by sort_order limit 1`;
const [category] = await sql`select id from category where is_active and parent_id is null order by sort_order limit 1`;
const business = async (key, name, claim = 'claimed') => {
  const [v] = await sql`
    insert into vendor (slug, display_name, primary_municipality_id, listing_status, published_at, claim_status, source)
    values (${`e2e-addr-${key}-${run}`}, ${`${name} ${run}`}, ${town.id}, 'published', now(), ${claim}, 'admin_entered')
    returning id, slug::text as slug, display_name as name`;
  await sql`insert into vendor_category (vendor_id, category_id, is_primary) values (${v.id}, ${category.id}, true)`;
  return v;
};
const V = await business('v', 'Address Bakery');
const W = await business('w', 'Address Florist');
const U = await business('u', 'Address Unclaimed', 'unclaimed');
const email = (who) => `e2e-addr-${who}-${run}@example.test`;
const ids = {};
for (const who of ['o', 'm', 's', 'a', 'w', 't']) ids[who] = await account(email(who));
await sql`insert into vendor_member (vendor_id, user_id, role) values
  (${V.id}, ${ids.o}, 'owner'), (${V.id}, ${ids.m}, 'manager'), (${V.id}, ${ids.s}, 'staff'), (${W.id}, ${ids.w}, 'owner')`;
await sql`insert into platform_role (user_id, role) values (${ids.t}, 'admin')`;
const cookie = {};
for (const who of ['o', 'm', 's', 'a', 'w']) cookie[who] = cookieFor(await passwordSession(email(who)));
cookie.t = cookieFor(await twoStepSession(email('t')));
const row = async (id) =>
  (await sql`select address_street as street, address_number as number, hide_address_number as hidden, map_lat as lat, map_lng as lng,
             map_approximate as approximate from vendor where id = ${id}`)[0];
const asked = async () => (await fetch(`${MAIL}/geocode/asked`)).json();
const ADDR = `/vendors/${V.slug}/address`;

console.log('Who can set the address');
let r = await site(`/vendors/${V.slug}/edit`, { cookie: cookie.o });
check('the edit page links to the address', r.body.includes(`href="${ADDR}"`));
r = await site(ADDR, { cookie: cookie.o });
check('the owner opens it: only the town for now', r.status === 200 && words(r.body).includes('shows only its town'), String(r.status));
r = await site(ADDR);
check('signed out: asked to sign in', [302, 303].includes(r.status) && (r.location ?? '').startsWith('/join'), `${r.status} ${r.location}`);
for (const [who, c] of [['staff', cookie.s], ['a customer', cookie.a], ['another business’s owner', cookie.w]]) {
  r = await site(ADDR, { cookie: c, method: 'POST', form: { street: 'Sneaky Street', number: '1' } });
  check(`${who} can’t set it`, r.status === 404 && (await row(V.id)).street === null, String(r.status));
}

console.log('\nThe owner sets it');
let before = (await asked()).length;
const sent = Date.now();
r = await site(ADDR, { cookie: cookie.o, method: 'POST', form: { street: '  Lakeshore   Road ', number: '22a' } });
let now = await row(V.id);
check('saved, tidied, with a pin at the address',
  r.status === 302 && now.street === 'Lakeshore Road' && now.number === '22A' && !now.hidden && now.lat !== null && !now.approximate,
  `${r.status} ${JSON.stringify(now)}`);
let q = (await asked()).slice(before);
check('…the address search was asked for the street and number, saying who we are',
  q.length === 1 && q[0].street === '22A Lakeshore Road' && q[0].city === town.name && String(q[0].agent).startsWith('Localites'), JSON.stringify(q));
const [oc] = await sql`select oc.flags, a.changes from owner_change oc join audit_log a on a.id = oc.audit_id where oc.vendor_id = ${V.id} order by a.created_at desc limit 1`;
check('…recorded as an owner change flagged “address”', oc?.flags?.includes('address') && oc.changes.address.to.street === 'Lakeshore Road');
const alert = await waitFor(
  async () => (await mailFor('supportlocalites@gmail.com')).filter((m) => m.at > sent && m.subject.includes(V.name)),
  (l) => l.length > 0,
);
check('…and the team gets a “check now” email', alert.length === 1 && alert[0].subject.includes('changed its address') && alert[0].body.includes('Address:'),
  alert.map((m) => m.subject).join(' | '));
r = await site(`/vendors/${V.slug}`);
let text = words(r.body);
check('the page shows the street and number, a map and directions',
  text.includes(`22A Lakeshore Road, ${town.name}`) && r.body.includes('Map showing where') && r.body.includes('google.com/maps/search') && !text.includes('Approximate location'));
r = await site(ADDR, { cookie: cookie.o, method: 'POST', form: { street: 'Lakeshore Road', number: '22A' } });
check('the same again: nothing saved', r.status === 302 && r.location.endsWith('unchanged=1'), `${r.status} ${r.location}`);
r = await site(ADDR, { cookie: cookie.o, method: 'POST', form: { street: 'Lakeshore Road', number: '22; drop' } });
check('a number that isn’t one is refused, plainly', r.status === 400 && words(r.body).includes('Enter the number as digits'), String(r.status));
r = await site(ADDR, { cookie: cookie.o, method: 'POST', form: { street: 'see http://x.example', number: '' } });
check('a street with a web address is refused', r.status === 400 && (await row(V.id)).street === 'Lakeshore Road', String(r.status));
r = await site(ADDR, { cookie: cookie.o, method: 'POST', form: { street: '', number: '5' } });
check('a number without a street is refused', r.status === 400, String(r.status));

console.log('\nHiding the number (“Never on Localites”)');
before = (await asked()).length;
r = await site(ADDR, { cookie: cookie.m, method: 'POST', form: { street: 'Lakeshore Road', number: '22A', hideNumber: 'yes' } });
now = await row(V.id);
check('a manager hides it: the number isn’t kept, the pin is approximate',
  r.status === 302 && now.hidden && now.number === null && now.approximate && now.lat !== null, `${r.status} ${JSON.stringify(now)}`);
q = (await asked()).slice(before);
check('…the address search was never sent the number', q.length === 1 && q[0].street === 'Lakeshore Road', JSON.stringify(q));
r = await site(`/vendors/${V.slug}`);
text = words(r.body);
check('the page shows the street, never the number, and says it’s approximate',
  text.includes(`Lakeshore Road, ${town.name}`) && !text.includes('22A') && !r.body.includes('22A') && text.includes('Approximate location'));
check('…its directions don’t carry the number either', !/maps\/search[^"]*22A/.test(r.body));
const [ocHidden] = await sql`select a.changes from owner_change oc join audit_log a on a.id = oc.audit_id where oc.vendor_id = ${V.id} order by a.created_at desc limit 1`;
check('…and the change the team sees holds no copy of it, before or after', ocHidden.changes.address.to.number === null && ocHidden.changes.address.from.number === null);

console.log('\nNot found, or no address');
r = await site(`/vendors/${W.slug}/address`, { cookie: cookie.w, method: 'POST', form: { street: 'Nowhere Lane', number: '9' } });
let w = await row(W.id);
check('not found by the search: saved, but not on the map', r.status === 302 && w.street === 'Nowhere Lane' && w.lat === null, `${r.status} ${JSON.stringify(w)}`);
r = await site(`/vendors/${W.slug}/address`, { cookie: cookie.w });
check('…and the owner is told plainly', words(r.body).includes('couldn’t find it on the map'));

console.log('\nThe team');
const [last] = await sql`select oc.audit_id from owner_change oc where oc.vendor_id = ${V.id} order by oc.audit_id desc limit 1`;
r = await site(`/admin/listings/${V.id}`, { cookie: cookie.t });
check('the team sees the address change in plain words', words(r.body).includes('Address:') && words(r.body).includes('(number hidden)'));
r = await site(`/admin/listings/${V.id}`, {
  cookie: cookie.t,
  method: 'POST',
  form: { intent: 'owner-undo', auditId: last.audit_id, key: 'address', reason: 'E2E: checking undo' },
});
now = await row(V.id);
check('the team undoes the hiding: the street comes back, never the number or its exact pin',
  r.status === 302 && now.number === null && !now.hidden && now.street === 'Lakeshore Road' && now.approximate, `${r.status} ${JSON.stringify(now)}`);
r = await site(`/admin/listings/${W.id}`, { cookie: cookie.t, method: 'POST', form: { intent: 'address', street: 'Mississaga Street', number: '7' } });
w = await row(W.id);
const [teamAudit] = await sql`select action from audit_log where subject_id = ${W.id} order by created_at desc limit 1`;
check('the team sets an address, recorded', r.status === 302 && w.street === 'Mississaga Street' && w.lat !== null && teamAudit.action === 'vendor.address',
  `${r.status} ${JSON.stringify(w)}`);
r = await site(`/admin/listings/${W.id}`, { cookie: cookie.o, method: 'POST', form: { intent: 'address', street: 'Hijack Road', number: '1' } });
check('…a business owner can’t use the team’s page', r.status !== 302 && (await row(W.id)).street === 'Mississaga Street', String(r.status));

console.log('\nBrowse local’s map');
await sql`update vendor set map_lat = null, map_lng = null, address_street = null, address_number = null where id = ${U.id}`;
r = await site(`/explore?view=map&q=${encodeURIComponent(`Address ${run}`)}`);
text = words(r.body);
check('the map view lists all three, and says which are on the map',
  r.status === 200 && [V, W, U].every((b) => text.includes(b.name)) && text.includes('listed by its town') && text.includes('on the map'),
  String(r.status));
check('…with the note that only those with an address are on it, and how many aren’t', text.includes('Only businesses that share an address are on the map. 1 more is listed by its town.'));
r = await site(`/explore?q=${encodeURIComponent(`Address ${run}`)}`);
check('the list view is still the rows, with the Map switch', r.status === 200 && r.body.includes('view=map'));

console.log('\nMessage all from the shortlist');
for (const b of [V, W, U]) await site('/shortlist', { cookie: cookie.a, method: 'POST', form: { intent: 'add', slug: b.slug, back: '/explore' } });
r = await site('/explore', { cookie: cookie.a });
check('the shortlist bar offers Message all', r.body.includes('href="/shortlist/message"'));
r = await site('/shortlist/message', { cookie: cookie.a });
text = words(r.body);
check('it lists the two on Localites, not the one that isn’t', r.status === 200 && text.includes(V.name) && text.includes(W.name) && !text.includes(U.name));
r = await site('/shortlist/message', { cookie: cookie.a, method: 'POST', form: [['body', 'Hi'], ['slug', U.slug]] });
check('one not on Localites can’t be chosen', r.status === 409 && words(r.body).includes('Choose at least one business.'), String(r.status));
r = await site('/shortlist/message', { cookie: cookie.s, method: 'POST', form: [['body', 'Hi'], ['slug', V.slug]] });
check('someone else’s shortlist isn’t used: staff with an empty one send nothing', r.status === 409, String(r.status));
const HELLO = `Are you free in June? ${run}`;
r = await site('/shortlist/message', { cookie: cookie.a, method: 'POST', form: [['body', HELLO], ['slug', V.slug], ['slug', W.slug]] });
const convs = await sql`select c.vendor_id, c.event_id from conversation c join message m on m.conversation_id = c.id
  where c.consumer_user_id = ${ids.a} and m.body = ${HELLO}`;
check('sent to each, each its own conversation, not about an event',
  r.status === 200 && words(r.body).includes(`Sent to ${V.name}, ${W.name}`) && convs.length === 2 && convs.every((c) => c.event_id === null),
  `${r.status} ${convs.length}`);

await finish('address and map');
