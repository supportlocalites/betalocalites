// Admin → Categories and towns (X6, X8; migration 0017). Covers: only the team; adding,
// renaming, reordering and hiding kinds of business and towns, each recorded; web addresses
// never change; two levels only; no duplicate names; a hidden kind or town isn't offered
// for new listings and a hidden main kind isn't shown when people browse.
// Settings and safety checks: tests/e2e/helpers.mjs.
//
// Usage: npm run test:e2e
import { account, check, cookieFor, finish, passwordSession, run, site, sql, twoStepSession } from './helpers.mjs';

const email = (who) => `e2e-cat-${who}-${run}@example.test`;
const ids = { team: await account(email('team')), other: await account(email('other')) };
await sql`insert into platform_role (user_id, role) values (${ids.team}, 'admin')`;
const cookie = { team: cookieFor(await twoStepSession(email('team'))), other: cookieFor(await passwordSession(email('other'))) };
const PAGE = '/admin/categories';
const post = (form, who = 'team', origin) => site(PAGE, { cookie: cookie[who], method: 'POST', form, ...(origin ? { origin } : {}) });
const kind = async (name) => (await sql`select id, slug::text as slug, name, parent_id, is_active, sort_order from category where name = ${name}`)[0];
const town = async (name) => (await sql`select id, slug::text as slug, name, region, is_active from municipality where name = ${name}`)[0];
const audits = async (action, id) => (await sql`select count(*)::int as n from audit_log where action = ${action} and subject_id = ${id}`)[0].n;
const MAIN = `E2E Party Things ${run}`;
const SUB = `E2E Piñatas ${run}`;
const TOWN = `E2E Hamlet ${run}`;

console.log('Only the team');
let r = await site(PAGE, { cookie: cookie.other });
check('someone not on the team: refused (403)', r.status === 403, String(r.status));
r = await post({ intent: 'add-kind', name: MAIN, sortOrder: '90', shown: 'on' }, 'other');
check('…and can’t add a kind of business', r.status === 403 && !(await kind(MAIN)), String(r.status));
r = await site(PAGE, { cookie: cookie.team });
check('the team sees the kinds of business and the towns', r.status === 200 && r.body.includes('Sweets') && r.body.includes('Orillia'), String(r.status));
r = await post({ intent: 'add-kind', name: MAIN, sortOrder: '90', shown: 'on' }, 'team', 'https://evil.example');
check('a form sent from another website: refused', r.status === 403 && !(await kind(MAIN)), String(r.status));

console.log('\nKinds of business');
r = await post({ intent: 'add-kind', name: MAIN, sortOrder: '90', shown: 'on', description: 'Things for parties' });
const main = await kind(MAIN);
check('the team adds a main kind; its web address is made from the name (recorded)',
  r.status === 302 && main?.slug === `e2e-party-things-${run}` && main.parent_id === null && (await audits('category.create', main.id)) === 1, `${r.status} ${main?.slug}`);
r = await site('/explore');
check('it’s shown when people browse', r.body.includes(MAIN));
r = await post({ intent: 'add-kind', name: SUB, sortOrder: '1', shown: 'on', parentId: main.id });
const sub = await kind(SUB);
check('a kind within it, with an accent in the name (web address without it)', r.status === 302 && sub?.parent_id === main.id && sub.slug === `e2e-pinatas-${run}`, sub?.slug);
r = await site('/admin/listings/new', { cookie: cookie.team });
check('it’s offered when the team adds a listing', r.body.includes(SUB));
r = await post({ intent: 'add-kind', name: SUB.toUpperCase(), sortOrder: '2', shown: 'on', parentId: main.id });
check('the same name again under the same main kind: refused plainly', r.status === 409 && r.body.includes('already used'), String(r.status));
r = await post({ intent: 'add-kind', name: '   ', sortOrder: '2' });
check('no name: refused', r.status === 400, String(r.status));
r = await post({ intent: 'add-kind', name: `E2E Other ${run}`, sortOrder: 'soon' });
check('an order that isn’t a number: refused', r.status === 400 && r.body.includes('order from 0 to 9999'), String(r.status));
r = await post({ intent: 'add-kind', name: `E2E Deep ${run}`, sortOrder: '1', shown: 'on', parentId: sub.id });
check('three levels (a kind within a kind within): refused', r.status === 409 && r.body.includes('two levels') && !(await kind(`E2E Deep ${run}`)), String(r.status));
const sweets = (await sql`select id from category where slug = 'sweets'`)[0];
r = await post({ intent: 'update-kind', id: main.id, name: MAIN, sortOrder: '90', shown: 'on', parentId: sweets.id });
check('a main kind with kinds within it can’t become one itself', r.status === 409 && (await kind(MAIN)).parent_id === null, String(r.status));

r = await post({ intent: 'update-kind', id: main.id, name: `${MAIN} renamed`, sortOrder: '91', shown: 'on', description: 'Things for parties' });
const renamed = await kind(`${MAIN} renamed`);
const [change] = await sql`select changes from audit_log where action = 'category.update' and subject_id = ${main.id}`;
check('renaming keeps the web address, and records what changed', r.status === 302 && renamed?.slug === main.slug && renamed.sort_order === 91
  && change?.changes?.name?.from === MAIN, JSON.stringify(change?.changes));
r = await post({ intent: 'update-kind', id: main.id, name: `${MAIN} renamed`, sortOrder: '91', shown: 'on', description: 'Things for parties' });
check('saving with nothing changed says so, and records nothing', r.status === 302 && r.location.includes('unchanged') && (await audits('category.update', main.id)) === 1, r.location);
r = await post({ intent: 'update-kind', id: sub.id, name: SUB, sortOrder: '1', shown: 'on', parentId: sweets.id });
check('a kind within can move to another main kind', r.status === 302 && (await kind(SUB)).parent_id === sweets.id, String(r.status));
r = await post({ intent: 'update-kind', id: main.id, name: `${MAIN} renamed`, sortOrder: '91', description: 'Things for parties' });
check('hiding a main kind: recorded', r.status === 302 && (await kind(`${MAIN} renamed`)).is_active === false, String(r.status));
r = await site('/explore');
check('…and it’s no longer shown when people browse', !r.body.includes(`${MAIN} renamed`));
r = await post({ intent: 'update-kind', id: sub.id, name: SUB, sortOrder: '1', parentId: sweets.id });
r = await site('/admin/listings/new', { cookie: cookie.team });
check('a hidden kind isn’t offered for new listings', !r.body.includes(SUB));
r = await post({ intent: 'update-kind', id: '00000000-0000-7000-8000-000000000000', name: 'Nobody', sortOrder: '1' });
check('changing one that doesn’t exist: refused plainly', r.status === 409 && r.body.includes('out of date'), String(r.status));

console.log('\nTowns');
r = await post({ intent: 'add-town', name: TOWN, region: 'Simcoe County', sortOrder: '50' });
const t = await town(TOWN);
check('the team adds a town; it starts hidden unless ticked (recorded)',
  r.status === 302 && t?.slug === `e2e-hamlet-${run}` && t.is_active === false && (await audits('municipality.create', t.id)) === 1, `${r.status} ${t?.slug}`);
r = await site('/admin/listings/new', { cookie: cookie.team });
check('a hidden town isn’t offered for new listings', !r.body.includes(TOWN));
r = await post({ intent: 'update-town', id: t.id, name: TOWN, region: 'Simcoe County', sortOrder: '50', shown: 'on' });
r = await site('/admin/listings/new', { cookie: cookie.team });
check('once shown, it is', r.body.includes(TOWN));
r = await post({ intent: 'add-town', name: TOWN.toLowerCase(), region: 'simcoe county', sortOrder: '51' });
check('the same town name again in the same region: refused plainly', r.status === 409 && r.body.includes('already a town'), String(r.status));
r = await post({ intent: 'update-town', id: t.id, name: `${TOWN} Village`, region: 'Simcoe County', sortOrder: '50', shown: 'on' });
check('renaming a town keeps its web address (recorded)', r.status === 302 && (await town(`${TOWN} Village`))?.slug === t.slug && (await audits('municipality.update', t.id)) === 2, String(r.status));
r = await post({ intent: 'update-town', id: t.id, name: `${TOWN} Village`, region: '', sortOrder: '50' });
check('a town without a region: refused', r.status === 400 && r.body.includes('region'), String(r.status));
r = await post({ intent: 'update-town', id: t.id, name: `${TOWN} Village`, region: 'Simcoe County', sortOrder: '50' }, 'other');
check('someone not on the team can’t change a town', r.status === 403 && (await town(`${TOWN} Village`)).is_active === true, String(r.status));

console.log('\nWhat already uses a hidden kind or town keeps it');
const [biz] = await sql`
  insert into vendor (slug, display_name, primary_municipality_id, listing_status, claim_status, source)
  values (${`e2e-cat-biz-${run}`}, ${`Cat Biz ${run}`}, ${t.id}, 'draft', 'unclaimed', 'admin_entered') returning id`;
await sql`insert into vendor_category (vendor_id, category_id, is_primary) values (${biz.id}, ${sub.id}, true)`;
const [ev] = await sql`
  insert into event (host_user_id, event_date, municipality_id)
  values (${ids.other}, (now() at time zone 'America/Toronto')::date + 20, ${t.id}) returning id`;
await sql`insert into event_private (event_id, host_user_id, title) values (${ev.id}, ${ids.other}, ${`Cat party ${run}`})`;
// The test town is hidden again (it also keeps the local database tidy).
await post({ intent: 'update-town', id: t.id, name: `${TOWN} Village`, region: 'Simcoe County', sortOrder: '50' });
r = await site(`/admin/listings/${biz.id}`, { cookie: cookie.team });
const chosen = (id) => new RegExp(`<option[^>]*value="${id}"[^>]*selected|<option[^>]*selected[^>]*value="${id}"`).test(r.body);
check('the team’s listing page still offers (and has chosen) its hidden kind and town, marked hidden',
  r.status === 200 && r.body.includes(`${SUB} (hidden)`) && r.body.includes(`${TOWN} Village (hidden)`) && chosen(sub.id) && chosen(t.id), String(r.status));
r = await site(`/events/${ev.id}/edit`, { cookie: cookie.other });
check('a person editing an event in a hidden town still has that town chosen', r.status === 200 && chosen(t.id), String(r.status));
r = await site('/events/new', { cookie: cookie.other });
check('…but a hidden town isn’t offered for a new event', r.status === 200 && !r.body.includes(`${TOWN} Village`), String(r.status));

await finish('categories and towns');
