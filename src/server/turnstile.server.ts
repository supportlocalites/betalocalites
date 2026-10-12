import type { ServerEnv } from './env';

/**
 * Cloudflare's free "are you human" check (Turnstile) on "Email me a code" and on checking
 * a code (ADR-028). Parked by D-38: on only if both keys are ever set in Cloudflare; until
 * then sign-in is the emailed code alone.
 */

export type HumanCheckState = 'off' | 'half' | 'on';

export function humanCheckState(env: ServerEnv): HumanCheckState {
  const site = Boolean(env.TURNSTILE_SITE_KEY?.trim());
  const secret = Boolean(env.TURNSTILE_SECRET_KEY?.trim());
  return site && secret ? 'on' : site || secret ? 'half' : 'off';
}

/** The public key the page needs to show the check, or null while the check is off. */
export function humanCheckSiteKey(env: ServerEnv): string | null {
  return humanCheckState(env) === 'on' ? env.TURNSTILE_SITE_KEY!.trim() : null;
}

/** The name of the form field the page sends the check's answer in. */
export const HUMAN_CHECK_FIELD = 'cf-turnstile-response';

const CLOUDFLARE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Local tests only: a pretend checker on this computer. Any other address is ignored. */
function verifyUrl(env: ServerEnv): string {
  const local = env.TURNSTILE_VERIFY_URL;
  if (!local) return CLOUDFLARE_VERIFY;
  try {
    const host = new URL(local).hostname;
    return host === '127.0.0.1' || host === 'localhost' ? local : CLOUDFLARE_VERIFY;
  } catch {
    return CLOUDFLARE_VERIFY;
  }
}

export type HumanCheckResult = 'passed' | 'failed' | 'unavailable';

type VerifyReply = { success?: unknown; action?: unknown; hostname?: unknown; 'error-codes'?: unknown };

/**
 * Asks Cloudflare whether the answer the page sent is a fresh, real pass for this form on
 * this site. Each answer works once. 'unavailable' means Cloudflare couldn't be asked: the
 * form is refused (never let through) with a "try again" message.
 */
export async function checkHuman(
  env: ServerEnv,
  request: Request,
  answer: FormDataEntryValue | null,
  action: string,
): Promise<HumanCheckResult> {
  if (humanCheckState(env) !== 'on') return 'passed';
  if (typeof answer !== 'string' || answer.length === 0 || answer.length > 2048) return 'failed';
  const body: Record<string, string> = { secret: env.TURNSTILE_SECRET_KEY!.trim(), response: answer };
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) body.remoteip = ip;
  let reply: VerifyReply;
  try {
    const res = await fetch(verifyUrl(env), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error('are-you-human check unavailable', res.status);
      return 'unavailable';
    }
    reply = (await res.json()) as VerifyReply;
  } catch (err) {
    console.error('are-you-human check unavailable', err instanceof Error ? err.name : 'error');
    return 'unavailable';
  }
  const codes = Array.isArray(reply['error-codes']) ? reply['error-codes'].map(String) : [];
  if (reply.success !== true) {
    // Our own key refused, or Cloudflare's trouble: the team must hear of it, the person can't fix it.
    if (codes.some((c) => c.includes('secret') || c === 'internal-error')) {
      console.error('are-you-human check refused our key or failed', codes.join(','));
      return 'unavailable';
    }
    return 'failed';
  }
  // A pass made for another form, or on another site using our key, doesn't count here.
  if (reply.action !== action || reply.hostname !== new URL(request.url).hostname) return 'failed';
  return 'passed';
}
