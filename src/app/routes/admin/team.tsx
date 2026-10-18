import { data, Form, redirect, useNavigation } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { addTeamAdmin, removeTeamAdmin, TeamRefused, teamMembers } from '@/server/admin/team-admins.server';
import { formFields } from '@/server/plan-pages.server';
import type { Route } from './+types/team';
import styles from './admin.module.css';

/**
 * Screen X10, Users & roles: who is on the Localites team, adding an admin and removing one
 * (migration 0035). The database makes each change, refuses anyone not on the team and
 * anyone removing themselves, and writes the audit log; a removed admin is shut out on
 * their next click (the gate checks the role on every request).
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Users and roles · Team'), { name: 'robots', content: 'noindex' }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const admin = context.get(adminContext);
  return {
    members: await teamMembers(env, admin),
    me: admin.userId,
    saved: new URL(request.url).searchParams.get('saved'),
  };
}

type Reply = { target: string; error: string };

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const admin = context.get(adminContext);
  const fields = formFields(await request.formData());
  const intent = fields.intent ?? '';
  const target = intent === 'remove' ? (fields.userId ?? '') : 'add';
  const refuse = (error: string, status = 400) => data<Reply>({ target, error }, { status });
  const reason = (fields.reason ?? '').trim();
  if (!reason || reason.length > 300) return refuse('Say why, in up to 300 characters.');
  try {
    if (intent === 'add') {
      const email = (fields.email ?? '').trim();
      if (!email || email.length > 320 || !email.includes('@')) return refuse('Type the email they sign in to Localites with.');
      await addTeamAdmin(env, admin, email, reason);
      return redirect('/admin/team?saved=added');
    }
    if (intent === 'remove' && isUuid(target)) {
      await removeTeamAdmin(env, admin, target, reason);
      return redirect('/admin/team?saved=removed');
    }
    return refuse('Unknown request.');
  } catch (err) {
    if (err instanceof TeamRefused) return refuse(err.message, 409);
    throw err;
  }
}

const SAVED: Record<string, string> = {
  added: 'Added to the team. They can open the team pages the next time they sign in with their password and authenticator app.',
  removed: 'Removed from the team. Their next click on a team page is refused.',
};

const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeZone: 'America/Toronto' });

export default function Team({ loaderData, actionData }: Route.ComponentProps) {
  const { members, me, saved } = loaderData;
  const busy = useNavigation().state === 'submitting';
  const current = members.filter((m) => !m.endedAt);
  const former = members.filter((m) => m.endedAt);
  const problem = (target: string) =>
    actionData && actionData.target === target ? (
      <p className="notice" role="alert">
        {actionData.error}
      </p>
    ) : null;
  return (
    <>
      <h1 className="title-1">Users and roles</h1>
      <div className="title-rule" aria-hidden="true" />
      <p className="muted">
        Everyone here is a Localites admin: they can open every team page. Every addition and removal is recorded with who did it and why.
      </p>
      {saved && SAVED[saved] && !actionData && (
        <p className="notice" role="status">
          {SAVED[saved]}
        </p>
      )}

      <section className={styles.section} aria-labelledby="current-heading">
        <h2 id="current-heading">On the team now ({current.length})</h2>
        <ul className={styles.rows}>
          {current.map((m) => (
            <li key={m.userId} className={styles.row}>
              <span className={styles.rowName}>{`${m.name}${m.userId === me ? ' (you)' : ''}`}</span>
              <span className="muted">
                {m.email} · since {when.format(new Date(m.since))}
                {m.grantedBy ? `, added by ${m.grantedBy}` : ''}
              </span>
              {m.userId !== me && (
                <details open={actionData?.target === m.userId}>
                  <summary className="text-link">Remove from the team</summary>
                  <Form method="post" className={styles.form}>
                    {problem(m.userId)}
                    <input type="hidden" name="intent" value="remove" />
                    <input type="hidden" name="userId" value={m.userId} />
                    <div className="field">
                      <label htmlFor={`reason-${m.userId}`} className="field-label">
                        Why (kept in the record)
                      </label>
                      <input id={`reason-${m.userId}`} name="reason" className="input" maxLength={300} required />
                    </div>
                    <button type="submit" className="button button-secondary" disabled={busy}>
                      Remove {m.name}
                    </button>
                  </Form>
                </details>
              )}
            </li>
          ))}
        </ul>
        <p className="muted">To leave the team yourself, ask another admin to remove you.</p>
      </section>

      <section className={styles.section} aria-labelledby="add-heading">
        <h2 id="add-heading">Add someone to the team</h2>
        <p>Team members sign in with a password and an authenticator app, so there are two steps before you add them here:</p>
        <ol>
          <li>
            In Supabase, open <strong>Authentication → Users → Add user → Create new user</strong>. Type their email, let them type their own
            password, and tick <strong>Auto Confirm User</strong>. If that email already has a Localites account (people sign in with emailed
            codes, without a password), use another email for their team account.
          </li>
          <li>
            They sign in once at <strong>/sign-in</strong> with that email and password. The team pages will turn them away for now: that’s
            expected, and it creates their Localites account.
          </li>
        </ol>
        <p>Then add them here. The next time they sign in, the site asks them to set up their authenticator app.</p>
        <Form method="post" className={styles.form}>
          {problem('add')}
          <input type="hidden" name="intent" value="add" />
          <div className={styles.twoColumns}>
            <div className="field">
              <label htmlFor="add-email" className="field-label">
                Their email
              </label>
              <input id="add-email" name="email" type="email" className="input" maxLength={320} autoComplete="off" required />
            </div>
            <div className="field">
              <label htmlFor="add-reason" className="field-label">
                Why (kept in the record)
              </label>
              <input id="add-reason" name="reason" className="input" maxLength={300} required />
            </div>
          </div>
          <button type="submit" className="button" disabled={busy}>
            Add to the team
          </button>
        </Form>
      </section>

      {former.length > 0 && (
        <section className={styles.section} aria-labelledby="former-heading">
          <h2 id="former-heading">Formerly on the team</h2>
          <ul className={styles.rows}>
            {former.map((m) => (
              <li key={m.userId} className={styles.row}>
                <span className={styles.rowName}>{m.name}</span>
                <span className="muted">
                  {m.email} · until {when.format(new Date(m.endedAt ?? m.since))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
