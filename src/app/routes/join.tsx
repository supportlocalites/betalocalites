import { useEffect, useRef } from 'react';
import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { cloudflareContext } from '@/app/context';
import { HumanCheckField, useHumanCheck } from '@/components/HumanCheck';
import { NameFields, ProfileFields } from '@/components/ProfileFields';
import { SiteHeader } from '@/components/SiteHeader';
import { pageMeta } from '@/lib/meta';
import { addressHash, claimCodeGuess, claimCodeSend, guessWasRight } from '@/server/auth/code-limits.server';
import { AuthError, authConfigured, authSettings, sendSignInCode, verifySignInCode } from '@/server/auth/gotrue.server';
import { createPerson, findPerson } from '@/server/auth/member.server';
import { CODE_FAILED, explainCodeError, NEUTRAL_SEND_CODES } from '@/server/auth/messages.server';
import { loadSession, safeNext, sessionCookies, withCookies } from '@/server/auth/session.server';
import { CODE_MINUTES } from '@/lib/claim-terms';
import { codeInput, emailInput, NAMES_NEEDED, namesInput, profileInput } from '@/server/member-input';
import { isUniqueViolation } from '@/server/db.server';
import type { ServerEnv } from '@/server/env';
import { checkHuman, HUMAN_CHECK_FIELD, humanCheckSiteKey } from '@/server/turnstile.server';
import { addressKey } from '@/server/visitor.server';
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
  const humanCheck = humanCheckSiteKey(env);
  if (!authConfigured(env))
    return data({ step: 'email' as Step, next, configured: false, signUpOpen: false, email: '', humanCheck }, { headers: noStore });

  const { session, setCookies } = await loadSession(request, env);
  if (session) {
    const person = await findPerson(env, session.user.id);
    if (person && !person.closed) throw redirect(next, withCookies(undefined, setCookies));
    const step: Step = person?.closed ? 'closed' : 'name';
    return data(
      { step, next, configured: true, signUpOpen: true, email: session.user.email, humanCheck },
      withCookies({ headers: noStore }, setCookies),
    );
  }
  // If Supabase can't be asked, assume new accounts are open; sending a code still works either way.
  const signUpOpen = await authSettings(env).then(
    (s) => s.signUpOpen,
    () => true,
  );
  return data(
    { step: 'email' as Step, next, configured: true, signUpOpen, email: '', humanCheck },
    withCookies({ headers: noStore }, setCookies),
  );
}

export const headers: Route.HeadersFunction = ({ loaderHeaders }) => loaderHeaders;

type Reply = { step: Step; email: string; error: string | null; notice: string | null; errors: Record<string, string> };
const reply = (r: Partial<Reply> & { step: Step }, status = 200, cookies: string[] = []) =>
  data<Reply>({ email: '', error: null, notice: null, errors: {}, ...r }, withCookies({ status }, cookies));

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  const next = safeNext(form.get('next'), '/account');

  if (intent === 'name') {
    const { session, setCookies } = await loadSession(request, env);
    if (!session) throw redirect(`/join?next=${encodeURIComponent(next)}`, withCookies(undefined, setCookies));
    const email = session.user.email;
    const fields = Object.fromEntries(form);
    const names = namesInput.safeParse(fields);
    const profile = profileInput.safeParse(fields);
    if (!names.success || !profile.success) {
      const errors: Record<string, string> = {};
      for (const issue of [...(names.error?.issues ?? []), ...(profile.error?.issues ?? [])])
        errors[String(issue.path[0])] ??= issue.message;
      const nameMissing = !String(fields.firstName ?? '').trim() || !String(fields.lastName ?? '').trim();
      const error = nameMissing ? NAMES_NEEDED : 'Please check what’s marked below.';
      return reply({ step: 'name', email, error, errors }, 400, setCookies);
    }
    try {
      await createPerson(env, session.user, names.data, profile.data);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const error = 'This email address is linked to an older account. Please contact supportlocalites@gmail.com.';
      return reply({ step: 'name', email, error }, 409, setCookies);
    }
    return redirect(next, withCookies(undefined, setCookies));
  }

  if (intent !== 'send' && intent !== 'verify') throw data(null, { status: 400 });
  const email = emailInput.safeParse(form.get('email') ?? '');
  if (!email.success) return reply({ step: 'email', error: 'Please check the email address.' }, 400);

  // A few tries a minute from one internet address (kept by Cloudflare, never stored).
  if (env.SIGN_IN_LIMIT && !(await env.SIGN_IN_LIMIT.limit({ key: addressKey(request) })).success) {
    return reply(
      { step: intent === 'send' ? 'email' : 'code', email: email.data, error: 'Too many tries. Please wait a minute, then try again.' },
      429,
    );
  }
  // Cloudflare's "are you human" check (PO-15), before any code is sent or guessed: stops
  // scripts using up the day's codes or someone's guesses (ADR-028).
  const human = await checkHuman(env, request, form.get(HUMAN_CHECK_FIELD), 'join');
  if (human !== 'passed') {
    const error =
      human === 'failed'
        ? 'Please wait for the “are you human” check to finish (tick it if it asks), then try again.'
        : 'We couldn’t run the “are you human” check just now. Please try again in a minute.';
    return reply({ step: intent === 'send' ? 'email' : 'code', email: email.data, error }, human === 'failed' ? 400 : 503);
  }
  const hash = await addressHash(email.data);
  return intent === 'send' ? sendCode(env, email.data, hash) : checkCode(env, email.data, hash, form.get('code'), next);
}

/**
 * Every outcome here that depends on the address itself gets the same reply as success,
 * so nobody can learn whether an address has an account (ADR-028).
 */
async function sendCode(env: ServerEnv, email: string, hash: string) {
  const { check, recentlyAsked } = await claimCodeSend(env, hash);
  if (check === 'daily_limit') {
    return reply({ step: 'email', email, error: 'We’ve sent a lot of sign-in codes today. Please try again tomorrow.' }, 429);
  }
  if (check === 'address_limit') {
    const notice =
      'We’ve already sent 3 codes to this address in the last hour. Use the newest one. If none of them work, please try again in an hour.';
    return reply({ step: 'code', email, notice }, 429);
  }
  try {
    await sendSignInCode(env, email);
  } catch (err) {
    if (!(err instanceof AuthError) || err.status >= 500 || err.code === 'unknown') {
      console.error('sign-in code not sent', err instanceof AuthError ? err.code : err);
      return reply({ step: 'email', email, error: explainCodeError(err) }, 503);
    }
    // While new accounts are closed, Supabase answers differently for addresses with and
    // without an account, so every refusal gets the neutral reply.
    const signUpOpen = await authSettings(env).then(
      (s) => s.signUpOpen,
      () => false,
    );
    const neutral = NEUTRAL_SEND_CODES.has(err.code) || !signUpOpen;
    // With accounts open, every address takes the same path, so this can be said plainly:
    // Supabase's "too many emails" means the whole site, unless this address asked a moment ago.
    if (neutral && signUpOpen && err.code === 'over_email_send_rate_limit' && !recentlyAsked) {
      return reply({ step: 'email', email, error: 'We’re sending a lot of codes right now. Please try again in a few minutes.' }, 429);
    }
    if (!neutral) return reply({ step: 'email', email, error: explainCodeError(err) }, 400);
  }
  return reply({ step: 'code', email });
}

async function checkCode(env: ServerEnv, email: string, hash: string, raw: FormDataEntryValue | null, next: string) {
  const code = codeInput.safeParse(raw ?? '');
  if (!code.success) return reply({ step: 'code', email, error: 'Enter the 6-digit code from the email.' }, 400);
  // Our limit on guesses (Supabase has none per code), counted before Supabase is asked.
  // Same words as a wrong code.
  const guess = await claimCodeGuess(env, hash);
  if (guess === null) return reply({ step: 'code', email, error: CODE_FAILED }, 400);
  try {
    const session = await verifySignInCode(env, email, code.data);
    await guessWasRight(env, guess);
    const cookies = sessionCookies(session);
    const person = await findPerson(env, session.user.id);
    // New here: one more step for their name. Already joined: straight back to where they were.
    if (!person) return redirect(`/join?next=${encodeURIComponent(next)}`, withCookies(undefined, cookies));
    return redirect(next, withCookies(undefined, cookies));
  } catch (err) {
    if (err instanceof AuthError && err.code === 'otp_expired') return reply({ step: 'code', email, error: CODE_FAILED }, 400);
    const expected = err instanceof AuthError && err.status < 500 && err.code !== 'unknown';
    if (!expected) console.error('sign-in code not checked', err instanceof AuthError ? err.code : err);
    return reply({ step: 'code', email, error: explainCodeError(err) }, expected ? 400 : 503);
  }
}

export default function Join({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== 'idle';
  const step = actionData?.step ?? loaderData.step;
  const email = actionData?.email || loaderData.email;
  const { next, configured, signUpOpen, humanCheck } = loaderData;
  // One check per screen; a fresh one after every reply (an answer works once).
  const { answer, widget } = useHumanCheck(step === 'email' || step === 'code' ? humanCheck : null, 'join', actionData);
  const checkOn = Boolean(humanCheck);
  const waiting = checkOn && !answer;
  const error = actionData?.error;
  const fieldErrors = actionData?.errors ?? {};
  const restart = `/join?next=${encodeURIComponent(next)}`;
  // A refused entry: point screen readers at the message and put the cursor back in the box.
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!error) return;
    const firstWrong = document.querySelector<HTMLElement>('main [aria-invalid="true"]');
    (firstWrong ?? field.current)?.focus();
  }, [error, actionData]);
  const invalid = error ? { 'aria-invalid': true, 'aria-errormessage': 'join-error' } : {};

  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">{step === 'name' ? 'Welcome to Localites' : 'Sign in or create an account'}</h1>
        <div className="title-rule" aria-hidden="true" />
        {error && (
          <p className="notice" role="alert" id="join-error">
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
            <p className="muted">You’re signed in as {email}. Tell us a little about yourself:</p>
            <NameFields first={null} last={null} errors={fieldErrors} firstRef={field} />
            <ProfileFields values={null} errors={fieldErrors} />
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
              It can take a minute to arrive, and works for {CODE_MINUTES} minutes. If you asked more than once, use the newest one.
            </p>
            <p className="notice">
              <strong>Not in your inbox?</strong> Check your <strong>spam or junk</strong> folder (and the “Other” or “Promotions” tab).
              Emails from new senders often land there. Marking it “Not spam” helps next time.
            </p>
            <Form method="post" noValidate>
              <input type="hidden" name="intent" value="verify" />
              <input type="hidden" name="next" value={next} />
              <input type="hidden" name="email" value={email} />
              <HumanCheckField answer={answer} on={checkOn} />
              <div className="field">
                <label htmlFor="code" className="field-label">
                  Code from the email
                </label>
                <input
                  ref={field}
                  id="code"
                  name="code"
                  className="input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9 ]*"
                  maxLength={8}
                  required
                  aria-describedby={error ? 'join-error' : undefined}
                  {...invalid}
                />
              </div>
              {widget}
              <button type="submit" className="button button-primary" disabled={busy || waiting}>
                {busy ? 'Checking…' : 'Continue'}
              </button>
            </Form>
            <p className="muted section-gap">Still nothing after a few minutes, even in spam?</p>
            <Form method="post">
              <input type="hidden" name="intent" value="send" />
              <input type="hidden" name="next" value={next} />
              <input type="hidden" name="email" value={email} />
              <HumanCheckField answer={answer} on={checkOn} />
              <button type="submit" className="button button-secondary" disabled={busy || waiting}>
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
              Browsing needs no account. You need one to claim your business{signUpOpen ? '' : ' (new accounts open soon)'}. We’ll email you
              a code; there’s no password to remember.
            </p>
            <Form method="post" noValidate>
              <input type="hidden" name="intent" value="send" />
              <input type="hidden" name="next" value={next} />
              <HumanCheckField answer={answer} on={checkOn} />
              <div className="field">
                <label htmlFor="email" className="field-label">
                  Email address
                </label>
                <input
                  ref={field}
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="input"
                  maxLength={254}
                  defaultValue={email}
                  aria-describedby={error ? 'join-error' : undefined}
                  {...invalid}
                />
              </div>
              {widget}
              <button type="submit" className="button button-primary" disabled={busy || waiting}>
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
