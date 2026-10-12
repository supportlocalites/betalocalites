// Activity counting and the Analytics page (D-22, D-30, D-37, ADR-030): only what a real
// browser reports with a signed note is counted; bots, other sites and forged notes aren't;
// the business's own visits and the team's are marked; the owner's page opens only for its
// owner when the team has switched it on; every look at the detail is recorded.
// Needs counting switched on (ACTIVITY_KEY in the site's settings). Helpers: helpers.mjs.
//
// Usage: npm run test:e2e
import { account, BASE, check, cookieFor, finish, passwordSession, run, site, sql, twoStepSession } from './helpers.mjs';

const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const NOTE = /([A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{30,})/;
const today = (await sql`select (now() at time zone 'America/Toronto')::date::text as d`)[0].d;
const yesterday = (await sql`select ((now() at time zone 'America/Toronto')::date - 1)::text as d`)[0].d;

/** A page as a phone browser asks for it (with its cookies and where it came from). */
async function page(path, { cookie, referer, ua = PHONE, ip } = {}) {
  const headers = { 'User-Agent': ua };
  if (ip) headers['CF-Connecting-IP'] = ip;
  if (cookie) headers.Cookie = cookie;
  if (referer) headers.Referer = referer;
  const res = await fetch(BASE + path, { headers, redirect: 'manual' });
  const body = await res.text();
  return { status: res.status, location: res.headers.get('location') ?? '', body, note: NOTE.exec(body)?.[1] ?? null, cookie: res.headers.getSetCookie() };
}
/** A browser report, as the page's script sends it. */
async function report(body, { cookie, origin = BASE, type = 'application/json', ua = PHONE } = {}) {
  const headers = { 'Content-Type': type, 'User-Agent': ua };
  if (origin) headers.Origin = origin;
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}/api/activity`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: res.status, cookie: res.headers.getSetCookie().find((c) => c.startsWith('__Host-lc_vid=')) ?? null };
}
const stats = async (id, day = today) =>
  (await sql`select coalesce(sum(seen_in_search), 0)::int as seen, coalesce(sum(position_sum), 0)::int as pos
             from vendor_daily_stats where vendor_id = ${id} and day = ${day}`)[0];
const audits = async (action, id) =>
  (await sql`select count(*)::int as n from audit_log where action = ${action} and (${id ?? null}::uuid is null or subject_id = ${id ?? null})`)[0].n;

// ------------------------------------------------------------------ set-up
const [town] = await sql`select id from municipality where is_active order by sort_order limit 1`;
const [category] = await sql`select id from category where is_active and parent_id is null order by sort_order limit 1`;
async function listing(label, status = 'published') {
  const [v] = await sql`
    insert into vendor (slug, display_name, primary_municipality_id, website_url, public_phone, listing_status, published_at, archived_at, claim_status, source)
    values (${`e2e-an-${label}-${run}`}, ${`Analytics ${label} ${run}`}, ${town.id}, 'https://analytics.example/', '705 555 0100', ${status},
            now(), ${status === 'archived' ? sql`now()` : null}, 'claimed', 'admin_entered')
    returning id, slug`;
  await sql`insert into vendor_category (vendor_id, category_id, is_primary) values (${v.id}, ${category.id}, true)`;
  await sql`insert into vendor_service (vendor_id, name, pricing_model, sort_order) values (${v.id}, 'Cakes', 'on_request', 1)`;
  return v;
}
const a = await listing('alpha');
const b = await listing('bravo');
const gone = await listing('archived', 'archived');
const ownerA = `e2e-an-owner-a-${run}@example.test`;
const ownerB = `e2e-an-owner-b-${run}@example.test`;
const nobodyEmail = `e2e-an-nobody-${run}@example.test`;
const adminEmail = `e2e-an-admin-${run}@example.test`;
const ownerAId = await account(ownerA);
const ownerBId = await account(ownerB);
await account(nobodyEmail);
const adminId = await account(adminEmail);
await sql`insert into platform_role (user_id, role) values (${adminId}, 'admin')`;
await sql`insert into vendor_member (vendor_id, user_id, role) values (${a.id}, ${ownerAId}, 'owner'), (${gone.id}, ${ownerAId}, 'owner'), (${b.id}, ${ownerBId}, 'owner')`;
const ownerCookie = cookieFor(await passwordSession(ownerA));
const ownerBCookie = cookieFor(await passwordSession(ownerB));
const nobodyCookie = cookieFor(await passwordSession(nobodyEmail));
const admin = cookieFor(await twoStepSession(adminEmail));
// Its own account: setting up two-step signs the person's other sessions out.
const notTeamEmail = `e2e-an-not-team-${run}@example.test`;
await account(notTeamEmail);
const nobodyTeamTry = cookieFor(await twoStepSession(notTeamEmail));

console.log('Activity counting');

// 1. A list a browser reports.
let p = await page(`/search?q=${run}`);
const visitorCookie = p.cookie.find((c) => c.startsWith('__Host-lc_vid='))?.split(';')[0] ?? '';
check('a search page carries a signed note, numbered places, and the new browser’s visitor cookie',
  p.status === 200 && Boolean(p.note) && p.body.includes('data-pos="1"') && Boolean(visitorCookie), String(p.status));
const listNote = p.note;
const order = [...p.body.matchAll(/href="\/vendors\/(e2e-an-[a-z]+-[a-z0-9]+)"/g)].map((m) => m[1]);
const placeOf = (v) => order.indexOf(v.slug) + 1;
let r = await report({ t: 'list', token: listNote, seen: [placeOf(a), placeOf(b)] });
check('a report without the browser’s cookie is refused (a note can’t be passed around)', r.status === 400 && (await stats(a.id)).seen === 0, String(r.status));
r = await report({ t: 'list', token: listNote, seen: [placeOf(a), placeOf(b)] }, { cookie: `__Host-lc_vid=${crypto.randomUUID()}` });
check('…nor with another browser’s cookie', r.status === 400 && (await stats(a.id)).seen === 0, String(r.status));
r = await report({ t: 'list', token: listNote, seen: [placeOf(a), placeOf(b)] }, { cookie: visitorCookie });
const [sa, sb] = [await stats(a.id), await stats(b.id)];
check('places seen are counted once each, at their places',
  r.status === 204 && sa.seen === 1 && sb.seen === 1 && sa.pos === placeOf(a) && sb.pos === placeOf(b),
  `${r.status} ${JSON.stringify([sa, sb, placeOf(a), placeOf(b)])}`);
r = await report({ t: 'list', token: listNote, seen: [placeOf(a), placeOf(b)] }, { cookie: visitorCookie });
check('the same report again counts nothing', r.status === 204 && (await stats(a.id)).seen === 1);
r = await report({ t: 'list', token: `${listNote.slice(0, -3)}abc`, seen: [1] }, { cookie: visitorCookie });
check('a changed note is refused', r.status === 400 && (await stats(a.id)).seen === 1, String(r.status));
r = await report({ t: 'list', token: listNote, seen: [1] }, { origin: 'https://evil.example' });
check('a report from another site is refused', r.status === 403, String(r.status));
r = await report({ t: 'list', token: listNote, seen: [1] }, { origin: null });
check('a report with no site named is refused', r.status === 403, String(r.status));
r = await report(`t=list&token=${listNote}`, { type: 'application/x-www-form-urlencoded' });
check('a plain form is refused', r.status === 403, String(r.status));
const botPage = await page(`/search?q=${run}`, { ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' });
r = await report({ t: 'list', token: listNote, seen: [1] }, { ua: 'Googlebot/2.1' });
check('a search engine gets no note and no cookie, and its reports are ignored',
  !botPage.note && !botPage.cookie.some((c) => c.startsWith('__Host-lc_vid=')) && r.status === 204, String(r.status));
const nothing = 'zqxjvwkp yyzzqq';
p = await page(`/search?q=${encodeURIComponent(nothing)}`, { cookie: visitorCookie });
r = await report({ t: 'list', token: p.note, seen: [] }, { cookie: visitorCookie });
const [none] = await sql`select result_count from search_record where words_norm = ${nothing} order by occurred_at desc limit 1`;
check('a search that found nothing is recorded as such', r.status === 204 && none?.result_count === 0, JSON.stringify(none));

// 2. A business's page.
p = await page(`/vendors/${a.slug}`, { referer: 'https://www.google.ca/', cookie: visitorCookie });
const viewNote = p.note;
check('a business page carries a signed note', p.status === 200 && Boolean(viewNote));
const listId = (await sql`select id::text from search_record where words_norm = ${run} order by occurred_at desc limit 1`)[0]?.id;
r = await report({ t: 'view', token: viewNote, pos: 2, list: listId }, { cookie: visitorCookie });
r = await report({ t: 'tap', token: viewNote, kind: 'website_tap' }, { cookie: visitorCookie });
r = await report({ t: 'tap', token: viewNote, kind: 'website_tap' }, { cookie: visitorCookie });
r = await report({ t: 'time', token: viewNote, seconds: 30 }, { cookie: visitorCookie });
r = await report({ t: 'time', token: viewNote, seconds: 20 }, { cookie: visitorCookie });
const events = await sql`select kind, source, list_position, duration_seconds, device, viewer from activity_event where vendor_id = ${a.id} order by id`;
const kinds = events.map((e) => e.kind).join(',');
check('opening, one tap and time on the page are recorded once each; repeats ignored', kinds === 'profile_view,website_tap,profile_time', kinds);
check('where the visitor came from is read on the server (Google), with the place in the list',
  events[0]?.source === 'web_search' && events[0]?.list_position === 2 && events[1]?.source === 'web_search', JSON.stringify(events[0]));
check('time on the page keeps the larger figure; the device is a phone', events[2]?.duration_seconds === 30 && events[0]?.device === 'phone');
r = await report({ t: 'list', token: viewNote, seen: [1] }, { cookie: visitorCookie });
check('a page note can’t be used as a list note', r.status === 400, String(r.status));
r = await report({ t: 'tap', token: viewNote, kind: 'email_tap' }, { cookie: visitorCookie });
check('an unknown kind of tap is refused', r.status === 400, String(r.status));

// A script that drops its cookie each time gets only so many new browsers a minute.
const fresh = [];
const scriptAddress = `2001:db8:${crypto.getRandomValues(new Uint16Array(1))[0].toString(16)}::1`; // a fresh address each run
for (let i = 0; i < 25; i++) fresh.push(await page(`/vendors/${b.slug}`, { ip: scriptAddress }));
const withNotes = fresh.filter((f) => f.note).length;
check('new browsers from one address are limited (no note past the limit)', withNotes <= 20 && withNotes >= 1, String(withNotes));

// 3. The owner's and the team's own visits are marked (and left out of totals).
const [ownerVid, teamVid] = [crypto.randomUUID(), crypto.randomUUID()];
const ownerBrowser = `__Host-lc_vid=${ownerVid}`;
const teamBrowser = `__Host-lc_vid=${teamVid}`;
await page('/account', { cookie: `${ownerCookie}; ${ownerBrowser}` });
await page('/admin', { cookie: `${admin}; ${teamBrowser}` });
const linked = await sql`select visitor_id::text as v, user_id from visitor_account where visitor_id in (${ownerVid}, ${teamVid})`;
const whose = Object.fromEntries(linked.map((l) => [l.v, l.user_id]));
check('signed-in pages remember which browser is whose', linked.length === 2 && whose[ownerVid] === ownerAId && whose[teamVid] === adminId, JSON.stringify(linked));
p = await page(`/vendors/${a.slug}`, { cookie: ownerBrowser });
await report({ t: 'view', token: p.note }, { cookie: ownerBrowser });
p = await page(`/vendors/${a.slug}`, { cookie: teamBrowser });
await report({ t: 'view', token: p.note }, { cookie: teamBrowser });
const viewers = (await sql`select viewer from activity_event where vendor_id = ${a.id} and kind = 'profile_view' order by id`).map((e) => e.viewer).join(',');
check('the owner’s visit is marked "owner" and the team’s "team"', viewers === 'public,owner,team', viewers);
p = await page(`/vendors/${a.slug}/edit`, { cookie: ownerCookie });
check('the owner’s "View as a visitor" preview carries no note (nothing is counted)', p.status === 200 && !p.note && !p.body.includes('/api/activity'));

// 4. The nightly count (run as Cloudflare's scheduler would).
await sql`delete from activity_rollup where day = ${yesterday}::date`;
await sql`insert into activity_event (kind, vendor_id, visitor_id, source, page_view_id, viewer, occurred_at)
          values ('profile_view', ${a.id}, '01900000-0000-7000-8000-0000000a0003', 'direct', gen_random_uuid(), 'public',
                  (${yesterday}::date + time '15:00') at time zone 'America/Toronto')`;
await site('/cdn-cgi/handler/scheduled?cron=0+12+*+*+*');
let counted;
for (let i = 0; i < 30; i++) {
  [counted] = await sql`select status from activity_rollup where day = ${yesterday}::date`;
  if (counted && counted.status !== 'running') break;
  await new Promise((res) => setTimeout(res, 200));
}
const [yViews] = await sql`select coalesce(sum(profile_views), 0)::int as n from vendor_daily_stats where vendor_id = ${a.id} and day = ${yesterday}::date`;
check('the nightly count adds yesterday into the totals', counted?.status === 'done' && yViews.n === 1, JSON.stringify({ counted, yViews }));
// Yesterday's numbers for the owner's page (seen in lists is counted as browsers report).
await sql`insert into vendor_daily_stats (vendor_id, day, placement, municipality_id, seen_in_search, position_sum)
          values (${a.id}, ${yesterday}::date, 'search', null, 42, 84), (${b.id}, ${yesterday}::date, 'search', null, 977, 977)
          on conflict on constraint vendor_daily_stats_vendor_id_day_placement_municipality_id_key do update set seen_in_search = excluded.seen_in_search`;

console.log('The owner’s Analytics page');
const analytics = (v) => `/vendors/${v.slug}/analytics?period=year`;
let s = await site(analytics(a));
check('signed out: asks you to sign in', s.status === 302 && s.location.startsWith('/join?next='), `${s.status} ${s.location}`);
s = await site(analytics(a), { cookie: nobodyCookie });
check('someone without a business: not available (404)', s.status === 404 && s.body.includes('no Analytics page here'), String(s.status));
s = await site(analytics(a), { cookie: ownerCookie });
check('its own owner, before the team switches it on: not available (404)', s.status === 404, String(s.status));
s = await site('/account', { cookie: ownerCookie });
check('…and Your account doesn’t offer it', !s.body.includes(`/vendors/${a.slug}/analytics`));
s = await site(`/vendors/${a.slug}/edit`, { cookie: ownerCookie, method: 'POST', form: { analytics: 'on', enabled: 'true', intent: 'analytics' } });
s = await site(`/admin/listings/${a.id}/activity`, { cookie: ownerCookie, method: 'POST', form: { intent: 'analytics', enabled: 'on' } });
const [stillOff] = await sql`select count(*)::int as n from vendor_analytics where vendor_id = ${a.id}`;
check('an owner can’t switch it on themselves (their edit page ignores it; the team page refuses them)',
  stillOff.n === 0 && (s.status === 403 || (s.status === 302 && s.location.startsWith('/sign-in'))), `${s.status} ${s.location}`);

s = await site(`/admin/listings/${a.id}/activity`, { cookie: admin, method: 'POST', form: { intent: 'analytics', enabled: 'on', note: 'E2E: trial' } });
const [switched] = await sql`select enabled from vendor_analytics where vendor_id = ${a.id}`;
const [onAudit] = await sql`select session_ref, reason from audit_log where action = 'vendor.analytics.on' and subject_id = ${a.id}`;
check('the team switches it on: recorded with who, why and the session', s.status === 302 && switched?.enabled === true && Boolean(onAudit?.session_ref) && onAudit.reason === 'E2E: trial', `${s.status}`);
s = await site(analytics(a), { cookie: ownerCookie });
check('its owner now sees their own numbers', s.status === 200 && s.body.includes(`Analytics for Analytics alpha ${run}`) && s.body.includes('>42<'), String(s.status));
check('…never another business’s, nor who (no browser codes, accounts or words)',
  !s.body.includes('977') && !s.body.includes('0000000a0003') && !s.body.includes(ownerVid) && !s.body.includes(ownerA) && !s.body.includes(nothing));
check('…and not stored by browsers', s.headers.get('cache-control') === 'no-store');
s = await site(`${analytics(a).replace('?', '.data?')}`, { cookie: ownerCookie });
check('the page’s data address answers the same', s.status === 200 && s.body.includes('42'), String(s.status));
s = await site('/account', { cookie: ownerCookie });
check('Your account now links to it', s.body.includes(`/vendors/${a.slug}/analytics`));
s = await site(analytics(a), { cookie: ownerBCookie });
check('another business’s owner: not available, and none of its numbers', s.status === 404 && !s.body.includes('>42<'), String(s.status));
s = await site(analytics(a), { cookie: admin });
check('a team admin who isn’t its owner: not available there (they use the team page)', s.status === 404, String(s.status));
await sql`insert into vendor_analytics (vendor_id, enabled, changed_by, audit_id)
          select ${gone.id}, true, ${adminId}, id from audit_log where action = 'vendor.analytics.on' and subject_id = ${a.id}`;
s = await site(analytics(gone), { cookie: ownerCookie });
check('an archived listing: not available, even switched on', s.status === 404, String(s.status));
const renamed = `${a.slug}-new`;
await sql`insert into vendor_slug_history (slug, vendor_id) values (${a.slug}, ${a.id})`;
await sql`update vendor set slug = ${renamed} where id = ${a.id}`;
s = await site(analytics(a), { cookie: ownerCookie });
check('an old web address goes to the new one', s.status === 302 && s.location.startsWith(`/vendors/${renamed}/analytics`), `${s.status} ${s.location}`);
await sql`update vendor set slug = ${a.slug} where id = ${a.id}`;
await sql`delete from vendor_slug_history where slug = ${a.slug}`;

console.log('The team’s activity pages');
s = await site('/admin/activity');
check('signed out: the team pages ask you to sign in', s.status === 302 && s.location.startsWith('/sign-in'), `${s.status}`);
s = await site('/admin/activity.data');
check('…and their data address shows nothing', !s.body.includes('Analytics alpha'), String(s.status));
s = await site('/admin/activity', { cookie: nobodyTeamTry });
check('someone not on the team (even with two-step): refused (403)', s.status === 403, String(s.status));
s = await site('/admin/activity', { cookie: admin });
check('the team overview shows categories, the nightly count and database space',
  s.status === 200 && s.body.includes('By main category') && s.body.includes('The nightly count') && s.body.includes('of the free 500 MB') && s.headers.get('cache-control') === 'no-store', String(s.status));
const looksBefore = await audits('activity.view_detail', a.id);
s = await site(`/admin/listings/${a.id}/activity`, { cookie: admin });
check('a business’s activity page shows the switch, its numbers and what was left out',
  s.status === 200 && s.body.includes('Switch off') && s.body.includes('Left out of these numbers'), String(s.status));
check('…and reading totals isn’t recorded as a look at the detail', (await audits('activity.view_detail', a.id)) === looksBefore);
s = await site(`/admin/listings/${a.id}/activity/${today}`, { cookie: admin });
check('a day’s detail shows each action by browser, and that look is recorded once',
  s.status === 200 && s.body.includes('Tapped Visit website') && s.body.includes('Team (left out)') && (await audits('activity.view_detail', a.id)) === looksBefore + 1, String(s.status));
s = await site(`/admin/listings/${a.id}/activity/${today}.data`, { cookie: admin });
check('…so is a look through its data address', (await audits('activity.view_detail', a.id)) === looksBefore + 2, String(s.status));
const searchLooks = await audits('search.view_detail');
s = await site(`/admin/activity/searches/${today}`, { cookie: admin });
check('the words people searched: shown to the team, and the look recorded', s.status === 200 && s.body.includes(nothing) && (await audits('search.view_detail')) === searchLooks + 1);
s = await site(`/admin/listings/${a.id}`, { cookie: admin });
check('the listing page links to its activity; looks at the detail stay out of its History',
  s.body.includes(`/admin/listings/${a.id}/activity`) && s.body.includes('Analytics page for the owner: On') && !s.body.includes('activity.view_detail'));
s = await site(`/admin/listings/${a.id}/activity`, { cookie: admin, method: 'POST', form: { intent: 'analytics', enabled: 'off' } });
s = await site(analytics(a), { cookie: ownerCookie });
check('switched off: recorded, and the owner can’t see it any more', (await audits('vendor.analytics.off', a.id)) === 1 && s.status === 404, String(s.status));
await sql`update vendor_member set ended_at = now() where vendor_id = ${a.id} and user_id = ${ownerAId}`;
await sql`update vendor_analytics set enabled = true where vendor_id = ${a.id}`;
s = await site(analytics(a), { cookie: ownerCookie });
check('a removed owner can’t see it, even switched on', s.status === 404, String(s.status));

await finish('activity and analytics');
