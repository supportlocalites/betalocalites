/* global document, window -- the code passed to page.evaluate runs in the browser */
// How the pages look and behave in a real browser (testing strategy: look checks), at
// phone size and computer size, signed out, as a person, as a business owner and as the
// team. On every page: nothing makes the page wider than the screen; no accessibility
// problems that the standard checker (axe-core, WCAG 2.2 A and AA rules, including tap
// target size and colour contrast) can find; and no errors in the page. Also checked open:
// the photo viewer and the profile-photo framing screen. A failed page's screenshot is
// saved in look-shots/ (kept by CI when something fails).
// Settings and safety checks: tests/e2e/helpers.mjs. Usage: npm run test:e2e
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { account, BASE, check, finish, MAIL, passwordSession, run, site, sql, twoStepSession } from './helpers.mjs';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const SHOTS = 'look-shots';
mkdirSync(SHOTS, { recursive: true });
const SIZES = [
  { name: 'phone', width: 360, height: 740 },
  { name: 'computer', width: 1280, height: 900 },
];

// ---- people and a business with everything filled in
const [town] = await sql`select id from municipality where is_active order by sort_order limit 1`;
const [kind] = await sql`select id from category where is_active order by sort_order limit 1`;
const [V] = await sql`
  insert into vendor (slug, display_name, primary_municipality_id, listing_status, published_at, claim_status, source,
                      tagline, description, website_url, public_phone)
  values (${`e2e-look-${run}`}, ${`Maple Crumb Bakery ${run}`}, ${town.id}, 'published', now(), 'claimed', 'admin_entered',
          'Custom cakes for birthdays and weddings', ${'Family bakery on Mississaga Street.\nEvery cake is made to order.'},
          'https://example.test/maple', '705-555-0123')
  returning id, slug::text as slug, display_name as name`;
await sql`insert into vendor_category (vendor_id, category_id, is_primary) values (${V.id}, ${kind.id}, true)`;
// A second business, only considered on the plan, so the plan shows both sections.
const [W] = await sql`
  insert into vendor (slug, display_name, primary_municipality_id, listing_status, published_at, claim_status, source)
  values (${`e2e-look-w-${run}`}, ${`Lakeside Balloons ${run}`}, ${town.id}, 'published', now(), 'unclaimed', 'admin_entered')
  returning id, slug::text as slug, display_name as name`;
await sql`insert into vendor_category (vendor_id, category_id, is_primary) values (${W.id}, ${kind.id}, true)`;
await sql`insert into vendor_service (vendor_id, name, description, pricing_model, price_cents, sort_order) values
  (${V.id}, 'Birthday cakes', 'Two tiers, any flavour', 'fixed', 8500, 1), (${V.id}, 'Cupcakes by the dozen', null, 'not_listed', null, 2)`;
const email = (who) => `e2e-look-${who}-${run}@example.test`;
const ids = {};
for (const who of ['owner', 'person', 'team']) ids[who] = await account(email(who));
await sql`insert into vendor_member (vendor_id, user_id, role) values (${V.id}, ${ids.owner}, 'owner')`;
await sql`insert into platform_role (user_id, role) values (${ids.team}, 'admin')`;
const sessions = {
  owner: await passwordSession(email('owner')),
  person: await passwordSession(email('person')),
  team: await twoStepSession(email('team')),
};
const cookieOf = (s) => `__Host-lc_at=${s.access_token}; __Host-lc_rt=${s.refresh_token}`;
const date = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
const made = await site('/events/new', {
  cookie: cookieOf(sessions.person),
  method: 'POST',
  form: { intent: 'create', title: `Ava's 6th birthday ${run}`, typeId: 'none', date, townId: town.id, guests: '15' },
});
const eventId = /^\/events\/([0-9a-f-]{36})/.exec(made.location)?.[1];
await site(`/vendors/${V.slug}/add`, { cookie: cookieOf(sessions.person), method: 'POST', form: { intent: 'add', eventId } });
const [planRow] = await sql`select id from event_vendor where event_id = ${eventId} and vendor_id = ${V.id}`;
await site(`/events/${eventId}/plan/${planRow.id}/book`, { cookie: cookieOf(sessions.person), method: 'POST' });
await site(`/vendors/${W.slug}/add`, { cookie: cookieOf(sessions.person), method: 'POST', form: { intent: 'add', eventId } });

const browser = await chromium.launch();
async function contextFor(who, size) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height } });
  const s = sessions[who];
  if (s) {
    const host = new URL(BASE).hostname;
    await ctx.addCookies(
      [
        ['__Host-lc_at', s.access_token],
        ['__Host-lc_rt', s.refresh_token],
      ].map(([name, value]) => ({ name, value, domain: host, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' })),
    );
  }
  return ctx;
}

// ---- the owner adds photos of three shapes and a wide logo, through the page itself
{
  const ctx = await contextFor('owner', SIZES[1]);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/vendors/${V.slug}/photos`);
  const picture = async (w, h, text) =>
    Buffer.from(
      await p.evaluate(
        async ([w, h, text]) => {
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const g = c.getContext('2d');
          const grad = g.createLinearGradient(0, 0, w, h);
          grad.addColorStop(0, '#c9a27e');
          grad.addColorStop(1, '#5a3e2b');
          g.fillStyle = grad;
          g.fillRect(0, 0, w, h);
          g.fillStyle = '#fbfaf8';
          g.font = `bold ${Math.round(h / 5)}px serif`;
          g.textAlign = 'center';
          g.fillText(text, w / 2, h / 2);
          const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let s = '';
          for (const b of bytes) s += String.fromCharCode(b);
          return btoa(s);
        },
        [w, h, text],
      ),
      'base64',
    );
  for (const [w, h, text, description] of [
    [1600, 900, 'WIDE', 'Wedding cake on the table'],
    [900, 1400, 'TALL', 'Three-tier cake'],
    [1200, 1200, 'SQUARE', 'Cupcakes'],
  ]) {
    const before = p.url();
    await p.setInputFiles('#file', { name: `${text}.jpg`, mimeType: 'image/jpeg', buffer: await picture(w, h, text) });
    await p.fill('#description', description);
    await p.click('button:has-text("Add photo")');
    await p.waitForURL((u) => u.search.includes('added=') && u.href !== before, { timeout: 20000 });
  }
  await p.setInputFiles('#profile-file', { name: 'logo.jpg', mimeType: 'image/jpeg', buffer: await picture(1400, 600, 'MAPLE CRUMB') });
  await p.fill('#profile-description', 'Maple Crumb logo');
  await p.click('button:has-text("Use this photo")');
  await p.waitForURL(/profile=/, { timeout: 20000 });
  await ctx.close();
  const shown = await sql`select count(*)::int as n from vendor_media where vendor_id = ${V.id}`;
  check('set-up: the business has three page photos and a profile photo', shown[0].n === 4, String(shown[0].n));
}

const found = await site(`/search?q=${run}`);
check('set-up: search finds the business, so its result row is looked at', found.body.includes(V.name));

// ---- the pages, as each kind of visitor sees them
const PAGES = [
  { who: null, path: '/', label: 'Welcome' },
  { who: null, path: '/explore', label: 'Explore' },
  { who: null, path: `/search?q=${run}`, label: 'Search results' },
  { who: null, path: `/vendors/${V.slug}`, label: 'A business page' },
  { who: null, path: `/vendors/${V.slug}`, label: 'The photo viewer', open: 'section[aria-labelledby=photos] a >> nth=1', dialog: true },
  { who: null, path: '/join', label: 'Join' },
  { who: null, path: '/sign-in', label: 'Team sign-in' },
  { who: null, path: '/suggest', label: 'Suggest a business' },
  { who: 'person', path: '/account', label: 'Your account' },
  { who: 'person', path: '/events', label: 'Your events' },
  { who: 'person', path: '/events/new', label: 'Plan an event' },
  { who: 'person', path: `/events/${eventId}`, label: 'An event plan' },
  { who: 'person', path: `/events/${eventId}/edit`, label: 'Editing an event' },
  { who: 'person', path: '/saved', label: 'Saved businesses' },
  { who: 'person', path: `/vendors/${V.slug}/add`, label: 'Add to an event' },
  { who: 'owner', path: '/business', label: 'Your business' },
  { who: 'owner', path: `/vendors/${V.slug}/edit`, label: 'Editing a listing' },
  { who: 'owner', path: `/vendors/${V.slug}/photos`, label: 'Photos (owner)' },
  {
    who: 'owner',
    path: `/vendors/${V.slug}/photos`,
    label: 'The framing screen',
    open: 'button:has-text("Adjust the framing")',
    dialog: true,
  },
  { who: 'owner', path: `/vendors/${V.slug}/team`, label: 'The business team' },
  { who: 'owner', path: `/vendors/${V.slug}/bookings`, label: 'Bookings marked' },
  { who: 'team', path: '/admin', label: 'Team: listings' },
  { who: 'team', path: `/admin/listings/${V.id}`, label: 'Team: one listing' },
  { who: 'team', path: '/admin/listings/new', label: 'Team: new listing' },
  { who: 'team', path: '/admin/claims', label: 'Team: claims' },
  { who: 'team', path: '/admin/suggestions', label: 'Team: suggestions' },
  { who: 'team', path: `/admin/photos?vendor=${V.id}`, label: 'Team: photos' },
  { who: 'team', path: '/admin/categories', label: 'Team: categories and towns' },
  { who: 'team', path: '/admin/event-types', label: 'Team: kinds of event' },
  { who: 'team', path: '/admin/activity', label: 'Team: activity' },
  { who: 'team', path: `/admin/bookings?business=${V.id}`, label: 'Team: bookings' },
];

const RULES = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const contexts = new Map();
for (const size of SIZES) {
  console.log(`\nAt ${size.name} size (${size.width} wide)`);
  for (const pg of PAGES) {
    const key = `${pg.who}:${size.name}`;
    if (!contexts.has(key)) contexts.set(key, await contextFor(pg.who, size));
    const p = await contexts.get(key).newPage();
    const errors = [];
    // Our own site's errors. (Outside services, like Cloudflare's "are you human" check,
    // can be out of reach where the tests run; that's not the page's fault.)
    const ours = (url) => url.startsWith(BASE) || url.startsWith(MAIL);
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
    p.on(
      'response',
      (r) => r.status() >= 400 && ours(r.url()) && r.request().resourceType() !== 'document' && errors.push(`${r.status()} ${r.url()}`),
    );
    p.on('requestfailed', (r) => ours(r.url()) && errors.push(`${r.failure()?.errorText} ${r.url()}`));
    const res = await p.goto(BASE + pg.path, { waitUntil: 'networkidle' });
    if (pg.open) {
      await p.click(pg.open);
      await p.waitForSelector('dialog[open]', { timeout: 10000 });
      await p.waitForTimeout(400);
    }
    const page = await p.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const describe = (el) =>
        `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''}`;
      // The narrowest elements reaching past the right edge are the ones to fix.
      const past = [...document.querySelectorAll('body *')]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.right > width + 1)
        .sort((a, b) => a.r.width - b.r.width)
        .slice(0, 3)
        .map(({ el, r }) => `${describe(el)} to ${Math.round(r.right)}px`);
      return { wide: document.documentElement.scrollWidth > width + 1, scrollWidth: document.documentElement.scrollWidth, width, past };
    });
    await p.addScriptTag({ content: AXE });
    const axe = await p.evaluate(
      (tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] }),
      RULES,
    );
    const problems = axe.violations.map(
      (v) =>
        `${v.id} (${v.impact}): ${v.nodes
          .slice(0, 2)
          .map((n) => n.target.join(' '))
          .join(', ')}${v.nodes.length > 2 ? ` and ${v.nodes.length - 2} more` : ''}`,
    );
    const name = `${pg.label} (${size.name})`;
    const ok = res?.status() === 200;
    check(`${name}: opens`, ok, String(res?.status()));
    check(
      `${name}: nothing wider than the screen`,
      !page.wide,
      `${page.scrollWidth}px wide on a ${page.width}px screen: ${page.past.join('; ')}`,
    );
    check(`${name}: no accessibility problems`, problems.length === 0, problems.join(' | '));
    check(`${name}: no errors in the page`, errors.length === 0, errors.slice(0, 3).join(' | '));
    if (!ok || page.wide || problems.length || errors.length) {
      await p.screenshot({ path: `${SHOTS}/${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`, fullPage: !pg.dialog });
    }
    await p.close();
  }
}
for (const ctx of contexts.values()) await ctx.close();
await browser.close();

// ---- the square profile photo in a person's lists (D-45), and gone once the business isn't listed
const [logo] = await sql`select a.storage_path as path from vendor_media vm join media_asset a on a.id = vm.media_asset_id
  where vm.vendor_id = ${V.id} and vm.role = 'logo'`;
const small = logo.path.replace(/\.(\w+)$/, '-small.$1');
const person = cookieOf(sessions.person);
await site(`/vendors/${V.slug}/add`, { cookie: person, method: 'POST', form: { intent: 'save' } });
for (const [what, path] of [
  ['an event plan', `/events/${eventId}`],
  ['Saved businesses', '/saved'],
  ['Add to an event', `/vendors/${V.slug}/add`],
]) {
  check(`${what} shows the business’s square profile photo`, (await site(path, { cookie: person })).body.includes(small));
}
// Taken down (D-46): gone from Saved; on the plan only as the person's own booking, with no
// photo or empty square; and listed for the team to check in about.
await sql`update vendor set listing_status = 'unpublished' where id = ${V.id}`;
const takenDown = (await site(`/events/${eventId}`, { cookie: person })).body;
check('once it isn’t listed, the plan keeps the booking by name, with no photo or empty square',
  takenDown.includes(V.name) && takenDown.includes('No longer listed on Localites') && !takenDown.includes(small) &&
    !/<li class="[^"]*withPhoto[^"]*">(?:(?!<\/li>).)*No longer listed/s.test(takenDown));
check('…and Saved doesn’t show it at all', !(await site('/saved', { cookie: person })).body.includes(V.name));
const forTeam = (await site(`/admin/bookings?business=${V.id}`, { cookie: cookieOf(sessions.team) })).body;
check('…and the team sees whom to check in with', forTeam.includes('Check in with these people') && forTeam.includes(email('person')));
await sql`update vendor set listing_status = 'published' where id = ${V.id}`;

await finish('look');
