import { data, Form, Link, redirect, useNavigation, useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { ProfileFields } from '@/components/ProfileFields';
import { SiteHeader } from '@/components/SiteHeader';
import { pageMeta } from '@/lib/meta';
import { updatePerson } from '@/server/auth/member.server';
import { nameInput, profileInput } from '@/server/member-input';
import { getProfile } from '@/server/profile.server';
import { myAccount } from '@/server/claims.server';
import type { Route } from './+types/account';
import styles from './member.module.css';

/**
 * Screens A4, V1 and V5, first version: your account (D-29). One login for personal use
 * and the businesses a person manages. Only ever shows this person's own details,
 * businesses and claims.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Your account'), { name: 'robots', content: 'noindex' }];

export async function loader({ context }: Route.LoaderArgs) {
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const [{ businesses, claims }, profile] = await Promise.all([myAccount(env, member.userId), getProfile(env, member.userId)]);
  return { name: member.name, email: member.email, profile, businesses, claims };
}

export async function action({ request, context }: Route.ActionArgs) {
  const member = context.get(memberContext);
  const form = await request.formData();
  if (form.get('intent') !== 'details') throw data(null, { status: 400 });
  const name = nameInput.safeParse(form.get('name') ?? '');
  const profile = profileInput.safeParse(Object.fromEntries(form));
  if (!name.success || !profile.success) {
    const errors: Record<string, string> = {};
    for (const issue of profile.error?.issues ?? []) errors[String(issue.path[0])] ??= issue.message;
    if (!name.success) errors.name = name.error.issues[0]?.message ?? 'Enter your name.';
    return data({ error: 'Please check what’s marked below.', errors }, { status: 400 });
  }
  // Only ever this person's own record: the id comes from the session, never the form.
  await updatePerson(context.get(cloudflareContext).env, member.userId, name.data, profile.data);
  return redirect('/account?saved=1');
}

const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeZone: 'America/Toronto' });
const CLAIM_STATUS = {
  submitted: 'Waiting for our team',
  approved: 'Approved',
  rejected: 'Not approved',
  withdrawn: 'Withdrawn',
} as const;
const ROLE = { owner: 'Owner', manager: 'Manager', staff: 'Staff' } as Record<string, string>;

export default function Account({ loaderData, actionData }: Route.ComponentProps) {
  const { name, email, profile, businesses, claims } = loaderData;
  const busy = useNavigation().state !== 'idle';
  const saved = useSearchParams()[0].has('saved') && !actionData;
  const errors = actionData?.errors ?? {};
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">Your account</h1>
        <div className="title-rule" aria-hidden="true" />

        <section aria-labelledby="details" className={styles.section}>
          <h2 id="details" className="label">
            Your details
          </h2>
          <p>
            Email: {email}
            <br />
            <span className="muted">We email a sign-in code to this address each time you sign in.</span>
          </p>
          <Form method="post" noValidate>
            <input type="hidden" name="intent" value="details" />
            {actionData?.error && (
              <p className="notice" role="alert">
                {actionData.error}
              </p>
            )}
            {saved && (
              <p className="notice" role="status">
                Saved.
              </p>
            )}
            <div className="field">
              <label htmlFor="name" className="field-label">
                Your name
              </label>
              <input
                id="name"
                name="name"
                className="input"
                defaultValue={name}
                autoComplete="name"
                maxLength={80}
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={errors.name ? 'name-error' : undefined}
              />
              {errors.name && (
                <p className="field-error" id="name-error">
                  {errors.name}
                </p>
              )}
            </div>
            <ProfileFields values={profile} errors={errors} />
            <button type="submit" className="button button-secondary" disabled={busy}>
              Save details
            </button>
          </Form>
        </section>

        <section aria-labelledby="businesses" className={styles.section}>
          <h2 id="businesses" className="label">
            Your businesses
          </h2>
          {businesses.length === 0 ? (
            <p className="muted">
              None yet. If your business is on Localites, open its page and choose “Claim this business”.
            </p>
          ) : (
            <>
              <ul className={styles.list}>
                {businesses.map((b) => (
                  <li key={b.id}>
                    {b.listed ? <Link to={`/vendors/${b.slug}`}>{b.name}</Link> : <span>{b.name}</span>}
                    <span className="muted">{ROLE[b.role] ?? b.role}</span>
                  </li>
                ))}
              </ul>
              <p className="muted">
                Editing your listing here is the next thing we’re building. Until then, email changes to
                supportlocalites@gmail.com from this address.
              </p>
            </>
          )}
        </section>

        {claims.length > 0 && (
          <section aria-labelledby="claims-title" className={styles.section} id="claims">
            <h2 id="claims-title" className="label">
              Your claims
            </h2>
            <ul className={styles.list}>
              {claims.map((c) => (
                <li key={c.id}>
                  <Link to={`/vendors/${c.slug}`}>{c.business}</Link>
                  <span className="muted">
                    {CLAIM_STATUS[c.status]} · sent {when.format(new Date(c.createdAt))}
                  </span>
                  {c.reason && <span className={styles.reason}>Reason: {c.reason}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <Form method="post" action="/sign-out" className={styles.section}>
          <button type="submit" className="button button-secondary">
            Sign out
          </button>
        </Form>
      </main>
    </>
  );
}
