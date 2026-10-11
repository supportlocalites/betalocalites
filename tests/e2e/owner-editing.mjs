// Owners editing their own listing (D-34, ADR-029): only the owner, only their own
// business, only the fields they may change; live at once; the team's undo, Remove owner
// and daily note. Settings and safety checks: tests/e2e/helpers.mjs.
//
// Usage: npm run test:e2e
import { account, check, cookieFor, finish, passwordSession, run, site, sql, twoStepSession } from './helpers.mjs';

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** The page's own copy of what it loaded (the hidden "base" field). */
const baseOf = (html) => {
  const m = /name="base" value="([^"]*)"/.exec(html) ?? /value="([^"]*)" name="base"/.exec(html);
  return m ? decode(m[1]) : null;
};
/** The form as a browser would send it: every field from the page's values, then changes. */
function formFrom(baseJson, changes = {}, newServices = []) {
  const b = JSON.parse(baseJson);
  const f = {
    base: baseJson,
    tagline: b.tagline ?? '',
    description: b.description ?? '',
    websiteUrl: b.websiteUrl ?? '',
    publicPhone: b.publicPhone ?? '',
  };
  const rows = [...b.services, ...newServices];
  rows.forEach((s, i) => {
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
const [town] = await sql`select id from municipality where is_active order by sort_order limit 1`;
async function listing(label, status = 'published') {
  const [v] = await sql`
    insert into vendor (slug, display_name, primary_municipality_id, website_url, public_phone, listing_status, published_at, archived_at, claim_status, source)
    values (${`e2e-own-${label}-${run}`}, ${`E2E ${label} ${run}`}, ${town.id}, 'https://sweettreats.example/', '705 555 0100', ${status},
            ${status === 'published' || status === 'unpublished' ? sql`now()` : null}, ${status === 'archived' ? sql`now()` : null}, 'claimed', 'admin_entered')
    returning id, slug`;
  await sql`insert into vendor_service (vendor_id, name, pricing_model, price_cents, sort_order) values
            (${v.id}, 'Wedding cake', 'starting_at', 35000, 1), (${v.id}, 'Cupcakes', 'fixed', 3600, 2)`;
  return v;
}
const mine = await listing('mine');
const theirs = await listing('theirs');
const hidden = await listing('hidden', 'unpublished');
const archived = await listing('archived', 'archived');

const ownerEmail = `e2e-owner-${run}@example.test`;
const otherEmail = `e2e-other-owner-${run}@example.test`;
const nobodyEmail = `e2e-no-business-${run}@example.test`;
const adminEmail = `e2e-own-admin-${run}@example.test`;
const ownerId = await account(ownerEmail);
const otherId = await account(otherEmail);
await account(nobodyEmail);
const adminId = await account(adminEmail);
await sql`insert into platform_role (user_id, role) values (${adminId}, 'admin')`;
for (const v of [mine, hidden, archived]) await sql`insert into vendor_member (vendor_id, user_id, role) values (${v.id}, ${ownerId}, 'owner')`;
await sql`insert into vendor_member (vendor_id, user_id, role) values (${theirs.id}, ${otherId}, 'owner')`;

const owner = cookieFor(await passwordSession(ownerEmail));
const other = cookieFor(await passwordSession(otherEmail));
const nobody = cookieFor(await passwordSession(nobodyEmail));
const admin = cookieFor(await twoStepSession(adminEmail));
const edit = (v) => `/vendors/${v.slug}/edit`;
const vendorRow = async (v) => (await sql`select display_name, slug, tagline, website_url, public_phone, public_email from vendor where id = ${v.id}`)[0];
const audits = async (v) => (await sql`select count(*)::int as n from audit_log where subject_id = ${v.id} and action like 'vendor.owner_edit%'`)[0].n;

console.log('Owners edit their own listing');

// 1. Only the owner.
let r = await site(edit(mine));
check('signed out: the edit page asks you to sign in, then comes back', r.status === 302 && r.location === `/join?next=${encodeURIComponent(edit(mine))}`, `${r.status} ${r.location}`);
r = await site(edit(mine), { cookie: nobody });
check('signed in without a business: "You can’t edit this listing" (404)', r.status === 404 && r.body.includes('You can’t edit this listing'), String(r.status));
r = await site(edit(mine), { cookie: other });
check('another business’s owner can’t open it (404)', r.status === 404, String(r.status));
r = await site(edit(mine), { cookie: admin });
check('a team admin isn’t its owner either (they edit on the team page)', r.status === 404, String(r.status));
r = await site(edit(archived), { cookie: owner });
check('an archived listing can’t be edited, even by its owner', r.status === 404, String(r.status));

r = await site(edit(mine), { cookie: owner });
const base0 = baseOf(r.body);
check('the owner’s edit page opens, laid out like the public page, never stored by browsers',
  r.status === 200 && Boolean(base0) && r.body.includes('View as a visitor') && r.body.includes('Save changes') && r.body.includes(`E2E mine ${run}`)
  && r.headers.get('cache-control') === 'no-store', String(r.status));
check('the name, town and categories are shown as text, not boxes', !/name="(name|slug|municipalityId|categoryIds|publicEmail)"/.test(r.body));
r = await site(edit(hidden), { cookie: owner });
check('a hidden listing can be edited, and says it’s hidden', r.status === 200 && r.body.includes('hidden from visitors right now'));

// 2. Someone else's form can't change this business.
const before = await vendorRow(mine);
r = await site(edit(mine), { cookie: other, method: 'POST', form: formFrom(base0, { tagline: 'Hijacked' }) });
check('another owner posting to this edit page changes nothing', r.status === 404 && (await vendorRow(mine)).tagline === before.tagline && (await audits(mine)) === 0, String(r.status));
r = await site(edit(mine), { cookie: nobody, method: 'POST', form: formFrom(base0, { tagline: 'Hijacked' }) });
check('so does someone with no business', r.status === 404 && (await audits(mine)) === 0, String(r.status));
r = await site(edit(theirs), { cookie: owner });
check('and the owner can’t open another business’s edit page', r.status === 404, String(r.status));
const [theirService] = await sql`select id, name from vendor_service where vendor_id = ${theirs.id} limit 1`;
const sneaky = JSON.parse(base0);
sneaky.services.push({ id: theirService.id, name: theirService.name, description: null, price: { pricingModel: 'starting_at', priceCents: 35000 }, shown: true });
r = await site(edit(mine), { cookie: owner, method: 'POST', form: formFrom(JSON.stringify(sneaky), { [`service.${sneaky.services.length - 1}.name`]: 'Stolen' }) });
const [theirsAfter] = await sql`select name from vendor_service where id = ${theirService.id}`;
check('a service of another business, slipped into the form, stops the whole save', r.status === 409 && theirsAfter.name === theirService.name && (await audits(mine)) === 0, `${r.status} ${theirsAfter.name}`);

// 3. Checks on what's typed.
r = await site(edit(mine), { cookie: owner, method: 'POST', form: formFrom(base0, { websiteUrl: 'bit.ly/cakes' }) });
check('a shortened link as the website is refused', r.status === 400 && r.body.includes('not a shortened link'), String(r.status));
r = await site(edit(mine), { cookie: owner, method: 'POST', form: formFrom(base0, { description: 'Order at www.cheap-cakes.example' }) });
check('a web address in the description is refused, pointing to the Website box', r.status === 400 && r.body.includes('Website box'), String(r.status));
r = await site(edit(mine), { cookie: owner, method: 'POST', form: formFrom(base0, { 'service.0.price': 'lots' }) });
check('a price that isn’t dollars is pointed out, and nothing is saved', r.status === 400 && r.body.includes('in dollars') && (await audits(mine)) === 0, String(r.status));
r = await site(edit(mine), { cookie: owner, method: 'POST', form: formFrom(base0) });
check('saving with nothing changed says so, and records nothing', r.status === 200 && r.body.includes('Nothing to save') && (await audits(mine)) === 0, String(r.status));

// 4. A real save: live at once, recorded, only the fields owners may change.
const pies = { id: null, name: 'Pies', description: 'Apple or cherry', price: { pricingModel: 'on_request', priceCents: null }, shown: true };
r = await site(edit(mine), {
  cookie: owner,
  method: 'POST',
  form: formFrom(base0, {
    tagline: 'Custom cakes for every party',
    description: 'Family bakery since 1999.\n\nWe deliver.',
    websiteUrl: 'sweettreats-new.example',
    'service.1.shown': '',
    name: 'Renamed by owner',
    slug: 'hijacked-slug',
    publicEmail: 'owner@evil.example',
    municipalityId: '00000000-0000-0000-0000-000000000000',
  }, [pies]),
});
const after = await vendorRow(mine);
check('saving goes straight to the edit page again, saying it’s live', r.status === 302 && r.location.startsWith(`${edit(mine)}?saved=`), `${r.status} ${r.location}`);
check('the changes are saved at once', after.tagline === 'Custom cakes for every party' && after.website_url === 'https://sweettreats-new.example');
check('fields owners may not change are ignored (name, web address, email)', after.display_name === before.display_name && after.slug === before.slug && after.public_email === before.public_email);
r = await site(`/vendors/${mine.slug}`);
check('visitors see the new words, the new service, and not the hidden one', r.body.includes('Custom cakes for every party') && r.body.includes('Pies') && r.body.includes('Apple or cherry') && !r.body.includes('Cupcakes'));
const [save1] = await sql`
  select oc.audit_id, oc.flags, a.actor_user_id, a.changes from owner_change oc join audit_log a on a.id = oc.audit_id
  where oc.vendor_id = ${mine.id} order by oc.audit_id desc limit 1`;
check('the save is in the audit log, credited to the owner, with before and after', save1?.actor_user_id === ownerId && save1.changes.tagline?.to === 'Custom cakes for every party' && Object.keys(save1.changes).some((k) => k.endsWith(':shown')));
check('a new website on another site is flagged for the team to check now', save1?.flags?.includes('website'));
await new Promise((res) => setTimeout(res, 500));
const [alerted] = await sql`select alert_status from owner_change where audit_id = ${save1.audit_id}`;
check('the "check now" email is recorded honestly (sent, failed or not set up)', ['sent', 'failed', 'skipped'].includes(alerted.alert_status), alerted.alert_status);

// 5. Someone on the team changes something while the owner's page is open.
r = await site(edit(mine), { cookie: owner });
const base1 = baseOf(r.body);
await sql`update vendor set website_url = 'https://team-fixed.example/' where id = ${mine.id}`;
r = await site(edit(mine), { cookie: owner, method: 'POST', form: formFrom(base1, { tagline: 'Cakes and pies' }) });
check('an owner editing something else saves fine, and the team’s change stays', r.status === 302 && (await vendorRow(mine)).website_url === 'https://team-fixed.example/' && (await vendorRow(mine)).tagline === 'Cakes and pies', String(r.status));
r = await site(edit(mine), { cookie: owner, method: 'POST', form: formFrom(base1, { websiteUrl: 'mine-again.example' }) });
check('an owner changing the same thing is told, and nothing is written', r.status === 409 && r.body.includes('Our team changed this while you were editing') && (await vendorRow(mine)).website_url === 'https://team-fixed.example/', String(r.status));

// 6. The team's page, and undo.
r = await site(`/admin/listings/${mine.id}`, { cookie: admin });
check('the team page shows the owner and their changes in plain words',
  r.status === 200 && r.body.includes('Changes by the owner') && r.body.includes(ownerEmail) && r.body.includes('Service added: “Pies”') && r.body.includes('Remove owner'));
check('a line changed again since can’t be undone first (the website)', r.body.includes('Changed again since'));
r = await site(`/admin/listings/${mine.id}`, { cookie: owner, method: 'POST', form: { intent: 'owner-undo', auditId: save1.audit_id, key: 'tagline', reason: 'x' } });
check('an owner can’t use the team’s undo (403)', r.status === 403, String(r.status));
const pieKey = Object.keys(save1.changes).find((k) => k.endsWith(':shown') && save1.changes[k].from === null);
const hiddenKey = Object.keys(save1.changes).find((k) => k.endsWith(':shown') && save1.changes[k].from === true);
r = await site(`/admin/listings/${mine.id}`, { cookie: admin, method: 'POST', form: { intent: 'owner-undo', auditId: save1.audit_id, key: pieKey, reason: '' } });
check('undo needs a reason (the owner sees it)', r.status === 400, String(r.status));
r = await site(`/admin/listings/${mine.id}`, { cookie: admin, method: 'POST', form: new URLSearchParams([['intent', 'owner-undo'], ['auditId', save1.audit_id], ['key', pieKey], ['key', hiddenKey], ['key', 'description'], ['reason', 'E2E: test undo']]) });
const [pie] = await sql`select is_active from vendor_service where id = ${pieKey.split(':')[1]}`;
const [cupcakes] = await sql`select is_active from vendor_service where id = ${hiddenKey.split(':')[1]}`;
const undone = await vendorRow(mine);
check('undo puts the ticked changes back: the new service hidden (not deleted), the hidden one shown, the old description',
  r.status === 302 && pie?.is_active === false && cupcakes.is_active === true && (await sql`select description from vendor where id = ${mine.id}`)[0].description === null, String(r.status));
check('…and leaves the rest of the save alone', undone.tagline === 'Cakes and pies');
const [undoRow] = await sql`select oc.undone_by, u.reason, u.action from owner_change oc join audit_log u on u.id = oc.undo_audit_id where oc.audit_id = ${save1.audit_id}`;
check('the undo is recorded, with who and why', undoRow?.undone_by === adminId && undoRow?.reason === 'E2E: test undo' && undoRow?.action === 'vendor.owner_edit.undo');
await new Promise((res) => setTimeout(res, 500));
const [told] = await sql`select status from notification where user_id = ${ownerId} and kind = 'listing_change_undone' order by created_at desc limit 1`;
check('the owner is emailed what changed back and why (recorded honestly)', told && ['sent', 'failed'].includes(told.status), JSON.stringify(told));
r = await site(`/admin/listings/${mine.id}`, { cookie: admin, method: 'POST', form: { intent: 'owner-undo', auditId: save1.audit_id, key: 'tagline', reason: 'again' } });
check('a save can’t be undone twice', r.status === 409 && r.body.includes('Already undone'), String(r.status));
r = await site(edit(mine), { cookie: owner });
check('the owner’s edit page says what the team changed back, and why', r.body.includes('our') && r.body.includes('changed back') && r.body.includes('E2E: test undo'));

// 7. The team's daily note (run as Cloudflare's scheduler would).
await sql`delete from team_digest where day = (now() at time zone 'America/Toronto')::date`;
r = await site('/cdn-cgi/handler/scheduled?cron=0+12+*+*+*');
await new Promise((res) => setTimeout(res, 1500));
const [note] = await sql`select status, failure_reason from team_digest where day = (now() at time zone 'America/Toronto')::date`;
const [pending] = await sql`select count(*)::int as n from owner_change where vendor_id = ${mine.id} and digest_day is null`;
check('the daily note runs and records its outcome honestly; unsent saves stay waiting',
  note && ((note.status === 'sent' && pending.n === 0) || (note.status === 'failed' && Boolean(note.failure_reason) && pending.n > 0)), JSON.stringify({ note, pending }));
const notesBefore = (await sql`select count(*)::int as n from team_digest`)[0].n;
await site('/cdn-cgi/handler/scheduled?cron=0+14+*+*+*');
await new Promise((res) => setTimeout(res, 1500));
const notesAfter = (await sql`select count(*)::int as n from team_digest`)[0].n;
check('a second run the same day makes no second note', notesAfter === notesBefore);
r = await site('/admin', { cookie: admin });
check('the team’s Listings page says how the daily note went', /Daily note of owners’ changes/.test(r.body));

// 8. Remove owner.
const staleForm = formFrom(baseOf((await site(edit(mine), { cookie: owner })).body), { tagline: 'After removal' });
r = await site(`/admin/listings/${mine.id}`, { cookie: admin, method: 'POST', form: { intent: 'owner-remove', reason: '' } });
check('removing an owner needs a reason', r.status === 400, String(r.status));
r = await site(`/admin/listings/${mine.id}`, { cookie: admin, method: 'POST', form: { intent: 'owner-remove', reason: 'E2E: wrong person' } });
const [membership] = await sql`select ended_at from vendor_member where vendor_id = ${mine.id} and user_id = ${ownerId}`;
const [claimState] = await sql`select claim_status from vendor where id = ${mine.id}`;
check('Remove owner ends their access and makes the listing claimable again', r.status === 302 && membership.ended_at !== null && claimState.claim_status === 'unclaimed', `${r.status} ${claimState.claim_status}`);
r = await site(edit(mine), { cookie: owner, method: 'POST', form: staleForm });
check('the removed owner’s open page can’t save any more', (r.status === 404 || r.status === 409) && (await vendorRow(mine)).tagline !== 'After removal', String(r.status));
r = await site(edit(mine), { cookie: owner });
check('…nor open the edit page', r.status === 404, String(r.status));
r = await site('/account', { cookie: owner });
check('…and Your account no longer offers to edit it', !r.body.includes(edit(mine)));
await new Promise((res) => setTimeout(res, 500));
const [removedNote] = await sql`select status from notification where user_id = ${ownerId} and kind = 'owner_removed' order by created_at desc limit 1`;
check('the removed owner is emailed why (recorded honestly)', removedNote && ['sent', 'failed'].includes(removedNote.status));
const [logged] = await sql`select count(*)::int as n from audit_log where subject_id = ${mine.id} and action = 'vendor_member.end' and actor_user_id = ${adminId}`;
check('removing an owner is in the audit log', logged.n === 1);

await finish('owner editing');
