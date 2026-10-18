// Admin → Users and roles (X10, migration 0035) and the audit log (X11). Covers: only the
// team opens either page; adding an admin by email (an account must exist), with a reason,
// recorded; the new admin gets in; nobody removes themselves; a removed admin is refused on
// their next click and can't add themselves back; forms from other websites are refused;
// the audit log shows entries, filters by record, ignores a malformed address, and records
// each look. Settings and safety checks: tests/e2e/helpers.mjs.
//
// Usage: npm run test:e2e
import { account, check, cookieFor, finish, passwordSession, run, site, sql, twoStepSession } from './helpers.mjs';

const email = (who) => `e2e-team-${who}-${run}@example.test`;
const ids = { a: await account(email('a')), b: await account(email('b')), other: await account(email('other')) };
await sql`insert into platform_role (user_id, role) values (${ids.a}, 'admin')`;
const cookie = { a: cookieFor(await twoStepSession(email('a'))), other: cookieFor(await passwordSession(email('other'))) };
const PAGE = '/admin/team';
const post = (form, who = 'a', origin) => site(PAGE, { cookie: cookie[who], method: 'POST', form, ...(origin ? { origin } : {}) });
const isAdmin = async (id) =>
  (await sql`select count(*)::int as n from platform_role where user_id = ${id} and role = 'admin' and revoked_at is null`)[0].n === 1;
const audits = async (action, id) =>
  (await sql`select actor_user_id, reason from audit_log where action = ${action} and subject_id = ${id} order by created_at`).map(
    (x) => `${x.actor_user_id}:${x.reason}`,
  );

console.log('Users and roles: only the team');
let r = await site(PAGE, { cookie: cookie.other });
check('someone not on the team: refused (403)', r.status === 403, String(r.status));
r = await post({ intent: 'add', email: email('other'), reason: 'me' }, 'other');
check('…and can’t add themselves', r.status === 403 && !(await isAdmin(ids.other)), String(r.status));
r = await site(PAGE, { cookie: cookie.a });
check('the team sees who is on the team, themselves marked', r.status === 200 && r.body.includes(`e2e-team-a-${run} (you)`), String(r.status));
r = await post({ intent: 'add', email: email('b'), reason: 'Helping' }, 'a', 'https://evil.example');
check('a form sent from another website: refused', r.status === 403 && !(await isAdmin(ids.b)), String(r.status));

console.log('\nAdding');
r = await post({ intent: 'add', email: `nobody-${run}@example.test`, reason: 'Helping' });
check('an email with no Localites account: refused, saying how', r.status === 409 && r.body.includes('sign in to Localites once first'), String(r.status));
r = await post({ intent: 'add', email: email('b'), reason: '' });
check('no reason: refused', r.status === 400 && !(await isAdmin(ids.b)), String(r.status));
r = await post({ intent: 'add', email: email('b').toUpperCase(), reason: 'Helping with claims' });
check('the team adds B (email in any case)', r.status === 302 && r.location === '/admin/team?saved=added' && (await isAdmin(ids.b)), `${r.status} ${r.location}`);
check('…recorded with who and why', (await audits('platform_role.grant', ids.b)).join() === `${ids.a}:Helping with claims`);
r = await post({ intent: 'add', email: email('b'), reason: 'Again' });
check('adding B twice: refused', r.status === 409 && r.body.includes('already on the team'), String(r.status));
cookie.b = cookieFor(await twoStepSession(email('b')));
r = await site('/admin', { cookie: cookie.b });
check('B opens the team pages', r.status === 200, String(r.status));

console.log('\nRemoving');
r = await post({ intent: 'remove', userId: ids.a, reason: 'Leaving' });
check('nobody removes themselves', r.status === 409 && (await isAdmin(ids.a)), String(r.status));
r = await post({ intent: 'remove', userId: ids.other, reason: 'x' });
check('removing someone not on the team: refused', r.status === 409 && r.body.includes('isn’t on the team'), String(r.status));
r = await post({ intent: 'remove', userId: 'not-an-id', reason: 'x' });
check('a malformed id: refused', r.status === 400, String(r.status));
r = await post({ intent: 'remove', userId: ids.b, reason: 'Done helping' });
check('A removes B', r.status === 302 && !(await isAdmin(ids.b)), `${r.status} ${r.location}`);
check('…recorded with who and why', (await audits('platform_role.revoke', ids.b)).join() === `${ids.a}:Done helping`);
r = await site('/admin', { cookie: cookie.b });
check('B is refused on the next click (403)', r.status === 403, String(r.status));
r = await post({ intent: 'add', email: email('b'), reason: 'Back' }, 'b');
check('…and can’t add themselves back', r.status === 403 && !(await isAdmin(ids.b)), String(r.status));
r = await site(PAGE, { cookie: cookie.a });
check('B is listed as formerly on the team', r.body.includes('Formerly on the team') && r.body.includes(`e2e-team-b-${run}`));

console.log('\nAudit log');
r = await site('/admin/audit', { cookie: cookie.other });
check('someone not on the team: refused (403)', r.status === 403, String(r.status));
const looks = async () => (await sql`select count(*)::int as n from audit_log where action = 'audit_log.view' and actor_user_id = ${ids.a}`)[0].n;
const before = await looks();
r = await site('/admin/audit', { cookie: cookie.a });
check('the team sees the newest entries, with who and why', r.status === 200 && r.body.includes('platform_role.revoke') && r.body.includes('Done helping'), String(r.status));
check('…and the look is recorded', (await looks()) === before + 1);
r = await site(`/admin/audit?record=${ids.b}`, { cookie: cookie.a });
check('one record’s entries only', r.status === 200 && r.body.includes('Helping with claims') && r.body.includes('Showing one record only'), String(r.status));
r = await site(`/admin/audit?record=${ids.other}`, { cookie: cookie.a });
check('a record with nothing about it: says so', r.status === 200 && r.body.includes('Nothing recorded'), String(r.status));
r = await site(`/admin/audit?who=x&kind=constructor&record=1'or'1&before=nonsense~1`, { cookie: cookie.a });
check('a malformed address is ignored, not an error', r.status === 200 && r.body.includes('platform_role.revoke'), String(r.status));
r = await site(`/admin/audit?who=${ids.a}&kind=app_user`, { cookie: cookie.a });
check('filtered by who and kind', r.status === 200 && r.body.includes('Done helping'), String(r.status));
for (const bad of ['2026', '2026-02-30 10:00:00+00', '2026-10-18 25:00:00+00']) {
  r = await site(`/admin/audit?before=${encodeURIComponent(`${bad}~${ids.a}`)}`, { cookie: cookie.a });
  check(`an impossible time in the address (${bad}) is ignored, not an error`, r.status === 200 && r.body.includes('platform_role.revoke'), String(r.status));
}

// Paging: 60 entries about one record, 50 on the first page, the other 10 on the next.
const pageRecord = ids.other;
await sql`insert into audit_log (actor_user_id, action, subject_type, subject_id, reason, created_at)
          select ${ids.a}, 'e2e.page_test', 'app_user', ${pageRecord}, 'entry ' || n, now() - n * interval '1 second'
          from generate_series(1, 60) n`;
r = await site(`/admin/audit?record=${pageRecord}`, { cookie: cookie.a });
const reasons = (body) => [...body.matchAll(/Why: entry (\d+)/g)].map((m) => Number(m[1]));
const first = reasons(r.body);
const older = r.body.match(/href="(\/admin\/audit\?[^"]*before=[^"]*)"/)?.[1]?.replaceAll('&amp;', '&');
check('the first page: the newest 50, with a link to older entries', first.length === 50 && first[0] === 1 && first[49] === 50 && Boolean(older), `${first.length} ${older}`);
r = await site(older ?? '/admin/audit', { cookie: cookie.a });
const second = reasons(r.body);
check('the next page: the other 10, none repeated, no further link', second.length === 10 && second[0] === 51 && second[9] === 60 && !r.body.includes('Older entries'), `${second.length} ${second[0]}`);

const [oldest] = await sql`select created_at::text as at, id from audit_log order by created_at, id limit 1`;
r = await site(`/admin/audit?before=${encodeURIComponent(`${oldest.at}~${oldest.id}`)}`, { cookie: cookie.a });
check('older than the very first entry: nothing', r.status === 200 && r.body.includes('Nothing recorded before that'), String(r.status));

await finish('users and roles, and the audit log');
