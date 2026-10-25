// Groups in Messages (D-62, migration 0057): a Message all becomes the person's own named group
// (named before sending, or called by the date; renamed later), with its own page showing what
// was asked and where each business has got to; the conversations stay one to one (Unread, a
// reply to one business only). Nobody else sees a group: not another person, not the
// businesses (never its name, nor who else was asked), not signed out.
//
// Usage: npm run test:e2e
import { account, check, cookieFor, finish, passwordSession, run, site, sql } from './helpers.mjs';

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const words = (html) => decode(html.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ');

const [town] = await sql`select id from municipality where is_active order by sort_order limit 1`;
async function listing(label, claim = 'claimed') {
  const [v] = await sql`
    insert into vendor (slug, display_name, primary_municipality_id, listing_status, published_at, claim_status, source)
    values (${`e2e-grp-${label}-${run}`}, ${`Groups ${label} ${run}`}, ${town.id}, 'published', now(), ${claim}, 'admin_entered')
    returning id, slug::text as slug, display_name as name`;
  return v;
}
const V = await listing('cakes');
const W = await listing('photos');
const U = await listing('unclaimed', 'unclaimed');
const email = (who) => `e2e-grp-${who}-${run}@example.test`;
const ids = {};
for (const who of ['a', 'b', 'o', 'w']) ids[who] = await account(email(who));
await sql`insert into vendor_member (vendor_id, user_id, role) values (${V.id}, ${ids.o}, 'owner'), (${W.id}, ${ids.w}, 'owner')`;
const cookie = {};
for (const who of ['a', 'b', 'o', 'w']) cookie[who] = cookieFor(await passwordSession(email(who)));

console.log('Naming a group as it’s sent');
for (const b of [V, W, U]) await site('/shortlist', { cookie: cookie.a, method: 'POST', form: { intent: 'add', slug: b.slug, inline: '1' } });
let r = await site('/shortlist/message', { cookie: cookie.a });
check('Message all asks for a name for the group (optional)', r.status === 200 && r.body.includes('id="groupName"') && words(r.body).includes('Name this group'));
const NAME = `Dinosaur party ${run}`;
const ASK = `Are you free on the 14th? ${run}`;
r = await site('/shortlist/message', { cookie: cookie.a, method: 'POST', form: [['groupName', NAME], ['body', ASK], ['slug', V.slug], ['slug', W.slug]] });
const groupId = /^\/messages\/groups\/([0-9a-f-]{36})\?sent=2$/.exec(r.location)?.[1];
const GROUP = `/messages/groups/${groupId}`;
const [g] = await sql`select name, user_id from message_group where id = ${groupId ?? '00000000-0000-0000-0000-000000000000'}`;
check('sent: straight to the new group, named as typed, theirs', r.status === 302 && g?.name === NAME && g?.user_id === ids.a, `${r.status} ${r.location}`);
check('…with both conversations in it, each message marked as sent with it',
  (await sql`select count(*)::int as n from message_group_member where group_id = ${groupId}`)[0].n === 2
  && (await sql`select count(*)::int as n from message_group_send where group_id = ${groupId}`)[0].n === 2);
r = await site('/shortlist/message', { cookie: cookie.a, method: 'POST', form: [['groupName', 'n'.repeat(61)], ['body', 'Hi'], ['slug', V.slug]] });
check('a name over 60 letters is refused, nothing sent', r.status === 400 && words(r.body).includes('up to 60 letters'), String(r.status));

console.log('\nThe group’s page');
r = await site(`${GROUP}?sent=2`, { cookie: cookie.a });
let text = words(r.body);
check('it shows the name, what was asked, both businesses and that they’re waiting', r.status === 200 && text.includes(NAME) && text.includes(ASK)
  && text.includes(V.name) && text.includes(W.name) && text.includes('2 waiting') && text.includes('Sent to 2 businesses'), String(r.status));
check('…with the top bar: Browse local, Messages, Community', r.body.includes('href="/explore"') && r.body.includes('href="/community"') && text.includes('Community'));
const [vConv] = await sql`select id from conversation where consumer_user_id = ${ids.a} and vendor_id = ${V.id} and ended_at is null`;
const REPLY = `Yes, we can do a T. rex! ${run}`;
r = await site(`/vendors/${V.slug}/messages/${vConv.id}`, { cookie: cookie.o, method: 'POST', form: { intent: 'send', body: REPLY } });
check('(the cake business replies)', [302, 303].includes(r.status), String(r.status));
r = await site(GROUP, { cookie: cookie.a });
text = words(r.body);
check('…now: a new reply from one, the other still waiting', text.includes('New reply') && text.includes(REPLY) && text.includes('1 replied') && text.includes('1 waiting'));

console.log('\nMessages: groups to keep track, single conversations to reply');
r = await site('/messages', { cookie: cookie.a });
text = words(r.body);
check('Messages opens on Groups: the group, its businesses and that one is new', text.includes('Your groups') && text.includes(NAME) && text.includes('1 new')
  && r.body.includes(`href="${GROUP}"`));
r = await site('/messages?view=unread', { cookie: cookie.a });
// Only the list as shown (the page's data for the browser has every conversation).
text = words(r.body.slice(0, r.body.indexOf('window.__reactRouterContext')));
check('Unread shows just the new reply, tagged with its group', text.includes(V.name) && !text.includes(W.name) && text.includes(NAME),
  text.slice(text.indexOf('Groups'), text.indexOf('Groups') + 300));
r = await site('/messages?view=all&order=old', { cookie: cookie.a });
check('All, oldest first, shows both', words(r.body).includes(V.name) && words(r.body).includes(W.name) && /aria-current="true"[^>]*>All</.test(r.body)
  && words(r.body).includes('Oldest first'));
r = await site(`/messages/${vConv.id}`, { cookie: cookie.a });
text = words(r.body);
check('the conversation is one to one: “Reply to … only”, with its group linked and the message marked',
  text.includes(`Reply to ${V.name} only`) && r.body.includes(`href="${GROUP}"`) && text.includes(`Sent with your group “${NAME}”`));
r = await site(`/vendors/${V.slug}/messages/${vConv.id}`, { cookie: cookie.o });
text = words(r.body);
check('the business sees the message but never the group, its name, or who else was asked',
  text.includes(ASK) && !text.includes(NAME) && !text.includes('Sent with') && !text.includes(W.name));

console.log('\nRenaming, and writing to everyone again');
const NEW = `Theo’s dinosaur party ${run}`;
r = await site(GROUP, { cookie: cookie.a, method: 'POST', form: { intent: 'rename', groupName: NEW } });
check('the group can be renamed', r.status === 302 && (await sql`select name from message_group where id = ${groupId}`)[0].name === NEW, String(r.status));
r = await site(GROUP, { cookie: cookie.a, method: 'POST', form: { intent: 'rename', groupName: '   ' } });
check('…but not to nothing', r.status === 400 && (await sql`select name from message_group where id = ${groupId}`)[0].name === NEW, String(r.status));
const AGAIN = `We’ve settled on 2pm. ${run}`;
const before = (await sql`select count(*)::int as n from message where author_user_id = ${ids.a}`)[0].n;
r = await site(GROUP, { cookie: cookie.a, method: 'POST', form: [['intent', 'write'], ['body', AGAIN], ['slug', V.slug], ['slug', W.slug]] });
check('writing to everyone sends it to each, privately, and back to the group',
  r.status === 302 && r.location === `${GROUP}?sent=2` && (await sql`select count(*)::int as n from message where author_user_id = ${ids.a}`)[0].n === before + 2
  && (await sql`select count(*)::int as n from message_group_send where group_id = ${groupId}`)[0].n === 4, `${r.status} ${r.location}`);
r = await site(GROUP, { cookie: cookie.a, method: 'POST', form: [['intent', 'write'], ['body', 'Sneaky'], ['slug', U.slug]] });
check('…only to the businesses in the group', r.status === 409, String(r.status));

console.log('\nNobody else');
r = await site(GROUP, { cookie: cookie.b });
check('another person: the group is “not found”', r.status === 404, String(r.status));
r = await site(GROUP, { cookie: cookie.b, method: 'POST', form: { intent: 'rename', groupName: 'Mine now' } });
check('…can’t rename it', r.status === 404 && (await sql`select name from message_group where id = ${groupId}`)[0].name === NEW, String(r.status));
const beforeB = (await sql`select count(*)::int as n from message where author_user_id = ${ids.b}`)[0].n;
r = await site(GROUP, { cookie: cookie.b, method: 'POST', form: [['intent', 'write'], ['body', 'Hello'], ['slug', V.slug]] });
check('…or write to its businesses through it', r.status === 404 && (await sql`select count(*)::int as n from message where author_user_id = ${ids.b}`)[0].n === beforeB, String(r.status));
r = await site(GROUP, { cookie: cookie.o });
check('the business’s owner: not found either', r.status === 404, String(r.status));
r = await site(GROUP);
check('signed out: asked to sign in', [302, 303].includes(r.status) && r.location.startsWith('/join'), `${r.status} ${r.location}`);
r = await site('/messages', { cookie: cookie.b });
check('another person’s Messages shows none of it', !words(r.body).includes(NEW) && !words(r.body).includes(V.name));

console.log('\nLeft unnamed, the date');
r = await site('/shortlist/message', { cookie: cookie.a, method: 'POST', form: [['body', `Any dates in May? ${run}`], ['slug', W.slug]] });
const plainId = /^\/messages\/groups\/([0-9a-f-]{36})/.exec(r.location)?.[1];
const parts = new Intl.DateTimeFormat('en-CA', { day: 'numeric', month: 'short', timeZone: 'America/Toronto' }).formatToParts(new Date());
const today = `Message all · ${parts.find((p) => p.type === 'day').value} ${parts.find((p) => p.type === 'month').value.replace('.', '')}`;
check('no name given: called by the date', r.status === 302 && (await sql`select name from message_group where id = ${plainId ?? '00000000-0000-0000-0000-000000000000'}`)[0]?.name === today,
  `${r.status} ${r.location}`);
r = await site(`/messages/${(await sql`select id from conversation where consumer_user_id = ${ids.a} and vendor_id = ${W.id} and ended_at is null`)[0].id}`, { cookie: cookie.a });
check('a business in two groups shows both on its conversation', r.body.includes(`href="${GROUP}"`) && r.body.includes(`href="/messages/groups/${plainId}"`));

console.log('\nCommunity');
r = await site('/community');
check('Community is its own page, saying plainly it isn’t open yet', r.status === 200 && words(r.body).includes('It isn’t open yet'), String(r.status));

await finish('message groups');
