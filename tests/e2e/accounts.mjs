// Accounts (migrations 0041–0043): the team suspends an account and lifts it (checked on the
// server on every request, recorded); a suspended person can still download their data or
// delete their account; Download my data gives the signed-in person their own data only; and
// the morning run deletes what the privacy policy says it deletes.
//
// Usage: npm run test:e2e
import { account, check, cookieFor, finish, passwordSession, run, site, sql, twoStepSession } from './helpers.mjs';

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const words = (html) => decode(html.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ');

const email = (who) => `e2e-acct-${who}-${run}@example.test`;
const ids = {};
for (const who of ['p', 'q', 'm', 'n']) ids[who] = await account(email(who));
await sql`insert into platform_role (user_id, role) values (${ids.m}, 'admin'), (${ids.n}, 'admin')`;
const cookie = { p: cookieFor(await passwordSession(email('p'))), q: cookieFor(await passwordSession(email('q'))) };
cookie.m = cookieFor(await twoStepSession(email('m')));
const [town] = await sql`select id from municipality where is_active order by sort_order limit 1`;
const [ev] = await sql`insert into event (host_user_id, event_date, start_time, municipality_id) values (${ids.p}, current_date + 20, '15:00', ${town.id}) returning id`;
await sql`insert into event_private (event_id, host_user_id, title, notes) values (${ev.id}, ${ids.p}, ${`P picnic ${run}`}, ${`P notes ${run}`})`;
const [evq] = await sql`insert into event (host_user_id, event_date, start_time, municipality_id) values (${ids.q}, current_date + 20, '15:00', ${town.id}) returning id`;
await sql`insert into event_private (event_id, host_user_id, title) values (${evq.id}, ${ids.q}, ${`Q secret ${run}`})`;

console.log('Accounts');

// ------------------------------------------------------------------ 1. Download my data
let r = await site('/account/data', { cookie: cookie.p });
check('Your account offers Download your data', r.status === 200 && words(r.body).includes('Download my data'), String(r.status));
r = await site('/account/data/download', { cookie: cookie.p });
let file = r.body;
check('the file is the person’s own: account, event, private notes',
  r.status === 200 && /attachment; filename="localites-my-data-\d{4}-\d{2}-\d{2}\.json"/.test(r.headers.get('content-disposition') ?? '') &&
    file.includes(email('p')) && file.includes(`P picnic ${run}`) && file.includes(`P notes ${run}`), `${r.status} ${r.headers.get('content-disposition')}`);
check('…never anyone else’s', !file.includes(`Q secret ${run}`) && !file.includes(email('q')));
r = await site('/account/data/download');
check('signed out: sent to sign in, no file', r.status === 302 && r.location.startsWith('/join'), `${r.status} ${r.location}`);

// ------------------------------------------------------------------ 2. Finding an account
r = await site('/admin/accounts', { cookie: cookie.p, method: 'POST', form: { intent: 'find', email: email('q') } });
check('a person can’t look anyone up on the team’s Accounts page', r.status === 403 || r.status === 404 || (r.status === 302 && !r.location.startsWith('/admin')), `${r.status} ${r.location}`);
check('…and gets nothing back about them', !r.body.includes(email('q')));
r = await site('/admin/accounts', { cookie: cookie.m, method: 'POST', form: { intent: 'find', email: email('p') } });
check('the team finds an account by email, sent in the form (never the web address)',
  r.status === 200 && words(r.body).includes(email('p')) && r.body.includes('name="intent" value="suspend"'), String(r.status));
r = await site('/admin/accounts', { cookie: cookie.m, method: 'POST', form: { intent: 'find', email: `nobody-${run}@example.test` } });
check('…an email nobody uses says so', r.status === 200 && words(r.body).includes('No Localites account uses that email'), String(r.status));
const [looked] = await sql`select count(*)::int as n from audit_log where action = 'account.look' and actor_user_id = ${ids.m} and subject_id = ${ids.p}`;
check('…and the look is recorded', looked.n >= 1, String(looked.n));

// ------------------------------------------------------------------ 3. Suspending
const post = (form, who = 'm') => site('/admin/accounts', { cookie: cookie[who], method: 'POST', form });
r = await post({ intent: 'suspend', userId: ids.p, reason: '' });
check('a reason is needed', r.status === 400 && words(r.body).includes('Say why'), String(r.status));
r = await post({ intent: 'suspend', userId: ids.n, reason: 'test' });
check('a team member can’t be suspended', r.status === 409 && words(r.body).includes('Remove their team role'), String(r.status));
r = await post({ intent: 'suspend', userId: ids.m, reason: 'test' });
check('nor yourself', r.status === 409 && words(r.body).includes('can’t suspend your own account'), String(r.status));
r = await post({ intent: 'suspend', userId: ids.q, reason: 'test' }, 'p');
check('a person can’t suspend someone', r.status !== 302 || !r.location.startsWith('/admin/accounts'), `${r.status} ${r.location}`);
check('…and nothing changed', (await sql`select count(*)::int as n from account_suspension where user_id = ${ids.q}`)[0].n === 0);
r = await post({ intent: 'suspend', userId: ids.p, reason: `Spam ${run}` });
check('the team suspends a person', r.status === 302 && r.location.includes('saved=suspended'), `${r.status} ${r.location}`);
const [rec] = await sql`select reason from audit_log where action = 'account.suspend' and subject_id = ${ids.p}`;
check('…recorded with why', rec?.reason === `Spam ${run}`);

for (const path of ['/events', '/account', `/events/${ev.id}`, '/messages', '/saved']) {
  r = await site(path, { cookie: cookie.p });
  check(`suspended: ${path} sends them to the suspended page`, r.status === 302 && r.location === '/suspended', `${r.status} ${r.location}`);
}
r = await site(`/events/${ev.id}/edit`, { cookie: cookie.p, method: 'POST', form: { title: 'Changed' } });
check('…and can’t change anything', r.status === 302 && r.location === '/suspended', `${r.status} ${r.location}`);
r = await site('/suspended', { cookie: cookie.p });
check('the suspended page says so, with how to reach the team, their data and deleting', r.status === 200 &&
  words(r.body).includes('Your account is suspended') && r.body.includes('/account/data') && r.body.includes('/account/delete') && r.body.includes('supportlocalites@gmail.com'));
r = await site('/account/data/download', { cookie: cookie.p });
check('…they can still download their data', r.status === 200 && r.body.includes(`P picnic ${run}`), String(r.status));
r = await site('/account/delete', { cookie: cookie.p });
check('…and still reach Delete your account', r.status === 200, String(r.status));
r = await site('/events', { cookie: cookie.q });
check('someone else is unaffected', r.status === 200, String(r.status));
r = await site('/admin/accounts', { cookie: cookie.m });
check('the team sees them under Suspended now', words(r.body).includes(email('p')) && words(r.body).includes(`Spam ${run}`));

// ------------------------------------------------------------------ 4. Lifting
r = await post({ intent: 'lift', userId: ids.p, reason: 'Sorted out' });
check('the team lifts it', r.status === 302 && r.location.includes('saved=lifted'), `${r.status} ${r.location}`);
r = await site('/events', { cookie: cookie.p });
check('…and they can use their account again', r.status === 200, String(r.status));
r = await post({ intent: 'lift', userId: ids.p, reason: 'Again' });
check('lifting twice is refused in plain words', r.status === 409 && words(r.body).includes('isn’t suspended'), String(r.status));

// ------------------------------------------------------------------ 5. Waiting for you
await sql`insert into vendor_suggestion (business_name, status) values (${`E2E waiting ${run}`}, 'new')`;
r = await site('/admin/waiting', { cookie: cookie.m });
check('the team’s Waiting for you lists what’s waiting, oldest first, with links',
  r.status === 200 && words(r.body).includes('Suggested businesses:') && r.body.includes('href="/admin/suggestions"'), String(r.status));
check('…counts only, never who', !r.body.includes(`E2E waiting ${run}`) && !r.body.includes(email('p')));
r = await site('/admin/waiting', { cookie: cookie.p });
check('a person can’t open it', r.status === 403 || (r.status === 302 && !r.location.startsWith('/admin')), `${r.status} ${r.location}`);

// ------------------------------------------------------------------ 6. The morning deletions
const [old] = await sql`
  insert into notification (user_id, kind, subject_type, subject_id, status, sent_at, created_at)
  values (${ids.q}, 'new_message', 'conversation', gen_random_uuid(), 'sent', now() - interval '13 months', now() - interval '13 months') returning id`;
const [young] = await sql`
  insert into notification (user_id, kind, subject_type, subject_id, status, sent_at)
  values (${ids.q}, 'new_message', 'conversation', gen_random_uuid(), 'sent', now()) returning id`;
await site('/cdn-cgi/handler/scheduled?cron=0+12+*+*+*');
let gone = false;
for (let i = 0; i < 30 && !gone; i++) {
  await new Promise((res) => setTimeout(res, 200));
  gone = (await sql`select count(*)::int as n from notification where id = ${old.id}`)[0].n === 0;
}
check('the morning run deletes an email record over a year old', gone);
check('…and keeps a recent one', (await sql`select count(*)::int as n from notification where id = ${young.id}`)[0].n === 1);

await finish('account');
