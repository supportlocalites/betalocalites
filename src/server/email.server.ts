import type { ServerEnv } from './env';

/** Where team notices go (D-11), and who Localites' emails come from (ADR-013, PO-12). */
export const TEAM_ADDRESS = 'supportlocalites@gmail.com';
export const FROM_ADDRESS = 'Localites <notices@localites.ca>';

export type EmailResult = { sent: true } | { sent: false; reason: string };

/**
 * Sends a plain-text email through Resend (free plan: 100 a day). Never throws: the
 * caller records what happened, so a failed email never loses the thing it was about.
 * The reason is short and never includes the key or the email's content.
 */
export async function sendEmail(
  env: ServerEnv,
  email: { to: string; subject: string; text: string; replyTo?: string },
): Promise<EmailResult> {
  if (!env.RESEND_API_KEY) return { sent: false, reason: 'Email isn’t set up yet (PO-12).' };
  try {
    const response = await fetch('https://api.resend.com/emails', {
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
    if (response.ok) return { sent: true };
    const body = (await response.json().catch(() => null)) as { name?: string; message?: string } | null;
    // Resend's own explanation (e.g. "The localites.ca domain is not verified"), on one
    // line, shortened, and with anything that looks like a key removed.
    const why = typeof body?.message === 'string' ? body.message.replace(/\s+/g, ' ').replace(/re_[A-Za-z0-9_]+/g, '[key]').slice(0, 200).trim() : '';
    return {
      sent: false,
      reason: `The email service answered ${response.status}${body?.name ? ` (${body.name})` : ''}${why ? `: ${why.replace(/\.$/, '')}` : ''}.`,
    };
  } catch {
    return { sent: false, reason: 'The email service couldn’t be reached.' };
  }
}
