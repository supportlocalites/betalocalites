import { useEffect, useRef } from 'react';
import { data, Form, redirect, useNavigation } from 'react-router';
import { cloudflareContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { pageMeta } from '@/lib/meta';
import { isAdmin } from '@/server/auth/admin.server';
import { AuthError, enrollTotp, verifyTotp } from '@/server/auth/gotrue.server';
import { explainAuthError } from '@/server/auth/messages.server';
import { loadSession, pagePath, safeNext, sessionCookies, withCookies } from '@/server/auth/session.server';
import { audit } from '@/server/admin/audit.server';
import { withDb } from '@/server/db.server';
import type { Route } from './+types/two-step';

/**
 * The second step for team accounts (E §2): a 6-digit code from an authenticator app.
 * First visit: set the app up by scanning a code. After that: enter the current code.
 */
export const meta: Route.MetaFunction = () => pageMeta('Two-step sign-in');

const noStore = { 'Cache-Control': 'no-store' };

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get('next'));
  const { session, setCookies } = await loadSession(request, env);
  if (!session) throw redirect(`/sign-in?next=${encodeURIComponent(pagePath(request))}`, withCookies(undefined, setCookies));
  if (session.claims.aal === 'aal2') throw redirect(next, withCookies(undefined, setCookies));

  const verified = session.user.factors.find((f) => f.type === 'totp' && f.status === 'verified');
  if (verified) {
    return data(
      { mode: 'verify' as const, factorId: verified.id, next, qrCode: null, secret: null },
      withCookies({ headers: noStore }, setCookies),
    );
  }
  const enrolment = await enrollTotp(env, session.accessToken, session.user);
  return data(
    { mode: 'enroll' as const, factorId: enrolment.factorId, next, qrCode: enrolment.qrCode, secret: enrolment.secret },
    withCookies({ headers: noStore }, setCookies),
  );
}

export const headers: Route.HeadersFunction = ({ loaderHeaders }) => loaderHeaders;

// A wrong code must not start the set-up again with a new QR code.
export const shouldRevalidate = () => false;

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const next = safeNext(form.get('next'));
  const factorId = String(form.get('factorId') ?? '');
  const code = String(form.get('code') ?? '').replace(/\s+/g, '');
  // A renewed session's cookies go back with every answer: a renewed sign-in that isn't
  // saved would leave the browser holding a used key, and the next use would end the session.
  const { session, setCookies } = await loadSession(request, env);
  if (!session) throw redirect(`/sign-in?next=${encodeURIComponent(next)}`, withCookies(undefined, setCookies));
  if (!/^\d{6}$/.test(code)) {
    return data({ error: 'Enter the 6-digit code from your authenticator app.' }, withCookies({ status: 400 }, setCookies));
  }
  try {
    // Supabase checks that this factor belongs to the signed-in person.
    const upgraded = await verifyTotp(env, session.accessToken, factorId, code);
    if (await isAdmin(env, upgraded.user.id)) {
      await withDb(env, (db) =>
        audit(db, { actor: upgraded.user.id, action: 'session.two_step', subjectType: 'app_user', subjectId: upgraded.user.id }),
      );
    }
    return redirect(next, withCookies(undefined, sessionCookies(upgraded)));
  } catch (err) {
    const expected = err instanceof AuthError && err.status < 500;
    if (!expected) console.error('two-step failed', err instanceof AuthError ? err.code : err);
    return data({ error: explainAuthError(err) }, withCookies({ status: expected ? 400 : 503 }, setCookies));
  }
}

export default function TwoStep({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== 'idle';
  const { mode, qrCode, secret } = loaderData;
  // After a refused code, the cursor goes back to the box (marked, and pointing at the message).
  const codeBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (actionData?.error) codeBox.current?.focus();
  }, [actionData]);
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">{mode === 'enroll' ? 'Set up two-step sign-in' : 'Enter your code'}</h1>
        <div className="title-rule" aria-hidden="true" />
        {mode === 'enroll' ? (
          <>
            <p>
              Team accounts need a second step. On your phone, open an authenticator app (Google Authenticator or Microsoft Authenticator,
              both free), add an account, and scan this code.
            </p>
            {qrCode && <img src={qrCode} alt="Code to scan with your authenticator app" className="qr" />}
            {secret && (
              <p className="muted">
                Can’t scan it? Choose “enter a setup key” and type: <code className="setup-key">{secret}</code>
              </p>
            )}
            <p>Then enter the 6-digit code the app shows.</p>
          </>
        ) : (
          <p>Open your authenticator app and enter the 6-digit code for Localites.</p>
        )}
        <Form method="post" noValidate>
          <input type="hidden" name="next" value={loaderData.next} />
          <input type="hidden" name="factorId" value={loaderData.factorId} />
          <div className="field">
            <label htmlFor="code" className="field-label">
              6-digit code
            </label>
            <input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={7}
              required
              className="input"
              ref={codeBox}
              aria-invalid={actionData?.error ? true : undefined}
              aria-describedby={actionData?.error ? 'two-step-error' : undefined}
            />
          </div>
          {actionData?.error && (
            <p className="notice" role="alert" id="two-step-error">
              {actionData.error}
            </p>
          )}
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
        </Form>
        <p className="muted section-gap">Never share these codes. Localites will never ask you for one.</p>
      </main>
    </>
  );
}
