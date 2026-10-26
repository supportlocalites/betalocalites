// Community (D-62, migration 0061): anyone reads; people signed in ask, answer (a business on
// Localites, a name they type, or just advice), vote up or down, and report; posts show at once
// unless the language check holds them for the team; the team shows or takes them down, written to
// the audit log. Each person can only change their own; nobody votes on their own answer or
// suggests their own business; who voted is never on the page. Checked here over the site, and in
// a real browser for asking and answering.
//
// Usage: npm run test:e2e
import { chromium } from 'playwright';
import { account, BASE, check, cookieFor, finish, passwordSession, run, site, sql, twoStepSession } from './helpers.mjs';

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const words = (html) => decode(html.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ');
const page = (html) => html.slice(0, html.indexOf('window.__reactRouterContext') >>> 0);

const email = (who) => `e2e-comm-${who}-${run}@example.test`;
const ids = {};
const cookie = {};
const NAMES = { p: ['Paula', 'Quill'], q: ['Quinn', 'Reed'], o: ['Owen', 'Stone'], team: ['Tess', 'Team'] };
for (const who of Object.keys(NAMES)) {
  ids[who] = await account(email(who));
  await sql`update app_user set given_name = ${NAMES[who][0]}, family_name = ${NAMES[who][1]}, display_name = ${NAMES[who].join(' ')} where id = ${ids[who]}`;
}
await sql`insert into platform_role (user_id, role) values (${ids.team}, 'admin')`;
for (const who of ['p', 'q', 'o']) cookie[who] = cookieFor(await passwordSession(email(who)));
cookie.team = cookieFor(await twoStepSession(email('team')));

const [town] = await sql`select id from municipality where is_active order by sort_order limit 1`;
const [kind] = await sql`select id, slug::text as slug, name from category where parent_id is null and is_active order by sort_order limit 1`;
const business = async (key, name) => {
  const [v] = await sql`
    insert into vendor (slug, display_name, primary_municipality_id, listing_status, published_at, claim_status, source)
    values (${`e2e-comm-${key}-${run}`}, ${`${name} ${run}`}, ${town.id}, 'published', now(), 'claimed', 'admin_entered')
    returning id, slug::text as slug, display_name as name`;
  await sql`insert into vendor_category (vendor_id, category_id, is_primary) values (${v.id}, ${kind.id}, true)`;
  return v;
};
const CAKES = await business('cakes', 'Community Cake Co');
const OWEN = await business('owen', 'Owen’s Own Party Shop');
await sql`insert into vendor_member (vendor_id, user_id, role) values (${OWEN.id}, ${ids.o}, 'owner')`;
await sql`insert into saved_vendor (user_id, vendor_id) values (${ids.q}, ${CAKES.id})`;

// Each from its own made-up address, so the quick-repeat guard isn't what's tested.
let n = 0;
const post = (path, who, form) => site(path, { cookie: cookie[who], method: 'POST', form, ip: `198.51.100.${(++n % 250) + 1}` });
const TITLE = `Who makes the best dinosaur cakes ${run}?`;

console.log('Reading and asking');
let r = await site('/community');
check('anyone can read Community, signed out: no ask box, and a way to sign in', r.status === 200 && words(page(r.body)).includes('Sign in to ask a question')
  && !r.body.includes('action="/community/ask"'), String(r.status));
r = await site('/community/ask', { method: 'POST', form: { title: TITLE } });
check('signed out, nobody can ask (sent to sign in)', r.status === 302 && r.location.startsWith('/join'), `${r.status} ${r.location}`);
r = await site('/community', { cookie: cookie.p });
check('signed in: the ask box', r.body.includes('action="/community/ask"') && r.body.includes('name="title"'));
r = await post('/community/ask', 'p', { title: 'Cakes?' });
check('a question is at least 10 characters', r.status === 302 && r.location === '/community?problem=title', `${r.status} ${r.location}`);
r = await site(r.location, { cookie: cookie.p });
check('…said in plain words', words(page(r.body)).includes('A question is 10 to 140 characters'));
r = await site('/community?problem=<b>Call 555-0100 now</b>');
check('the page never says words from its address, only its own', !words(page(r.body)).includes('Call 555-0100'));
r = await post('/community/ask', 'p', { title: TITLE, detail: 'For a 5th birthday, about 20 kids.', kind: kind.slug });
const qId = /^\/community\/([0-9a-f-]{36})$/.exec(r.location ?? '')?.[1];
check('Paula asks: it shows at once, on its own page', r.status === 302 && Boolean(qId), `${r.status} ${r.location}`);
r = await site('/community');
check('…in the feed for everyone, as “Paula Q.”, with its kind', words(page(r.body)).includes(TITLE) && words(page(r.body)).includes('Asked by Paula Q.')
  && words(page(r.body)).includes(kind.name) && !words(page(r.body)).includes('Quill'));
r = await site(`/community?kind=${kind.slug}`);
check('…and under its kind of business', words(page(r.body)).includes(TITLE));

console.log('\nAnswering');
r = await site(`/community/${qId}`, { cookie: cookie.q });
check('the question page, with the answer form ready for Quinn', r.status === 200 && words(page(r.body)).includes(TITLE) && words(page(r.body)).includes('Answer'));
r = await post(`/community/${qId}/act`, 'q', { intent: 'answer', mode: 'business', vendor: CAKES.slug, body: 'They made our son a T. rex and it was perfect.' });
check('Quinn suggests a favourite on Localites, with why', r.status === 302 && r.location.startsWith(`/community/${qId}#a-`), `${r.status} ${r.location}`);
const aCakes = r.location.split('#a-')[1];
r = await post(`/community/${qId}/act`, 'p', { intent: 'answer', mode: 'business', find: CAKES.name, body: 'Seconding these folks, great work.' });
check('the same business again is a vote instead, said plainly', r.status === 302 && r.location.includes('problem=twice'), `${r.status} ${r.location}`);
r = await post(`/community/${qId}/act`, 'p', { intent: 'answer', mode: 'business', businessName: `Maple Crumbs ${run}`, body: 'Not on Localites yet, but lovely work.' });
check('Paula types the name of one not on Localites', r.status === 302 && r.location.includes('#a-'), `${r.status} ${r.location}`);
const aTyped = r.location.split('#a-')[1];
r = await post(`/community/${qId}/act`, 'p', { intent: 'answer', mode: 'business', find: `Nobody Here ${run}`, body: 'A business that is not on the list.' });
check('a name not on the list from “Search Localites” is refused, saying what to do', r.status === 302 && r.location.includes('problem=notFound'), r.location);
r = await post(`/community/${qId}/act`, 'o', { intent: 'answer', mode: 'business', vendor: OWEN.slug, body: 'We are the very best party shop, honestly!' });
check('Owen can’t suggest his own business', r.status === 302 && r.location.includes('problem=own'), r.location);
r = await post(`/community/${qId}/act`, 'o', { intent: 'answer', mode: 'business', businessName: OWEN.name, body: 'Typing our own name instead, sneaky!' });
check('…not even by typing its name', r.status === 302 && r.location.includes('problem=own'), r.location);
r = await post(`/community/${qId}/act`, 'o', { intent: 'answer', mode: 'advice', body: 'Order early: bakeries book up three weeks out.' });
check('…but can give advice', r.status === 302 && r.location.includes('#a-'), r.location);
const aAdvice = r.location.split('#a-')[1];
r = await site(`/community/${qId}?answer=1`, { cookie: cookie.o });
check('the answer picker lists businesses on Localites, leaving out his own', r.body.includes(`value="${CAKES.name}"`) && !r.body.includes(`value="${OWEN.name}"`));
r = await site(`/community/${qId}`);
let w = words(page(r.body));
check('everyone sees the answers: the business on Localites, the typed name, the advice, and who wrote each',
  w.includes(CAKES.name) && w.includes(`Maple Crumbs ${run}`) && w.includes('Not on Localites yet') && w.includes('Order early') && w.includes('Quinn R.') && w.includes('Owen S.'));
check('…linking to the business’s page', r.body.includes(`href="/vendors/${CAKES.slug}"`));

console.log('\nVoting');
r = await post(`/community/${qId}/act`, 'p', { intent: 'vote', answer: aCakes, value: '1' });
r = await post(`/community/${qId}/act`, 'o', { intent: 'vote', answer: aCakes, value: '1' });
r = await post(`/community/${qId}/act`, 'q', { intent: 'vote', answer: aAdvice, value: '-1' });
let [counts] = await sql`select up_votes as up, down_votes as down from community_answer where id = ${aCakes}`;
check('two votes up count on the answer', counts.up === 2 && counts.down === 0, JSON.stringify(counts));
r = await post(`/community/${qId}/act`, 'p', { intent: 'vote', answer: aCakes, value: '1' });
[counts] = await sql`select up_votes as up from community_answer where id = ${aCakes}`;
check('voting the same way again takes the vote back', counts.up === 1, JSON.stringify(counts));
await sql`insert into vendor_member (vendor_id, user_id, role) values (${CAKES.id}, ${ids.o}, 'manager')`;
r = await post(`/community/${qId}/act`, 'o', { intent: 'vote', answer: aCakes, value: '-1' });
check('someone on a business’s team can’t vote on answers about it', r.location.includes('problem=ownBusiness'), r.location);
await sql`delete from vendor_member where vendor_id = ${CAKES.id} and user_id = ${ids.o}`;
r = await post(`/community/${qId}/act`, 'q', { intent: 'vote', answer: aCakes, value: '1' });
check('nobody votes on their own answer', r.location.includes('problem=ownVote') && (await sql`select up_votes from community_answer where id = ${aCakes}`)[0].up_votes === 1, r.location);
r = await site(`/community/${qId}/act`, { method: 'POST', form: { intent: 'vote', answer: aCakes, value: '1' } });
check('signed out, nobody votes (sent to sign in)', r.status === 302 && r.location.startsWith('/join'), r.location);
r = await site(`/community/${qId}`);
w = words(page(r.body));
check('the most up-voted first, marked “Most helpful”; a down vote shows as “1 disagree”', w.indexOf(CAKES.name) < w.indexOf('Order early') && w.includes('Most helpful') && w.includes('1 disagree'));
check('…and who voted is never on the page', !r.body.includes(ids.o) && !r.body.includes(ids.p));
r = await site('/community');
check('the feed shows its most helpful answer', words(page(r.body)).includes(`${CAKES.name} · most helpful, 1 vote up`));

console.log('\nOnly your own');
r = await post(`/community/${qId}/act`, 'q', { intent: 'remove-answer', answer: aTyped });
let [typed] = await sql`select status from community_answer where id = ${aTyped}`;
check('Quinn can’t take down Paula’s answer', typed.status === 'shown');
r = await post(`/community/${qId}/act`, 'q', { intent: 'remove-question' });
check('…nor her question', (await sql`select status from community_question where id = ${qId}`)[0].status === 'shown');
r = await post(`/community/${qId}/act`, 'p', { intent: 'remove-answer', answer: aTyped });
[typed] = await sql`select status, removed_by from community_answer where id = ${aTyped}`;
check('Paula takes her own answer down', typed.status === 'removed' && typed.removed_by === 'author');
r = await site(`/community/${qId}`);
check('…gone from the page', !words(page(r.body)).includes(`Maple Crumbs ${run}`));

console.log('\nThe language check and reports');
const [rude] = await sql`select 'shit' as w`;
r = await post('/community/ask', 'q', { title: `Who sells the best ${rude.w} decorations ${run}?` });
check('a question the language check flags is held, and she’s told', r.status === 302 && r.location === '/community?asked=held', r.location);
const [held] = await sql`select id, status, language_flag from community_question where author_user_id = ${ids.q} order by created_at desc limit 1`;
check('…kept for the team with why', held.status === 'held' && held.language_flag?.includes('Word list'));
r = await site('/community');
check('…not in the feed for anyone else', !words(page(r.body)).includes('decorations'));
r = await site('/community', { cookie: cookie.q });
check('…but its author sees it, waiting for our team', words(page(r.body)).includes('decorations') && words(page(r.body)).includes('Waiting for our team'));
r = await site(`/community/${held.id}`);
check('…and its page isn’t found for anyone else', r.status === 404, String(r.status));
r = await site(`/community/${qId}/report?answer=${aAdvice}`, { cookie: cookie.q });
check('a report page for Owen’s answer', r.status === 200 && words(page(r.body)).includes('Order early'));
r = await site(`/community/${qId}/report?answer=${aAdvice}`, { cookie: cookie.q, method: 'POST', form: { reason: 'untrue', details: 'Not my experience' } });
check('Quinn reports it', r.status === 302 && r.location.includes('sent=1'), r.location);
r = await site(`/community/${qId}/report?answer=${aAdvice}`, { cookie: cookie.q, method: 'POST', form: { reason: 'spam' } });
check('…once', r.status === 409 && words(page(r.body)).includes('already reported'), String(r.status));
r = await site(`/community/${qId}/report?answer=${aAdvice}`, { cookie: cookie.o, method: 'POST', form: { reason: 'spam' } });
check('nobody reports their own', r.status === 409, String(r.status));
r = await site(`/community/${qId}/report`, { method: 'POST', form: { reason: 'spam' } });
check('signed out, nobody reports (sent to sign in)', r.status === 302 && r.location.startsWith('/join'), r.location);

console.log('\nThe team');
r = await site('/admin/community', { cookie: cookie.p });
check('someone not on the team can’t see the team’s page', r.status === 302 || r.status === 403 || r.status === 404, String(r.status));
r = await site('/admin/community', { cookie: cookie.team });
w = words(r.body);
check('the team sees the held question with why, and the reported answer with its report', r.status === 200 && w.includes('decorations')
  && w.includes('Word list') && w.includes('Order early') && w.includes('Not true, or misleading'), String(r.status));
r = await site('/admin/community', { cookie: cookie.p, method: 'POST', form: { id: aAdvice, kind: 'answer', intent: 'remove' } });
check('someone not on the team can’t take a post down', (await sql`select status from community_answer where id = ${aAdvice}`)[0].status === 'shown', String(r.status));
r = await site('/admin/community', { cookie: cookie.team, method: 'POST', form: { id: aAdvice, kind: 'answer', intent: 'remove', note: 'Checked' } });
check('the team takes the reported answer down', r.status === 302 && (await sql`select status, removed_by from community_answer where id = ${aAdvice}`)[0].removed_by === 'team');
check('…its report decided, and the audit log has it', (await sql`select decision from community_report where answer_id = ${aAdvice}`)[0].decision === 'removed'
  && (await sql`select count(*)::int as n from audit_log where subject_id = ${aAdvice} and action = 'community_answer.removed'`)[0].n === 1);
r = await site('/admin/community', { cookie: cookie.team, method: 'POST', form: { id: held.id, kind: 'question', intent: 'show' } });
r = await site('/community');
check('the team shows the held question: now in the feed', words(page(r.body)).includes('decorations'));
r = await site('/admin/waiting', { cookie: cookie.team });
check('…and nothing waits any more', !words(r.body).includes('Community posts') || words(r.body).includes('Nothing'));

console.log('\nIn the browser');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies(cookie.q.split('; ').map((pair) => {
  const [name, value] = pair.split('=');
  return { name, value, domain: new URL(BASE).hostname, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' };
}));
const me = await ctx.newPage();
await me.goto(`${BASE}/community`, { waitUntil: 'networkidle' });
await me.fill('#title', `best dinosaur cakes for a party ${run}`);
check('typing a question shows ones already asked', await me.isVisible(`text=${TITLE}`));
await me.goto(`${BASE}/community/${qId}`, { waitUntil: 'networkidle' });
await me.click('button:has-text("Answer")');
check('Answer opens the form: favourites first', await me.isVisible('text=Your favourites') && await me.isVisible(`label:has-text("${CAKES.name}")`));
await me.click('label:has-text("Just answer")');
check('…“Just answer” leaves out the business', !(await me.isVisible('text=Your favourites')) && await me.isVisible('text=Your advice'));
await browser.close();

console.log('\nAn account deleted');
await sql`update app_user set deleted_at = now() where id = ${ids.p}`;
check('Paula’s account deleted: her question comes down, her votes go',
  (await sql`select status from community_question where id = ${qId}`)[0].status === 'removed'
  && (await sql`select count(*)::int as n from community_vote where user_id = ${ids.p}`)[0].n === 0);

await finish('community');
