import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { pageMeta } from '@/lib/meta';
import { deleteMyAccount, onLocalitesTeam } from '@/server/account-deletion.server';
import { cleanUpConversationFiles } from '@/server/conversation-files.server';
import { afterwards } from '@/server/plan-pages.server';
import { signOut } from '@/server/auth/gotrue.server';
import { clearedCookies, withCookies } from '@/server/auth/session.server';
import type { Route } from './+types/account-delete';
import styles from './plan.module.css';

/**
 * A4: delete my account (E §8, D-10). Says plainly what goes and what stays, and asks the
 * person to type their email address to confirm. Only ever deletes the signed-in person's
 * own account: no id comes from the page.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Delete your account'), { name: 'robots', content: 'noindex' }];

export async function loader({ context }: Route.LoaderArgs) {
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  return { email: member.email, team: await onLocalitesTeam(env, member.userId) };
}

const TEAM_WORDS = 'You’re on the Localites team, so you can’t delete your account here. Ask another admin to remove your team role first.';

export async function action({ request, context }: Route.ActionArgs) {
  const member = context.get(memberContext);
  const { env, ctx } = context.get(cloudflareContext);
  const form = await request.formData();
  if (form.get('intent') !== 'delete') throw data(null, { status: 400 });
  const typed = String(form.get('confirm') ?? '')
    .trim()
    .toLowerCase();
  if (typed !== member.email.trim().toLowerCase()) {
    return data({ error: 'Type your email address exactly as shown, to confirm.' }, { status: 400 });
  }
  const result = await deleteMyAccount(env, member.userId);
  if (result === 'team') return data({ error: TEAM_WORDS }, { status: 409 });
  // Their conversation files are deleted from storage now (the nightly run catches any left).
  afterwards(ctx, cleanUpConversationFiles(env), 'file clean-up');
  // Deleted (or already closed): end the session with Supabase and clear the cookies.
  await signOut(env, member.accessToken).catch(() => undefined);
  return redirect('/goodbye', withCookies(undefined, clearedCookies()));
}

export default function DeleteAccount({ loaderData, actionData }: Route.ComponentProps) {
  const { email, team } = loaderData;
  const busy = useNavigation().state !== 'idle';
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">Delete your account</h1>
        <div className="title-rule" aria-hidden="true" />
        {actionData?.error && (
          <p className="notice" role="alert" id="delete-error">
            {actionData.error}
          </p>
        )}
        {team ? (
          <p>{TEAM_WORDS}</p>
        ) : (
          <>
            <p>This can’t be undone. When you delete your account:</p>
            <ul>
              <li>your events, your plans for them and your saved businesses are deleted;</li>
              <li>your name, email address and personal details are erased;</li>
              <li>if you run a business on Localites, you leave its team; if you were its only owner, it goes back to unclaimed;</li>
              <li>any claim you’re waiting on is withdrawn;</li>
              <li>businesses you marked as booked no longer see your booking;</li>
              <li>you’re signed out on this device.</li>
            </ul>
            <p className="muted">
              We keep only counts that can’t be linked to you (such as how often a business was viewed) and records of changes made to
              businesses, without your name. Our backups are replaced within 30 days, after which nothing of yours is left.
            </p>
            <Form method="post">
              <input type="hidden" name="intent" value="delete" />
              <div className="field">
                <label htmlFor="confirm" className="field-label">
                  To confirm, type your email address: {email}
                </label>
                <input
                  id="confirm"
                  name="confirm"
                  type="email"
                  className="input"
                  autoComplete="off"
                  required
                  aria-describedby={actionData?.error ? 'delete-error' : undefined}
                  aria-invalid={actionData?.error ? true : undefined}
                />
              </div>
              <div className={styles.actions}>
                <button type="submit" className="button button-primary" disabled={busy}>
                  {busy ? 'Deleting…' : 'Delete my account'}
                </button>
                <Link to="/account" className="button button-secondary">
                  Keep my account
                </Link>
              </div>
            </Form>
          </>
        )}
      </main>
    </>
  );
}
