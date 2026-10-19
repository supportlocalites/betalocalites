import { data, Form, Link, useNavigation } from 'react-router';
import { cloudflareContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { shareMeta } from '@/lib/meta';
import { suggestionInput } from '@/server/suggestion-input';
import { hasSessionCookie, loadSession } from '@/server/auth/session.server';
import { connectionFingerprint, notifyTeam, saveSuggestion } from '@/server/suggestions.server';
import { torontoDate } from '@/lib/activity';
import { addressKey, visitor } from '@/server/visitor.server';
import type { Route } from './+types/suggest';
import { cleanText } from '@/lib/clean-text';

/**
 * Screen P11: Suggest a business (D-25, ADR-027). Open to everyone, no account. Someone signed
 * in is linked to their suggestion and emailed once the business is listed.
 */
export const meta: Route.MetaFunction = ({ matches }) => shareMeta(matches, '/suggest', 'Suggest a business');

export function loader({ request }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams;
  return {
    category: cleanText(params.get('category') ?? '').slice(0, 80),
    q: cleanText(params.get('q') ?? '').slice(0, 200),
  };
}

const LIMITED = 'You’ve sent a few suggestions already. Please try again in an hour.';

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const form = await request.formData();

  // A field people never see; only bots fill it in. Thank them and keep nothing.
  if (String(form.get('company_url') ?? '') !== '') return { done: true as const };

  const parsed = suggestionInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
    return data({ error: null, errors }, { status: 400 });
  }

  // At most a few complete suggestions a minute from one internet address (kept by
  // Cloudflare, never stored). Fixing a mistake on the form doesn't count.
  if (env.SUGGEST_LIMIT && !(await env.SUGGEST_LIMIT.limit({ key: addressKey(request) })).success) {
    return data({ error: LIMITED, errors: {} as Record<string, string> }, { status: 429 });
  }

  const who = visitor(request);
  const headers = new Headers();
  if (who.setCookie) headers.append('Set-Cookie', who.setCookie);
  // Signed in: linked to their account (checked with the sign-in service, never taken from the form).
  const signedIn = hasSessionCookie(request) ? await loadSession(request, env).catch(() => null) : null;
  for (const c of signedIn?.setCookies ?? []) headers.append('Set-Cookie', c);
  const userId = signedIn?.session?.user.id ?? null;
  const connection = await connectionFingerprint(env, addressKey(request), torontoDate(new Date()));
  const result = await saveSuggestion(env, parsed.data, who.id, userId, connection);
  if (!result.saved) {
    const error =
      result.reason === 'daily_limit'
        ? 'We’ve had a lot of suggestions today. Please try again tomorrow.'
        : result.reason === 'connection_limit'
          ? 'That’s the most suggestions from one place in a day. Thank you! Please send more tomorrow.'
          : LIMITED;
    return data({ error, errors: {} as Record<string, string> }, { status: 429, headers });
  }
  // The email to the team happens after the person sees "Thanks"; its outcome is recorded.
  ctx.waitUntil(
    notifyTeam(env, result.id, parsed.data, new URL(request.url).origin).catch((err) =>
      console.error('suggestion email not recorded', err instanceof Error ? err.message : err),
    ),
  );
  return data({ done: true as const, linked: Boolean(userId) }, { headers });
}

export default function Suggest({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state === 'submitting';
  if (actionData && 'done' in actionData) {
    return (
      <>
        <SiteHeader />
        <main className="page narrow">
          <h1 className="title-1">Thanks</h1>
          <div className="title-rule" aria-hidden="true" />
          <p role="status">
            Our team will look into this business and add it if it’s a fit.
            {'linked' in actionData && actionData.linked ? ' We’ll email you when it’s on Localites.' : ''}
          </p>
          <p className="section-gap">
            <Link to="/explore" className="button button-primary">
              Back to Explore
            </Link>
          </p>
        </main>
      </>
    );
  }
  const errors = actionData && 'errors' in actionData ? actionData.errors : {};
  const error = actionData && 'error' in actionData ? actionData.error : null;
  const field = (name: string, label: string, hint: string, props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div className="field">
      <label htmlFor={name} className="field-label">
        {label}
      </label>
      {hint && (
        <p className="field-hint" id={`${name}-hint`}>
          {hint}
        </p>
      )}
      <input
        id={name}
        name={name}
        className="input"
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={[hint ? `${name}-hint` : '', errors[name] ? `${name}-error` : ''].filter(Boolean).join(' ') || undefined}
        {...props}
      />
      {errors[name] && (
        <p className="field-error" id={`${name}-error`}>
          {errors[name]}
        </p>
      )}
    </div>
  );
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">Suggest a business</h1>
        <div className="title-rule" aria-hidden="true" />
        <p className="muted">
          Know a local business that should be on Localites? Tell us, and our team will look into it.
        </p>
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        <Form method="post" noValidate>
          <input type="hidden" name="category" value={loaderData.category} />
          <input type="hidden" name="q" value={loaderData.q} />
          {field('businessName', 'Business name', '', { required: true, maxLength: 200, autoComplete: 'off' })}
          {field('website', 'Website or social page (if you know it)', '', { maxLength: 500, inputMode: 'url', autoComplete: 'off' })}
          {field('contact', 'Their phone number or email (if you know it)', 'Only used by our team to reach the business. Never shown on Localites.', {
            maxLength: 200,
            autoComplete: 'off',
          })}
          <div className="visually-hidden" aria-hidden="true">
            <label htmlFor="company_url">Leave this empty</label>
            <input id="company_url" name="company_url" tabIndex={-1} autoComplete="off" />
          </div>
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? 'Sending…' : 'Send suggestion'}
          </button>
        </Form>
      </main>
    </>
  );
}
