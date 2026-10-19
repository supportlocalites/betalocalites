// The light and dark look (D-57): the moon on the Welcome page and in every header switches to
// the dark look, the sun back; the choice is kept in a cookie holding only "light" or "dark", and
// the form only ever goes back to a page on this site. With no choice, the page follows the
// device (checked in the browser by look.mjs, which runs every page in the dark look too).
//
// Usage: npm run test:e2e
import { account, check, cookieFor, finish, passwordSession, run, site, twoStepSession, sql } from './helpers.mjs';

const htmlTheme = (body) => /<html[^>]*data-theme="(\w+)"/.exec(body)?.[1] ?? null;
const offers = (body) => /<form[^>]*action="\/theme"[\s\S]*?name="to" value="(\w+)"/.exec(body)?.[1] ?? null;

console.log('The moon and the sun');
let r = await site('/');
check('the Welcome page follows the device until someone chooses, and offers the moon', r.status === 200 && htmlTheme(r.body) === null
  && offers(r.body) === 'dark' && r.body.includes('Switch to the dark look'), String(r.status));
r = await site('/explore');
check('…and so does the header on other pages', offers(r.body) === 'dark');

r = await site('/theme', { method: 'POST', form: { to: 'dark', back: '/explore?q=cakes' } });
const set = r.headers.get('set-cookie') ?? '';
check('the moon keeps “dark” in a cookie for a year and goes back to the same page', r.status === 302 && r.location === '/explore?q=cakes'
  && /^lc_theme=dark; Path=\/; Max-Age=31536000; SameSite=Lax/.test(set), `${r.status} ${r.location} ${set}`);
r = await site('/', { cookie: 'lc_theme=dark' });
check('…then pages are dark, and offer the sun', htmlTheme(r.body) === 'dark' && offers(r.body) === 'light' && r.body.includes('Switch to the light look'));
r = await site('/theme', { method: 'POST', form: { to: 'light', back: '/' }, cookie: 'lc_theme=dark' });
check('the sun goes back to light', r.status === 302 && (r.headers.get('set-cookie') ?? '').startsWith('lc_theme=light;'));
r = await site('/', { cookie: 'lc_theme=light' });
check('…and a light choice stays light whatever the device', htmlTheme(r.body) === 'light' && offers(r.body) === 'dark');

r = await site('/theme', { method: 'POST', form: { to: '<script>', back: '/' } });
check('anything else is taken as light', (r.headers.get('set-cookie') ?? '').startsWith('lc_theme=light;'));
for (const back of ['//evil.example/', 'https://evil.example/', '/\\evil.example', 'javascript:alert(1)']) {
  r = await site('/theme', { method: 'POST', form: { to: 'dark', back } });
  check(`never sent to another site (${back})`, r.status === 302 && r.location === '/', r.location);
}
r = await site('/', { cookie: 'lc_theme=purple' });
check('a cookie with another value is ignored', htmlTheme(r.body) === null);
r = await site('/theme');
check('opening the address itself just goes Home', r.status === 302 && r.location === '/', `${r.status} ${r.location}`);

console.log('\nSigned in, and the team');
const person = `e2e-theme-p-${run}@example.test`;
const team = `e2e-theme-t-${run}@example.test`;
await account(person);
const teamId = await account(team);
await sql`insert into platform_role (user_id, role) values (${teamId}, 'admin')`;
r = await site('/account', { cookie: `${cookieFor(await passwordSession(person))}; lc_theme=dark` });
check('account pages have the sun in the header, in the dark look', r.status === 200 && htmlTheme(r.body) === 'dark' && offers(r.body) === 'light', String(r.status));
r = await site('/admin', { cookie: `${cookieFor(await twoStepSession(team))}; lc_theme=dark` });
check('…and so do the team’s pages', r.status === 200 && htmlTheme(r.body) === 'dark' && offers(r.body) === 'light', String(r.status));

await finish('light and dark look');
