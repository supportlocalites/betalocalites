// The language check (D-50, migration 0036): owners' saves with offensive words are held for
// the team (the word list, or the AI checker, here the pretend one in scripts/e2e/mail-server.mjs);
// the team is emailed, puts a held save live or declines it, and the owner is emailed; the
// owner can withdraw it; clean words go live at once, also when the AI checker is down. Reviews
// keep the check's finding for the team; a business's flagged reply is held until the team puts
// it live. Settings and safety checks: tests/e2e/helpers.mjs.
//
// Usage: npm run test:e2e
import { account, check, cookieFor, finish, mailFor, passwordSession, run, site, sql, twoStepSession } from './helpers.mjs';

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const words = (html) => decode(html.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ');
const baseOf = (html) => {
  const m = /name="base" value="([^"]*)"/.exec(html) ?? /value="([^"]*)" name="base"/.exec(html);
  return m ? decode(m[1]) : null;
};
const seenOf = (html) => {
  const m = /name="seen" value="([^"]*)"/.exec(html) ?? /value="([^"]*)" name="seen"/.exec(html);
  return m ? decode(m[1]) : '';
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
/** The form as a browser would send it: every field from the page's values, then changes. */
function formFrom(baseJson, changes = {}) {
  const b = JSON.parse(baseJson);
  const f = { base: baseJson, tagline: b.tagline ?? '', description: b.description ?? '', websiteUrl: b.websiteUrl ?? '', publicPhone: b.publicPhone ?? '' };
  b.services.forEach((s, i) => {
    f[`service.${i}.id`] = s.id ?? '';
    f[`service.${i}.name`] = s.name;
    f[`service.${i}.description`] = s.description ?? '';
    f[`service.${i}.pricingModel`] = s.price.pricingModel;
    f[`service.${i}.price`] = s.price.priceCents == null ? '' : String(s.price.priceCents / 100);
    if (s.shown) f[`service.${i}.shown`] = 'yes';
  });
  return { ...f, ...changes };
}

// ------------------------------------------------------------------ set-up
const TEAM = 'supportlocalites@gmail.com';
const [town] = await sql`select id from municipality where is_active order by sort_order limit 1`;
const [V] = await sql`
  insert into vendor (slug, display_name, primary_municipality_id, tagline, listing_status, published_at, claim_status, source)
  values (${`e2e-words-${run}`}, ${`Words Bakery ${run}`}, ${town.id}, 'Cakes for every party', 'published', now(), 'claimed', 'admin_entered')
  returning id, slug::text as slug`;
await sql`insert into vendor_service (vendor_id, name, pricing_model, price_cents, sort_order) values (${V.id}, 'Birthday cake', 'fixed', 4500, 1)`;
const email = (who) => `e2e-words-${who}-${run}@example.test`;
const ids = {};
for (const who of ['o', 'x', 'm', 'a']) ids[who] = await account(email(who));
await sql`insert into platform_role (user_id, role) values (${ids.m}, 'admin')`;
await sql`insert into vendor_member (vendor_id, user_id, role) values (${V.id}, ${ids.o}, 'owner')`;
const cookie = { o: cookieFor(await passwordSession(email('o'))), x: cookieFor(await passwordSession(email('x'))), a: cookieFor(await passwordSession(email('a'))) };
cookie.m = cookieFor(await twoStepSession(email('m')));
const EDIT = `/vendors/${V.slug}/edit`;
const tagline = async () => (await sql`select tagline from vendor where id = ${V.id}`)[0].tagline;
const holds = async () => sql`select id, status, flag_reason, decision_reason, team_email_status from owner_edit_hold where vendor_id = ${V.id} order by created_at`;
const save = async (changes) => {
  const page = await site(EDIT, { cookie: cookie.o });
  return site(EDIT, { cookie: cookie.o, method: 'POST', form: formFrom(baseOf(page.body), changes) });
};
const teamMail = async (subject) => (await mailFor(TEAM)).filter((m) => m.subject.includes(subject));

console.log('Owners’ words');
let r = await save({ tagline: `Fresh cakes daily ${run}` });
check('clean words: live at once', r.status === 302 && r.location.includes('saved=') && (await tagline()) === `Fresh cakes daily ${run}`, `${r.status} ${r.location}`);
r = await save({ tagline: 'pretend-phone call us any time' });
check('the AI checker’s privacy category (a phone number) doesn’t hold a save', r.status === 302 && (await tagline()) === 'pretend-phone call us any time', r.location);

r = await save({ tagline: 'The best shit cakes in town' });
let [h] = await holds();
check('a word on the list: the save is held, nothing written', r.status === 302 && r.location.includes('held=') && (await tagline()) === 'pretend-phone call us any time', `${r.status} ${r.location}`);
check('…the reason names the word, for the team', h?.status === 'waiting' && h.flag_reason === 'Word list: shit', JSON.stringify(h));
r = await site(EDIT, { cookie: cookie.o });
check('the owner is told it’s waiting for the team, with what’s waiting', words(r.body).includes('Our team is checking a few words') && words(r.body).includes('The best shit cakes in town'));
check('…and never shown the team’s reason', !words(r.body).includes('Word list'));
const heldMail = await waitFor(() => teamMail(`Changes to Words Bakery ${run} are waiting`), (m) => m.length > 0);
check('the team is emailed, with what the check found and a link', heldMail.length === 1 && heldMail[0].body.includes('Word list: shit') && heldMail[0].body.includes('/admin/held-changes'));
r = await save({ description: 'Something else' });
check('saving again while one waits: refused in plain words', r.status === 409 && words(r.body).includes('still waiting for our team'), String(r.status));
r = await site(EDIT, { cookie: cookie.x, method: 'POST', form: { intent: 'withdraw' } });
check('someone else can’t withdraw it', r.status === 404 && (await holds())[0].status === 'waiting', String(r.status));
r = await site(EDIT, { cookie: cookie.o, method: 'POST', form: { intent: 'withdraw' } });
check('the owner withdraws it', r.status === 302 && r.location.includes('withdrawn=1') && (await holds())[0].status === 'withdrawn', r.location);

r = await save({ description: 'We pretend-hate some people' });
[, h] = await holds();
check('the AI checker’s finding holds a save too', r.status === 302 && h?.status === 'waiting' && h.flag_reason === 'AI checker: hate', JSON.stringify(h));

console.log('\nThe team’s held changes');
r = await site('/admin/held-changes', { cookie: cookie.x });
check('someone not on the team: refused (403)', r.status === 403, String(r.status));
r = await site('/admin/held-changes', { cookie: cookie.o, method: 'POST', form: { intent: 'publish', id: h.id } });
check('the owner can’t put their own held save live', r.status === 403 && (await holds())[1].status === 'waiting', String(r.status));
r = await site('/admin/held-changes', { cookie: cookie.m });
check('the team sees it: the business, what changed, what the check found', r.status === 200 && words(r.body).includes(`Words Bakery ${run}`) && words(r.body).includes('We pretend-hate some people') && words(r.body).includes('AI checker: hate'));
r = await site('/admin', { cookie: cookie.m });
check('the team menu counts it', words(r.body).includes('Held changes (1 waiting)'));
r = await site('/admin/held-changes', { cookie: cookie.m, method: 'POST', form: { intent: 'decline', id: h.id, reason: '' } });
check('declining needs a reason', r.status === 400 && (await holds())[1].status === 'waiting', String(r.status));
r = await site('/admin/held-changes', { cookie: cookie.m, method: 'POST', form: { intent: 'decline', id: h.id, reason: 'Hateful words aren’t allowed' } });
check('the team declines it; the listing is unchanged', r.status === 302 && (await holds())[1].status === 'declined' && (await sql`select description from vendor where id = ${V.id}`)[0].description === null, String(r.status));
let ownerMail = await waitFor(async () => (await mailFor(email('o'))).filter((m) => m.subject.includes("weren't put live")), (m) => m.length > 0);
check('the owner is emailed why', ownerMail.length === 1 && ownerMail[0].body.includes('Hateful words aren’t allowed'));
r = await site(EDIT, { cookie: cookie.o });
check('…and the edit page says so', words(r.body).includes('didn’t put live') && words(r.body).includes('Hateful words aren’t allowed'));
r = await site('/admin/held-changes', { cookie: cookie.m, method: 'POST', form: { intent: 'publish', id: h.id } });
check('a decided change can’t be decided again', r.status === 409, String(r.status));

r = await save({ tagline: 'Cakes, and a damn good time pretend-hate' });
const [, , h3] = await holds();
r = await site('/admin/held-changes', { cookie: cookie.m, method: 'POST', form: { intent: 'publish', id: h3.id } });
check('the team puts one live: written as the owner’s own save', r.status === 302 && (await tagline()) === 'Cakes, and a damn good time pretend-hate', String(r.status));
const [asOwner] = await sql`select actor_user_id from audit_log where subject_id = ${V.id} and action = 'vendor.owner_edit' order by created_at desc limit 1`;
const [byTeam] = await sql`select actor_user_id from audit_log where subject_id = ${V.id} and action = 'vendor.owner_edit_hold_publish'`;
check('…recorded as the owner’s change (for the daily note and undo) and as the team’s decision', asOwner?.actor_user_id === ids.o && byTeam?.actor_user_id === ids.m);
ownerMail = await waitFor(async () => (await mailFor(email('o'))).filter((m) => m.subject.includes('are live')), (m) => m.length > 0);
check('the owner is emailed that it’s live', ownerMail.length === 1 && ownerMail[0].body.includes('damn good time'));

r = await save({ tagline: 'Twat cakes' });
const [, , , h4] = await holds();
await sql`update vendor set tagline = 'The team changed this' where id = ${V.id}`;
r = await site('/admin/held-changes', { cookie: cookie.m, method: 'POST', form: { intent: 'publish', id: h4.id } });
check('if what they changed has changed since, putting it live is refused', r.status === 409 && words(r.body).includes('changed since they saved') && (await tagline()) === 'The team changed this', String(r.status));
await sql`delete from vendor_member where vendor_id = ${V.id} and user_id = ${ids.o}`;
r = await site('/admin/held-changes', { cookie: cookie.m, method: 'POST', form: { intent: 'publish', id: h4.id } });
check('if they no longer own the business, too', r.status === 409 && words(r.body).includes('no longer own'), String(r.status));
await sql`insert into vendor_member (vendor_id, user_id, role) values (${V.id}, ${ids.o}, 'owner')`;
await site('/admin/held-changes', { cookie: cookie.m, method: 'POST', form: { intent: 'decline', id: h4.id, reason: 'Out of date' } });

console.log('\nWhen the AI checker is down');
r = await save({ tagline: 'pretend-outage lovely cakes' });
check('clean words still go live (the word list’s answer stands)', r.status === 302 && r.location.includes('saved=') && (await tagline()) === 'pretend-outage lovely cakes', r.location);
r = await save({ tagline: 'pretend-outage bullshit cakes' });
check('…and the word list still holds', r.status === 302 && r.location.includes('held=') && (await holds()).at(-1).flag_reason === 'Word list: bullshit', r.location);
await site(EDIT, { cookie: cookie.o, method: 'POST', form: { intent: 'withdraw' } });

console.log('\nReviews and replies');
const [e] = await sql`insert into event (host_user_id, event_date, municipality_id) values (${ids.a}, current_date - 5, ${town.id}) returning id`;
await sql`insert into event_private (event_id, host_user_id, title) values (${e.id}, ${ids.a}, 'Party')`;
const [row] = await sql`insert into event_vendor (event_id, host_user_id, vendor_id, status, booked_at) values (${e.id}, ${ids.a}, ${V.id}, 'booked', now() - interval '20 days') returning id`;
r = await site(`/events/${e.id}/review/${row.id}`, { cookie: cookie.a, method: 'POST', form: { rating: '1', body: `They pretend-hate us ${run}` } });
const [rev] = await sql`select id, status, language_flag from review where event_vendor_id = ${row.id}`;
check('a review waits for the team as always, with the check’s finding kept', rev?.status === 'pending' && rev.language_flag === 'AI checker: hate', JSON.stringify(rev));
const revMail = await waitFor(() => teamMail(`New review of Words Bakery ${run}`), (m) => m.length > 0);
check('…the team’s email says what the check found', revMail.length === 1 && revMail[0].body.includes('The language check found something to look at: AI checker: hate'));
r = await site(`/admin/reviews/${rev.id}`, { cookie: cookie.m });
check('…and so does the team’s review page', words(r.body).includes('The language check found something to look at: AI checker: hate'));
r = await site(`/admin/reviews/${rev.id}`, { cookie: cookie.m, method: 'POST', form: { intent: 'publish', seen: seenOf(r.body) } });
check('the team publishes it', r.status === 302 && (await sql`select status from review where id = ${rev.id}`)[0].status === 'published', String(r.status));

r = await site(`/vendors/${V.slug}/reviews`, { cookie: cookie.o, method: 'POST', form: { reviewId: rev.id, reply: 'What a load of shit' } });
const [held] = await sql`select vendor_reply, reply_held_reason from review where id = ${rev.id}`;
check('the business’s reply with a listed word is held', r.status === 302 && r.location.includes('held=1') && held.reply_held_reason === 'Word list: shit', `${r.status} ${r.location}`);
r = await site(`/vendors/${V.slug}`);
check('…not on the business page', !r.body.includes('What a load of shit'));
r = await site(`/vendors/${V.slug}/reviews`, { cookie: cookie.o });
check('…the business sees it waiting', words(r.body).includes('waiting for our team to check some words') && words(r.body).includes('What a load of shit'));
const replyMail = await waitFor(() => teamMail(`A reply from Words Bakery ${run} is waiting`), (m) => m.length > 0);
check('…the team is emailed', replyMail.length === 1 && replyMail[0].body.includes(`/admin/reviews/${rev.id}`));
r = await site('/admin/reviews', { cookie: cookie.m });
check('…and sees it under held replies', words(r.body).includes('Replies held by the language check (1)'));
r = await site(`/admin/reviews/${rev.id}`, { cookie: cookie.o, method: 'POST', form: { intent: 'release_reply' } });
check('the business can’t put its own reply live', r.status === 403, String(r.status));
r = await site(`/admin/reviews/${rev.id}`, { cookie: cookie.m, method: 'POST', form: { intent: 'release_reply' } });
check('the team puts the reply live', r.status === 302, String(r.status));
r = await site(`/vendors/${V.slug}`);
check('…now it shows on the business page', r.body.includes('What a load of shit'));
const [released] = await sql`select count(*)::int as n from audit_log where subject_id = ${rev.id} and action = 'review.release_reply' and actor_user_id = ${ids.m}`;
check('…recorded with who', released.n === 1);

await finish('language check');
