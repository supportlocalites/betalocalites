// A pretend email service for the local tests, never used by the real site:
//   - SMTP on 127.0.0.1:2525 accepts every email the local sign-in server sends and keeps
//     it in memory (no TLS, no password: it only listens on this computer);
//   - HTTP on 127.0.0.1:8787 serves our sign-in email template (emails/sign-in-code.html)
//     to the sign-in server, and lets the tests read what was sent: GET /messages?to=<address>.
// Usage: node scripts/e2e/mail-server.mjs
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const SMTP_PORT = Number(process.env.E2E_SMTP_PORT ?? 2525);
const HTTP_PORT = Number(process.env.E2E_MAIL_HTTP_PORT ?? 8787);
const messages = []; // { to: string[], subject, body, at }

const decodeQuotedPrintable = (s) =>
  Buffer.from(
    s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))),
    'latin1',
  ).toString('utf8');

function keep(rcpt, lines) {
  const blank = lines.indexOf('');
  const head = lines.slice(0, blank);
  const header = (name) => head.find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`))?.slice(name.length + 1).trim() ?? '';
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
    } else if (url.pathname === '/health') {
      res.writeHead(200);
      res.end('ok');
    } else {
      res.writeHead(404);
      res.end();
    }
  })
  .listen(HTTP_PORT, '127.0.0.1', () => console.log(`test mail server: smtp ${SMTP_PORT}, http ${HTTP_PORT}`));
