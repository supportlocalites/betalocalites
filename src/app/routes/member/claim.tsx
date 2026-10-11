import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { pageMeta } from '@/lib/meta';
import { OPEN_CLAIMS_PER_PERSON, RELATIONSHIPS } from '@/lib/claim-terms';
import { claimInput } from '@/server/member-input';
import { emailClaimReceived } from '@/server/claim-emails.server';
import { ClaimRefused, claimTarget, submitClaim } from '@/server/claims.server';
import type { Route } from './+types/claim';
import styles from './member.module.css';

/** Screen P8: claim a listing (D-29, D-33). Needs an account (the layout's gate). */
export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta(loaderData ? `Claim ${loaderData.vendor.name}` : 'Claim a business'),
  { name: 'robots', content: 'noindex' },
];

export async function loader({ params, context }: Route.LoaderArgs) {
  const member = context.get(memberContext);
  const target = await claimTarget(context.get(cloudflareContext).env, params.slug, member);
  if (!target) throw data(null, { status: 404 });
  return { ...target, email: member.email };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const member = context.get(memberContext);
  const target = await claimTarget(env, params.slug, member);
  if (!target) throw data(null, { status: 404 });

  const form = await request.formData();
  const parsed = claimInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
    return data({ error: null, errors }, { status: 400 });
  }
  try {
    const { claimId, business } = await submitClaim(env, member, target.vendor.id, parsed.data);
    // Emails go after the page answers; each one's outcome is recorded.
    ctx.waitUntil(
      emailClaimReceived(env, new URL(request.url).origin, member, {
        id: claimId,
        business,
        relationship: parsed.data.relationship,
        websiteUrl: target.vendor.websiteUrl,
      }).catch((err) => console.error('claim emails not recorded', err instanceof Error ? err.message : err)),
    );
  } catch (err) {
    if (err instanceof ClaimRefused) return data({ error: err.message, errors: {} as Record<string, string> }, { status: 409 });
    throw err;
  }
  return redirect(`/vendors/${target.vendor.slug}/claim`);
}

export default function Claim({ loaderData, actionData }: Route.ComponentProps) {
  const { vendor, state, evidence, email } = loaderData;
  const busy = useNavigation().state !== 'idle';
  const errors = actionData?.errors ?? {};
  const back = (
    <p className="section-gap">
      <Link to={`/vendors/${vendor.slug}`} className="text-link">
        Back to {vendor.name}
      </Link>
    </p>
  );

  if (state !== 'can_claim') {
    const message = {
      waiting: 'Thanks. Your claim is waiting for our team. We’ll check it with the business and email you when it’s decided.',
      manager: 'You’re already this business’s owner on Localites. It’s listed on your account page.',
      claimed: 'This business is already managed on Localites. If you think that’s wrong, email supportlocalites@gmail.com.',
      too_many: `You can have ${OPEN_CLAIMS_PER_PERSON} claims waiting at a time. Please wait for our team to answer one.`,
    }[state];
    return (
      <>
        <SiteHeader />
        <main className="page narrow">
          <h1 className="title-1">{vendor.name}</h1>
          <div className="title-rule" aria-hidden="true" />
          <p role="status">{message}</p>
          <p>
            <Link to="/account" className="button button-primary">
              Your account
            </Link>
          </p>
          {back}
        </main>
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">Claim {vendor.name}</h1>
        <div className="title-rule" aria-hidden="true" />
        <p>
          Once our team approves your claim, you become this business’s owner on Localites. Claiming is free, and the
          listing stays up while we check. Editing the listing yourself is coming soon; until then, our team makes
          changes for you.
        </p>
        <p className="muted">
          {evidence === 'match'
            ? `You’re signed in as ${email}, which matches the business’s own website, so we can usually confirm it quickly.`
            : `You’re signed in as ${email}. To confirm, our team will contact the business using the phone number or email it publishes itself.`}
        </p>
        {actionData?.error && (
          <p className="notice" role="alert">
            {actionData.error}
          </p>
        )}
        <Form method="post" noValidate>
          <fieldset className={styles.choices} aria-describedby={errors.relationship ? 'relationship-error' : undefined}>
            <legend>How are you connected to {vendor.name}?</legend>
            {Object.entries(RELATIONSHIPS).map(([value, label]) => (
              <label key={value} className={styles.choice}>
                <input type="radio" name="relationship" value={value} required />
                {label}
              </label>
            ))}
            {errors.relationship && (
              <p className="field-error" id="relationship-error">
                {errors.relationship}
              </p>
            )}
          </fieldset>
          <div className="field">
            <label htmlFor="note" className="field-label">
              Anything that will help us confirm it (optional)
            </label>
            <p className="field-hint" id="note-hint">
              For example, your role, or the best time to reach the business. Seen only by our team.
            </p>
            <textarea id="note" name="note" className="input" maxLength={1000} aria-describedby="note-hint" />
            {errors.note && <p className="field-error">{errors.note}</p>}
          </div>
          <label className={styles.choice}>
            <input type="checkbox" name="authorised" value="yes" required aria-describedby={errors.authorised ? 'authorised-error' : undefined} />
            I’m allowed to manage this business’s listing.
          </label>
          {errors.authorised && (
            <p className="field-error" id="authorised-error">
              {errors.authorised}
            </p>
          )}
          <p className="section-gap">
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? 'Sending…' : 'Send claim'}
            </button>
          </p>
        </Form>
        {back}
      </main>
    </>
  );
}
