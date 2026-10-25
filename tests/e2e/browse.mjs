// Browse local in the Base44 design (D-59; D-57 and migration 0053 before it): a row for each
// main kind of business (D-60) with every listed business as a small card, the heart (favourites)
// and the + (shortlist) on each card, the profile panel with Message or Inquire, and the shortlist
// bar with Message all. Search, Within, Rating, Sort and Clear work in the browser, as on Base44,
// checked here in a real browser. A business's own web address opens the page with its profile
// open (K18). The database's own rules for the shortlist are in db/tests/0053.
//
// Usage: npm run test:e2e
import { chromium } from 'playwright';
import { account, BASE, check, cookieFor, finish, passwordSession, run, site, sql, twoStepSession } from './helpers.mjs';

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const words = (html) => decode(html.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ');

const [town] = await sql`select id, slug::text as slug, name from municipality where is_active order by sort_order limit 1`;
const [kind] = await sql`select id, slug::text as slug, name from category where parent_id is null and is_active order by sort_order limit 1`;
const [kind2] = await sql`select id, slug::text as slug, name from category where parent_id is null and is_active order by sort_order offset 1 limit 1`;
const [sub] = await sql`select id, name from category where parent_id = ${kind.id} and is_active order by sort_order limit 1`;
const business = async (key, name, { status = 'published', claim = 'claimed', tagline = null, pin = null, category = kind } = {}) => {
  const [v] = await sql`
    insert into vendor (slug, display_name, primary_municipality_id, listing_status, published_at, claim_status, source, tagline,
                        address_street, map_lat, map_lng)
    values (${`e2e-browse-${key}-${run}`}, ${`${name} ${run}`}, ${town.id}, ${status}, now(), ${claim}, 'admin_entered', ${tagline},
            ${pin ? 'Mississaga Street East' : null}, ${pin?.[0] ?? null}, ${pin?.[1] ?? null})
    returning id, slug::text as slug, display_name as name`;
  await sql`insert into vendor_category (vendor_id, category_id, is_primary) values (${v.id}, ${category.id}, true)`;
  return v;
};
// A is downtown (about 0 km), B is in Washago (about 17 km), U isn't on Localites yet.
const A = await business('a', 'Browse Alpha Bakery', { tagline: 'Cakes for every party', pin: [44.6086, -79.4184], category: sub ?? kind });
const B = await business('b', 'Browse Beta Bakery', { pin: [44.7504, -79.3329] });
const U = await business('u', 'Browse Unclaimed Bakery', { claim: 'unclaimed' });
const H = await business('h', 'Browse Hidden Bakery', { status: 'unpublished' });
const email = (who) => `e2e-browse-${who}-${run}@example.test`;
const ids = {};
for (const who of ['p', 'q', 'o', 't']) ids[who] = await account(email(who));
await sql`insert into vendor_member (vendor_id, user_id, role) values (${A.id}, ${ids.o}, 'owner')`;
await sql`insert into platform_role (user_id, role) values (${ids.t}, 'admin')`;
const cookie = {};
for (const who of ['p', 'q', 'o']) cookie[who] = cookieFor(await passwordSession(email(who)));
cookie.t = cookieFor(await twoStepSession(email('t')));

console.log('Rows, cards and the profile');
let r = await site('/explore');
check('signed out, Browse local shows listed businesses in their main kind’s row', r.status === 200 && r.body.includes(`id="rail-${kind.slug}"`)
  && r.body.includes(A.name) && r.body.includes(B.name) && r.body.includes(U.name) && !r.body.includes(H.name), String(r.status));
check('…with the top bar: search, Show (All), Within (Any, its slider tucked inside), Rating, Sort and Reset', r.body.includes('Search by name or what they do...')
  && r.body.includes('id="within" type="range"') && words(r.body).includes('50 km+') && words(r.body).includes('Within Any') && r.body.includes('4.8 &amp; up') && r.body.includes('Fastest reply')
  && r.body.includes('>Reset<') && r.body.includes('>All<'));
// The count line under the map is gone (the owner, 24 October 2026).
check('…the count line under the map, with Expand list', /\d+ businesses · Click a business to open the profile/.test(words(r.body)) && words(r.body).includes('Expand list'));
check('…the + asks to sign in first and comes back here; the heart works without an account',
  r.body.includes(`href="/join?next=${encodeURIComponent('/explore')}"`) && r.body.includes(`Sign in to add ${A.name} to your shortlist`)
  && r.body.includes(`aria-label="Add ${A.name} to favourites"`));
check('…a card shows its own kind within the main one', !sub || words(r.body).includes(sub.name));
check('…and no shortlist bar, no footer and no light/dark switch', !r.body.includes('aria-label="Your shortlist"')
  && !r.body.includes('<footer') && !r.body.includes('action="/theme"'));

r = await site(`/vendors/${A.slug}`);
check('a business’s own address opens Browse local with its profile open', r.status === 200 && r.body.includes(`aria-label="${A.name}"`)
  && r.body.includes(`href="/vendors/${A.slug}/message"`) && words(r.body).includes(`Message ${A.name}`), String(r.status));
check('…its link preview names the business', r.body.includes(`<meta property="og:title" content="${A.name}`) || r.body.includes(`<title>${A.name}`));
r = await site(`/vendors/${U.slug}`);
check('a business not on Localites yet offers Inquire', r.body.includes(`href="/vendors/${U.slug}/inquire"`) && !r.body.includes(`/vendors/${U.slug}/message`));
r = await site(`/vendors/${H.slug}`);
check('a business that isn’t listed isn’t found', r.status === 404, String(r.status));
r = await site(`/vendors/${A.slug}/panel`);
const panel = r.status === 200 ? JSON.parse(r.body) : null;
check('the panel’s own data: its reviews, nothing private', panel && panel.reviews && typeof panel.reviews.count === 'number'
  && !('email' in panel) && !JSON.stringify(panel).includes('@'), String(r.status));
r = await site(`/vendors/${H.slug}/panel`);
check('…and nothing for a business that isn’t listed', r.status === 404, String(r.status));

console.log('\nThe + and the heart');
r = await site('/shortlist', { cookie: cookie.p, method: 'POST', form: { intent: 'add', slug: A.slug, back: '/explore' } });
check('the + adds a business to the shortlist and goes back', r.status === 302 && r.location === '/explore', `${r.status} ${r.location}`);
r = await site('/shortlist', { cookie: cookie.p, method: 'POST', form: { intent: 'add', slug: A.slug, inline: '1' } });
check('…twice is the same as once', r.status === 200 && (await sql`select count(*)::int as n from shortlist where user_id = ${ids.p}`)[0].n === 1, String(r.status));
r = await site('/shortlist', { cookie: cookie.p, method: 'POST', form: { intent: 'add', slug: H.slug } });
check('a business that isn’t listed can’t be added', r.status === 404, String(r.status));
r = await site('/shortlist', { cookie: cookie.p, method: 'POST', form: { intent: 'save', slug: B.slug, inline: '1' } });
check('the heart saves a favourite to the account when signed in', r.status === 200
  && (await sql`select count(*)::int as n from saved_vendor where user_id = ${ids.p} and vendor_id = ${B.id}`)[0].n === 1, String(r.status));
r = await site('/shortlist', { method: 'POST', form: { intent: 'add', slug: B.slug } });
check('signed out, nothing is added (sent to sign in)', r.status === 302 && r.location.startsWith('/join'), `${r.status} ${r.location}`);
r = await site('/shortlist', { cookie: cookie.p, method: 'POST', form: { intent: 'add', slug: A.slug, back: 'https://evil.example/' } });
check('…and it only ever goes back to a page on this site', r.status === 302 && r.location === '/', r.location);

r = await site('/explore', { cookie: cookie.p });
check('signed in: the shortlist bar shows what’s on it, with Message all and no events button', r.body.includes('aria-label="Your shortlist"')
  && r.body.includes(`Remove ${A.name} from your shortlist`) && r.body.includes('href="/shortlist/message"') && !r.body.includes('Add these to an event'));
check('…the card says it’s on the shortlist, and the other is a favourite', r.body.includes(`aria-label="Remove ${A.name} from your shortlist"`)
  && r.body.includes(`aria-label="Remove ${B.name} from favourites"`));
check('…and the menu has Edit profile, Messages and Sign out, not My events', words(r.body).includes('Edit profile') && r.body.includes('href="/account"')
  && r.body.includes('href="/messages"') && words(r.body).includes('Sign out') && !r.body.includes('href="/events"'));
r = await site('/explore', { cookie: cookie.q });
check('someone else sees none of it: no bar, nothing marked', !r.body.includes('aria-label="Your shortlist"')
  && r.body.includes(`aria-label="Add ${A.name} to your shortlist"`) && r.body.includes(`aria-label="Add ${B.name} to favourites"`));
r = await site('/explore', { cookie: cookie.o });
check('a business owner’s menu has My business', r.body.includes('href="/business"'));

console.log('\nIn the browser: search, filters, sort and the panel');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const cardNames = async () => page.$$eval('article h3', (hs) => hs.map((h) => h.textContent));
await page.goto(`${BASE}/explore`, { waitUntil: 'networkidle' });
await page.fill('#q', `alpha bakery ${run}`);
let names = await cardNames();
check('typing finds a business by its name, at once', names.includes(A.name) && !names.includes(B.name), names.join(', '));
await page.fill('#q', 'alpa bakry');
names = await cardNames();
check('…and forgives spelling (“alpa bakry”)', names.includes(A.name) && !names.includes(B.name), names.join(', '));
await page.fill('#q', 'cakes for every party');
names = await cardNames();
check('…or by what it does', names.includes(A.name) && !names.includes(B.name));
await page.fill('#q', `zzz-nothing-${run}`);
check('nothing found: Base44’s words, and Suggest a business', (await page.textContent('body')).includes('Nothing matches those filters')
  && (await page.$('a[href^="/suggest"]')) !== null);
await page.click('button:has-text("Reset")');
check('the distance slider is hidden until Within is pressed', !(await page.isVisible('#within')));
await page.click('summary:has-text("Within")');
await page.fill('#within', '3');
names = await cardNames();
check('“Within 3 km” keeps the business downtown and leaves out Washago', names.includes(A.name) && !names.includes(B.name) && !names.includes(U.name));
check('…and the button says so', (await page.textContent('summary:has-text("Within")')).includes('3 km'));
await page.fill('#within', '50');
await page.mouse.click(640, 880);
check('…a click anywhere else tucks the slider away', !(await page.isVisible('#within')));
await page.selectOption('#rating', '4.8');
names = await cardNames();
check('“4.8 & up” leaves out businesses with no rating yet', !names.includes(A.name) && !names.includes(B.name));
await page.click('button:has-text("Reset")');
await page.selectOption('#sort', 'near');
names = await cardNames();
check('“Closest” puts downtown before Washago, and no-pin businesses last', names.indexOf(A.name) < names.indexOf(B.name) && names.indexOf(B.name) < names.indexOf(U.name));
await page.click(`button[aria-label="Open ${A.name}"]`);
await page.waitForSelector(`aside[aria-label="${A.name}"]`);
check('tapping a card opens its profile, and its address names it', page.url().includes(`v=${A.slug}`));
await page.keyboard.press('Escape');
await page.waitForSelector(`aside[aria-label="${A.name}"]`, { state: 'detached' });
check('Esc closes it', !page.url().includes('v='));
await page.click(`button[aria-label="Add ${B.name} to favourites"]`);
check('signed out, the heart keeps a favourite in this browser', (await page.getAttribute(`button[aria-label="Remove ${B.name} from favourites"]`, 'aria-pressed')) === 'true');
await page.reload({ waitUntil: 'networkidle' });
check('…and still after a reload', (await page.$(`button[aria-label="Remove ${B.name} from favourites"]`)) !== null);
const at = async (sel) => page.$eval(sel, (el) => el.getBoundingClientRect().toJSON());
const [fav, reset, sortBox] = [await at('button:has-text("Favourites")'), await at('button:has-text("Reset")'), await at('#sort')];
check('Favourites sits at the far right of the bar; Reset stays next to the filters', fav.x > 1280 * 0.8 && reset.x > sortBox.x && reset.x < fav.x,
  `${Math.round(fav.x)} ${Math.round(reset.x)}`);
check('…and no Curator’s note on a profile', !(await page.textContent('body')).includes('Curator'));

console.log('\nThe owner’s additions (24 October 2026)');
const stepCount = async () => (await page.textContent('aside [class*="stepCount"]'))?.replace(/\s+/g, ' ').trim() ?? '';
await page.click('button:has-text("Favourites")');
names = await cardNames();
check('Favourites shows only the favourites', names.length === 1 && names[0] === B.name, names.join(', '));
await page.click('button:has-text("Favourites")');
await page.click('summary:has-text("Show")');
await page.click(`label:has-text("${kind2.name}")`);
names = await cardNames();
check('Show: ticking a kind leaves only that kind', !names.includes(A.name) && !names.includes(B.name));
await page.click('button:has-text("Show all kinds")');
names = await cardNames();
check('…and “Show all kinds” brings every kind back', names.includes(A.name) && names.includes(B.name));
await page.click('summary:has-text("Show")');
check('it starts with the map and the rows', (await page.$('[aria-label="Map of the businesses that shared an address"]')) !== null && names.length > 0);
await page.click('button:has-text("Expand list")');
check('Expand list: only the rows, no map, and Collapse', (await page.$('[aria-label="Map of the businesses that shared an address"]')) === null
  && (await cardNames()).length > 0 && (await page.$('button:has-text("Collapse")')) !== null);
await page.click('button:has-text("Collapse")');
await page.click('button:has-text("Expand map")');
await page.waitForSelector('[aria-label="Map of the businesses that shared an address"]');
const strip = await page.$$eval('[class*="strip"] article h3', (hs) => hs.map((h) => h.textContent));
check('Map: the businesses in one line along the bottom of the map', strip.includes(A.name) && strip.includes(B.name), strip.length);
await page.click(`[class*="strip"] button[aria-label="Open ${A.name}"]`);
await page.waitForSelector(`aside[aria-label="${A.name}"]`);
check('…tapping one there opens its profile beside the map', page.url().includes(`v=${A.slug}`));
await page.keyboard.press('Escape');
check('…and the count line is out of the way', !(await page.isVisible('button:has-text("Expand list")')));
await page.click('button:has-text("Collapse")');
await page.waitForSelector('[aria-label="Map of the businesses that shared an address"]');
check('“Search this area” waits until there’s something to search', await page.isDisabled('button:has-text("Search this area")'));
await page.selectOption('#rating', '4');
check('…a changed filter makes it clickable', !(await page.isDisabled('button:has-text("Search this area")')));
await page.selectOption('#rating', '');
check('…changed back, there’s nothing new to search', await page.isDisabled('button:has-text("Search this area")'));
// Open A and close it, so the map is centred on it before it's moved a little.
await page.click(`button[aria-label="Open ${A.name}"]`);
await page.waitForSelector(`aside[aria-label="${A.name}"]`);
await page.waitForTimeout(1000);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
const mapBox = await page.$eval('[aria-label="Map of the businesses that shared an address"]', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 3, y: r.y + r.height / 3 };
});
await page.mouse.move(mapBox.x, mapBox.y);
await page.mouse.down();
await page.mouse.move(mapBox.x + 40, mapBox.y + 20, { steps: 5 });
await page.mouse.up();
check('…moving the map makes it clickable', !(await page.isDisabled('button:has-text("Search this area")')));
await page.click('button:has-text("Search this area")');
names = await cardNames();
check('…it keeps those on the map in view, and leaves out those with no address', names.includes(A.name) && !names.includes(U.name), names.join(', '));
// The map may still be gliding from the drag; give the button a moment to settle.
const faded = await page.waitForSelector('button:has-text("Search this area"):disabled', { timeout: 3000 }).then(() => true, () => false);
check('…and fades again until the map moves or a filter changes', faded);
await page.click('button:has-text("Reset")');
names = await cardNames();
check('Reset brings back the whole area', names.includes(U.name));
await page.click(`button[aria-label="Open ${A.name}"]`);
await page.waitForSelector(`aside[aria-label="${A.name}"]`);
check('‹ › steps through every business the filters show, not just one kind', (await stepCount()).endsWith(`/ ${names.length}`), `${await stepCount()} of ${names.length}`);
await page.keyboard.press('Escape');
const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
await phone.goto(`${BASE}/vendors/${A.slug}`, { waitUntil: 'networkidle' });
check('on a phone, an open profile is the whole screen: no rows squeezed beside it',
  !(await phone.isVisible(`#rail-${kind.slug}`)) && (await phone.isVisible(`aside[aria-label="${A.name}"]`)));
await phone.close();
await page.goto(`${BASE}/vendors/${A.slug}`, { waitUntil: 'networkidle' });
await page.click('button[aria-label="Close profile"]');
await page.waitForSelector(`aside[aria-label="${A.name}"]`, { state: 'detached' });
check('a business’s own address can be closed too', (await page.$(`aside[aria-label="${A.name}"]`)) === null);
await page.click(`button[aria-label="Open ${A.name}"]`);
await page.click('button[aria-label="Expand to sheet"]');
await page.waitForSelector(`[role="dialog"][aria-label="${A.name}"]`);
check('expanded, the profile is a sheet over the page, with its ×', (await page.$('[role="dialog"] button[aria-label="Close profile"]')) !== null);
await page.mouse.click(4, 896);
await page.waitForSelector('[role="dialog"]', { state: 'detached' });
check('…a click outside it closes it', (await page.$(`aside[aria-label="${A.name}"]`)) === null);
const signedIn = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await signedIn.addCookies(cookie.p.split('; ').map((pair) => {
  const [name, value] = pair.split('=');
  return { name, value, domain: new URL(BASE).hostname, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' };
}));
const me = await signedIn.newPage();
await me.goto(`${BASE}/explore`, { waitUntil: 'networkidle' });
const [favAt, menuAt] = [await me.$eval('button:has-text("Favourites")', (el) => el.getBoundingClientRect().x), await me.$eval('summary[aria-label="Your menu"]', (el) => el.getBoundingClientRect().x)];
check('signed in: the profile button is at the far right, Favourites just left of it', menuAt > favAt && menuAt > 1280 * 0.9, `${Math.round(favAt)} ${Math.round(menuAt)}`);
await me.click('summary[aria-label="Your menu"]');
check('…it opens Edit profile and Sign out', await me.isVisible('a:has-text("Edit profile")') && await me.isVisible('button:has-text("Sign out")'));
await me.mouse.click(640, 600);
check('…and a click anywhere else closes it', !(await me.isVisible('a:has-text("Edit profile")')));
await signedIn.close();
await browser.close();

console.log('\nClear all on the shortlist bar');
for (const v of [A, B]) await site('/shortlist', { cookie: cookie.p, method: 'POST', form: { intent: 'add', slug: v.slug, inline: '1' } });
await site('/shortlist', { cookie: cookie.q, method: 'POST', form: { intent: 'add', slug: A.slug, inline: '1' } });
r = await site('/explore', { cookie: cookie.p });
check('the shortlist bar has Clear all beside Message all, and × on each', words(r.body).includes('Clear all') && words(r.body).includes('Message all')
  && r.body.includes(`Remove ${A.name} from your shortlist`));
r = await site('/shortlist', { cookie: cookie.p, method: 'POST', form: { intent: 'clear', inline: '1' } });
const left = async (id) => (await sql`select count(*)::int as n from shortlist where user_id = ${id}`)[0].n;
check('Clear all empties their own shortlist, and nobody else’s', r.status === 200 && (await left(ids.p)) === 0 && (await left(ids.q)) === 1, String(r.status));
r = await site('/shortlist', { method: 'POST', form: { intent: 'clear' } });
check('…signed out, nothing is cleared (sent to sign in)', r.status === 302 && r.location.startsWith('/join') && (await left(ids.q)) === 1, `${r.status} ${r.location}`);

console.log('\nThe team sets the profile details');
r = await site(`/admin/listings/${A.id}`, { cookie: cookie.t });
check('the team’s listing page has Neighbourhood, Tags and Curator’s note', r.body.includes('Profile details') && r.body.includes('id="curatorNote"'));
r = await site(`/admin/listings/${A.id}`, { cookie: cookie.t, method: 'POST', form: { intent: 'profile', neighbourhood: 'Downtown', tags: 'Nut free, Seats 40', curatorNote: 'Order the tarts.' } });
const [details] = await sql`select neighbourhood, tags, curator_note from vendor where id = ${A.id}`;
check('…the team saves them, and they’re in the history', r.status === 302 && details.neighbourhood === 'Downtown' && details.curator_note === 'Order the tarts.'
  && (await sql`select count(*)::int as n from audit_log where subject_id = ${A.id} and action = 'vendor.profile_details'`)[0].n === 1, String(r.status));
r = await site(`/vendors/${A.slug}`);
check('…and the profile shows the neighbourhood and tags, but no Curator’s note (the owner, 25 October 2026)', !r.body.includes('Order the tarts.')
  && !r.body.includes('Curator') && r.body.includes('Seats 40') && r.body.includes('Downtown'));
r = await site(`/admin/listings/${A.id}`, { cookie: cookie.o, method: 'POST', form: { intent: 'profile', curatorNote: 'Best in town!' } });
check('a business owner can’t write the Curator’s note', r.status !== 302 && (await sql`select curator_note from vendor where id = ${A.id}`)[0].curator_note === 'Order the tarts.', String(r.status));
r = await site(`/admin/listings/${A.id}`, { cookie: cookie.t, method: 'POST', form: { intent: 'profile', tags: 'a,b,c,d,e,f,g' } });
check('…and seven tags are refused, nothing changed', r.status === 400 && (await sql`select tags from vendor where id = ${A.id}`)[0].tags.length === 2, String(r.status));

await finish('browse local');
