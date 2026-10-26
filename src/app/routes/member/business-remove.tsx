import { data, Form, Link, redirect, useNavigation, useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { SLUG } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { refuseTeamMember } from '@/server/bookings.server';
import { askToRemove, removalPage, removalTeamEmail, RequestRefused, withdrawRemoval } from '@/server/business-requests.server';
import { sendEmail, TEAM_ADDRESS } from '@/server/email.server';
import { afterwards, siteUrl } from '@/server/plan-pages.server';
import type { Route } from './+types/business-remove';
import styles from './account.module.css';

/**
 * Ask to remove a business from Localites (D-63). Owner only (checked in the database on every
 * request). Nothing changes here: our team checks who it affects, then gets in touch.
 */
export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta(loaderData ? `Remove ${loaderData.page.name}` : 'Remove a business'),
  { name: 'robots', content: 'noindex' },
];

export async function loader({ params, context }: Route.LoaderArgs) {
  if (!SLUG.test(params.slug)) throw data(null, { status: 404 });
  const { env } = context.get(cloudflareContext);
  const member = context.get(memberContext);
  await refuseTeamMember(env, member.userId, params.slug, true);
  const page = await removalPage(env, member.userId, params.slug);
  if (!page) throw data(null, { status: 404 });
  return { page };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  if (!SLUG.test(params.slug)) throw data(null, { status: 404 });
  const { env, ctx } = context.get(cloudflareContext);
  const member = context.get(memberContext);
  await refuseTeamMember(env, member.userId, params.slug, true);
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  const here = `/vendors/${params.slug}/remove`;
  try {
    if (intent === 'ask') {
      const reason = String(form.get('reason') ?? '').trim().slice(0, 1000) || null;
      const asked = await askToRemove(env, member, params.slug, reason);
      if (!asked) throw data(null, { status: 404 });
      afterwards(
        ctx,
        sendEmail(env, { to: TEAM_ADDRESS, ...removalTeamEmail({ id: asked.id, business: asked.name, reason, person: { name: member.name, email: member.email } }, siteUrl(env, request)) }),
        'removal email',
      );
      return redirect(`${here}?asked=1`);
    }
    if (intent === 'withdraw') {
      if (!(await withdrawRemoval(env, member, params.slug))) throw data(null, { status: 404 });
      return redirect(`${here}?withdrawn=1`);
    }
  } catch (err) {
    if (err instanceof RequestRefused) return data({ error: err.message }, { status: 409 });
    throw err;
  }
  throw data(null, { status: 400 });
}

const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'long', timeZone: 'America/Toronto' });

export default function RemoveBusiness({ loaderData: { page }, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== 'idle';
  const [params] = useSearchParams();
  return (
    <>
      <SiteHeader />
      <main className={`page ${styles.narrow}`}>
        <p>
          <Link to="/account?tab=businesses" className="text-link">
            ← Businesses
          </Link>
        </p>
        <h1 className="title-1">{`Remove ${page.name} from Localites`}</h1>
        {actionData?.error && (
          <p className="notice" role="alert">
            {actionData.error}
          </p>
        )}
        {params.has('withdrawn') && !page.open && (
          <p className="notice" role="status">
            Done: you’ve withdrawn your request. Nothing has changed.
          </p>
        )}
        {page.open ? (
          <div className={styles.panel}>
            <p className={styles.saved} role="status">
              {params.has('asked') ? 'Sent to our team' : 'With our team'}
            </p>
            <p>
              {`You asked on ${when.format(new Date(page.open.createdAt))}. Our team will check who it affects first, then be in touch to sort it out with you. Your page stays as it is until then.`}
            </p>
            {page.open.reason && <p className="muted">{`Your reason: “${page.open.reason}”`}</p>}
            <Form method="post">
              <input type="hidden" name="intent" value="withdraw" />
              <button type="submit" className="button button-secondary" disabled={busy}>
                Withdraw my request
              </button>
            </Form>
          </div>
        ) : (
          <Form method="post" className={styles.panel}>
            <input type="hidden" name="intent" value="ask" />
            <p>
              Taking a business off Localites affects other people too: its team, customers messaging it, and anyone who has booked it
              or saved it. So our team checks first, then gets in touch to sort it out with you. Nothing changes until then.
            </p>
            <p className="muted">
              Just want a break? You can hide your page for a while from <Link to={`/vendors/${page.slug}/team`}>Team</Link> instead,
              and bring it back whenever you like.
            </p>
            <div className="field">
              <label htmlFor="reason" className="field-label">
                Why are you leaving? (optional)
              </label>
              <p className="field-hint" id="reason-hint">
                Seen only by our team.
              </p>
              <textarea id="reason" name="reason" className="input" maxLength={1000} aria-describedby="reason-hint" />
            </div>
            <p>
              <button type="submit" className={`button button-primary ${styles.dangerButton}`} disabled={busy}>
                {busy ? 'Sending…' : 'Ask our team to remove it'}
              </button>
            </p>
          </Form>
        )}
      </main>
    </>
  );
}
