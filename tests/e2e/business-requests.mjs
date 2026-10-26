// Add my business, and asking to remove one (D-63, migration 0058): the full address with
// "keep my street number private" (the number is never kept), limits, the team's view, a claim
// started for the person when the team lists it, and removal requests: owner only, nothing
// changes until the team acts, "done" only once the listing is archived, all recorded.
//
// Usage: npm run test:e2e
import { account, check, cookieFor, finish, passwordSession, run, site, sql, twoStepSession } from './helpers.mjs';

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const words = (html) => decode(html.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ');
const page = (html) => html.slice(0, html.indexOf('window.__reactRouterContext') >>> 0);

const email = (who) => `e2e-breq-${who}-${run}@example.test`;
const ids = {};
const cookie = {};
for (const who of ['p', 'q', 'o', 'm', 'team']) {
  ids[who] = await account(email(who));
  await sql`update app_user set given_name = ${`Pat${who}`}, family_name = 'Tester', display_name = ${`Pat${who} Tester`} where id = ${ids[who]}`;
}
await sql`insert into platform_role (user_id, role) values (${ids.team}, 'admin')`;
for (const who of ['p', 'q', 'o', 'm']) cookie[who] = cookieFor(await passwordSession(email(who)));
cookie.team = cookieFor(await twoStepSession(email('team')));
const [town] = await sql`select id from municipality where is_active order by sort_order limit 1`;
const [cat] = await sql`select id from category where parent_id is null order by sort_order limit 1`;

const NAME = `Pat’s Party Cakes ${run}`;
// Each from its own made-up address, so the few-a-minute guard (as Suggest a business) isn't what's tested.
let addresses = 0;
const add = (who, extra = {}) =>
  site('/account/add-business', {
    cookie: cookie[who],
    ip: `198.51.100.${(++addresses % 250) + 1}`,
    method: 'POST',
    form: {
      businessName: NAME, category: '', town: 'Orillia', unit: 'Unit 2', number: '22', street: 'Lakeshore Road', hideNumber: 'yes',
      postalCode: 'l3v1a1', contact: '705-555-0101', website: '', relationship: 'owner', note: 'Call after 4', authorised: 'yes',
      ...extra,
    },
  });

console.log('Add my business');
let r = await site('/account/add-business');
check('signed out, it sends you to sign in', r.status === 302 && r.location.startsWith('/join'), `${r.status} ${r.location}`);
r = await site('/account/add-business', { cookie: cookie.p });
check('it asks for the unit, number, street, town and postal code, with keep-it-private',
  r.status === 200 && ['name="unit"', 'name="number"', 'name="street"', 'name="town"', 'name="postalCode"', 'name="hideNumber"'].every((f) => r.body.includes(f)), String(r.status));
check('…and how you’re connected, as four choices', ['owner', 'manager', 'employee', 'other'].every((v) => r.body.includes(`name="relationship" value="${v}"`)));
r = await add('p', { businessName: '', town: '', contact: '', relationship: '', authorised: '' });
let w = words(page(r.body));
check('the name, town, contact, connection and permission are needed', r.status === 400 && w.includes('Enter the business’s name') && w.includes('Enter the town')
  && w.includes('phone number or email') && w.includes('Choose how you’re connected') && w.includes('allowed to manage'), String(r.status));
check('…and what was typed is kept', r.body.includes('value="Lakeshore Road"') && r.body.includes('value="Unit 2"'));
r = await add('p', { number: '22', street: '' });
check('a number without its street is refused', r.status === 400 && words(page(r.body)).includes('Enter the street as well'), String(r.status));
r = await add('p');
check('sent: back to Businesses, thanked', r.status === 302 && r.location === '/account?tab=businesses&added=1', `${r.status} ${r.location}`);
let [row] = await sql`select * from vendor_suggestion where suggested_by = ${ids.p} and business_name = ${NAME}`;
check('saved as theirs, with the street, town and postal code', row && row.relationship === 'owner'
  && row.address_street === 'Lakeshore Road' && row.town === 'Orillia' && row.postal_code === 'L3V 1A1' && row.note === 'Call after 4' && row.contact === '705-555-0101');
check('…the private street number and unit were never kept', row && row.hide_address_number === true && row.address_number === null && row.address_unit === null);
const [log] = await sql`select count(*)::int as n from audit_log where action = 'vendor_suggestion.own' and subject_id = ${row?.id ?? null}`;
check('…and recorded', log.n === 1);
r = await site('/account?tab=businesses&added=1', { cookie: cookie.p });
w = words(page(r.body));
check('Businesses shows it, with our team', w.includes(NAME) && w.includes('With our team') && w.includes('Our team will be in touch'));
r = await site('/account?tab=businesses', { cookie: cookie.q });
check('…but not to anyone else', !words(page(r.body)).includes(NAME));
r = await add('p', { businessName: `${NAME} two`, hideNumber: '' });
const [two] = await sql`select address_number, address_unit from vendor_suggestion where business_name = ${`${NAME} two`}`;
check('a street number and unit not kept private are kept', r.status === 302 && two?.address_number === '22' && two.address_unit === 'Unit 2');
await add('p', { businessName: `${NAME} three` });
r = await add('p', { businessName: `${NAME} four` });
check('at most 3 waiting at a time', r.status === 409 && words(page(r.body)).includes('3 businesses waiting'), String(r.status));

console.log('\nThe team');
r = await site('/admin/suggestions', { cookie: cookie.p });
check('not on the team: the suggestions page is closed', r.status === 302 || r.status === 403 || r.status === 404, String(r.status));
r = await site('/admin/suggestions', { cookie: cookie.team });
w = words(page(r.body));
check('the team sees it was added by its owner, who, and the address', r.status === 200 && w.includes('Added by its owner') && w.includes(email('p'))
  && w.includes('Lakeshore Road, Orillia, L3V 1A1') && w.includes('Unit 2, 22 Lakeshore Road, Orillia, L3V 1A1') && w.includes('keep their street number private'), String(r.status));
r = await site(`/admin/listings/new?suggestion=${row.id}`, {
  cookie: cookie.team,
  method: 'POST',
  form: { suggestionId: row.id, name: NAME, slug: '', tagline: '', description: '', municipalityId: town.id, primaryCategoryId: cat.id, websiteUrl: '', publicEmail: '', publicPhone: '' },
});
check('the team adds it as a draft', r.status === 302, `${r.status} ${r.location}`);
const [made] = await sql`select v.id, v.claim_status from vendor_suggestion s join vendor v on v.id = s.vendor_id where s.id = ${row.id}`;
const claims = made ? await sql`select status, relationship, claimant_note from vendor_claim where vendor_id = ${made.id} and claimant_user_id = ${ids.p}` : [];
check('…which starts a claim for them, waiting to be confirmed', claims.length === 1 && claims[0].status === 'submitted' && claims[0].relationship === 'owner'
  && made.claim_status === 'claim_pending', JSON.stringify(claims));
const [claimLog] = await sql`select count(*)::int as n from audit_log where action = 'vendor_claim.from_own_business' and actor_user_id = ${ids.team}`;
check('…recorded', claimLog.n === 1);
const [memberRows] = await sql`select count(*)::int as n from vendor_member where vendor_id = ${made?.id ?? null}`;
check('…and gives them nothing until the team confirms it', memberRows.n === 0);
r = await site('/account?tab=businesses', { cookie: cookie.p });
check('their Businesses now shows the claim, waiting', words(page(r.body)).includes('Your claim'));

// Already on Localites: marking it so starts a claim on that listing instead.
const [LISTED] = await sql`
  insert into vendor (slug, display_name, primary_municipality_id, listing_status, published_at, claim_status, source)
  values (${`e2e-breq-l-${run}`}, ${`Already Listed ${run}`}, ${town.id}, 'published', now(), 'unclaimed', 'admin_entered') returning id`;
await add('q', { businessName: `Already Listed ${run}`, relationship: 'manager' });
const [qs] = await sql`select id from vendor_suggestion where suggested_by = ${ids.q} and relationship is not null`;
r = await site('/admin/suggestions', { cookie: cookie.team, method: 'POST', form: { intent: 'duplicate', id: qs.id, vendorId: LISTED.id } });
const [qc] = await sql`select c.status, c.relationship, v.claim_status from vendor_claim c join vendor v on v.id = c.vendor_id
                        where c.vendor_id = ${LISTED.id} and c.claimant_user_id = ${ids.q}`;
check('marked as already listed: a claim is started on that listing', r.status === 302 && qc?.status === 'submitted' && qc.relationship === 'manager'
  && qc.claim_status === 'claim_pending', JSON.stringify(qc));

console.log('\nAsking to remove a business');
const [V] = await sql`
  insert into vendor (slug, display_name, primary_municipality_id, listing_status, published_at, claim_status, source)
  values (${`e2e-breq-v-${run}`}, ${`Removal Test ${run}`}, ${town.id}, 'published', now(), 'claimed', 'admin_entered')
  returning id, slug::text as slug, display_name as name`;
await sql`insert into vendor_member (vendor_id, user_id, role) values (${V.id}, ${ids.o}, 'owner'), (${V.id}, ${ids.m}, 'manager')`;
// Someone has saved it and booked it for an upcoming event: the team must see that before removing it.
await sql`insert into saved_vendor (user_id, vendor_id) values (${ids.q}, ${V.id})`;
const [ev] = await sql`insert into event (host_user_id, event_date, municipality_id) values (${ids.q}, current_date + 14, ${town.id}) returning id`;
await sql`insert into event_vendor (event_id, host_user_id, vendor_id, status, booked_at) values (${ev.id}, ${ids.q}, ${V.id}, 'booked', now())`;
const REMOVE = `/vendors/${V.slug}/remove`;
r = await site('/account?tab=businesses', { cookie: cookie.o });
check('the owner’s Businesses offers Remove from Localites', r.body.includes(`href="${REMOVE}"`));
r = await site('/account?tab=businesses', { cookie: cookie.m });
check('…a manager’s doesn’t', !r.body.includes(`href="${REMOVE}"`));
r = await site(REMOVE, { cookie: cookie.m });
check('a manager can’t open it', r.status === 403, String(r.status));
r = await site(REMOVE, { cookie: cookie.m, method: 'POST', form: { intent: 'ask', reason: 'Nope' } });
check('…nor ask', r.status === 403, String(r.status));
r = await site(REMOVE, { cookie: cookie.q, method: 'POST', form: { intent: 'ask' } });
check('…nor can a stranger', r.status === 404, String(r.status));
let [count] = await sql`select count(*)::int as n from business_removal_request where vendor_id = ${V.id}`;
check('…so nothing was asked', count.n === 0);
r = await site(REMOVE, { cookie: cookie.o });
w = words(page(r.body));
check('the owner sees what it affects and that our team will be in touch', r.status === 200 && w.includes('our team checks first') && w.includes('Nothing changes until then'), String(r.status));
r = await site(REMOVE, { cookie: cookie.o, method: 'POST', form: { intent: 'ask', reason: `Closing ${run}` } });
check('the owner asks', r.status === 302 && r.location === `${REMOVE}?asked=1`, `${r.status} ${r.location}`);
r = await site(`${REMOVE}?asked=1`, { cookie: cookie.o });
w = words(page(r.body));
check('…and is told our team will be in touch, the page staying as it is', w.includes('Sent to our team') && w.includes('be in touch') && w.includes('Your page stays as it is'));
const [listing] = await sql`select listing_status from vendor where id = ${V.id}`;
check('…nothing changed on Localites', listing.listing_status === 'published');
r = await site(REMOVE, { cookie: cookie.o, method: 'POST', form: { intent: 'ask' } });
check('asking twice is refused', r.status === 409, String(r.status));
r = await site(REMOVE, { cookie: cookie.o, method: 'POST', form: { intent: 'withdraw' } });
check('the owner can withdraw it', r.status === 302 && r.location === `${REMOVE}?withdrawn=1`);
r = await site(REMOVE, { cookie: cookie.o, method: 'POST', form: { intent: 'ask', reason: `Closing ${run}` } });
const [req] = await sql`select id from business_removal_request where vendor_id = ${V.id} and status = 'new'`;
check('…and ask again', r.status === 302 && Boolean(req));

r = await site('/admin/removals', { cookie: cookie.o });
check('not on the team: the removal list is closed', r.status === 302 || r.status === 403 || r.status === 404, String(r.status));
r = await site('/admin/removals', { cookie: cookie.team });
w = words(page(r.body));
check('the team sees it, who asked, why, and who it affects', r.status === 200 && w.includes(V.name) && w.includes(email('o')) && w.includes(`Closing ${run}`)
  && w.includes('2 people on its team') && w.includes('1 upcoming booking') && w.includes('saved by 1 person'), String(r.status));
r = await site('/admin', { cookie: cookie.team });
check('…and the team menu counts it', words(page(r.body)).includes('Removal requests (') );
r = await site('/admin/removals', { cookie: cookie.team, method: 'POST', form: { id: req.id, intent: 'done', note: '' } });
check('“done” is refused while the listing is still up', r.status === 409, String(r.status));
r = await site('/admin/removals', { cookie: cookie.o, method: 'POST', form: { id: req.id, intent: 'declined', note: 'x' } });
let [still] = await sql`select status from business_removal_request where id = ${req.id}`;
check('the owner can’t decide it themselves', still.status === 'new', String(r.status));
await sql`update vendor set listing_status = 'archived', archived_at = now() where id = ${V.id}`;
r = await site('/admin/removals', { cookie: cookie.team, method: 'POST', form: { id: req.id, intent: 'done', note: 'Spoke to them' } });
[still] = await sql`select status, decided_by from business_removal_request where id = ${req.id}`;
check('once archived, the team marks it done', r.status === 302 && still.status === 'done' && still.decided_by === ids.team, String(r.status));
const [removalLog] = await sql`select array_agg(action order by created_at) as a from audit_log where subject_id = ${V.id} and action like 'business_removal.%'`;
check('every step is recorded', JSON.stringify(removalLog.a) === JSON.stringify(['business_removal.ask', 'business_removal.withdraw', 'business_removal.ask', 'business_removal.done']), JSON.stringify(removalLog.a));
r = await site(REMOVE, { cookie: cookie.o });
check('an archived business can’t be asked about again', r.status === 404, String(r.status));

console.log('\nDownload your data');
r = await site('/account/data/download', { cookie: cookie.p });
check('Pat’s download has the business she added, with its unit', r.status === 200 && r.body.includes(NAME) && r.body.includes('Unit 2'), String(r.status));
r = await site('/account/data/download', { cookie: cookie.o });
check('the owner’s has their removal request', r.status === 200 && r.body.includes(`Closing ${run}`), String(r.status));

await finish('Add and remove a business');
