// Community photos (the owner, 27 October 2026; migration 0063): up to 3 with a question or an
// answer; each waits for the team, so until then only its author sees it; the team shows it or
// takes it down (written to the audit log), and a photo taken down (or on a post its author took
// down) has its stored file deleted. Handed out by the site only to those who may see it.
//
// Usage: npm run test:e2e
import { account, BASE, check, cookieFor, finish, MAIL, passwordSession, run, sql, twoStepSession } from './helpers.mjs';

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const words = (html) => decode(html.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ');
const page = (html) => html.slice(0, html.indexOf('window.__reactRouterContext') >>> 0);

const email = (who) => `e2e-cph-${who}-${run}@example.test`;
const ids = {};
const cookie = {};
for (const who of ['p', 'q', 'team']) {
  ids[who] = await account(email(who));
  await sql`update app_user set given_name = ${who}, family_name = 'Photo' where id = ${ids[who]}`;
}
await sql`insert into platform_role (user_id, role) values (${ids.team}, 'admin')`;
for (const who of ['p', 'q']) cookie[who] = cookieFor(await passwordSession(email(who)));
cookie.team = cookieFor(await twoStepSession(email('team')));

// Just enough of a JPEG for the site's checks (as tests/e2e/photos.mjs).
const be16 = (n) => [n >> 8, n & 0xff];
const text = (s) => [...Buffer.from(s, 'latin1')];
const seg = (marker, payload) => [0xff, marker, ...be16(payload.length + 2), ...payload];
const jpeg = (w, h) =>
  new Uint8Array([
    0xff, 0xd8,
    ...seg(0xe0, text('JFIF\0\x01\x01')),
    ...seg(0xc0, [8, ...be16(h), ...be16(w), 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]),
    ...seg(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]),
    ...text(`picture ${run} `), ...Array.from({ length: 64 }, (_, i) => i), 0xff, 0xd9,
  ]);
const file = (bytes, name, type = 'image/jpeg') => new File([bytes], name, { type });
async function post(path, who, fields, photos = []) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  for (const p of photos) form.append('photos', p);
  const res = await fetch(BASE + path, { method: 'POST', headers: { Cookie: cookie[who] ?? '', Origin: BASE }, body: form, redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location') ?? '' };
}
const get = (path, who) => fetch(BASE + path, { headers: who ? { Cookie: cookie[who] } : {}, redirect: 'manual' });
const stored = async () => (await (await fetch(`${MAIL}/storage/files`)).json()).filter((f) => f.key.includes('community/'));
const photosOf = (where) => sql`select id, status, storage_path as path, storage_removed_at as gone from community_photo where ${where} order by created_at`;

console.log('Asking with photos');
const storedBefore = (await stored()).length;
let r = await post('/community/ask', 'p', { title: `What a cake, who made it ${run}?` }, [file(jpeg(800, 600), 'cake.jpg'), file(jpeg(640, 480), 'cake2.jpg')]);
const qId = /\/community\/([0-9a-f-]{36})/.exec(r.location)?.[1];
check('Paula asks with two photos: sent to her question, told they’re waiting', r.status === 302 && r.location.includes('?photos=waiting') && Boolean(qId), `${r.status} ${r.location}`);
let pPhotos = await photosOf(sql`question_id = ${qId}`);
check('…both waiting for the team, stored privately under community/', pPhotos.length === 2 && pPhotos.every((p) => p.status === 'pending')
  && (await stored()).length === storedBefore + 2);
let res = await get(`/community/${qId}?photos=waiting`, 'p');
let body = await res.text();
check('…her page shows them, marked as waiting', words(page(body)).includes('Your photos are waiting for our team') && words(page(body)).includes('only you can see it')
  && body.includes(`/community/photos/${pPhotos[0].id}`));
res = await get(`/community/${qId}`, 'q');
body = await res.text();
check('someone else sees the question but none of the waiting photos', res.status === 200 && !body.includes('/community/photos/'));
res = await get(`/community/${qId}`);
check('…nor does someone signed out', !(await res.text()).includes('/community/photos/'));
res = await get(`/community/photos/${pPhotos[0].id}`, 'p');
check('Paula can open her waiting photo, never kept by a shared cache', res.status === 200 && res.headers.get('content-type') === 'image/jpeg'
  && res.headers.get('cache-control') === 'private, no-store', `${res.status} ${res.headers.get('cache-control')}`);
res = await get(`/community/photos/${pPhotos[0].id}`, 'q');
check('…someone else gets “not found”', res.status === 404, String(res.status));
res = await get(`/community/photos/${pPhotos[0].id}`);
check('…and so does someone signed out', res.status === 404, String(res.status));

console.log('\nWhat’s refused');
r = await post('/community/ask', 'p', { title: `Four photos at once ${run}` }, [1, 2, 3, 4].map((i) => file(jpeg(100, 100), `${i}.jpg`)));
check('four photos at once: refused, saying up to 3, nothing asked', r.location.includes('problem=photoTooMany')
  && (await sql`select count(*)::int as n from community_question where title = ${`Four photos at once ${run}`}`)[0].n === 0, r.location);
r = await post('/community/ask', 'p', { title: `Not really a photo ${run}` }, [file(new Uint8Array(text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), 'x.jpg')]);
check('something that isn’t a photo: refused, nothing asked or stored', r.location.includes('problem=photoProblem')
  && (await sql`select count(*)::int as n from community_question where title = ${`Not really a photo ${run}`}`)[0].n === 0
  && (await stored()).length === storedBefore + 2, r.location);
r = await post('/community/ask', null, { title: `Signed out with a photo ${run}` }, [file(jpeg(100, 100), 'a.jpg')]);
check('signed out, nobody posts photos', [302, 303].includes(r.status) && r.location.startsWith('/join'), `${r.status} ${r.location}`);

console.log('\nAnswering with a photo');
r = await post(`/community/${qId}/act`, 'q', { intent: 'answer', mode: 'advice', body: 'That looks like the cake I had at my sister’s.' }, [file(jpeg(500, 400), 'mine.jpg')]);
const aId = r.location.split('#a-')[1];
check('Quinn answers with a photo of his own', r.status === 302 && r.location.includes('?photos=waiting') && Boolean(aId), `${r.status} ${r.location}`);
const [qPhoto] = await photosOf(sql`answer_id = ${aId}`);
check('…waiting too', qPhoto?.status === 'pending');

console.log('\nThe team decides');
res = await get('/admin/community', 'team');
body = await res.text();
check('the team’s Community page lists the three photos waiting', res.status === 200 && words(body).includes('Photos waiting (3)'), String(res.status));
res = await get(`/admin/community/photos/${qPhoto.id}`, 'team');
check('…and the team can open any of them to judge it, never kept by a cache', res.status === 200 && (res.headers.get('cache-control') ?? '').includes('no-store'), `${res.status} ${res.headers.get('cache-control')}`);
res = await get(`/admin/community/photos/${qPhoto.id}`, 'q');
check('someone not on the team can’t use the team’s address', res.status !== 200, String(res.status));
r = await post('/admin/community', 'q', { kind: 'photo', id: pPhotos[0].id, intent: 'show' });
check('…nor show a photo through the team’s page', (await photosOf(sql`id = ${pPhotos[0].id}`))[0].status === 'pending', `${r.status} ${r.location}`);
r = await post('/admin/community', 'team', { kind: 'photo', id: pPhotos[0].id, intent: 'show' });
check('the team shows Paula’s first photo, recorded in the audit log', r.status === 302
  && (await photosOf(sql`id = ${pPhotos[0].id}`))[0].status === 'shown'
  && (await sql`select count(*)::int as n from audit_log where action = 'community_photo.shown' and subject_id = ${pPhotos[0].id}`)[0].n === 1, `${r.status} ${r.location}`);
res = await get(`/community/photos/${pPhotos[0].id}`);
check('…now anyone can open it, kept only briefly by caches', res.status === 200 && res.headers.get('cache-control') === 'public, max-age=300', `${res.status} ${res.headers.get('cache-control')}`);
body = await (await get(`/community/${qId}`)).text();
check('…and it shows on the question for everyone; the other still doesn’t', body.includes(`/community/photos/${pPhotos[0].id}`) && !body.includes(`/community/photos/${pPhotos[1].id}`));
r = await post('/admin/community', 'team', { kind: 'photo', id: pPhotos[1].id, intent: 'remove' });
await new Promise((ok) => setTimeout(ok, 800));
const second = (await photosOf(sql`id = ${pPhotos[1].id}`))[0];
check('the team takes the second down: recorded, and its stored file deleted', second.status === 'removed' && second.gone !== null
  && !(await stored()).some((f) => f.key.includes(pPhotos[1].id))
  && (await sql`select count(*)::int as n from audit_log where action = 'community_photo.removed' and subject_id = ${pPhotos[1].id}`)[0].n === 1, JSON.stringify(second));
r = await post('/admin/community', 'team', { kind: 'photo', id: pPhotos[1].id, intent: 'show' });
check('…and it can’t be shown again', (await photosOf(sql`id = ${pPhotos[1].id}`))[0].status === 'removed', `${r.status}`);

console.log('\nPosts and accounts');
await post('/admin/community', 'team', { kind: 'photo', id: qPhoto.id, intent: 'show' });
r = await post(`/community/${qId}/act`, 'q', { intent: 'remove-answer', answer: aId });
await new Promise((ok) => setTimeout(ok, 800));
res = await get(`/community/photos/${qPhoto.id}`);
const qp = (await photosOf(sql`id = ${qPhoto.id}`))[0];
check('Quinn takes his answer down: its photo no longer opens, and its stored file goes', res.status === 404 && qp.gone !== null, `${res.status} ${JSON.stringify(qp)}`);
await sql`update app_user set deleted_at = now() where id = ${ids.p}`;
pPhotos = await photosOf(sql`question_id = ${qId}`);
check('Paula’s account deleted: all her photos come down', pPhotos.every((p) => p.status === 'removed'));
res = await get(`/community/photos/${pPhotos[0].id}`);
check('…and the one that was showing no longer opens', res.status === 404, String(res.status));

await finish('community photos');
