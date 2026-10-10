import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { cloudflareContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { pageMeta } from '@/lib/meta';
import { addressHash, canTryCode, checkCodeSend, recordCodeEvent, sentWithinMinute } from '@/server/auth/code-limits.server';
import { AuthError, authConfigured, authSettings, sendSignInCode, verifySignInCode } from '@/server/auth/gotrue.server';
import { createPerson, findPerson } from '@/server/auth/member.server';
import { CODE_FAILED, explainCodeError, NEUTRAL_SEND_CODES } from '@/server/auth/messages.server';
import { loadSession, safeNext, sessionCookies, withCookies } from '@/server/auth/session.server';
import { CODE_MINUTES, codeInput, emailInput, nameInput } from '@/server/member-input';
import { isUniqueViolation } from '@/server/db.server';
import type { ServerEnv } from '@/server/env';
import type { Route } from './+types/join';

/**
 * Screens A1–A2: "Sign in or create an account" (D-27, D-32, ADR-028). One screen for both:
 * an emailed 6-digit code, then (new accounts only) a name. Replies never say whether an
 * address already has an account. The team signs in at /sign-in (password and app).
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Sign in or create an account'), { name: 'robots', content: 'noindex' }];

const noStore = { 'Cache-Control': 'no-store' };

type Step = 'email' | 'code' | 'name' | 'closed';

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const next = safeNext(new URL(request.url).searchParams.get('next'), '/account');
  if (!authConfigured(env)) return data({ step: 'email' as Step, next, configured: false, signUpOpen: false, email: '' }, { headers: noStore });

  const { session, setCookies } = await loadSession(request, env);
  if (session) {
    const person = await findPerson(env, session.user.id);
    if (person && !person.closed) throw redirect(next, withCookies(undefined, setCookies));
    const step: Step = person?.closed ? 'closed' : 'name';
    return data({ step, next, configured: true, signUpOpen: true, email: session.user.email }, withCookies({ headers: noStore }, setCookies));
  }
  // If Supabase can't be asked, assume new accounts are open; sending a code still works either way.
  const signUpOpen = await authSettings(env).then(
    (s) => s.signUpOpen,
    () => true,
  );
  return data({ step: 'email' as Step, next, configured: true, signUpOpen, email: '' }, withCookies({ headers: noStore }, setCookies));
}

export const headers: Route.HeadersFunction = ({ loaderHeaders }) => loaderHeaders;

type Reply = { step: Step; email: string; error: string | null; notice: string | null };
const reply = (r: Partial<Reply> & { step: Step }, status = 200) =>
  data<Reply>({ email: '', error: null, notice: null, ...r }, { status });

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  const next = safeNext(form.get('next'), '/account');

  if (intent === 'name') {
    const { session, setCookies } = await loadSession(request, env);
    if (!session) throw redirect(`/join?next=${encodeURIComponent(next)}`, withCookies(undefined, setCookies));
    const name = nameInput.safeParse(form.get('name') ?? '');
    if (!name.success) return reply({ step: 'name', email: session.user.email, error: name.error.issues[0]?.message ?? 'Enter your name.' }, 400);
    try {
      await createPerson(env, session.user, name.data);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      return reply({ step: 'name', email: session.user.email, error: 'This email address is linked to an older account. Please contact supportlocalites@gmail.com.' }, 409);
    }
    return redirect(next, withCookies(undefined, setCookies));
  }

  if (intent !== 'send' && intent !== 'verify') throw data(null, { status: 400 });
  const email = emailInput.safeParse(form.get('email') ?? '');
  if (!email.success) return reply({ step: 'email', error: 'Please check the email address.' }, 400);

  // A few tries a minute from one internet address (kept by Cloudflare, never stored).
  const address = request.headers.get('CF-Connecting-IP') ?? 'local';
  if (env.SIGN_IN_LIMIT && !(await env.SIGN_IN_LIMIT.limit({ key: address })).success) {
    return reply({ step: intent === 'send' ? 'email' : 'code', email: email.data, error: 'Too many tries. Please wait a minute, then try again.' }, 429);
  }
  const hash = await addressHash(email.data);
  return intent === 'send' ? sendCode(env, email.data, hash) : checkCode(env, email.data, hash, form.get('code'), next);
}

async function sendCode(env: ServerEnv, email: string, hash: string) {
  const limit = await checkCodeSend(env, hash);
  if (limit === 'daily_limit') {
    return reply({ step: 'email', email, error: 'We’ve sent a lot of sign-in codes today. Please try again tomorrow.' }, 429);
  }
  if (limit === 'address_limit') {
    return reply({ step: 'code', email, notice: 'We’ve already sent a few codes to this address in the last hour. Use the newest one, or try again later.' }, 429);
  }
  try {
    await sendSignInCode(env, email);
    await recordCodeEvent(env, hash, 'sent');
  } catch (err) {
    const neutral = err instanceof AuthError && NEUTRAL_SEND_CODES.has(err.code);
    // Supabase gives one answer for "a code went to this address under a minute ago" and
    // "the whole site has sent too many emails"; only the second needs saying.
    if (neutral && err.code === 'over_email_send_rate_limit' && !(await sentWithinMinute(env, hash))) {
      return reply({ step: 'email', email, error: 'We’re sending a lot of codes right now. Please try again in a few minutes.' }, 429);
    }
    if (!neutral) {
      const expected = err instanceof AuthError && err.status < 500 && err.code !== 'unknown';
      if (!expected) console.error('sign-in code not sent', err instanceof AuthError ? err.code : err);
      return reply({ step: 'email', email, error: explainCodeError(err) }, expected ? 400 : 503);
    }
    // Otherwise the same reply as success: it says nothing about the address.
  }
  return reply({ step: 'code', email });
}

async function checkCode(env: ServerEnv, email: string, hash: string, raw: FormDataEntryValue | null, next: string) {
  const code = codeInput.safeParse(raw ?? '');
  if (!code.success) return reply({ step: 'code', email, error: 'Enter the 6-digit code from the email.' }, 400);
  // Our limit on wrong guesses (Supabase has none per code). Same words as a wrong code.
  if (!(await canTryCode(env, hash))) return reply({ step: 'code', email, error: CODE_FAILED }, 400);
  try {
    const session = await verifySignInCode(env, email, code.data);
    const cookies = sessionCookies(session);
    const person = await findPerson(env, session.user.id);
    // New here: one more step for their name. Already joined: straight back to where they were.
    if (!person) return redirect(`/join?next=${encodeURIComponent(next)}`, withCookies(undefined, cookies));
    return redirect(next, withCookies(undefined, cookies));
  } catch (err) {
    if (err instanceof AuthError && err.code === 'otp_expired') {
      await recordCodeEvent(env, hash, 'wrong_code');
      return reply({ step: 'code', email, error: CODE_FAILED }, 400);
    }
    const expected = err instanceof AuthError && err.status < 500 && err.code !== 'unknown';
    if (!expected) console.error('sign-in code not checked', err instanceof AuthError ? err.code : err);
    return reply({ step: 'code', email, error: explainCodeError(err) }, expected ? 400 : 503);
  }
}

export default function Join({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== 'idle';
  const step = actionData?.step ?? loaderData.step;
  const email = actionData?.email || loaderData.email;
  const { next, configured, signUpOpen } = loaderData;
  const error = actionData?.error;
  const restart = `/join?next=${encodeURIComponent(next)}`;

  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">{step === 'name' ? 'Welcome to Localites' : 'Sign in or create an account'}</h1>
        <div className="title-rule" aria-hidden="true" />
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        {actionData?.notice && (
          <p className="notice" role="status">
            {actionData.notice}
          </p>
        )}

        {!configured ? (
          <p className="notice">Sign-in isn’t switched on for this site yet.</p>
        ) : step === 'closed' ? (
          <>
            <p>This account has been closed. If that’s a mistake, email supportlocalites@gmail.com.</p>
            <Form method="post" action="/sign-out">
              <button type="submit" className="button button-secondary">
                Sign out
              </button>
            </Form>
          </>
        ) : step === 'name' ? (
          <Form method="post" noValidate>
            <input type="hidden" name="intent" value="name" />
            <input type="hidden" name="next" value={next} />
            <p className="muted">You’re signed in as {email}. One last thing:</p>
            <div className="field">
              <label htmlFor="name" className="field-label">
                Your name
              </label>
              <p className="field-hint" id="name-hint">
                Shown to our team, and to a business when you contact it.
              </p>
              <input id="name" name="name" className="input" autoComplete="name" maxLength={80} required aria-describedby="name-hint" />
            </div>
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Continue'}
            </button>
          </Form>
        ) : step === 'code' ? (
          <>
            <p role="status">
              {signUpOpen ? (
                <>We’ve emailed a 6-digit code to {email}.</>
              ) : (
                <>If {email} has an account, we’ve emailed it a 6-digit code.</>
              )}{' '}
              It can take a minute to arrive, and works for {CODE_MINUTES} minutes.
            </p>
            <Form method="post" noValidate>
              <input type="hidden" name="intent" value="verify" />
              <input type="hidden" name="next" value={next} />
              <input type="hidden" name="email" value={email} />
              <div className="field">
                <label htmlFor="code" className="field-label">
                  Code from the email
                </label>
                <input
                  id="code"
                  name="code"
                  className="input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9 ]*"
                  maxLength={8}
                  required
                />
              </div>
              <button type="submit" className="button button-primary" disabled={busy}>
                {busy ? 'Checking…' : 'Continue'}
              </button>
            </Form>
            <p className="muted section-gap">Didn’t get it? Check your junk folder, then:</p>
            <Form method="post">
              <input type="hidden" name="intent" value="send" />
              <input type="hidden" name="next" value={next} />
              <input type="hidden" name="email" value={email} />
              <button type="submit" className="button button-secondary" disabled={busy}>
                Send a new code
              </button>
            </Form>
            <p className="section-gap">
              <Link to={restart} className="text-link">
                Use a different email address
              </Link>
            </p>
          </>
        ) : (
          <>
            <p className="muted">
              Browsing needs no account. You need one to claim your business{signUpOpen ? '' : ' (new accounts open soon)'}.
              We’ll email you a code; there’s no password to remember.
            </p>
            <Form method="post" noValidate>
              <input type="hidden" name="intent" value="send" />
              <input type="hidden" name="next" value={next} />
              <div className="field">
                <label htmlFor="email" className="field-label">
                  Email address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="input"
                  maxLength={254}
                  defaultValue={email}
                />
              </div>
              <button type="submit" className="button button-primary" disabled={busy}>
                {busy ? 'Sending…' : 'Email me a code'}
              </button>
            </Form>
            <p className="muted section-gap">
              Localites team? <Link to={`/sign-in?next=${encodeURIComponent(next === '/account' ? '/admin' : next)}`}>Team sign-in</Link>
            </p>
          </>
        )}
      </main>
    </>
  );
}
