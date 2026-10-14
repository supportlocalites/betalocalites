import type { ServerEnv } from './env';

/** Where team notices go (D-11), and who Localites' emails come from (ADR-013, PO-12). */
export const TEAM_ADDRESS = 'supportlocalites@gmail.com';
export const FROM_ADDRESS = 'Localites <notices@localites.ca>';

const RESEND_URL = 'https://api.resend.com/emails';

/** All sending needs: the site passes its whole settings, the site watch (workers/watch.ts) just these. */
export type EmailEnv = Pick<ServerEnv, 'RESEND_API_KEY' | 'EMAIL_API_URL'>;

/** Local tests only: a pretend email service on this computer. Any other address is ignored. */
export function emailApiUrl(env: EmailEnv): string {
  const local = env.EMAIL_API_URL;
  if (!local) return RESEND_URL;
  try {
    const host = new URL(local).hostname;
    return host === '127.0.0.1' || host === 'localhost' ? local : RESEND_URL;
  } catch {
    return RESEND_URL;
  }
}

type Email = { to: string; subject: string; text: string; replyTo?: string };

/** How long one request to the email service may take before it counts as unreachable. */
const REQUEST_SECONDS = 5;

const asResend = (email: Email) => ({
  from: FROM_ADDRESS,
  to: [email.to],
  subject: email.subject,
  text: email.text,
  ...(email.replyTo ? { reply_to: email.replyTo } : {}),
});

function post(env: EmailEnv, url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_SECONDS * 1000),
  });
}

export type EmailResult = { sent: true } | { sent: false; reason: string };

/**
 * One request to the email service, told to slow down at most once (it allows a few sends a
 * second): wait as asked (at most 2 s) and try once more. Never throws.
 */
async function deliver(env: EmailEnv, url: string, body: unknown): Promise<EmailResult> {
  if (!env.RESEND_API_KEY) return { sent: false, reason: 'Email isn’t set up yet (PO-12).' };
  try {
    let response = await post(env, url, body);
    if (response.status === 429) {
      await response.body?.cancel();
      const wait = Math.min(2000, Math.max(500, Number(response.headers.get('retry-after') ?? 1) * 1000 || 1000));
      await new Promise((r) => setTimeout(r, wait));
      response = await post(env, url, body);
    }
    if (response.ok) {
      await response.body?.cancel();
      return { sent: true };
    }
    const answer = (await response.json().catch(() => null)) as { name?: string; message?: string } | null;
    // Resend's own explanation (e.g. "The localites.ca domain is not verified"), on one
    // line, shortened, and with anything that looks like a key removed.
    const why =
      typeof answer?.message === 'string'
        ? answer.message
            .replace(/\s+/g, ' ')
            .replace(/re_[A-Za-z0-9_]+/g, '[key]')
            .slice(0, 200)
            .trim()
        : '';
    return {
      sent: false,
      reason: `The email service answered ${response.status}${answer?.name ? ` (${answer.name})` : ''}${why ? `: ${why.replace(/\.$/, '')}` : ''}.`,
    };
  } catch {
    return { sent: false, reason: 'The email service couldn’t be reached.' };
  }
}

/**
 * Sends a plain-text email through Resend (free plan: 100 a day). Never throws: the
 * caller records what happened, so a failed email never loses the thing it was about.
 * The reason is short and never includes the key or the email's content.
 */
export function sendEmail(env: EmailEnv, email: Email): Promise<EmailResult> {
  return deliver(env, emailApiUrl(env), asResend(email));
}

/**
 * Several emails in one request (Resend's batch sending, up to 100): all sent, or none. For
 * a business's whole team at once, so the sending fits in the time Cloudflare allows.
 */
export function sendEmails(env: EmailEnv, emails: Email[]): Promise<EmailResult> {
  if (emails.length === 0) return Promise.resolve({ sent: true });
  if (emails.length > 100) return Promise.resolve({ sent: false, reason: 'More than 100 emails at once.' });
  return deliver(env, `${emailApiUrl(env)}/batch`, emails.map(asResend));
}
