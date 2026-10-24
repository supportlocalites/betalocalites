// Owners editing their own listing (D-34, ADR-029): only the owner, only their own
// business, only the fields they may change; live at once; the team's undo, Remove owner
// and daily note. Settings and safety checks: tests/e2e/helpers.mjs.
//
// Usage: npm run test:e2e
import { account, check, cookieFor, finish, passwordSession, run, site, sql, twoStepSession } from './helpers.mjs';

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** A hidden field's value: the page's own copy of what it loaded ("base", or the team's "loaded"). */
const hiddenOf = (name) => (html) => {
  const m = new RegExp(`name="${name}" value="([^"]*)"`).exec(html) ?? new RegExp(`value="([^"]*)" name="${name}"`).exec(html);
  return m ? decode(m[1]) : null;
};
const baseOf = hiddenOf('base');
const loadedOf = hiddenOf('loaded');
/** Work done after the page answered (emails, records): waits until it shows, up to 5 seconds. */
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
const extra = await listing('extra');
const [category] = await sql`select id from category where is_active order by sort_order limit 1`;

const ownerEmail = `e2e-owner-${run}@example.test`;
const otherEmail = `e2e-other-owner-${run}@example.test`;
const nobodyEmail = `e2e-no-business-${run}@example.test`;
const adminEmail = `e2e-own-admin-${run}@example.test`;
const owner2Email = `e2e-owner-two-${run}@example.test`;
const ownerId = await account(ownerEmail);
const otherId = await account(otherEmail);
const nobodyId = await account(nobodyEmail);
const owner2Id = await account(owner2Email);
const adminId = await account(adminEmail);
await sql`insert into platform_role (user_id, role) values (${adminId}, 'admin')`;
for (const v of [mine, hidden, archived]) await sql`insert into vendor_member (vendor_id, user_id, role) values (${v.id}, ${ownerId}, 'owner')`;
await sql`insert into vendor_member (vendor_id, user_id, role) values (${theirs.id}, ${otherId}, 'owner')`;
await sql`insert into vendor_member (vendor_id, user_id, role) values (${extra.id}, ${owner2Id}, 'owner')`;

const owner = cookieFor(await passwordSession(ownerEmail));
const other = cookieFor(await passwordSession(otherEmail));
const nobody = cookieFor(await passwordSession(nobodyEmail));
const owner2 = cookieFor(await passwordSession(owner2Email));
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
check('an archived listing can’t be edited, even by its owner, and the page says why', r.status === 404 && r.body.includes('no longer on Localites'), String(r.status));
r = await site('/account', { cookie: owner });
check('Your account offers to edit the owner’s listings, but not an archived one', r.body.includes(edit(mine)) && !r.body.includes(edit(archived)));

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
// Details from nothing: past the clash check (the page's copy says empty, so does this
// business's), so only the database's "this business's services only" rule can stop it.
r = await site(edit(mine), { cookie: owner, method: 'POST', form: formFrom(JSON.stringify(sneaky), { [`service.${sneaky.services.length - 1}.description`]: 'Stolen' }) });
const [theirsAfter] = await sql`select description from vendor_service where id = ${theirService.id}`;
check('a service of another business, slipped into the form, stops the whole save',
  r.status === 409 && r.body.includes('out of date') && !r.body.includes('Our team changed') && theirsAfter.description === null && (await audits(mine)) === 0,
  `${r.status} ${theirsAfter.description}`);

// 3. Checks on what's typed.
r = await site(edit(mine), { cookie: owner, method: 'POST', form: formFrom(base0, { websiteUrl: 'bit.ly/cakes' }) });
check('a shortened link as the website is refused', r.status === 400 && r.body.includes('not a shortened link'), String(r.status));
r = await site(edit(mine), { cookie: owner, method: 'POST', form: formFrom(base0, { description: 'Order at www.cheap-cakes.example' }) });
check('a web address in the description is refused, naming it and pointing to the Website box',
  r.status === 400 && r.body.includes('Website box') && r.body.includes('www.cheap-cakes.example'), String(r.status));
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
// The Base44 profile shows no services (D-59); the owner's words show at once.
check('visitors see the new words at once', r.body.includes('Custom cakes for every party'));
const [save1] = await sql`
  select oc.audit_id, oc.flags, a.actor_user_id, a.changes from owner_change oc join audit_log a on a.id = oc.audit_id
  where oc.vendor_id = ${mine.id} order by oc.audit_id desc limit 1`;
check('the save is in the audit log, credited to the owner, with before and after', save1?.actor_user_id === ownerId && save1.changes.tagline?.to === 'Custom cakes for every party' && Object.keys(save1.changes).some((k) => k.endsWith(':shown')));
check('a new website on another site is flagged for the team to check now', save1?.flags?.includes('website'));
const [alerted] = await waitFor(() => sql`select alert_status from owner_change where audit_id = ${save1.audit_id}`, ([a]) => !['none', 'sending'].includes(a.alert_status));
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
const [told] = await waitFor(
  () => sql`select status from notification where user_id = ${ownerId} and kind = 'listing_change_undone' order by created_at desc limit 1`,
  ([n]) => n && n.status !== 'queued',
);
check('the owner is emailed what changed back and why (recorded honestly)', told && ['sent', 'failed'].includes(told.status), JSON.stringify(told));
r = await site(`/admin/listings/${mine.id}`, { cookie: admin, method: 'POST', form: { intent: 'owner-undo', auditId: save1.audit_id, key: 'tagline', reason: 'again' } });
check('a save can’t be undone twice, and the team is shown why',
  r.status === 409 && /role="alert"[^>]*>Someone on the team already undid this save/.test(r.body), String(r.status));
r = await site(`/admin/listings/${mine.id}`, { cookie: admin });
check('a partly undone save says which parts were put back and which kept',
  r.body.includes('put back') && r.body.includes('kept as the owner set it'));
r = await site(edit(mine), { cookie: owner });
check('the owner’s edit page says what the team changed back, and why', r.body.includes('our') && r.body.includes('changed back') && r.body.includes('E2E: test undo'));

// 7. The team's daily note (run as Cloudflare's scheduler would). An earlier run today may
// have sent today's note (the pretend email service accepts it), so its saves are put back
// in waiting before the note is removed and run again.
await sql`update owner_change set digest_day = null where digest_day = (now() at time zone 'America/Toronto')::date`;
await sql`delete from team_digest where day = (now() at time zone 'America/Toronto')::date`;
r = await site('/cdn-cgi/handler/scheduled?cron=0+12+*+*+*');
await new Promise((res) => setTimeout(res, 1500));
const [note] = await sql`select status, failure_reason from team_digest where day = (now() at time zone 'America/Toronto')::date`;
const [pending] = await sql`select count(*)::int as n from owner_change where vendor_id = ${mine.id} and digest_day is null`;
check('the daily note runs and records its outcome honestly; unsent saves stay waiting',
  note && ((note.status === 'sent' && pending.n === 0) || (note.status === 'failed' && Boolean(note.failure_reason) && pending.n > 0)), JSON.stringify({ note, pending }));
const today = sql`(now() at time zone 'America/Toronto')::date`;
const [first] = await sql`select status, started_at from team_digest where day = ${today}`;
await site('/cdn-cgi/handler/scheduled?cron=0+14+*+*+*');
await new Promise((res) => setTimeout(res, 1500));
const [second] = await sql`select status, started_at from team_digest where day = ${today}`;
check(first.status === 'sent' ? 'a second run the same day leaves a sent note alone' : 'a second run the same day tries the failed note again',
  first.status === 'sent' ? +second.started_at === +first.started_at && second.status === 'sent' : +second.started_at > +first.started_at,
  JSON.stringify({ first, second }));
r = await site('/admin', { cookie: admin });
check('the team’s Listings page says how the daily note went',
  second.status === 'sent' ? r.body.includes('Daily note of owners’ changes: sent') : r.body.includes('Daily note of owners’ changes: failed on'));

// 7b. Text the team wrote, and the team's own forms (review of D-34).
await sql`update vendor set tagline = ${'Cakes  for every party '}, description = ${'Order at sweettreats.ca or jane@sweettreats.ca.\r\n\r\n\r\nFamily  run.'} where id = ${extra.id}`;
const teamWords = (await sql`select tagline, description from vendor where id = ${extra.id}`)[0];
r = await site(edit(extra), { cookie: owner2 });
const baseX = baseOf(r.body);
const teamLoaded = loadedOf((await site(`/admin/listings/${extra.id}`, { cookie: admin })).body);
// The browser sends the About box with plain line breaks; spaces the save would tidy don't count.
r = await site(edit(extra), { cookie: owner2, method: 'POST', form: formFrom(baseX, { tagline: 'Cakes for every party', description: 'Order at sweettreats.ca or jane@sweettreats.ca.\n\n\nFamily run.', publicPhone: '705 555 0177' }) });
const [phoneSave] = await sql`
  select a.changes from owner_change oc join audit_log a on a.id = oc.audit_id where oc.vendor_id = ${extra.id} order by oc.audit_id desc limit 1`;
const extraRow = await vendorRow(extra);
check('text the team wrote (even with an address in it) never blocks an owner’s save, and isn’t counted as their change',
  r.status === 302 && extraRow.public_phone === '705 555 0177' && extraRow.tagline === teamWords.tagline
  && (await sql`select description from vendor where id = ${extra.id}`)[0].description === teamWords.description
  && Object.keys(phoneSave?.changes ?? {}).join() === 'publicPhone', `${r.status} ${Object.keys(phoneSave?.changes ?? {})}`);
const teamForm = (changes = {}) => {
  const l = JSON.parse(teamLoaded);
  return {
    intent: 'details', loaded: teamLoaded, name: `E2E extra ${run}`, slug: extra.slug, tagline: l.tagline ?? '', description: l.description ?? '',
    municipalityId: town.id, websiteUrl: l.websiteUrl ?? '', publicEmail: '', publicPhone: l.publicPhone ?? '', primaryCategoryId: category.id, ...changes,
  };
};
r = await site(`/admin/listings/${extra.id}`, { cookie: admin, method: 'POST', form: teamForm() });
check('a team save of other details keeps the owner’s newer phone', r.status === 302 && (await vendorRow(extra)).public_phone === '705 555 0177', String(r.status));
r = await site(`/admin/listings/${extra.id}`, { cookie: admin, method: 'POST', form: teamForm({ publicPhone: '705 555 0000' }) });
check('a team member changing the same box is told the owner changed it, and nothing is written',
  r.status === 409 && r.body.includes('The owner changed this while you were editing') && (await vendorRow(extra)).public_phone === '705 555 0177', String(r.status));
r = await site(`/admin/listings/${extra.id}`, { cookie: admin, method: 'POST', form: { ...teamForm(), loaded: '' } });
check('a team form without the page’s copy of what it showed is refused as out of date', r.status === 400 && r.body.includes('out of date'), String(r.status));

// 7c. The team changes the web address while the owner's page is open.
r = await site(edit(extra), { cookie: owner2 });
const baseR = baseOf(r.body);
const renamed = `${extra.slug}-renamed`;
await sql`insert into vendor_slug_history (slug, vendor_id) values (${extra.slug}, ${extra.id})`;
await sql`update vendor set slug = ${renamed} where id = ${extra.id}`;
r = await site(edit(extra), { cookie: owner2, method: 'POST', form: formFrom(baseR, { tagline: 'Renamed while open' }) });
check('a save from the old web address still works, then goes to the new one',
  r.status === 302 && r.location.startsWith(`/vendors/${renamed}/edit?saved=`) && (await vendorRow(extra)).tagline === 'Renamed while open', `${r.status} ${r.location}`);

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
const [removedNote] = await waitFor(
  () => sql`select status from notification where user_id = ${ownerId} and kind = 'owner_removed' order by created_at desc limit 1`,
  ([n]) => n && n.status !== 'queued',
);
check('the removed owner is emailed why (recorded honestly)', removedNote && ['sent', 'failed'].includes(removedNote.status));
const [logged] = await sql`select count(*)::int as n from audit_log where subject_id = ${mine.id} and action = 'vendor_member.end' and actor_user_id = ${adminId}`;
check('removing an owner is in the audit log', logged.n === 1);

// 9. After removal: a website the old owner typed proves nothing, and a new owner starts clean.
await sql`update vendor set website_url = ${save1.changes.websiteUrl.to} where id = ${mine.id}`;
const claimantEmail = `e2e-jane-${run}@${new URL(save1.changes.websiteUrl.to).hostname}`;
await account(claimantEmail);
r = await site(`/vendors/${mine.slug}/claim`, { cookie: cookieFor(await passwordSession(claimantEmail)), method: 'POST', form: { relationship: 'owner', authorised: 'yes' } });
const [claim] = await sql`select id from vendor_claim where vendor_id = ${mine.id} and status = 'submitted'`;
r = await site('/admin/claims', { cookie: admin });
check('the Claims page warns that the website was typed in by a past owner (even though part of that save was undone)',
  Boolean(claim) && r.body.includes('typed in by a past owner'));
r = await site('/admin/claims', { cookie: admin, method: 'POST', form: { intent: 'approve', id: claim?.id ?? '', check: 'email_domain' } });
const [claimAfter] = await sql`select status from vendor_claim where id = ${claim?.id ?? null}`;
check('…and the server refuses "their email is at the business’s website" for it', r.status === 409 && claimAfter?.status === 'submitted', `${r.status} ${claimAfter?.status}`);
await sql`update vendor_claim set status = 'withdrawn' where id = ${claim?.id ?? null}`;
await sql`insert into vendor_member (vendor_id, user_id, role) values (${mine.id}, ${nobodyId}, 'owner')`;
await sql`update vendor set claim_status = 'claimed' where id = ${mine.id}`;
r = await site(edit(mine), { cookie: nobody });
check('a new owner doesn’t see what the team told the last one', r.status === 200 && !r.body.includes('E2E: test undo') && !r.body.includes('changed back'), String(r.status));

await finish('owner editing');
