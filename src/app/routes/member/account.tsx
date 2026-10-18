import { data, Form, Link, redirect, useNavigation, useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { NameFields, ProfileFields } from '@/components/ProfileFields';
import { SiteHeader } from '@/components/SiteHeader';
import { pageMeta } from '@/lib/meta';
import { EVENTS_PRIVATE } from '@/lib/plan-terms';
import { updatePerson } from '@/server/auth/member.server';
import { NAMES_NEEDED, namesInput, profileInput } from '@/server/member-input';
import { getProfile } from '@/server/profile.server';
import { myAccount } from '@/server/claims.server';
import { reviewRequestsOn, setReviewRequests } from '@/server/review-requests.server';
import { REVIEW_REQUESTS } from '@/lib/review-terms';
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
  const [{ businesses, claims }, profile, reviewRequests] = await Promise.all([
    myAccount(env, member.userId),
    getProfile(env, member.userId),
    reviewRequestsOn(env, member.userId),
  ]);
  // Accounts made before first and last names were asked (the team's) start with the
  // whole name in the first box.
  const first = member.firstName ?? member.name;
  return { first, last: member.lastName, email: member.email, profile, businesses, claims, reviewRequests };
}

export async function action({ request, context }: Route.ActionArgs) {
  const member = context.get(memberContext);
  const form = await request.formData();
  if (form.get('intent') === 'emails') {
    // Only ever this person's own choice: the id comes from the session.
    await setReviewRequests(context.get(cloudflareContext).env, member.userId, form.get('reviewRequests') === 'on');
    return redirect('/account?emails=1#emails');
  }
  if (form.get('intent') !== 'details') throw data(null, { status: 400 });
  const fields = Object.fromEntries(form);
  const names = namesInput.safeParse(fields);
  const profile = profileInput.safeParse(fields);
  if (!names.success || !profile.success) {
    const errors: Record<string, string> = {};
    for (const issue of [...(names.error?.issues ?? []), ...(profile.error?.issues ?? [])]) errors[String(issue.path[0])] ??= issue.message;
    const nameMissing = !String(fields.firstName ?? '').trim() || !String(fields.lastName ?? '').trim();
    return data({ error: nameMissing ? NAMES_NEEDED : 'Please check what’s marked below.', errors }, { status: 400 });
  }
  // Only ever this person's own record: the id comes from the session, never the form.
  await updatePerson(context.get(cloudflareContext).env, member.userId, names.data, profile.data);
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
  const { first, last, email, profile, businesses, claims, reviewRequests } = loaderData;
  const busy = useNavigation().state !== 'idle';
  const [params] = useSearchParams();
  const saved = params.has('saved') && !actionData;
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
            <NameFields first={first} last={last} errors={errors} />
            <ProfileFields values={profile} errors={errors} />
            <button type="submit" className="button button-secondary" disabled={busy}>
              Save details
            </button>
          </Form>
        </section>

        <section aria-labelledby="planning" className={styles.section}>
          <h2 id="planning" className="label">
            Planning
          </h2>
          <p>
            <Link to="/events" className="text-link">
              My events
            </Link>{' '}
            ·{' '}
            <Link to="/saved" className="text-link">
              Saved businesses
            </Link>
          </p>
          <p className="muted">Only you can see your saved businesses. {EVENTS_PRIVATE}</p>
        </section>

        <section aria-labelledby="emails-title" className={styles.section} id="emails">
          <h2 id="emails-title" className="label">
            Emails
          </h2>
          <Form method="post">
            <input type="hidden" name="intent" value="emails" />
            <label className={styles.check}>
              <input type="checkbox" name="reviewRequests" defaultChecked={reviewRequests} /> {REVIEW_REQUESTS.label}
            </label>
            <p className="muted">{REVIEW_REQUESTS.hint}</p>
            <button type="submit" className="button button-secondary" disabled={busy}>
              Save
            </button>
            {params.has('emails') && (
              <p role="status" className="muted">
                Saved.
              </p>
            )}
          </Form>
        </section>

        <section aria-labelledby="businesses" className={styles.section}>
          <h2 id="businesses" className="label">
            Your businesses
          </h2>
          {businesses.length === 0 ? (
            <p className="muted">None yet. If your business is on Localites, open its page and choose “Claim this business”.</p>
          ) : (
            <>
              <ul className={styles.list}>
                {businesses.map((b) => (
                  <li key={b.id}>
                    {b.listed ? <Link to={`/vendors/${b.slug}`}>{b.name}</Link> : <span>{b.name}</span>}
                    <span className="muted">{ROLE[b.role] ?? b.role}</span>
                    {(b.role === 'owner' || b.role === 'manager') && !b.archived && (
                      <span>
                        <Link to={`/vendors/${b.slug}/bookings`} className="text-link">
                          Bookings marked
                        </Link>
                      </span>
                    )}
                    {b.role === 'owner' && !b.archived && (
                      <span>
                        <Link to={`/vendors/${b.slug}/team`} className="text-link">
                          Team
                        </Link>
                      </span>
                    )}
                    {b.role === 'staff' && !b.archived && (
                      <span>
                        <Link to={`/vendors/${b.slug}/messages`} className="text-link">
                          Messages
                        </Link>
                      </span>
                    )}
                    {(b.role === 'owner' || b.role === 'manager') && !b.archived && (
                      <span>
                        <Link to={`/vendors/${b.slug}/edit`} className="button button-primary">
                          Edit your listing
                        </Link>{' '}
                        <Link to={`/vendors/${b.slug}/photos`} className="button button-secondary">
                          Photos
                        </Link>
                        {b.analytics && (
                          <>
                            {' '}
                            <Link to={`/vendors/${b.slug}/analytics`} className="button button-secondary">
                              Analytics
                            </Link>
                          </>
                        )}
                      </span>
                    )}
                    {b.archived && <span className="muted">No longer on Localites. Email supportlocalites@gmail.com with questions.</span>}
                  </li>
                ))}
              </ul>
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

        <p className={styles.section}>
          <Link to="/account/data" className="text-link">
            Download your data
          </Link>
          {' · '}
          <Link to="/account/delete" className="text-link">
            Delete your account
          </Link>
        </p>
        <Form method="post" action="/sign-out" className={styles.section}>
          <button type="submit" className="button button-secondary">
            Sign out
          </button>
        </Form>
      </main>
    </>
  );
}
