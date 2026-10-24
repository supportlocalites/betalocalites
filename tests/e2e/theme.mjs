// Light only (D-59, K16): the Base44 design has one look, so no page offers the moon or the sun
// and a dark choice made before (D-57's cookie) no longer turns a page dark. The /theme address is
// kept with its code until the owner asks what can be removed; it still only ever goes back to a
// page on this site.
//
// Usage: npm run test:e2e
import { account, check, cookieFor, finish, passwordSession, run, site, twoStepSession, sql } from './helpers.mjs';

const htmlTheme = (body) => /<html[^>]*data-theme="(\w+)"/.exec(body)?.[1] ?? null;
const offersSwitch = (body) => /<form[^>]*action="\/theme"/.test(body) || body.includes('Switch to the dark look');

console.log('One look');
let r = await site('/');
check('the Welcome page has no moon, and no chosen look', r.status === 200 && htmlTheme(r.body) === null && !offersSwitch(r.body), String(r.status));
r = await site('/explore');
check('…nor does Browse local', r.status === 200 && htmlTheme(r.body) === null && !offersSwitch(r.body), String(r.status));
r = await site('/', { cookie: 'lc_theme=dark' });
check('a dark choice made before no longer turns pages dark', htmlTheme(r.body) === null && !offersSwitch(r.body));

r = await site('/theme', { method: 'POST', form: { to: 'dark', back: '/explore' } });
check('the old /theme address still only goes back to this site', r.status === 302 && r.location === '/explore', `${r.status} ${r.location}`);
for (const back of ['//evil.example/', 'https://evil.example/', '/\\evil.example', 'javascript:alert(1)']) {
  r = await site('/theme', { method: 'POST', form: { to: 'dark', back } });
  check(`…never to another site (${back})`, r.status === 302 && r.location === '/', r.location);
}

console.log('\nSigned in, and the team');
const person = `e2e-theme-p-${run}@example.test`;
const team = `e2e-theme-t-${run}@example.test`;
await account(person);
const teamId = await account(team);
await sql`insert into platform_role (user_id, role) values (${teamId}, 'admin')`;
r = await site('/account', { cookie: `${cookieFor(await passwordSession(person))}; lc_theme=dark` });
check('account pages are light, with no switch', r.status === 200 && htmlTheme(r.body) === null && !offersSwitch(r.body), String(r.status));
r = await site('/admin', { cookie: `${cookieFor(await twoStepSession(team))}; lc_theme=dark` });
check('…and so are the team’s pages', r.status === 200 && htmlTheme(r.body) === null && !offersSwitch(r.body), String(r.status));

await finish('one light look');
