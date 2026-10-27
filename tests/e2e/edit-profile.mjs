// Edit profile, Style C (D-63): one part at a time (names, about you, businesses, privacy),
// each saving only its own fields; Claim a business lists only businesses no one runs yet;
// and the account switch (the menu lists each business, a business page shows the dark bar),
// which only ever offers the person's own businesses.
//
// Usage: npm run test:e2e
import { account, check, cookieFor, finish, passwordSession, run, site, sql } from './helpers.mjs';

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const words = (html) => decode(html.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ');
// The page without the loader's data, which repeats everything the page was given.
const page = (html) => html.slice(0, html.indexOf('window.__reactRouterContext') >>> 0);
// Only the page's main part, not the menu (which lists every business you're on).
const main = (html) => page(html).slice(Math.max(0, page(html).indexOf('<main')));

const email = (who) => `e2e-prof-${who}-${run}@example.test`;
const ids = {};
const cookie = {};
for (const who of ['p', 'o', 's', 'x']) {
  ids[who] = await account(email(who));
  await sql`update app_user set given_name = ${`Pat${who}`}, family_name = 'Tester', display_name = ${`Pat${who} Tester`} where id = ${ids[who]}`;
  cookie[who] = cookieFor(await passwordSession(email(who)));
}
const [town] = await sql`select id from municipality where is_active order by sort_order limit 1`;
const vendor = async (key, extra = {}) => {
  const [v] = await sql`
    insert into vendor (slug, display_name, primary_municipality_id, listing_status, published_at, claim_status, source)
    values (${`e2e-prof-${key}-${run}`}, ${`Profile ${key} ${run}`}, ${town.id}, ${extra.status ?? 'published'},
            ${extra.status === 'draft' ? null : new Date()}, ${extra.claim ?? 'unclaimed'}, 'admin_entered')
    returning id, slug::text as slug, display_name as name`;
  return v;
};
const V = await vendor('v', { claim: 'claimed' });
const V2 = await vendor('v2', { claim: 'claimed' });
const OPEN = await vendor('open');
const DRAFT = await vendor('draft', { status: 'draft' });
const RUN = await vendor('run'); // unclaimed on paper, but someone is on its team
await sql`insert into vendor_member (vendor_id, user_id, role) values
  (${V.id}, ${ids.o}, 'owner'), (${V2.id}, ${ids.o}, 'owner'), (${V.id}, ${ids.s}, 'staff'), (${RUN.id}, ${ids.x}, 'owner')`;

console.log('Edit profile');
let r = await site('/account');
check('signed out, Edit profile sends you to sign in', r.status === 302 && r.location.startsWith('/join'), `${r.status} ${r.location}`);
r = await site('/account', { cookie: cookie.p });
let w = words(page(r.body));
check('it has the four parts', r.status === 200 && ['Profile', 'About you', 'Businesses', 'Privacy'].every((t) => w.includes(t))
  && r.body.includes('href="/account?tab=businesses"'), String(r.status));
check('…no favourites on it any more (only the top bar’s icon)', !words(main(r.body)).includes('Favourites'));
check('…and with no business, it offers to claim one or add yours', r.body.includes('href="/account/claim"') && r.body.includes('href="/account/add-business"'));

await sql`insert into person_profile (user_id, town) values (${ids.p}, 'Orillia') on conflict (user_id) do update set town = 'Orillia'`;
r = await site('/account', { cookie: cookie.p, method: 'POST', form: { intent: 'names', firstName: 'Robin', lastName: 'Lake' } });
check('saving your name goes back to Profile, saved', r.status === 302 && r.location === '/account?saved=1', `${r.status} ${r.location}`);
let [row] = await sql`select u.given_name, u.family_name, u.display_name, pp.town from app_user u left join person_profile pp on pp.user_id = u.id where u.id = ${ids.p}`;
check('…the name changed, and your town was left alone', row.given_name === 'Robin' && row.family_name === 'Lake' && row.display_name === 'Robin Lake' && row.town === 'Orillia', JSON.stringify(row));
r = await site('/account', { cookie: cookie.p, method: 'POST', form: { intent: 'about', town: 'Barrie', province: '', gender: '', postalCode: '' } });
check('saving About you goes back to that part, saved', r.status === 302 && r.location === '/account?tab=about&saved=1', `${r.status} ${r.location}`);
[row] = await sql`select u.given_name, pp.town from app_user u left join person_profile pp on pp.user_id = u.id where u.id = ${ids.p}`;
check('…the town changed, and your name was left alone', row.given_name === 'Robin' && row.town === 'Barrie', JSON.stringify(row));
r = await site('/account', { cookie: cookie.p, method: 'POST', form: { intent: 'names', firstName: '', lastName: 'Lake' } });
check('an empty first name is refused', r.status === 400 && words(r.body).includes('first and last name'), String(r.status));
r = await site('/account', { cookie: cookie.p, method: 'POST', form: { intent: 'nonsense' } });
check('an unknown save is refused', r.status === 400, String(r.status));

console.log('\nClaim a business');
r = await site('/account/claim');
check('signed out, it sends you to sign in', r.status === 302 && r.location.startsWith('/join'), `${r.status} ${r.location}`);
r = await site(`/account/claim?q=${encodeURIComponent(`Profile`)}`, { cookie: cookie.p });
w = words(page(r.body));
check('it lists a business no one runs yet, with a Claim link', r.status === 200 && w.includes(OPEN.name) && r.body.includes(`href="/vendors/${OPEN.slug}/claim"`), String(r.status));
check('…but not a claimed one, a draft, or one with a team', !w.includes(V.name) && !w.includes(DRAFT.name) && !w.includes(RUN.name));
r = await site(`/account/claim?q=${encodeURIComponent(`zzzz-nothing-${run}`)}`, { cookie: cookie.p });
check('nothing matching offers to add your business instead', r.status === 200 && r.body.includes('href="/account/add-business"'));

console.log('\nThe account switch');
r = await site('/explore', { cookie: cookie.o });
check('an owner’s menu lists each of their businesses', r.body.includes(`href="/business?b=${V.slug}"`) && r.body.includes(`href="/business?b=${V2.slug}"`));
check('…and Personal', words(r.body).includes('Personal') && r.body.includes('href="/explore"'));
r = await site('/explore', { cookie: cookie.s });
check('staff switch straight to the inbox', r.body.includes(`href="/vendors/${V.slug}/messages"`) && !r.body.includes(`href="/business?b=${V2.slug}"`));
r = await site('/explore', { cookie: cookie.p });
check('someone with no business has no switch', !words(r.body).includes('Switch account') && !r.body.includes('href="/business'));
r = await site(`/vendors/${V.slug}/edit`, { cookie: cookie.o });
w = words(page(r.body));
check('a business page shows the business bar with Switch to personal', r.status === 200 && w.includes('Switch to personal') && w.includes(V.name), String(r.status));
r = await site(`/business?b=${V.slug}`, { cookie: cookie.o });
w = words(main(r.body));
check('Your business for one business shows only that one', r.status === 200 && w.includes(V.name) && !w.includes(V2.name), String(r.status));
r = await site(`/business?b=${RUN.slug}`, { cookie: cookie.o });
w = words(page(r.body));
check('…someone else’s business in the address falls back to all of yours', r.status === 200 && words(main(r.body)).includes(V.name) && words(main(r.body)).includes(V2.name), String(r.status));
check('…someone else’s business in the address shows none of it', r.status === 200 && !w.includes(RUN.name), String(r.status));
r = await site(`/vendors/${V.slug}/edit`, { cookie: cookie.p });
check('a stranger still can’t open the business’s edit page', r.status === 404 || r.status === 403, String(r.status));

console.log('\nFind my address (27 October 2026)');
// The owner: "bring up that address looker and make sure I select the right address and then can
// autofill in my info"; and the home shows on their own map only.
r = await site('/account/address-search?q=12 Mississaga St, Orillia');
check('signed out, the address search asks you to sign in first', [302, 303].includes(r.status) && r.location.startsWith('/join'), `${r.status} ${r.location}`);
r = await site(`/account/address-search?q=${encodeURIComponent('12 Mississaga St, Orillia')}`, { cookie: cookie.p });
let found = JSON.parse(r.body);
const first = found.places?.[0];
check('signed in, it offers places with their parts, Orillia first', r.status === 200 && found.places.length === 2 && first.town === 'Orillia'
  && first.streetAddress === '12 Mississaga Street East' && first.province === 'ON' && first.postalCode === 'L3V 1V5', r.body.slice(0, 200));
r = await site(`/account/address-search?q=${encodeURIComponent('1 Nowhere Lane')}`, { cookie: cookie.p });
found = JSON.parse(r.body);
check('…nothing found is said plainly', found.places.length === 0 && /No address found/.test(found.problem ?? ''), r.body.slice(0, 200));
r = await site(`/account/address-search?q=${encodeURIComponent('5 Outage Road')}`, { cookie: cookie.p });
found = JSON.parse(r.body);
check('…and a search that isn’t answering too, saving nothing', found.places.length === 0 && /isn’t answering/.test(found.problem ?? ''), r.body.slice(0, 200));
const about = (extra) => ({ intent: 'about', streetAddress: first.streetAddress, town: first.town, province: 'ON', postalCode: first.postalCode, ...extra });
r = await site('/account', { cookie: cookie.p, method: 'POST', form: about({ homeLat: String(first.lat), homeLng: String(first.lng) }) });
const homeOf = async (id) => (await sql`select home_lat as lat, home_lng as lng, home_lookup as lookup from person_profile where user_id = ${id}`)[0];
let h = await homeOf(ids.p);
check('choosing it and saving keeps the address and where it is', [302, 303].includes(r.status) && h?.lookup === 'found' && Math.abs(h.lat - first.lat) < 0.0001, JSON.stringify(h));
r = await site('/explore', { cookie: cookie.p });
// The page's data is React Router's encoding, not plain JSON: look for the key and the two numbers together.
const hasHome = (body) => body.includes('\\"home\\",{');
check('…their own Browse local gets their home, for the house on the map', hasHome(r.body) && r.body.includes(String(Number(h.lat))) && r.body.includes(String(Number(h.lng))));
r = await site('/explore', { cookie: cookie.o });
check('…nobody else’s does', !hasHome(r.body));
r = await site('/explore');
check('…nor signed out', !hasHome(r.body));
r = await site('/account', { cookie: cookie.p, method: 'POST', form: about({ streetAddress: '14 Mississaga Street East' }) });
h = await homeOf(ids.p);
check('changing the address by hand takes the house off until it’s chosen again', h?.lookup === null && h?.lat === null, JSON.stringify(h));
r = await site('/account', { cookie: cookie.p, method: 'POST', form: about({ homeLat: '99', homeLng: '-79.4' }) });
h = await homeOf(ids.p);
check('a place outside the map is never kept', h?.lat === null, JSON.stringify(h));

await finish('Edit profile');
