// A pretend email service for the local tests, never used by the real site:
//   - SMTP on 127.0.0.1:2525 accepts every email the local sign-in server sends and keeps
//     it in memory (no TLS, no password: it only listens on this computer);
//   - HTTP on 127.0.0.1:8787 serves our sign-in email template (emails/sign-in-code.html)
//     to the sign-in server, and lets the tests read what was sent: GET /messages?to=<address>;
//   - POST /emails (and /emails/batch, a list at once) stands in for Resend's sending
//     service (the site's own emails, when the site is pointed here with EMAIL_API_URL): it
//     keeps the email like the ones above.
//     Only the test key is accepted. POST /emails/fail?on=1 makes it refuse every email
//     (as Resend would when down) until ?on=0;
//   - POST /turnstile/siteverify stands in for Cloudflare's "are you human" checker. An
//     answer "pass:<form>:<site>:<anything>" passes for that form on that site, once; "fail"
//     fails; "down" makes the checker answer with an error. Only the test secret is accepted;
//   - /storage/v1/… stands in for Supabase Storage (business photos): PUT and DELETE under
//     /storage/v1/s3/<bucket>/<path> (only with the test key, signed the S3 way), GET under
//     /storage/v1/object/public/<bucket>/<path>. GET /storage/files lists what is stored;
//     POST /storage/fail?on=1 makes storage refuse every change until ?on=0;
//   - POST /moderation stands in for Cloudflare's AI checker (the language check, D-50, when
//     the site is pointed here with MODERATION_URL): words containing "pretend-hate" are unsafe
//     (hate, S10), "pretend-phone" trips only privacy (S7), "pretend-outage" makes it fail;
//     anything else is safe. GET /moderation/asked lists what it was asked.
// Usage: node scripts/e2e/mail-server.mjs
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const SMTP_PORT = Number(process.env.E2E_SMTP_PORT ?? 2525);
const HTTP_PORT = Number(process.env.E2E_MAIL_HTTP_PORT ?? 8787);
const messages = []; // { to: string[], subject, body, at }
const TURNSTILE_SECRET = process.env.E2E_TURNSTILE_SECRET ?? 'e2e-turnstile-secret-local-only';
const EMAIL_KEY = process.env.E2E_EMAIL_KEY ?? 'e2e-email-key-local-only';
const spent = new Set();
const asked = []; // what the pretend AI checker was asked (lower case)
const PHOTO_KEY = process.env.E2E_PHOTO_KEY ?? 'e2e-photo-key';
const files = new Map(); // "<bucket>/<path>" -> { type, body: Buffer }
let storageFails = false;
let emailFails = false;
const checks = []; // what the site sent the checker: { response, remoteip }

function siteverify(body) {
  if (body.secret !== TURNSTILE_SECRET) return [200, { success: false, 'error-codes': ['invalid-input-secret'] }];
  const answer = String(body.response ?? '');
  checks.push({ response: answer, remoteip: body.remoteip ?? null });
  if (answer === 'down') return [500, {}];
  const [word, action, hostname] = answer.split(':');
  if (word !== 'pass') return [200, { success: false, 'error-codes': ['invalid-input-response'] }];
  if (spent.has(answer)) return [200, { success: false, 'error-codes': ['timeout-or-duplicate'] }];
  spent.add(answer);
  return [200, { success: true, action, hostname, challenge_ts: new Date().toISOString(), 'error-codes': [] }];
}

const decodeQuotedPrintable = (s) =>
  Buffer.from(
    s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))),
    'latin1',
  ).toString('utf8');

function keep(rcpt, lines) {
  const blank = lines.indexOf('');
  const head = lines.slice(0, blank);
  const header = (name) =>
    head
      .find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`))
      ?.slice(name.length + 1)
      .trim() ?? '';
  let body = lines.slice(blank + 1).join('\r\n');
  if (/quoted-printable/i.test(header('Content-Transfer-Encoding'))) body = decodeQuotedPrintable(body);
  messages.push({ to: rcpt.map((r) => r.replace(/[<>]/g, '').toLowerCase()), subject: header('Subject'), body, at: Date.now() });
}

net
  .createServer((sock) => {
    let buf = '';
    let inData = false;
    let data = [];
    let rcpt = [];
    const send = (line) => sock.write(`${line}\r\n`);
    send('220 localhost test mail server');
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            keep(rcpt, data);
            data = [];
            rcpt = [];
            send('250 OK');
          } else data.push(line.startsWith('..') ? line.slice(1) : line);
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') {
          send('250-localhost');
          send('250 8BITMIME');
        } else if (cmd === 'HELO' || cmd === 'MAIL' || cmd === 'NOOP') send('250 OK');
        else if (cmd === 'RCPT') {
          rcpt.push(line.slice(8).trim());
          send('250 OK');
        } else if (cmd === 'DATA') {
          inData = true;
          send('354 End with <CRLF>.<CRLF>');
        } else if (cmd === 'RSET') {
          data = [];
          rcpt = [];
          send('250 OK');
        } else if (cmd === 'QUIT') {
          send('221 Bye');
          sock.end();
        } else send('502 Not implemented');
      }
    });
    sock.on('error', () => {});
  })
  .listen(SMTP_PORT, '127.0.0.1');

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${HTTP_PORT}`);
    if (url.pathname === '/sign-in-code.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(await readFile(path.join(root, 'emails', 'sign-in-code.html')));
    } else if (url.pathname === '/messages') {
      const to = (url.searchParams.get('to') ?? '').toLowerCase();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(messages.filter((m) => m.to.includes(to))));
    } else if (url.pathname === '/emails' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      let email = null;
      try {
        email = JSON.parse(raw);
      } catch {
        email = null; // answered below as a validation error, as Resend would
      }
      if (req.headers.authorization !== `Bearer ${EMAIL_KEY}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ name: 'invalid_api_key', message: 'API key is invalid' }));
      } else if (emailFails) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ name: 'application_error', message: 'Pretend outage' }));
      } else if (!Array.isArray(email?.to) || typeof email.subject !== 'string' || typeof email.text !== 'string') {
        res.writeHead(422, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ name: 'validation_error', message: 'Missing to, subject or text' }));
      } else {
        messages.push({
          to: email.to.map((t) => String(t).toLowerCase()),
          subject: email.subject,
          body: email.text,
          replyTo: email.reply_to ?? null,
          at: Date.now(),
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: `e2e-${messages.length}` }));
      }
    } else if (url.pathname === '/emails/batch' && req.method === 'POST') {
      // Resend's batch sending: a list of emails, all sent or none.
      let raw = '';
      for await (const chunk of req) raw += chunk;
      let emails = null;
      try {
        emails = JSON.parse(raw);
      } catch {
        emails = null;
      }
      const valid = (e) => Array.isArray(e?.to) && typeof e.subject === 'string' && typeof e.text === 'string';
      if (req.headers.authorization !== `Bearer ${EMAIL_KEY}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ name: 'invalid_api_key', message: 'API key is invalid' }));
      } else if (emailFails) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ name: 'application_error', message: 'Pretend outage' }));
      } else if (!Array.isArray(emails) || emails.length === 0 || emails.length > 100 || !emails.every(valid)) {
        res.writeHead(422, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ name: 'validation_error', message: 'Each email needs to, subject and text' }));
      } else {
        const ids = [];
        for (const email of emails) {
          messages.push({
            to: email.to.map((t) => String(t).toLowerCase()),
            subject: email.subject,
            body: email.text,
            replyTo: email.reply_to ?? null,
            at: Date.now(),
          });
          ids.push({ id: `e2e-${messages.length}` });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: ids }));
      }
    } else if (url.pathname === '/emails/fail' && req.method === 'POST') {
      emailFails = url.searchParams.get('on') === '1';
      res.writeHead(204);
      res.end();
    } else if (url.pathname === '/turnstile/siteverify' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch {
        body = Object.fromEntries(new URLSearchParams(raw));
      }
      const [status, reply] = siteverify(body);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply));
    } else if (url.pathname === '/moderation' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const text = String(JSON.parse(raw || '{}').messages?.at(-1)?.content ?? '').toLowerCase();
      asked.push(text);
      if (text.includes('pretend-outage')) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ errors: [{ message: 'daily allowance used up' }] }));
      } else {
        const categories = text.includes('pretend-hate') ? ['S10'] : text.includes('pretend-phone') ? ['S7'] : [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ response: { safe: categories.length === 0, categories } }));
      }
    } else if (url.pathname === '/moderation/asked') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(asked));
    } else if (url.pathname === '/turnstile/checks') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(checks));
    } else if (url.pathname.startsWith('/storage/v1/s3/') && req.method === 'GET') {
      // Reading a stored file with the storage keys (the private conversation files, migration 0028).
      const signed = String(req.headers.authorization ?? '').startsWith(`AWS4-HMAC-SHA256 Credential=${PHOTO_KEY}/`);
      const file = files.get(decodeURIComponent(url.pathname.slice('/storage/v1/s3/'.length)));
      if (!signed) {
        res.writeHead(403, { 'Content-Type': 'application/xml' });
        res.end('<Error><Code>AccessDenied</Code></Error>');
      } else if (!file) {
        res.writeHead(404);
        res.end();
      } else {
        res.writeHead(200, { 'Content-Type': file.type, 'Content-Length': file.body.length });
        res.end(file.body);
      }
    } else if (url.pathname.startsWith('/storage/v1/s3/') && (req.method === 'PUT' || req.method === 'DELETE')) {
      const key = decodeURIComponent(url.pathname.slice('/storage/v1/s3/'.length));
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const signed = String(req.headers.authorization ?? '').startsWith(`AWS4-HMAC-SHA256 Credential=${PHOTO_KEY}/`) && Boolean(req.headers['x-amz-date']);
      if (!signed) {
        res.writeHead(403, { 'Content-Type': 'application/xml' });
        res.end('<Error><Code>AccessDenied</Code></Error>');
      } else if (storageFails) {
        res.writeHead(503);
        res.end();
      } else if (req.method === 'PUT') {
        files.set(key, { type: String(req.headers['content-type'] ?? ''), body: Buffer.concat(chunks), cacheControl: req.headers['cache-control'] ?? null });
        res.writeHead(200, { ETag: `"${files.size}"` });
        res.end();
      } else {
        files.delete(key);
        res.writeHead(204);
        res.end();
      }
    } else if (url.pathname.startsWith('/storage/v1/object/public/') && req.method === 'GET') {
      const file = files.get(decodeURIComponent(url.pathname.slice('/storage/v1/object/public/'.length)));
      if (!file) {
        res.writeHead(404);
        res.end();
      } else {
        res.writeHead(200, { 'Content-Type': file.type, 'Content-Length': file.body.length });
        res.end(file.body);
      }
    } else if (url.pathname === '/storage/files') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([...files].map(([key, f]) => ({ key, type: f.type, size: f.body.length, cacheControl: f.cacheControl }))));
    } else if (url.pathname === '/storage/fail' && req.method === 'POST') {
      storageFails = url.searchParams.get('on') === '1';
      res.writeHead(204);
      res.end();
    } else if (url.pathname === '/health') {
      res.writeHead(200);
      res.end('ok');
    } else {
      res.writeHead(404);
      res.end();
    }
  })
  .listen(HTTP_PORT, '127.0.0.1', () => console.log(`test mail server: smtp ${SMTP_PORT}, http ${HTTP_PORT}`));
