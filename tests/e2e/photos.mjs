// Business photos (V2, P4, E §9; migrations 0016 and 0019). Covers: only the business's owner
// or a manager adds, describes, orders and removes photos, and chooses and frames the square
// profile photo; staff, other owners and strangers get
// "not found"; files are checked from their contents and lose their location details; at
// most 8; the photo shows on the business page and in search; removing deletes the files
// (and retries nightly when storage was down); the team sees every photo and can remove any.
// Photos are stored in the pretend file storage (scripts/e2e/mail-server.mjs).
// Settings and safety checks: tests/e2e/helpers.mjs.
//
// Usage: npm run test:e2e
import { account, BASE, check, cookieFor, finish, MAIL, passwordSession, run, site, sql, twoStepSession } from './helpers.mjs';

const [town] = await sql`select id from municipality where is_active order by sort_order limit 1`;
async function listing(label) {
  const [v] = await sql`
    insert into vendor (slug, display_name, primary_municipality_id, listing_status, published_at, claim_status, source)
    values (${`e2e-photo-${label}-${run}`}, ${`Photo ${label} ${run}`}, ${town.id}, 'published', now(), 'claimed', 'admin_entered')
    returning id, slug::text as slug, display_name as name`;
  return v;
}
const V = await listing('v');
const W = await listing('w');
const email = (who) => `e2e-photo-${who}-${run}@example.test`;
const ids = {};
for (const who of ['o', 'mgr', 'mgr2', 'stf', 'o2', 'other', 'team']) ids[who] = await account(email(who));
await sql`insert into vendor_member (vendor_id, user_id, role) values
  (${V.id}, ${ids.o}, 'owner'), (${V.id}, ${ids.mgr}, 'manager'), (${V.id}, ${ids.mgr2}, 'manager'), (${V.id}, ${ids.stf}, 'staff'), (${W.id}, ${ids.o2}, 'owner')`;
await sql`insert into platform_role (user_id, role) values (${ids.team}, 'admin')`;
const cookie = {};
for (const who of ['o', 'mgr', 'mgr2', 'stf', 'o2', 'other']) cookie[who] = cookieFor(await passwordSession(email(who)));
cookie.team = cookieFor(await twoStepSession(email('team')));
const PAGE = (v = V) => `/vendors/${v.slug}/photos`;

// ---- pictures made byte by byte: just enough of a JPEG or WebP for the site's checks.
const be16 = (n) => [n >> 8, n & 0xff];
const le16 = (n) => [n & 0xff, n >> 8];
const le32 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24];
const text = (s) => [...Buffer.from(s, 'latin1')];
const seg = (marker, payload) => [0xff, marker, ...be16(payload.length + 2), ...payload];
const jpeg = (w, h, extra = []) =>
  new Uint8Array([
    0xff, 0xd8,
    ...seg(0xe0, text('JFIF\0\x01\x01')),
    ...extra,
    ...seg(0xc0, [8, ...be16(h), ...be16(w), 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]),
    ...seg(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]),
    ...text(`picture ${run} `), ...Array.from({ length: 64 }, (_, i) => i), 0xff, 0xd9,
  ]);
const withGps = (w, h) => jpeg(w, h, seg(0xe1, text(`Exif\0\0GPS 44.6082N 79.4197W ${run}`)));
const webp = (w, h) => {
  const vp8 = [...text('VP8 '), ...le32(12), 0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(w), ...le16(h), 0, 0];
  return new Uint8Array([...text('RIFF'), ...le32(vp8.length + 4), ...text('WEBP'), ...vp8]);
};
const file = (bytes, name, type) => new File([bytes], name, { type });

async function post(path, who, fields, { origin = BASE } = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const res = await fetch(BASE + path, { method: 'POST', headers: { Cookie: cookie[who] ?? '', Origin: origin }, body: form, redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location') ?? '', body: await res.text() };
}
const add = (who, { large, small, description = `Our cakes ${run}`, v = V, ...rest }) =>
  post(PAGE(v), who, {
    intent: 'add',
    description,
    ...(large ? { large: file(large, 'photo.jpg', 'image/jpeg') } : {}),
    ...(small ? { small: file(small, 'photo-small.jpg', 'image/jpeg') } : {}),
    ...rest,
  });
const stored = async () => (await (await fetch(`${MAIL}/storage/files`)).json()).filter((f) => f.key.includes(V.id) || f.key.includes(W.id));
const photosOf = (v) => sql`
  select a.id, a.storage_path as path, a.alt_text as alt, a.width, a.height, a.deleted_at, a.storage_removed_at, vm.sort_order, vm.role
  from media_asset a left join vendor_media vm on vm.media_asset_id = a.id
  where a.owner_kind = 'vendor' and a.owner_id = ${v.id} order by a.created_at`;
const live = async (v = V) => (await photosOf(v)).filter((p) => !p.deleted_at);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(test) {
  for (let i = 0; i < 30; i++) {
    if (await test()) return true;
    await wait(150);
  }
  return false;
}

console.log('Who can open the photo page');
let r = await site(PAGE());
check('signed out: sent to sign in first', r.status === 302 && r.location.startsWith('/join'), `${r.status} ${r.location}`);
for (const who of ['other', 'o2', 'stf']) {
  r = await site(PAGE(), { cookie: cookie[who] });
  check(`${{ other: 'someone not on the team', o2: 'another business’s owner', stf: 'staff' }[who]} gets “not found”`, r.status === 404, String(r.status));
}
for (const who of ['other', 'o2', 'stf']) {
  r = await add(who, { large: jpeg(800, 600), small: jpeg(400, 300) });
  check(`…and can’t add a photo (${who})`, r.status === 404 && (await photosOf(V)).length === 0 && (await stored()).length === 0, String(r.status));
}
r = await site(PAGE(), { cookie: cookie.o });
check('the owner sees the photo page, with nothing yet', r.status === 200 && r.body.includes('Add a photo') && r.body.includes('photos of your own work'), String(r.status));
r = await site('/account', { cookie: cookie.o });
check('Your account links to Photos', r.body.includes(`href="${PAGE()}"`));

console.log('\nAdding');
r = await add('o', { large: withGps(1600, 1200), small: withGps(640, 480) });
const [first] = await live();
check('the owner adds a photo (both sizes)', r.status === 302 && r.location.includes(`added=${first?.id}`) && first?.width === 1600 && first?.alt === `Our cakes ${run}`, `${r.status} ${r.body.slice(0, 200)}`);
const files = await stored();
check('two files are stored, under a random name in the business’s folder, kept by caches for an hour only (so removals take effect)',
  files.length === 2 && first.path.startsWith(`vendors/${V.id}/`) && /^[0-9a-f-]{36}\.jpg$/.test(first.path.split('/').pop())
    && files.every((f) => f.type === 'image/jpeg' && f.cacheControl === 'public, max-age=3600'), JSON.stringify(files));
const publicBytes = Buffer.from(await (await fetch(`${MAIL}/storage/v1/object/public/vendor-photos/${first.path}`)).arrayBuffer());
check('the stored photo has no location details (they are removed), but is still the picture',
  publicBytes.length > 0 && !publicBytes.includes('GPS') && publicBytes.includes(`picture ${run}`), String(publicBytes.length));
check('…and the addition is recorded', (await sql`select count(*)::int as n from audit_log where action = 'vendor_photo.add' and subject_id = ${V.id} and actor_user_id = ${ids.o}`)[0].n === 1);
r = await site(`/vendors/${V.slug}`);
check('the business page shows it as the main photo, with its description',
  r.body.includes(`/storage/v1/object/public/vendor-photos/${first.path}`) && r.body.includes(`alt="Our cakes ${run}"`));
r = await site(`/search?q=${encodeURIComponent(V.name)}`);
check('search results show the small version', r.body.includes(first.path.replace('.jpg', '-small.jpg')));

console.log('\nRefused');
r = await add('mgr', { large: jpeg(800, 600), small: jpeg(400, 300), description: '   ' });
check('no description: refused', r.status === 400 && r.body.includes('describe the photo'), String(r.status));
r = await add('mgr', { large: jpeg(800, 600), small: jpeg(400, 300), description: 'See www.example.com' });
check('a web address in the description: refused', r.status === 400 && r.body.includes('web or email address'), String(r.status));
const png = new Uint8Array([0x89, ...text('PNG\r\n\x1a\n'), ...Array(40).fill(0)]);
r = await add('mgr', { large: png, small: png });
check('a PNG with a .jpg name: refused (checked from its contents)', r.status === 400 && r.body.includes('isn’t a photo Localites can use'), String(r.status));
r = await add('mgr', { large: new Uint8Array(text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), small: jpeg(10, 10) });
check('a drawing with a script in it (SVG): refused', r.status === 400, String(r.status));
r = await add('mgr', { large: jpeg(3000, 2000), small: jpeg(400, 300) });
check('a photo bigger than 2048 pixels: refused', r.status === 400 && r.body.includes('too large'), String(r.status));
r = await add('mgr', { large: jpeg(800, 600), small: jpeg(1200, 900) });
check('a “small” version that isn’t small: refused', r.status === 400, String(r.status));
r = await add('mgr', { large: new Uint8Array(1100 * 1024).fill(1), small: jpeg(400, 300) });
check('a file over 1 MB: refused', r.status === 400 || r.status === 413, String(r.status));
r = await post(PAGE(), 'mgr', { intent: 'add', description: 'x', large: file(jpeg(800, 600), 'a.jpg', 'image/jpeg'), small: file(jpeg(400, 300), 'b.jpg', 'image/jpeg') }, { origin: 'https://evil.example' });
check('a form sent from another website: refused', r.status === 403, String(r.status));
check('nothing refused was stored', (await live()).length === 1 && (await stored()).length === 2, String((await live()).length));

const tiff = [...text('II*\0'), ...le32(8), ...le16(1), ...le16(0x0112), ...le16(3), ...le32(1), ...le16(6), 0, 0, ...le32(0)];
r = await post(PAGE(), 'mgr', { intent: 'add', description: 'Sideways', file: file(jpeg(800, 600, seg(0xe1, [...text('Exif\0\0'), ...tiff])), 's.jpg', 'image/jpeg') });
check('a photo stored on its side, sent without the page’s script: refused with what to do', r.status === 400 && r.body.includes('stored on its side'), String(r.status));
console.log('\nWithout the page’s script');
r = await post(PAGE(), 'o', { intent: 'add', description: `Plain ${run}`, file: file(webp(1200, 800), 'p.webp', 'image/webp') });
const plain = (await live()).find((p) => p.alt === `Plain ${run}`);
check('a small enough WebP sent as chosen is accepted, used for both sizes', r.status === 302 && plain?.path.endsWith('.webp') && plain.width === 1200, `${r.status}`);

console.log('\nA manager, and changes');
r = await add('mgr', { large: jpeg(900, 900), small: jpeg(300, 300), description: `Manager’s photo ${run}` });
check('a manager can add a photo', r.status === 302, String(r.status));
const mgrPhoto = (await live()).find((p) => p.alt === `Manager’s photo ${run}`);
r = await post(PAGE(), 'o', { intent: 'main', id: mgrPhoto.id });
r = await site(`/vendors/${V.slug}`);
// The page's first described photo (the soft copy behind it has no description).
const firstImg = r.body.match(/<img src="[^"]*vendor-photos\/([^"]+)" alt="[^"]+"/)?.[1];
check('“Show this one first” puts it first on the business page', firstImg === mgrPhoto.path, firstImg);
r = await post(PAGE(), 'o', { intent: 'describe', id: mgrPhoto.id, description: `Our shop front ${run}` });
check('the description can be changed (recorded)', r.status === 302 && (await live()).some((p) => p.alt === `Our shop front ${run}`)
  && (await sql`select count(*)::int as n from audit_log where action = 'vendor_photo.describe' and subject_id = ${V.id}`)[0].n === 1, String(r.status));
r = await post(PAGE(W), 'o2', { intent: 'remove', id: mgrPhoto.id });
check('another business’s owner can’t remove V’s photo through their own page', r.status === 409 && (await live()).some((p) => p.id === mgrPhoto.id), String(r.status));
r = await post(PAGE(), 'o2', { intent: 'remove', id: mgrPhoto.id });
check('…nor through V’s page', r.status === 404 && (await live()).some((p) => p.id === mgrPhoto.id), String(r.status));
r = await post(PAGE(), 'stf', { intent: 'describe', id: mgrPhoto.id, description: 'Staff were here' });
check('staff can’t change a description', r.status === 404 && !(await live()).some((p) => p.alt === 'Staff were here'), String(r.status));

console.log('\nThe profile photo (square, beside the name and in lists; migration 0019)');
const logoOf = async () => (await live()).filter((p) => p.role === 'logo');
r = await site(`/search?q=${encodeURIComponent(V.name)}`);
check('without one, search shows the first page photo', r.body.includes(mgrPhoto.path.replace('.jpg', '-small.jpg')));
r = await add('o', { large: jpeg(1200, 500), small: jpeg(600, 250), description: `Our logo ${run}`, role: 'logo' });
let [logo] = await logoOf();
check('the owner adds a profile photo, and the page opens its framing screen (recorded)', r.status === 302 && r.location.includes(`profile=${logo?.id}`)
  && (await sql`select count(*)::int as n from audit_log where action = 'vendor_photo.profile' and subject_id = ${V.id}`)[0].n === 1, `${r.status} ${r.location}`);
r = await site(`/search?q=${encodeURIComponent(V.name)}`);
check('search now shows the profile photo, not the first page photo',
  r.body.includes(logo.path.replace('.jpg', '-small.jpg')) && !r.body.includes(mgrPhoto.path.replace('.jpg', '-small.jpg')));
// 1200 x 500 is 2.4 times wider than tall: whole, it fills the square's width and 41.667% of its height, centred.
check('…shown whole by default (a wide logo), on a soft copy of itself',
  r.body.includes('top:29.167%') && r.body.includes('height:41.667%') && r.body.includes('aria-hidden="true"'));
r = await site(`/vendors/${V.slug}`);
const heroImg = r.body.match(/<img src="[^"]*vendor-photos\/([^"]+)" alt="[^"]+"/)?.[1];
check('the business page shows it beside the name, and still leads with the first page photo',
  r.body.includes(`alt="Our logo ${run}"`) && heroImg === mgrPhoto.path, heroImg);
const frame = { x: '10', y: '0', w: '50', h: '100' };
// A second manager sends the refused framings, so no one person passes the 20-changes-a-minute limit.
r = await post(PAGE(), 'mgr', { intent: 'frame', id: logo.id, ...frame });
const cropOf = async (id) => (await sql`select crop_x, crop_y, crop_w, crop_h from media_asset where id = ${id}`)[0];
check('a manager frames it (recorded)', r.status === 200 && JSON.stringify(await cropOf(logo.id)) === JSON.stringify({ crop_x: 10, crop_y: 0, crop_w: 50, crop_h: 100 })
  && (await sql`select count(*)::int as n from audit_log where action = 'vendor_photo.frame' and subject_id = ${V.id}`)[0].n === 1, String(r.status));
r = await post(PAGE(), 'mgr', { intent: 'frame', id: logo.id, ...frame, x: '20' });
const reframed = (await sql`select changes from audit_log where action = 'vendor_photo.frame' and subject_id = ${V.id} order by created_at desc limit 1`)[0]?.changes;
check('framing it again records what it was before', r.status === 200 && reframed?.[`photo.${logo.id}.frame`]?.from?.x === 10, JSON.stringify(reframed));
r = await post(PAGE(), 'mgr', { intent: 'frame', id: logo.id, ...frame });
r = await site(`/search?q=${encodeURIComponent(V.name)}`);
check('lists draw it as framed', r.body.includes('left:-20%') && r.body.includes('width:200%'));
for (const [what, bad] of [
  ['an empty size', { ...frame, w: '0' }],
  ['a missing side', { x: '1', y: '1', w: '50' }],
  ['not a number', { ...frame, x: 'NaN' }],
  ['far outside the photo', { ...frame, x: '-900' }],
  ['far too zoomed out', { ...frame, h: '900' }],
]) {
  r = await post(PAGE(), 'mgr2', { intent: 'frame', id: logo.id, ...bad });
  check(`a framing with ${what}: refused, nothing changed`, r.status === 400 && (await cropOf(logo.id)).crop_x === 10, String(r.status));
}
r = await post(PAGE(), 'mgr2', { intent: 'frame', id: mgrPhoto.id, ...frame });
check('a page photo can’t be framed as a profile photo', r.status === 409 && (await cropOf(mgrPhoto.id)).crop_x === null, String(r.status));
r = await post(PAGE(), 'stf', { intent: 'frame', id: logo.id, ...frame, x: '30' });
check('staff can’t frame it', r.status === 404 && (await cropOf(logo.id)).crop_x === 10, String(r.status));
r = await post(PAGE(W), 'o2', { intent: 'frame', id: logo.id, ...frame, x: '30' });
check('another business’s owner can’t frame it through their own page', r.status === 409 && (await cropOf(logo.id)).crop_x === 10, String(r.status));
r = await post(PAGE(), 'o2', { intent: 'frame', id: logo.id, ...frame, x: '30' });
check('…nor through this business’s page', r.status === 404 && (await cropOf(logo.id)).crop_x === 10, String(r.status));
r = await add('stf', { large: jpeg(500, 500), small: jpeg(200, 200), description: 'Staff logo', role: 'logo' });
check('staff can’t add or replace it', r.status === 404 && (await logoOf())[0]?.id === logo.id, String(r.status));
r = await post(PAGE(), 'mgr', { intent: 'main', id: logo.id });
check('“Show this one first” doesn’t touch the profile photo', r.status === 302 && (await logoOf())[0]?.id === logo.id);
const oldLogo = logo;
r = await add('o', { large: jpeg(600, 600), small: jpeg(300, 300), description: `New logo ${run}`, role: 'logo' });
[logo] = await logoOf();
check('a new profile photo replaces the old one: only one, the new one, with no framing yet',
  r.status === 302 && (await logoOf()).length === 1 && logo.alt === `New logo ${run}` && (await cropOf(logo.id)).crop_x === null, String(r.status));
check('…and the history says which photo it replaced',
  (await sql`select changes from audit_log where action = 'vendor_photo.profile' and subject_id = ${V.id} order by created_at desc limit 1`)[0]
    ?.changes?.photo?.from?.id === oldLogo.id);
check('…and the old one’s files are deleted',
  await until(async () => !(await stored()).some((f) => f.key.includes(oldLogo.path.replace('.jpg', '')))
    && (await photosOf(V)).find((p) => p.id === oldLogo.id)?.storage_removed_at !== null));
r = await site(PAGE(), { cookie: cookie.o });
check('the photo page shows it, with how it looks in lists', r.status === 200 && r.body.includes(`alt="New logo ${run}"`) && r.body.includes('In search results'));

console.log('\nAt most 8 on the page (the profile photo is one more)');
const pagePhotos = async () => (await live()).filter((p) => p.role === 'gallery');
for (let n = (await pagePhotos()).length; n < 8; n++) await add('o', { large: jpeg(500, 500), small: jpeg(200, 200), description: `Filler ${n}` });
check('eight page photos on the business, and its profile photo', (await pagePhotos()).length === 8 && (await logoOf()).length === 1, String((await live()).length));
const before = (await stored()).length;
r = await add('o', { large: jpeg(500, 500), small: jpeg(200, 200), description: 'Ninth' });
check('a ninth is refused plainly, and nothing is stored', r.status === 409 && r.body.includes('the most it can') && (await stored()).length === before, String(r.status));
r = await site(PAGE(), { cookie: cookie.o });
check('the page says the business has the most photos it can show', r.body.includes('Remove one to add another'));

console.log('\nRemoving');
r = await post(PAGE(), 'o', { intent: 'remove', id: first.id });
check('the owner removes a photo: off the business page at once (recorded)', r.status === 302
  && !(await site(`/vendors/${V.slug}`)).body.includes(first.path)
  && (await sql`select count(*)::int as n from audit_log where action = 'vendor_photo.remove' and subject_id = ${V.id}`)[0].n === 1, String(r.status));
check('…and both its files are deleted from storage, and that is recorded',
  await until(async () => !(await stored()).some((f) => f.key.includes(first.path.replace('.jpg', '')))
    && (await photosOf(V)).find((p) => p.id === first.id)?.storage_removed_at !== null));

console.log('\nWhen storage is down');
await fetch(`${MAIL}/storage/fail?on=1`, { method: 'POST' });
const countBefore = (await photosOf(V)).length;
r = await add('o', { large: jpeg(500, 500), small: jpeg(200, 200), description: 'While down' });
const leftover = (await photosOf(V)).slice(countBefore);
check('adding says plainly it couldn’t be saved; nothing shows, and the files are noted for the nightly retry',
  r.status === 409 && r.body.includes('couldn’t be saved') && leftover.length === 1 && leftover[0].deleted_at !== null && leftover[0].sort_order === null,
  `${r.status} ${JSON.stringify(leftover)}`);
const [gone] = await live();
r = await post(PAGE(), 'o', { intent: 'remove', id: gone.id });
await wait(500);
const [after] = (await photosOf(V)).filter((p) => p.id === gone.id);
check('removing still takes it off the business; its files wait', r.status === 302 && after.deleted_at !== null && after.storage_removed_at === null, String(r.status));
await fetch(`${MAIL}/storage/fail?on=0`, { method: 'POST' });
await site('/cdn-cgi/handler/scheduled?cron=0+12+*+*+*');
check('the nightly run deletes them once storage is back',
  await until(async () => (await photosOf(V)).find((p) => p.id === gone.id)?.storage_removed_at !== null && !(await stored()).some((f) => f.key.includes(gone.path.replace(/\.\w+$/, '')))));

console.log('\nThe team');
r = await site('/admin/photos', { cookie: cookie.o });
check('not on the team: Admin → Photos is refused', r.status === 403, String(r.status));
r = await site('/admin/photos', { cookie: cookie.team });
const [teamTarget] = await live();
check('the team sees businesses’ photos with who added them', r.status === 200 && r.body.includes(V.name) && r.body.includes(teamTarget.alt), String(r.status));
r = await site('/admin/photos', { cookie: cookie.o, method: 'POST', form: { intent: 'remove', id: teamTarget.id } });
check('not on the team: can’t remove one', r.status === 403 && (await live()).some((p) => p.id === teamTarget.id), String(r.status));
r = await site('/admin/photos', { cookie: cookie.team, method: 'POST', form: { intent: 'remove', id: teamTarget.id, reason: `Not their own work ${run}` } });
check('the team removes a photo, with the reason recorded', r.status === 200 && !(await live()).some((p) => p.id === teamTarget.id)
  && (await sql`select count(*)::int as n from audit_log where action = 'vendor_photo.team_remove' and reason = ${`Not their own work ${run}`}`)[0].n === 1, String(r.status));

await finish('business photos');
