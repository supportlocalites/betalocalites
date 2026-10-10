import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { cloudflareContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { pageMeta } from '@/lib/meta';
import { rememberUser } from '@/server/auth/admin.server';
import { AuthError, authConfigured, signInWithPassword } from '@/server/auth/gotrue.server';
import { explainAuthError } from '@/server/auth/messages.server';
import { loadSession, safeNext, sessionCookies, withCookies } from '@/server/auth/session.server';
import type { Route } from './+types/sign-in';

export const meta: Route.MetaFunction = () => pageMeta('Team sign-in');

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get('next'));
  const configured = authConfigured(env);
  if (configured) {
    const { session, setCookies } = await loadSession(request, env);
    if (session) throw redirect(next, withCookies(undefined, setCookies));
  }
  return { next, configured, expired: url.searchParams.has('expired'), team: url.searchParams.has('team') };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const email = String(form.get('email') ?? '').trim().slice(0, 254);
  const password = String(form.get('password') ?? '').slice(0, 200);
  const next = safeNext(form.get('next'));
  if (!email || !password) return data({ error: 'Enter your email address and password.' }, { status: 400 });
  try {
    const session = await signInWithPassword(env, email, password);
    await rememberUser(env, session.user);
    return redirect(next, withCookies(undefined, sessionCookies(session)));
  } catch (err) {
    const expected = err instanceof AuthError && err.status < 500 && err.code !== 'unknown';
    if (!expected) console.error('sign-in failed', err instanceof AuthError ? err.code : err);
    return data({ error: explainAuthError(err) }, { status: expected ? 400 : 503 });
  }
}

export default function SignIn({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== 'idle';
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">Team sign-in</h1>
        <div className="title-rule" aria-hidden="true" />
        {loaderData.expired && (
          <p className="notice">For safety, team sign-ins last 12 hours. Please sign in again.</p>
        )}
        {loaderData.team && (
          <p className="notice">The team pages need the team sign-in: your password, then your authenticator app.</p>
        )}
        {!loaderData.configured ? (
          <p className="notice">Sign-in isn’t switched on for this site yet.</p>
        ) : (
          <Form method="post" noValidate>
            <input type="hidden" name="next" value={loaderData.next} />
            <div className="field">
              <label htmlFor="email" className="field-label">
                Email address
              </label>
              <input id="email" name="email" type="email" autoComplete="email" required className="input" maxLength={254} />
            </div>
            <div className="field">
              <label htmlFor="password" className="field-label">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="input"
                maxLength={200}
              />
            </div>
            {actionData?.error && (
              <p className="notice" role="alert">
                {actionData.error}
              </p>
            )}
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </Form>
        )}
        <p className="muted section-gap">
          This sign-in is for the Localites team. Everyone else: <Link to="/join">sign in with an emailed code</Link>.
        </p>
      </main>
    </>
  );
}
