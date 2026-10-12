// Cloudflare's "are you human" check on signing in with an emailed code (ADR-028, PO-15).
// The site is pointed at the pretend checker in scripts/e2e/mail-server.mjs, which passes an
// answer "pass:<form>:<site>:<anything>" once. Checks that no code is sent and no guess is
// counted without a fresh pass made for this form on this site, and that a checker that
// can't be reached refuses rather than lets through.
// Settings and safety checks: tests/e2e/helpers.mjs.
//
// Usage: npm run test:e2e
import { createHash, randomInt } from 'node:crypto';
import { check, finish, humanChecks, humanPass, latestCode, mailFor, run, site, sql } from './helpers.mjs';

const hashOf = (email) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
let visitors = randomInt(0, 200) * 250;
const ip = () => {
  visitors++;
  return `198.19.${Math.floor(visitors / 250) % 256}.${(visitors % 250) + 1}`;
};
const ASK = 'Please wait for the “are you human” check to finish';
const DOWN = 'We couldn’t run the “are you human” check just now';
const send = (email, answer, from = ip()) =>
  site('/join', { method: 'POST', form: { intent: 'send', email, next: '/account', 'cf-turnstile-response': answer }, ip: from });
const verify = (email, code, answer, from = ip()) =>
  site('/join', { method: 'POST', form: { intent: 'verify', email, code, next: '/account', 'cf-turnstile-response': answer }, ip: from });
const events = async (email, kind) =>
  (await sql`select count(*)::int as n from sign_in_code_event where email_hash = ${hashOf(email)} and kind = ${kind}`)[0].n;

await sql`delete from sign_in_code_event`;

console.log('The check is on');
let r = await site('/join');
check('the sign-in page carries the public site key', r.body.includes('e2e-turnstile-site-key'));
check('and never the secret key', !r.body.includes('e2e-turnstile-secret'));

console.log('\nNo code is sent without a fresh pass for this form on this site');
const pat = `human-${run}@example.test`;
const refusals = [
  ['no answer at all', null, 400, ASK],
  ['an empty answer', '', 400, ASK],
  ['a failed check', 'fail', 400, ASK],
  ['a pass made for another form', humanPass('suggest'), 400, ASK],
  ['a pass made on another site', humanPass('join', 'evil.example'), 400, ASK],
  ['an answer far too long', `pass:join:localhost:${'x'.repeat(3000)}`, 400, ASK],
  ['the checker failing', 'down', 503, DOWN],
];
for (const [what, answer, status, words] of refusals) {
  r = await send(pat, answer);
  check(`refused: ${what} (${status})`, r.status === status && r.body.includes(words), `got ${r.status}`);
}
check('no code was emailed', (await mailFor(pat)).length === 0);
check('and none was counted against the address or the day', (await events(pat, 'sent')) === 0);

const once = humanPass();
const from = ip();
const before = Date.now();
r = await send(pat, once, from);
check('a fresh pass sends the code', r.status === 200 && r.body.includes('We’ve emailed a 6-digit code'), `got ${r.status}`);
const code = await latestCode(pat, before - 1);
check('the code arrives', Boolean(code));
const sent = (await humanChecks()).filter((c) => c.response === once);
check('the visitor’s address is passed to the checker', sent.length === 1 && sent[0].remoteip === from);
r = await send(pat, once);
check('the same pass can’t be used twice', r.status === 400 && r.body.includes(ASK), `got ${r.status}`);
check('so only one code was sent', (await events(pat, 'sent')) === 1);

console.log('\nNo guess is counted without a pass (nobody can lock someone out by guessing)');
for (let i = 0; i < 7; i++) {
  r = await verify(pat, '000000', i % 2 ? 'fail' : null);
  if (r.status !== 400 || !r.body.includes(ASK)) break;
}
check('wrong codes without a pass are refused before being tried', r.status === 400 && r.body.includes(ASK), `got ${r.status}`);
check('and none counted as a guess', (await events(pat, 'wrong_code')) === 0);
r = await verify(pat, code, 'down');
check('a checker that can’t be reached refuses the right code too (never lets through)', r.status === 503 && r.body.includes(DOWN));
r = await verify(pat, code, humanPass());
check('with a pass, the right code still signs in', r.status === 302 && r.location.startsWith('/join'), `got ${r.status} ${r.location}`);

await finish('are-you-human');
