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

function post(env: EmailEnv, email: { to: string; subject: string; text: string; replyTo?: string }): Promise<Response> {
  return fetch(emailApiUrl(env), {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [email.to],
      subject: email.subject,
      text: email.text,
      ...(email.replyTo ? { reply_to: email.replyTo } : {}),
    }),
  });
}

export type EmailResult = { sent: true } | { sent: false; reason: string };

/**
 * Sends a plain-text email through Resend (free plan: 100 a day). Never throws: the
 * caller records what happened, so a failed email never loses the thing it was about.
 * The reason is short and never includes the key or the email's content.
 */
export async function sendEmail(
  env: EmailEnv,
  email: { to: string; subject: string; text: string; replyTo?: string },
): Promise<EmailResult> {
  if (!env.RESEND_API_KEY) return { sent: false, reason: 'Email isn’t set up yet (PO-12).' };
  try {
    let response = await post(env, email);
    // Resend allows a few sends a second: told to slow down, wait as asked (at most 2 s) and try once more.
    if (response.status === 429) {
      await response.body?.cancel();
      const wait = Math.min(2000, Math.max(500, Number(response.headers.get('retry-after') ?? 1) * 1000 || 1000));
      await new Promise((r) => setTimeout(r, wait));
      response = await post(env, email);
    }
    if (response.ok) {
      await response.body?.cancel();
      return { sent: true };
    }
    const body = (await response.json().catch(() => null)) as { name?: string; message?: string } | null;
    // Resend's own explanation (e.g. "The localites.ca domain is not verified"), on one
    // line, shortened, and with anything that looks like a key removed.
    const why =
      typeof body?.message === 'string'
        ? body.message
            .replace(/\s+/g, ' ')
            .replace(/re_[A-Za-z0-9_]+/g, '[key]')
            .slice(0, 200)
            .trim()
        : '';
    return {
      sent: false,
      reason: `The email service answered ${response.status}${body?.name ? ` (${body.name})` : ''}${why ? `: ${why.replace(/\.$/, '')}` : ''}.`,
    };
  } catch {
    return { sent: false, reason: 'The email service couldn’t be reached.' };
  }
}
