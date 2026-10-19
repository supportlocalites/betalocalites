// Scenario-test fixes, round 5 part 2 (D-54, migration 0051): a business's owner changes its name
// (M20): only the owner, through the language check, once in 30 days; the web address follows and
// old links (the page, message, add) keep working; older conversations show "New name (dba Old
// name)"; the team is told, sees it in the owner's changes and can undo it; when the team renames
// a business, its owner is emailed. The database's own rules are checked in db/tests/0051.
//
// Usage: npm run test:e2e
import { account, check, cookieFor, finish, mailFor, passwordSession, run, site, sql, twoStepSession } from './helpers.mjs';

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const words = (html) => decode(html.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ');
const hiddenOf = (name) => (html) => {
  const m = new RegExp(`name="${name}" value="([^"]*)"`).exec(html) ?? new RegExp(`value="([^"]*)" name="${name}"`).exec(html);
  return m ? decode(m[1]) : null;
};
async function waitFor(read, done, ms = 5000) {
  const end = Date.now() + ms;
  let value = await read();
  while (!done(value) && Date.now() < end) {
    await new Promise((res) => setTimeout(res, 150));
    value = await read();
  }
  return value;
}

const [town] = await sql`select id from municipality where is_active order by sort_order limit 1`;
const [category] = await sql`select id from category where is_active order by sort_order limit 1`;
const business = async (key, name) => {
  const [v] = await sql`
    insert into vendor (slug, display_name, primary_municipality_id, listing_status, published_at, claim_status, source)
    values (${`e2e-fix5b-${key}-${run}`}, ${`${name} ${run}`}, ${town.id}, 'published', now(), 'claimed', 'admin_entered')
    returning id, slug::text as slug, display_name as name`;
  await sql`insert into vendor_category (vendor_id, category_id, is_primary) values (${v.id}, ${category.id}, true)`;
  return v;
};
const V = await business('v', 'Fix Five B Bakery');
const W = await business('w', 'Fix Five B Florist');
const email = (who) => `e2e-fix5b-${who}-${run}@example.test`;
const ids = {};
for (const who of ['o', 'm', 'a', 'w', 't']) ids[who] = await account(email(who));
await sql`insert into vendor_member (vendor_id, user_id, role) values
  (${V.id}, ${ids.o}, 'owner'), (${V.id}, ${ids.m}, 'manager'), (${W.id}, ${ids.w}, 'owner')`;
await sql`insert into platform_role (user_id, role) values (${ids.t}, 'admin')`;
const cookie = {};
for (const who of ['o', 'm', 'a', 'w']) cookie[who] = cookieFor(await passwordSession(email(who)));
cookie.t = cookieFor(await twoStepSession(email('t')));
const row = async (id) => (await sql`select display_name as name, slug::text as slug from vendor where id = ${id}`)[0];
const NAME = `/vendors/${V.slug}/name`;

console.log('Before: a customer writes to the business');
let r = await site(`/vendors/${V.slug}/message`, { cookie: cookie.a, method: 'POST', form: { body: `Hello from before ${run}` } });
check('a customer starts a conversation', r.status === 302 && r.location.startsWith('/messages/'), `${r.status} ${r.location}`);

console.log('\nWho can change the name');
r = await site(`/vendors/${V.slug}/edit`, { cookie: cookie.o });
check('the edit page links to changing the name', r.body.includes(`href="${NAME}"`));
r = await site(NAME, { cookie: cookie.m });
check('a manager is told only the owner can', r.status === 200 && words(r.body).includes('Only the business’s owner can change its name'));
r = await site(NAME, { cookie: cookie.m, method: 'POST', form: { name: `Manager Name ${run}` } });
check('…and can’t', r.status === 409 && (await row(V.id)).name === V.name, String(r.status));
r = await site(NAME, { cookie: cookie.a });
check('a customer can’t open the page', r.status === 404, String(r.status));
r = await site(NAME, { cookie: cookie.w, method: 'POST', form: { name: `Other Owner ${run}` } });
check('another business’s owner can’t rename it', r.status === 404 && (await row(V.id)).name === V.name, String(r.status));

console.log('\nWhat a name may be');
r = await site(NAME, { cookie: cookie.o, method: 'POST', form: { name: 'Cakes at sweettreats.com' } });
check('a web address is refused', r.status === 400 && (await row(V.id)).name === V.name, String(r.status));
r = await site(NAME, { cookie: cookie.o, method: 'POST', form: { name: `Pretend-hate Cakes ${run}` } });
check('a name the language check flags is refused', r.status === 400 && words(r.body).includes('We can’t use that name') && (await row(V.id)).name === V.name, String(r.status));
r = await site(NAME, { cookie: cookie.o, method: 'POST', form: { name: V.name } });
check('the same name changes nothing', r.status === 409 && words(r.body).includes('already your business’s name'), String(r.status));

console.log('\nThe owner renames it');
const NEW = `Renamed B Bakery ${run}`;
const before = Date.now();
r = await site(NAME, { cookie: cookie.o, method: 'POST', form: { name: `  ${NEW}  ` } });
const now = await row(V.id);
check('the name changes, tidied, and the web address follows', r.status === 302 && now.name === NEW && now.slug === `renamed-b-bakery-${run}`
  && r.location.startsWith(`/vendors/${now.slug}/edit?saved=`), `${r.status} ${r.location} ${now.slug}`);
const [kept] = await sql`select name from vendor_former_name where vendor_id = ${V.id}`;
check('the old name is kept', kept?.name === V.name);
const [change] = await sql`
  select oc.flags, a.changes, a.actor_user_id as actor from owner_change oc join audit_log a on a.id = oc.audit_id
  where oc.vendor_id = ${V.id} order by oc.audit_id desc limit 1`;
check('recorded as the owner’s change, flagged for the team', change?.flags?.join() === 'name' && change.actor === ids.o
  && change.changes?.name?.to === NEW, JSON.stringify(change));
const alert = await waitFor(
  async () => (await mailFor('supportlocalites@gmail.com')).filter((m) => m.at > before && m.subject.includes(NEW)),
  (list) => list.length > 0,
);
check('the team gets a “check now” email', alert.length === 1 && alert[0].subject.startsWith('Check now') && alert[0].body.includes('Business name'),
  alert.map((m) => m.subject).join(' | '));

console.log('\nOld links');
r = await site(`/vendors/${V.slug}`);
check('the old page address goes to the new one', r.status === 301 && r.location === `/vendors/${now.slug}`, `${r.status} ${r.location}`);
r = await site(`/vendors/${V.slug}/add?x=1`, { cookie: cookie.a });
check('…and so does “Add to event”', r.status === 302 && r.location === `/vendors/${now.slug}/add?x=1`, `${r.status} ${r.location}`);
r = await site(`/vendors/${V.slug}/message`, { cookie: cookie.a });
check('…and “Message”', r.status === 302 && r.location === `/vendors/${now.slug}/message`, `${r.status} ${r.location}`);
r = await site(`/vendors/${V.slug}/edit`, { cookie: cookie.o });
check('…and the owner’s own pages', r.status === 302 && r.location === `/vendors/${now.slug}/edit`, `${r.status} ${r.location}`);
r = await site(`/vendors/nothing-here-${run}/add`, { cookie: cookie.a });
check('a web address no business ever had is still “not found”', r.status === 404, String(r.status));

console.log('\nOlder things show the old name too');
r = await site('/messages', { cookie: cookie.a });
check('the customer’s earlier conversation shows “New name (dba Old name)”', words(r.body).includes(`${NEW} (dba ${V.name})`));
r = await site(`/vendors/${now.slug}`, { cookie: cookie.a });
check('the business’s page shows just the new name', words(r.body).includes(NEW) && !words(r.body).includes('(dba'));

console.log('\nOnce in 30 days');
r = await site(`/vendors/${now.slug}/name`, { cookie: cookie.o, method: 'POST', form: { name: `Third Name ${run}` } });
check('a second change is refused', r.status === 409 && words(r.body).includes('once every 30 days') && (await row(V.id)).name === NEW, String(r.status));
r = await site(`/vendors/${now.slug}/name`, { cookie: cookie.o });
check('…the page says when, and lists the earlier name', words(r.body).includes('You can change it again from') && words(r.body).includes(V.name));

console.log('\nThe team');
const [audit] = await sql`select oc.audit_id from owner_change oc where oc.vendor_id = ${V.id} order by oc.audit_id desc limit 1`;
r = await site(`/admin/listings/${V.id}`, { cookie: cookie.t });
check('the team sees the change in plain words', words(r.body).includes(`Business name: “${V.name}” → “${NEW}”`));
r = await site(`/admin/listings/${V.id}`, { cookie: cookie.t, method: 'POST', form: { intent: 'owner-undo', auditId: audit.audit_id, key: 'name', reason: 'E2E: not their name' } });
check('the team puts the old name back', r.status === 302 && (await row(V.id)).name === V.name, String(r.status));
r = await site(`/vendors/${now.slug}`);
check('…the page keeps its new address, under the old name', r.status === 200 && words(r.body).includes(V.name), String(r.status));
r = await site(`/vendors/${now.slug}/name`, { cookie: cookie.o, method: 'POST', form: { name: `Better Name ${run}` } });
check('…and a change the team undid doesn’t count: the owner can choose another name', r.status === 302 && (await row(V.id)).name === `Better Name ${run}`,
  String(r.status));

const loaded = hiddenOf('loaded')((await site(`/admin/listings/${W.id}`, { cookie: cookie.t })).body);
const l = JSON.parse(loaded);
const TEAM_NAME = `Team Named Florist ${run}`;
const teamBefore = Date.now();
r = await site(`/admin/listings/${W.id}`, {
  cookie: cookie.t,
  method: 'POST',
  form: {
    intent: 'details', loaded, name: TEAM_NAME, slug: W.slug, tagline: l.tagline ?? '', description: l.description ?? '', municipalityId: town.id,
    websiteUrl: l.websiteUrl ?? '', publicEmail: '', publicPhone: l.publicPhone ?? '', primaryCategoryId: category.id, categoryIds: category.id,
  },
});
check('the team renames another business', r.status === 302 && (await row(W.id)).name === TEAM_NAME, String(r.status));
const told = await waitFor(
  async () => (await mailFor(email('w'))).filter((m) => m.at > teamBefore),
  (list) => list.length > 0,
);
check('…and its owner is emailed, with the old and new names', told.length === 1 && told[0].subject.includes(`${TEAM_NAME} has a new name`)
  && told[0].body.includes(`(dba ${W.name})`), told.map((m) => m.subject).join(' | '));

console.log('\nDownload your data (M21)');
// The owner's own event, with words that look like code, and a message they wrote for the business.
const [ev] = await sql`insert into event (host_user_id, event_date, start_time, municipality_id) values (${ids.o}, current_date + 9, '13:00', ${town.id}) returning id`;
await sql`insert into event_private (event_id, host_user_id, title, notes) values (${ev.id}, ${ids.o}, ${`O party ${run}`}, ${'<script>alert(1)</script> & more'})`;
const [conv] = await sql`select id from conversation where vendor_id = ${V.id} and consumer_user_id = ${ids.a}`;
r = await site(`/vendors/${(await row(V.id)).slug}/messages/${conv.id}`, { cookie: cookie.o, method: 'POST', form: { intent: 'send', body: `Owner reply ${run}` } });
const ownerReply = await sql`select 1 from message where conversation_id = ${conv.id} and author_user_id = ${ids.o} and author_side = 'vendor'`;
check('the owner writes to a customer for the business', ownerReply.length === 1, String(r.status));
r = await site('/account/data', { cookie: cookie.o });
check('the page offers a readable copy and the data file', r.body.includes('href="/account/data/download?readable"') && r.body.includes('href="/account/data/download"'));
r = await site('/account/data/download?readable', { cookie: cookie.o });
check('the readable copy is a page to save', r.status === 200 && (r.headers.get('content-type') ?? '').startsWith('text/html')
  && /attachment; filename="localites-my-data-\d{4}-\d{2}-\d{2}\.html"/.test(r.headers.get('content-disposition') ?? ''), `${r.status} ${r.headers.get('content-disposition')}`);
check('…with headings, their event, and what they did for the business', r.body.includes('<h2>Your events</h2>') && r.body.includes(`O party ${run}`)
  && r.body.includes('<h2>What you did for your businesses</h2>') && r.body.includes(`Owner reply ${run}`) && r.body.includes('Business name: “'));
check('…words that look like code are shown as words, never run', !r.body.includes('<script>') && r.body.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; more'));
check('…never the customer’s side', !r.body.includes(`Hello from before ${run}`) && !r.body.includes(email('a')));
r = await site('/account/data/download', { cookie: cookie.o });
check('the data file is laid out a line at a time, and has the business section too', r.status === 200 && r.body.split('\n').length > 20
  && JSON.parse(r.body).for_your_businesses?.[0]?.messages_you_wrote?.some((m) => m.message === `Owner reply ${run}`));
r = await site('/account/data/download?readable');
check('signed out: no readable copy', r.status === 302 && r.location.startsWith('/join'), `${r.status} ${r.location}`);

await finish('scenario fix (round 5b)');
