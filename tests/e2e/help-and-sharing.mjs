// Help, the footer, "Something wrong with this listing?", link previews, the site map and
// robots.txt (product owner, 18 October 2026). Previews never reveal anything private: an
// invitation link shows robots a plain card and sets no cookie.
//
// Usage: npm run test:e2e
import { BASE, check, finish, run, site, sql } from './helpers.mjs';

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const words = (html) => decode(html.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ');
const meta = (html, prop) => new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`).exec(html)?.[1] ?? null;
const robot = (path) =>
  fetch(BASE + path, { redirect: 'manual', headers: { 'User-Agent': 'WhatsApp/2.23.20.0 A' } }).then(async (res) => ({
    status: res.status,
    cookie: res.headers.get('set-cookie') ?? '',
    body: await res.text(),
  }));

const [town] = await sql`select id from municipality where is_active order by sort_order limit 1`;
const [listed] = await sql`
  insert into vendor (slug, display_name, tagline, primary_municipality_id, listing_status, published_at, source)
  values (${`e2e-share-${run}`}, ${`Share Bakery ${run}`}, 'Fresh bread daily', ${town.id}, 'published', now(), 'admin_entered') returning slug::text as slug`;
const [draft] = await sql`
  insert into vendor (slug, display_name, primary_municipality_id, listing_status, source)
  values (${`e2e-share-draft-${run}`}, ${`Draft Bakery ${run}`}, ${town.id}, 'draft', 'admin_entered') returning slug::text as slug`;

console.log('Help and sharing');

let r = await site('/help');
check('the help page answers the common questions, with the team’s email', r.status === 200 &&
  ['How do I pay a business?', 'How do I sign in?', 'Can I get a copy of my information?', 'I don’t want my business listed'].every((q) => words(r.body).includes(q)) &&
  r.body.includes('mailto:supportlocalites@gmail.com'), String(r.status));
check('…and says plainly that Localites doesn’t process payments', words(r.body).includes('Localites doesn’t process payments'));
for (const path of ['/', '/explore', `/vendors/${listed.slug}`, '/help']) {
  r = await site(path);
  check(`the footer on ${path}: help, information pages and the team’s email`,
    r.body.includes('<footer') && r.body.includes('href="/help"') && r.body.includes('href="/for-businesses"') && r.body.includes('mailto:supportlocalites@gmail.com'));
}

r = await site(`/vendors/${listed.slug}`);
const report = /href="(mailto:supportlocalites@gmail\.com\?subject=[^"]+)"[^>]*>Tell us/.exec(r.body)?.[1] ?? '';
check('a business page offers “Something wrong with this listing?”, emailing the team with the listing’s address',
  words(r.body).includes('Something wrong with this listing?') && decodeURIComponent(decode(report)).includes(`/vendors/${listed.slug}`));
check('…and a link preview: the business’s name, tagline, address and a picture',
  meta(r.body, 'og:title') === `Share Bakery ${run}` && meta(r.body, 'og:description') === 'Fresh bread daily' &&
    meta(r.body, 'og:url') === `${BASE}/vendors/${listed.slug}` && (meta(r.body, 'og:image') ?? '').startsWith('http'), `${meta(r.body, 'og:image')}`);
r = await site('/');
check('the welcome page’s preview uses the Localites picture', meta(r.body, 'og:image') === `${BASE}/share.png`);
const png = await fetch(`${BASE}/share.png`);
check('…which is there', png.status === 200 && (png.headers.get('content-type') ?? '').includes('image/png'), String(png.status));

// Invitation links: robots get a plain card, never the event, and no cookie.
r = await robot('/i/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
check('a link-preview robot opening a personal invitation link gets a plain “You’re invited” card, no cookie',
  r.status === 200 && r.body.includes('og:title" content="You’re invited"') && !r.cookie.includes('localites-invite'), `${r.status} ${r.cookie}`);
r = await robot('/g/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
check('…and the same for a group link', r.status === 200 && r.body.includes('You’re invited') && !r.cookie.includes('localites-group'), `${r.status} ${r.cookie}`);
check('…with a link on, in case a person is ever taken for a robot', r.body.includes('href="/g/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA?open=1"'));
r = await robot('/g/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA?open=1');
check('…which always goes through', r.status === 302, String(r.status));
r = await site('/i/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
check('a person’s browser still swaps the link for a cookie', r.status === 302 && r.location === '/invite', `${r.status} ${r.location}`);

r = await site('/robots.txt');
check('robots.txt keeps invitations and team pages out, and points to the site map',
  r.status === 200 && ['Disallow: /i/', 'Disallow: /g/', 'Disallow: /group-invite', 'Disallow: /admin', `Sitemap: ${BASE}/sitemap.xml`].every((l) => r.body.includes(l)), r.body);
r = await site('/sitemap.xml');
check('the site map lists the public pages and listed businesses', r.status === 200 &&
  r.body.includes(`<loc>${BASE}/help</loc>`) && r.body.includes(`<loc>${BASE}/vendors/${listed.slug}</loc>`), String(r.status));
check('…never a draft, an invitation or a signed-in page',
  !r.body.includes(draft.slug) && !r.body.includes('/i/') && !r.body.includes('/events') && !r.body.includes('/admin'));

r = await site('/api/health');
check('the public health check says whether the site works, never which settings it has',
  r.status === 200 && r.body.includes('"database":"ok"') && !r.body.includes('settingsSeen') && !r.body.includes('SUPABASE'), r.body.slice(0, 200));

await finish('help and sharing');
