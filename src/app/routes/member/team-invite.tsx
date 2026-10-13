import { data, Form, Link, useNavigation } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { pageMeta } from '@/lib/meta';
import { TEAM_ROLES } from '@/lib/team-terms';
import { acceptInvite, invitationFor, TeamRefused } from '@/server/team.server';
import type { Route } from './+types/team-invite';
import styles from './plan.module.css';

/**
 * Opening an invitation to a business's team (V4). The person signs in first (the member
 * gate brings them back here); it can be accepted only by the account with the email
 * address it was sent to, once, within 7 days.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Join a business’s team'), { name: 'robots', content: 'noindex' }];

export async function loader({ params, context }: Route.LoaderArgs) {
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  return { invitation: await invitationFor(env, params.token, member.email) };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  if ((await request.formData()).get('intent') !== 'accept') throw data(null, { status: 400 });
  try {
    const joined = await acceptInvite(env, { userId: member.userId, email: member.email }, params.token);
    return { joined };
  } catch (err) {
    if (err instanceof TeamRefused) return data({ error: err.message }, { status: 409 });
    throw err;
  }
}

export default function TeamInvite({ loaderData, actionData }: Route.ComponentProps) {
  const { invitation } = loaderData;
  const busy = useNavigation().state !== 'idle';
  const joined = actionData && 'joined' in actionData ? actionData.joined : null;
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">Join a business’s team</h1>
        <div className="title-rule" aria-hidden="true" />
        {actionData && 'error' in actionData && (
          <p className="notice" role="alert">
            {actionData.error}
          </p>
        )}
        {joined ? (
          <>
            <p role="status">
              You’re now on the team at <strong>{joined.business}</strong> as {TEAM_ROLES[joined.role].name}.
            </p>
            <p>
              <Link to="/business" className="button button-primary">
                Go to My business
              </Link>
            </p>
          </>
        ) : invitation.state === 'open' ? (
          invitation.forYou ? (
            <>
              <p>
                You’ve been invited to help run <strong>{invitation.business}</strong> on Localites as {TEAM_ROLES[invitation.role].name}.
              </p>
              <p className="muted">{TEAM_ROLES[invitation.role].what}</p>
              <Form method="post" className={styles.actions}>
                <input type="hidden" name="intent" value="accept" />
                <button type="submit" className="button button-primary" disabled={busy}>
                  {busy ? 'Joining…' : 'Accept and join the team'}
                </button>
                <Link to="/account" className="button button-secondary">
                  Not now
                </Link>
              </Form>
            </>
          ) : (
            <p>
              This invitation was sent to a different email address. Sign out, then sign in with the address the invitation was sent to.
            </p>
          )
        ) : invitation.state === 'unknown' ? (
          <p>This invitation link isn’t valid. Check you copied all of it, or ask the business’s owner to send a new one.</p>
        ) : (
          <p>This invitation has expired or has already been used. Ask the business’s owner to send a new one.</p>
        )}
      </main>
    </>
  );
}
