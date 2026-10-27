// Browse local in the Base44 design (D-59; D-57 and migration 0053 before it): a row for each
// main kind of business (D-60) with every listed business as a small card, the heart (favourites)
// and the + (shortlist) on each card, the profile panel with Message or Inquire, and the shortlist
// bar with Message all. Search and the Filters list (Categories, Rating, Sort, Reset; D-64) work in
// the browser, as on Base44, checked here in a real browser. No distances (the owner, 26 October 2026). A business's own web address opens the page with its profile
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
// A is downtown, B is in Washago, U isn't on Localites yet.
const A = await business('a', 'Browse Alpha Bakery', { tagline: 'Cakes for every party', pin: [44.6086, -79.4184], category: sub ?? kind });
const B = await business('b', 'Browse Beta Bakery', { pin: [44.7504, -79.3329] });
const U = await business('u', 'Browse Unclaimed Bakery', { claim: 'unclaimed' });
// N is a block from A, so both dots fit on the map together.
const N = await business('n', 'Browse Near Bakery', { pin: [44.6094, -79.4170] });
const H = await business('h', 'Browse Hidden Bakery', { status: 'unpublished' });
const mine = async (id) => (await sql`select v.slug::text as slug from shortlist s join vendor v on v.id = s.vendor_id where s.user_id = ${id} order by v.slug`).map((x) => x.slug);
const mineNow = () => mine(ids.p);
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
check('…with the search first, and Filters inside it: Categories (All), Rating, Sort and Reset', r.body.includes('Search by name or what they do...')
  && r.body.includes('aria-label="Filters"') && words(r.body).includes('Categories All') && words(r.body).includes('Rating Any rating')
  && words(r.body).includes('Sort Top rated') && r.body.includes('>Reset<'));
check('…and no distances anywhere (the owner, 26 October 2026)', !words(r.body).includes('Within') && !words(r.body).includes('Closest') && !/\d+\.\d km/.test(words(r.body)));
// The count line under the map is gone (the owner, 24 October 2026).
check('…the count line under the map, with Expand list', /\d+ businesses · Click a business to open the profile/.test(words(r.body)) && words(r.body).includes('Expand list'));
check('…the + asks to sign in first and comes back here; the heart works without an account',
  r.body.includes(`href="/join?next=${encodeURIComponent('/explore')}"`) && r.body.includes(`Sign in to add ${A.name} to your picks`)
  && r.body.includes(`aria-label="Add ${A.name} to favourites"`));
check('…a card shows its own kind within the main one', !sub || words(r.body).includes(sub.name));
check('…and no shortlist bar, no footer and no light/dark switch', !r.body.includes('aria-label="My picks"')
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
check('signed in: My picks shows what’s on it, with “Message 1” and no events button', r.body.includes('aria-label="My picks"')
  && r.body.includes(`Remove ${A.name} from my picks`) && words(r.body).includes('Message 1') && r.body.includes('href="/shortlist/message"') && !r.body.includes('Add these to an event'));
check('…the card says it’s on the shortlist, and the other is a favourite', r.body.includes(`aria-label="Remove ${A.name} from my picks"`)
  && r.body.includes(`aria-label="Remove ${B.name} from favourites"`));
check('…and the menu has Edit profile, Messages and Sign out, not My events', words(r.body).includes('Edit profile') && r.body.includes('href="/account"')
  && r.body.includes('href="/messages"') && words(r.body).includes('Sign out') && !r.body.includes('href="/events"'));
r = await site('/explore', { cookie: cookie.q });
check('someone else sees none of it: no bar, nothing marked', !r.body.includes('aria-label="My picks"')
  && r.body.includes(`aria-label="Add ${A.name} to my picks"`) && r.body.includes(`aria-label="Add ${B.name} to favourites"`));
r = await site('/explore', { cookie: cookie.o });
check('a business owner’s menu lists their business to switch to', r.body.includes('href="/business?b='));

console.log('\nIn the browser: search, filters, sort and the panel');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const cardNames = async () => page.$$eval('article h3', (hs) => hs.map((h) => h.textContent));
// The Filters list (D-64): open it, open one line, and pick; Reset and Show results at its foot.
const LIST = '[class*="filterList"]';
const openFilters = async (p = page) => {
  if (!(await p.isVisible(LIST))) await p.click('summary[aria-label^="Filters"]');
};
const pick = async (line, choice, p = page) => {
  await openFilters(p);
  if ((await p.getAttribute(`${LIST} button:has-text("${line}")`, 'aria-expanded')) !== 'true') await p.click(`${LIST} button:has-text("${line}")`);
  await p.click(`${LIST} label:has-text("${choice}")`);
};
const done = async (p = page) => {
  if (await p.isVisible(LIST)) await p.click(`${LIST} button:has-text("Show results")`);
};
const resetFilters = async (p = page) => {
  await openFilters(p);
  await p.click(`${LIST} button:has-text("Reset")`);
  await done(p);
};
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
await page.click('[class*="empty"] button:has-text("Reset")');
check('…with Reset there, which brings everything back', (await page.inputValue('#q')) === '' && (await cardNames()).includes(A.name));
check('no distances on the cards', !(await page.textContent('body')).match(/\d+\.\d km/));
await openFilters();
check('Filters opens a short list, one line each, none of them open', (await page.$$eval(`${LIST} button[aria-expanded]`, (bs) => bs.map((b) => b.getAttribute('aria-expanded')))).join() === 'false,false,false');
await page.click(`${LIST} button:has-text("Sort")`);
const sorts = await page.$$eval(`${LIST} fieldset label`, (ls) => ls.map((l) => l.textContent.trim()));
check('…tapping a line opens only that one: Sort has no “Closest”', sorts.join('|') === 'Top rated|Fastest reply|Most reviewed', sorts.join('|'));
await pick('Rating', '4.8 & up');
check('…opening another closes the first', (await page.getAttribute(`${LIST} button:has-text("Sort")`, 'aria-expanded')) === 'false');
await done();
names = await cardNames();
check('“4.8 & up” leaves out businesses with no rating yet', !names.includes(A.name) && !names.includes(B.name));
check('…and the Filters button counts it', (await page.getAttribute('summary[aria-label^="Filters"]', 'aria-label')) === 'Filters, 1 on');
await resetFilters();
await page.click(`button[aria-label="Open ${A.name}"]`);
await page.waitForSelector(`aside[aria-label="${A.name}"]`);
check('tapping a card opens its profile, and its address names it', page.url().includes(`v=${A.slug}`));
await page.keyboard.press('Escape');
await page.waitForSelector(`aside[aria-label="${A.name}"]`, { state: 'detached' });
check('Esc closes it', !page.url().includes('v='));
// Where each dot is on screen, and whether it's inside the map as it's now shown.
const dots = () => page.$$eval('.leaflet-marker-icon', (els) => {
  const box = els[0].ownerDocument.querySelector('[aria-label="Map of the businesses that shared an address"]').getBoundingClientRect();
  return els.map((el) => {
    const r = el.getBoundingClientRect();
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    return { name: el.getAttribute('title'), x: Math.round(x), y: Math.round(y), seen: x >= box.left && x <= box.right && y >= box.top && y <= box.bottom };
  });
});
// Let the map settle from closing the last profile first.
await page.waitForTimeout(1500);
const full = (await dots()).filter((d) => d.seen);
await page.click(`button[aria-label="Open ${A.name}"]`);
await page.waitForSelector(`aside[aria-label="${A.name}"]`);
await page.waitForTimeout(1500);
const narrowed = new Set((await dots()).filter((d) => d.seen).map((d) => d.name));
check('opening a business narrows the map, and every business that was in view still is', full.length > 1 && full.every((d) => narrowed.has(d.name)),
  `${full.length} before, missing: ${full.filter((d) => !narrowed.has(d.name)).map((d) => d.name).join(', ')}`);
await page.keyboard.press('Escape');
await page.waitForTimeout(1500);
const back = await dots();
check('…closing it puts the full view back, every dot where it was', full.every((d) => back.some((b) => b.name === d.name && Math.abs(b.x - d.x) <= 3 && Math.abs(b.y - d.y) <= 3)));
const mapAt = () => page.$eval('.leaflet-map-pane', (el) => el.style.transform);
await page.click(`button[aria-label="Open ${A.name}"]`);
await page.waitForTimeout(1200);
const before = await mapAt();
await page.click(`button[aria-label="Open ${N.name}"]`);
await page.waitForSelector(`aside[aria-label="${N.name}"]`);
await page.waitForTimeout(1200);
check('switching to a business already on the map leaves the map where it is; only its dot changes', (await mapAt()) === before
  && (await page.$$('[class*="dotOpen"]')).length === 1, `${before} → ${await mapAt()}`);
await page.click(`button[aria-label="Open ${B.name}"]`);
await page.waitForSelector(`aside[aria-label="${B.name}"]`);
await page.waitForTimeout(1200);
check('…one out of sight (Washago) brings the map to it', (await mapAt()) !== before);
await page.keyboard.press('Escape');
await page.click(`button[aria-label="Add ${B.name} to favourites"]`);
check('signed out, the heart keeps a favourite in this browser', (await page.getAttribute(`button[aria-label="Remove ${B.name} from favourites"]`, 'aria-pressed')) === 'true');
await page.reload({ waitUntil: 'networkidle' });
check('…and still after a reload', (await page.$(`button[aria-label="Remove ${B.name} from favourites"]`)) !== null);
const at = async (sel) => page.$eval(sel, (el) => el.getBoundingClientRect().toJSON());
const [search, filters, msgs, comm, fav, expand] = [await at('[role="search"]'), await at('summary[aria-label^="Filters"]'),
  await at('header a[aria-label="Messages"]'), await at('header a[aria-label="Community"]'), await at('[class*="viewbar"] button:has-text("Favourites")'), await at('button:has-text("Expand list")')];
// The owner, 26 October 2026: "I like the icons" at the right, and "search first", Filters inside it;
// 27 October: Favourites is a button left of Expand list, not in the top bar; no Browse icon.
check('the search in the middle with Filters inside it; Messages then Community at the right; no Favourites or Browse up there',
  Math.abs(search.x + search.width / 2 - 640) < 160 && filters.x > search.x && filters.x + filters.width <= search.x + search.width
  && msgs.x > search.x + search.width && msgs.x < comm.x && (await page.$('header a[aria-label="Browse"]')) === null
  && (await page.$('header a[title="Favourites"], header button:has-text("Favourites")')) === null,
  `${Math.round(search.x)}+${Math.round(search.width)} ${Math.round(filters.x)} ${Math.round(msgs.x)} ${Math.round(comm.x)}`);
check('…Favourites sits just left of Expand list, on the bar above the rows', fav.x < expand.x && Math.abs(fav.y - expand.y) < 12 && fav.y > search.y + search.height,
  `${Math.round(fav.x)},${Math.round(fav.y)} ${Math.round(expand.x)},${Math.round(expand.y)}`);
check('…and no Curator’s note on a profile', !(await page.textContent('body')).includes('Curator'));

console.log('\nThe owner’s additions (24 October 2026)');
const stepCount = async () => (await page.textContent('aside [class*="stepCount"]'))?.replace(/\s+/g, ' ').trim() ?? '';
const FAV = '[class*="viewbar"] button:has-text("Favourites")';
await page.click(FAV);
await page.waitForURL(/fav=1/);
await page.waitForTimeout(300);
names = await cardNames();
check('Favourites shows only the favourites', names.length === 1 && names[0] === B.name, names.join(', '));
check('…the button carries the count', (await page.textContent(FAV)).includes('1'));
await page.click(FAV);
await page.waitForTimeout(300);
names = await cardNames();
// The owner, 27 October 2026: "click favourites icon again it should stay on the favourite page".
check('…pressed again, it stays on the favourites', names.length === 1 && names[0] === B.name, names.join(', '));
await page.click('button[aria-label="Show all businesses"]');
await page.waitForURL((u) => !u.search.includes('fav'));
await page.waitForTimeout(300);
names = await cardNames();
check('…the × beside it goes back to the whole list', names.includes(A.name) && names.includes(B.name) && (await page.$('button[aria-label="Show all businesses"]')) === null, names.join(', '));
await page.click(FAV);
await page.waitForURL(/fav=1/);
await page.click('header a[class*="logo"]');
await page.waitForURL((u) => !u.search.includes('fav'));
await page.waitForTimeout(300);
names = await cardNames();
check('…and the Localites wordmark goes back to all of Browse local', names.includes(A.name) && names.includes(B.name), names.join(', '));
await pick('Categories', kind2.name);
names = await cardNames();
check('Categories: ticking a kind leaves only that kind', !names.includes(A.name) && !names.includes(B.name));
check('…its line says which', (await page.textContent(`${LIST} button:has-text("Categories")`)).includes(kind2.name));
await page.click(`${LIST} button:has-text("Reset")`);
names = await cardNames();
check('…and Reset brings every kind back', names.includes(A.name) && names.includes(B.name));
await done();
check('Show results closes the list', !(await page.isVisible(LIST)));
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
await pick('Rating', '4.0 & up');
await done();
check('…a changed filter makes it clickable', !(await page.isDisabled('button:has-text("Search this area")')));
await pick('Rating', 'Any rating');
await done();
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
await resetFilters();
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
// The other businesses stay in reach along the bottom (the owner, 26 October 2026).
const PEEK = 'nav[aria-label="Other businesses in your search"]';
check('…with the other businesses in a row along the bottom, the open one marked', await phone.isVisible(PEEK)
  && (await phone.textContent(`${PEEK} [aria-current="true"]`))?.includes(A.name));
await phone.click(`${PEEK} button:has-text("${B.name}")`);
await phone.waitForSelector(`aside[aria-label="${B.name}"]`);
check('…a tap there opens another', phone.url().includes(`v=${B.slug}`) && (await phone.textContent(`${PEEK} [aria-current="true"]`))?.includes(B.name));
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

const [msgsAt, menuAt] = [await me.$eval('header a[aria-label^="Messages"]', (el) => el.getBoundingClientRect().x), await me.$eval('summary[aria-label="Your menu"]', (el) => el.getBoundingClientRect().x)];
const commAt = await me.$eval('header a[aria-label="Community"]', (el) => el.getBoundingClientRect().x);
check('signed in: the profile button is at the far right, with Messages and Community left of it',
  menuAt > commAt && commAt > msgsAt && menuAt > 1280 * 0.9, `${Math.round(msgsAt)} ${Math.round(commAt)} ${Math.round(menuAt)}`);
await me.goto(`${BASE}/community`, { waitUntil: 'networkidle' });
check('on other pages (Community): Messages and Community, no Favourites or Browse icon',
  (await me.$('header a[aria-label^="Messages"]')) !== null && (await me.$('header a[title="Favourites"]')) === null && (await me.$('header a[aria-label="Browse"]')) === null);
await me.goto(`${BASE}/explore`, { waitUntil: 'networkidle' });
await me.click('summary[aria-label="Your menu"]');
check('…it opens Edit profile and Sign out (Messages is its own icon, not in the menu)', await me.isVisible('a:has-text("Edit profile")') && await me.isVisible('button:has-text("Sign out")')
  && (await me.$('nav[aria-label="Your pages"] a[href="/messages"]')) === null);
await me.mouse.click(640, 600);
check('…and a click anywhere else closes it', !(await me.isVisible('a:has-text("Edit profile")')));
await me.goto(`${BASE}/explore`, { waitUntil: 'networkidle' });
const CLEAR = '[aria-label="My picks"] button[aria-label="Clear all my picks"]';
const openPicks = async (p = me) => {
  if (!(await p.isVisible(`[aria-label="My picks"] button[aria-label^="Remove "]`))) await p.click('[aria-label="My picks"] summary');
};
check('My picks is the hairline pill: “1 pick”, Clear and Message 1, the list closed', await me.isVisible('[aria-label="My picks"] summary:has-text("1 pick")')
  && await me.isVisible(CLEAR) && await me.isVisible('[aria-label="My picks"] a:has-text("Message 1")')
  && !(await me.isVisible(`[aria-label="My picks"] button[aria-label="Remove ${A.name} from my picks"]`)));
await openPicks();
check('…tapping “1 pick” opens the list: the business, its own category and an ×', await me.isVisible(`[aria-label="My picks"] button[aria-label="Remove ${A.name} from my picks"]`)
  && (await me.textContent('[aria-label="My picks"] ul')).includes((sub ?? kind).name));
await me.click(CLEAR);
await me.waitForSelector('[role="status"]:has-text("Picks cleared")');
// The pointer resting on the note keeps it up while the test looks (it fades after 2 seconds).
await me.hover('[role="status"]:has-text("Picks cleared")');
for (let i = 0; i < 30 && (await mineNow()).length > 0; i++) await me.waitForTimeout(100);
check('Clear all: the bar goes and “Picks cleared · Undo” shows', !(await me.isVisible('[aria-label="My picks"]')) && (await mineNow()).length === 0);
await me.click('button:has-text("Undo")');
await me.waitForSelector('[aria-label="My picks"] summary:has-text("1 pick")');
// The pill can still be showing from before the Undo is saved: wait for the picks themselves.
for (let i = 0; i < 30 && !(await mineNow()).includes(A.slug); i++) await me.waitForTimeout(100);
await me.waitForLoadState('networkidle');
await me.waitForLoadState('networkidle');
check('…Undo puts them back', (await mineNow()).includes(A.slug));
await openPicks();
await me.click(`[aria-label="My picks"] button[aria-label="Remove ${A.name} from my picks"]`);
await me.waitForSelector(`[role="status"]:has-text("${A.name} removed")`);
check('taking one business off with its × offers Undo too', (await me.isVisible('button:has-text("Undo")')));
const noteMiddle = async () => me.$eval('[role="status"]:has(button:has-text("Undo"))', (el) => { const b = el.getBoundingClientRect(); return b.x + b.width / 2; });
check('…the note in the middle of the page, with no profile open', Math.abs((await noteMiddle()) - 640) < 40, String(Math.round(await noteMiddle())));
await me.click('button:has-text("Undo")');
await me.waitForSelector('[aria-label="My picks"] summary:has-text("1 pick")');
// The pill can still be showing from before the Undo is saved: wait for the picks themselves.
for (let i = 0; i < 30 && !(await mineNow()).includes(A.slug); i++) await me.waitForTimeout(100);
await me.waitForLoadState('networkidle');
check('…and Undo puts it back', (await mineNow()).includes(A.slug));
await openPicks();
await me.click(`[aria-label="My picks"] button[aria-label="Remove ${A.name} from my picks"]`);
await me.waitForSelector(`[role="status"]:has-text("${A.name} removed")`);
// Somewhere plain (the count of businesses shown), so the click opens nothing else.
await me.click('p[class*="count"]');
const fadedAtOnce = await me.waitForSelector(`[role="status"]:has-text("${A.name} removed")`, { state: 'detached', timeout: 1000 }).then(() => true, () => false);
check('a click anywhere else fades the Undo note at once, and it stays removed', fadedAtOnce && !(await mineNow()).includes(A.slug));
await me.click(`[class*="cardButtons"] button[aria-label="Add ${A.name} to my picks"]`);
for (let i = 0; i < 30 && !(await mineNow()).includes(A.slug); i++) await me.waitForTimeout(100);
const tick = `[class*="cardButtons"] button[aria-label="Remove ${A.name} from my picks"]`;
await me.waitForSelector(tick);
check('a picked business’s + is a solid dark circle with a tick, not the outline +', (await me.$eval(tick, (el) => el.ownerDocument.defaultView.getComputedStyle(el).backgroundColor)) === 'rgb(28, 26, 23)');
await me.click(tick);
await me.waitForSelector(`[role="status"]:has-text("${A.name} removed")`);
await me.click('button:has-text("Undo")');
await me.waitForSelector(tick);
for (let i = 0; i < 30 && !(await mineNow()).includes(A.slug); i++) await me.waitForTimeout(100);
check('…unticking it on the card offers Undo as well', (await mineNow()).includes(A.slug));
// The owner, 27 October 2026: with a profile open, the note is in the middle of the list beside it.
await me.goto(`${BASE}/explore?v=${B.slug}`, { waitUntil: 'networkidle' });
await me.waitForSelector(`aside[aria-label="${B.name}"]`);
await openPicks();
await me.click(`[aria-label="My picks"] button[aria-label="Remove ${A.name} from my picks"]`);
await me.waitForSelector(`[role="status"]:has-text("${A.name} removed")`);
const listMiddle = await me.$eval(`aside[aria-label="${B.name}"]`, (el) => el.getBoundingClientRect().x / 2);
check('…with a profile open, the Undo note is in the middle of the list, not the page', Math.abs((await noteMiddle()) - listMiddle) < 40,
  `${Math.round(await noteMiddle())} ${Math.round(listMiddle)}`);
await me.click('button:has-text("Undo")');
for (let i = 0; i < 30 && !(await mineNow()).includes(A.slug); i++) await me.waitForTimeout(100);
await me.goto(`${BASE}/explore`, { waitUntil: 'networkidle' });
await me.click(CLEAR);
await me.waitForSelector('[role="status"]:has-text("Picks cleared")');
await me.mouse.move(5, 5);
await me.waitForTimeout(1000);
const stillUp = await me.isVisible('[role="status"]:has-text("Picks cleared")');
const gone = await me.waitForSelector('[role="status"]:has-text("Picks cleared")', { state: 'detached', timeout: 2500 }).then(() => true, () => false);
check('…and left alone, the note stays up for 2 seconds, then fades, the picks still cleared', stillUp && gone && (await mineNow()).length === 0);
await site('/shortlist', { cookie: cookie.p, method: 'POST', form: { intent: 'add', slug: A.slug, inline: '1' } });
const pocket = await signedIn.newPage();
await pocket.setViewportSize({ width: 390, height: 844 });
await pocket.goto(`${BASE}/explore`, { waitUntil: 'networkidle' });
const onScreen = async (sel) => (await pocket.locator(`${sel}:visible`).count()) > 0;
const removeA = `[aria-label="My picks"] button[aria-label="Remove ${A.name} from my picks"]`;
check('on a phone, the same pill: how many, Clear and Message 1 in reach, the list closed',
  (await onScreen('[aria-label="My picks"] summary:has-text("1 pick")')) && (await onScreen(CLEAR))
  && (await onScreen('[aria-label="My picks"] a:has-text("Message 1")')) && !(await onScreen(removeA)));
await pocket.click('[aria-label="My picks"] summary');
check('…tapping it opens the list, with an × on each', await onScreen(removeA));
await pocket.mouse.click(195, 200);
check('…and tapping anywhere else closes it', !(await onScreen(removeA)));
await signedIn.close();
await browser.close();

console.log('\nClear all on the shortlist bar');
for (const v of [A, B, U]) await site('/shortlist', { cookie: cookie.p, method: 'POST', form: { intent: 'add', slug: v.slug, inline: '1' } });
await site('/shortlist', { cookie: cookie.q, method: 'POST', form: { intent: 'add', slug: A.slug, inline: '1' } });
r = await site('/explore', { cookie: cookie.p });
check('My picks has Clear beside “Message all 2” (U isn’t on Localites, so not counted), and × on each', r.body.includes('aria-label="Clear all my picks"')
  && words(r.body).includes('Message all 2') && r.body.includes(`Remove ${A.name} from my picks`) && r.body.includes(`Remove ${U.name} from my picks`));
r = await site('/shortlist', { cookie: cookie.p, method: 'POST', form: { intent: 'clear', inline: '1' } });
const left = async (id) => (await sql`select count(*)::int as n from shortlist where user_id = ${id}`)[0].n;
check('Clear all empties their own shortlist, and nobody else’s', r.status === 200 && (await left(ids.p)) === 0 && (await left(ids.q)) === 1, String(r.status));
r = await site('/shortlist', { method: 'POST', form: { intent: 'clear' } });
check('…signed out, nothing is cleared (sent to sign in)', r.status === 302 && r.location.startsWith('/join') && (await left(ids.q)) === 1, `${r.status} ${r.location}`);
r = await site('/shortlist', { cookie: cookie.p, method: 'POST', form: { intent: 'restore', slugs: [A.slug, B.slug, U.slug, H.slug].join(','), inline: '1' } });
check('Undo puts back what was cleared, listed businesses only (not one taken down)', r.status === 200
  && JSON.stringify(await mine(ids.p)) === JSON.stringify([A.slug, B.slug, U.slug].sort()) && (await left(ids.q)) === 1, `${r.status} ${await mine(ids.p)}`);
r = await site('/shortlist', { cookie: cookie.p, method: 'POST', form: { intent: 'restore', slugs: [A.slug, B.slug].join(','), inline: '1' } });
check('…twice is the same as once', r.status === 200 && (await left(ids.p)) === 3, String(r.status));
r = await site('/shortlist', { cookie: cookie.p, method: 'POST', form: { intent: 'restore', slugs: `${A.slug},not a slug`, inline: '1' } });
check('…anything that isn’t a business’s address is refused', r.status === 400, String(r.status));
r = await site('/shortlist', { cookie: cookie.p, method: 'POST', form: { intent: 'restore', slugs: Array.from({ length: 31 }, (_, i) => `x-${i}`).join(','), inline: '1' } });
check('…and so are more than the picks can hold', r.status === 400, String(r.status));
r = await site('/shortlist', { method: 'POST', form: { intent: 'restore', slugs: A.slug } });
check('…signed out, nothing is put back (sent to sign in)', r.status === 302 && r.location.startsWith('/join'), `${r.status} ${r.location}`);
await site('/shortlist', { cookie: cookie.q, method: 'POST', form: { intent: 'clear', inline: '1' } });
await site('/shortlist', { cookie: cookie.p, method: 'POST', form: { intent: 'restore', slugs: A.slug, inline: '1' } });
check('…and only ever into their own picks', (await left(ids.q)) === 0);
const fillers = [];
for (let i = (await left(ids.p)); i < 30; i++) fillers.push(await business(`fill${i}`, `Browse Filler ${i}`));
for (const f of fillers) await sql`insert into shortlist (user_id, vendor_id) values (${ids.p}, ${f.id})`;
const Z = await business('z', 'Browse Zeta Bakery');
r = await site('/shortlist', { cookie: cookie.p, method: 'POST', form: { intent: 'restore', slugs: Z.slug, inline: '1' } });
check('…with the picks full (30), Undo says not all of them fit, and adds nothing', r.status === 409 && words(r.body).includes('Not all of them fit')
  && (await left(ids.p)) === 30, String(r.status));
await sql`delete from shortlist where user_id = ${ids.p} and vendor_id = any(${fillers.map((f) => f.id)}::uuid[])`;

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
