import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { describeEvidence } from '@/lib/domain-match';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { type Check, CHECKS, RELATIONSHIPS } from '@/lib/claim-terms';
import { emailClaimDecision } from '@/server/claim-emails.server';
import { approveClaim, ClaimConflict, declineClaim, listClaims } from '@/server/claims.server';
import type { Route } from './+types/claims';
import styles from './admin.module.css';

/**
 * Screen X4: claims (D-33, D-35). The team checks each claim with the business itself
 * before approving: a matching email address, or the business's own published phone
 * number or email. Never the contact details in the claim.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Claims · Team'), { name: 'robots', content: 'noindex' }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const show = new URL(request.url).searchParams.get('show') === 'all' ? 'all' : 'open';
  const { env } = context.get(cloudflareContext);
  const admin = context.get(adminContext);
  return { show, claims: await listClaims(env, show), me: admin.userId, emailReady: Boolean(env.RESEND_API_KEY) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const admin = context.get(adminContext);
  const form = await request.formData();
  const id = String(form.get('id') ?? '');
  const intent = String(form.get('intent') ?? '');
  if (!isUuid(id)) throw data(null, { status: 400 });
  const site = new URL(request.url).origin;
  try {
    if (intent === 'approve') {
      const check = String(form.get('check') ?? '');
      if (!Object.hasOwn(CHECKS, check)) return data({ id, error: 'Choose how you confirmed it.' }, { status: 400 });
      const decided = await approveClaim(env, admin, id, check as Check);
      ctx.waitUntil(
        emailClaimDecision(env, site, id, decided, { approved: true }).catch((err) =>
          console.error('claim emails not recorded', err instanceof Error ? err.message : err),
        ),
      );
    } else if (intent === 'decline') {
      const reason = String(form.get('reason') ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
      if (!reason) return data({ id, error: 'Give a reason. It’s emailed to the person who claimed.' }, { status: 400 });
      const decided = await declineClaim(env, admin, id, reason);
      ctx.waitUntil(
        emailClaimDecision(env, site, id, decided, { approved: false, reason }).catch((err) =>
          console.error('claim emails not recorded', err instanceof Error ? err.message : err),
        ),
      );
    } else {
      return data({ id, error: 'Unknown request.' }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof ClaimConflict) return data({ id, error: err.message }, { status: 409 });
    throw err;
  }
  return redirect('/admin/claims');
}

const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' });
const OUTCOME = { submitted: 'Waiting', approved: 'Approved', rejected: 'Declined', withdrawn: 'Withdrawn' } as const;

export default function Claims({ loaderData, actionData }: Route.ComponentProps) {
  const { show, claims, me, emailReady } = loaderData;
  const busy = useNavigation().state === 'submitting';
  return (
    <>
      <h1 className="title-1">Claims</h1>
      <div className="title-rule" aria-hidden="true" />
      <p className="muted">
        People asking to manage a listing (D-33). Approve only when their email address is at the business’s own
        website, or after you’ve confirmed it with the business using the phone number or email the business publishes
        itself, never the details in the claim. The first approved claim wins; any others are declined automatically.
        Approving a claim doesn’t make a business verified.
      </p>
      {!emailReady && <p className="notice">Email isn’t set up yet (PO-12), so claimants won’t be emailed about decisions.</p>}
      <p>
        {show === 'open' ? (
          <Link to="?show=all" className="text-link">
            Show all, including decided
          </Link>
        ) : (
          <Link to="?" className="text-link">
            Show waiting only
          </Link>
        )}
      </p>
      {claims.length === 0 ? (
        <p className="muted">{show === 'open' ? 'No claims waiting.' : 'No claims yet.'}</p>
      ) : (
        <ul className={styles.rows}>
          {claims.map((c) => {
            const own = c.claimant.userId === me;
            return (
              <li key={c.id} id={`c-${c.id}`} className={styles.row}>
                <span className={styles.rowName}>{c.vendor.name}</span>
                <span className="muted">
                  <span className={styles.status}>{OUTCOME[c.status]}</span> · {when.format(new Date(c.createdAt))} ·{' '}
                  <Link to={`/admin/listings/${c.vendor.id}`}>Listing</Link>
                  {c.vendor.listed && (
                    <>
                      {' · '}
                      <Link to={`/vendors/${c.vendor.slug}`}>Public page</Link>
                    </>
                  )}
                </span>
                <span>
                  Claimed by {c.claimant.name} ({c.claimant.email})
                  {c.relationship ? `: “${RELATIONSHIPS[c.relationship]}”` : ''}
                </span>
                {c.note && <span className="muted">Their note: “{c.note}”</span>}
                <span>{describeEvidence(c.evidence)}</span>
                {c.status === 'submitted' ? (
                  <>
                    <span>
                      The business’s own details:{' '}
                      {[
                        c.vendor.publicPhone && `phone ${c.vendor.publicPhone}`,
                        c.vendor.publicEmail && `email ${c.vendor.publicEmail}`,
                        c.vendor.websiteUrl && `website ${c.vendor.websiteUrl}`,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'none published; find them before approving'}
                    </span>
                    {c.otherOpen > 0 && (
                      <span className="muted">
                        {c.otherOpen} other {c.otherOpen === 1 ? 'claim' : 'claims'} waiting for this business.
                      </span>
                    )}
                    <span className="muted">Email to claimant: {c.emailStatus ?? 'not recorded'}</span>
                    {actionData && 'id' in actionData && actionData.id === c.id && (
                      <p className="notice" role="alert">
                        {actionData.error}
                      </p>
                    )}
                    {own ? (
                      <p className="notice">This is your own claim. Another team member must check it.</p>
                    ) : (
                      <Form method="post" className={styles.buttons}>
                        <input type="hidden" name="intent" value="approve" />
                        <input type="hidden" name="id" value={c.id} />
                        <label htmlFor={`check-${c.id}`} className="visually-hidden">
                          How you confirmed it
                        </label>
                        <select id={`check-${c.id}`} name="check" className="input" defaultValue="">
                          <option value="">How you confirmed it…</option>
                          {Object.entries(CHECKS)
                            .filter(([key]) => key !== 'email_domain' || c.evidence.result === 'match')
                            .map(([key, label]) => (
                              <option key={key} value={key}>
                                {label}
                              </option>
                            ))}
                        </select>
                        <button type="submit" className="button button-primary" disabled={busy}>
                          Approve
                        </button>
                      </Form>
                    )}
                    <Form method="post" className={styles.buttons}>
                      <input type="hidden" name="intent" value="decline" />
                      <input type="hidden" name="id" value={c.id} />
                      <label htmlFor={`why-${c.id}`} className="visually-hidden">
                        Reason for declining (emailed to them)
                      </label>
                      <input
                        id={`why-${c.id}`}
                        name="reason"
                        className="input"
                        placeholder="Reason (emailed to them)"
                        maxLength={500}
                      />
                      <button type="submit" className="button button-secondary" disabled={busy}>
                        Decline
                      </button>
                    </Form>
                  </>
                ) : (
                  <span className="muted">
                    {c.decisionNote && <>“{c.decisionNote}” · </>}
                    by {c.reviewedBy ?? 'the team'}
                    {c.reviewedAt ? ` · ${when.format(new Date(c.reviewedAt))}` : ''}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
