import { data, Form, redirect, useNavigation } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { type Account, AccountRefused, findAccount, liftSuspension, suspendAccount, suspendedAccounts } from '@/server/admin/accounts.server';
import { formFields } from '@/server/plan-pages.server';
import type { Route } from './+types/accounts';
import styles from './admin.module.css';

/**
 * Accounts: find someone's account by email, and suspend it or lift a suspension (migration
 * 0042). The database makes each change, refuses yourself, team members and deleted accounts,
 * and writes the audit log; each look-up is recorded too. A suspended person is turned away
 * on their next click (the gate checks on every request), but can still download their data
 * or delete their account (and then join again with a new account: a suspension isn't a ban).
 * The email searched for is sent in the form, never in the web address (no personal details
 * in logs or browser history).
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Accounts · Team'), { name: 'robots', content: 'noindex' }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const admin = context.get(adminContext);
  return { suspended: await suspendedAccounts(env, admin), saved: new URL(request.url).searchParams.get('saved') };
}

type Reply = { error?: string; email?: string; account?: Account | null };

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const admin = context.get(adminContext);
  const fields = formFields(await request.formData());
  const email = (fields.email ?? '').trim().slice(0, 320);
  const refuse = (error: string, status = 400) => data<Reply>({ error, email }, { status });
  if (fields.intent === 'find') {
    if (!email.includes('@')) return refuse('Type the email they sign in with.');
    return data<Reply>({ email, account: await findAccount(env, admin, email) });
  }
  const userId = fields.userId ?? '';
  const reason = (fields.reason ?? '').trim();
  if (!isUuid(userId)) return refuse('Unknown request.');
  if (!reason || reason.length > 300) return refuse('Say why, in up to 300 characters.');
  try {
    if (fields.intent === 'suspend') {
      await suspendAccount(env, admin, userId, reason);
      return redirect('/admin/accounts?saved=suspended');
    }
    if (fields.intent === 'lift') {
      await liftSuspension(env, admin, userId, reason);
      return redirect('/admin/accounts?saved=lifted');
    }
    return refuse('Unknown request.');
  } catch (err) {
    if (err instanceof AccountRefused) return refuse(err.message, 409);
    throw err;
  }
}

const SAVED: Record<string, string> = {
  suspended: 'Suspended. Their next click on a signed-in page takes them to a page saying so; they can still download their data or delete their account.',
  lifted: 'Suspension lifted. They can use their account again.',
};

const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeZone: 'America/Toronto' });

export default function Accounts({ loaderData, actionData }: Route.ComponentProps) {
  const { suspended, saved } = loaderData;
  const email = actionData?.email ?? '';
  const account = actionData?.account ?? null;
  const searched = actionData !== undefined && 'account' in actionData;
  const busy = useNavigation().state === 'submitting';
  return (
    <>
      <h1 className="title-1">Accounts</h1>
      <div className="title-rule" aria-hidden="true" />
      <p className="muted">
        Find an account by the email it signs in with. Suspending it closes every signed-in page for that person until it’s lifted. Their
        events, messages and reviews stay as they are. They can still delete their account and join again with a new one, so a suspension
        isn’t a ban. Every look-up, suspension and lift is recorded with who did it.
      </p>
      {saved && SAVED[saved] && !actionData && (
        <p className="notice" role="status">
          {SAVED[saved]}
        </p>
      )}
      {actionData?.error && (
        <p className="notice" role="alert">
          {actionData.error}
        </p>
      )}

      <section className={styles.section} aria-labelledby="find-heading">
        <h2 id="find-heading">Find an account</h2>
        <Form method="post" className={styles.form}>
          <input type="hidden" name="intent" value="find" />
          <div className="field">
            <label htmlFor="find-email" className="field-label">
              Their email
            </label>
            <input id="find-email" name="email" type="email" className="input" maxLength={320} defaultValue={email} autoComplete="off" required />
          </div>
          <button type="submit" className="button button-secondary">
            Find
          </button>
        </Form>
        {searched && !account && <p>No Localites account uses that email.</p>}
        {account && (
          <div className={styles.row}>
            <span className={styles.rowName}>{account.name}</span>
            <span className="muted">
              {account.email} · joined {when.format(new Date(account.joined))}
              {account.businesses.length > 0 ? ` · on the team of ${account.businesses.join(', ')}` : ''}
              {account.onTeam ? ' · on the Localites team' : ''}
            </span>
            {account.suspension ? (
              <>
                <p>
                  {`Suspended on ${when.format(new Date(account.suspension.at))} by ${account.suspension.by}: ${account.suspension.reason}`}
                </p>
                <Form method="post" className={styles.form}>
                  <input type="hidden" name="intent" value="lift" />
                  <input type="hidden" name="userId" value={account.userId} />
                  <div className="field">
                    <label htmlFor="lift-reason" className="field-label">
                      Why (kept in the record)
                    </label>
                    <input id="lift-reason" name="reason" className="input" maxLength={300} required />
                  </div>
                  <button type="submit" className="button button-secondary" disabled={busy}>
                    Lift the suspension
                  </button>
                </Form>
              </>
            ) : account.onTeam ? (
              <p className="muted">Team members can’t be suspended. Remove their team role on Users and roles first.</p>
            ) : (
              <Form method="post" className={styles.form}>
                <input type="hidden" name="intent" value="suspend" />
                <input type="hidden" name="userId" value={account.userId} />
                <div className="field">
                  <label htmlFor="suspend-reason" className="field-label">
                    Why (kept in the record; never shown to them)
                  </label>
                  <input id="suspend-reason" name="reason" className="input" maxLength={300} required />
                </div>
                <button type="submit" className="button" disabled={busy}>
                  Suspend {account.name}
                </button>
              </Form>
            )}
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="suspended-heading">
        <h2 id="suspended-heading">Suspended now ({suspended.length})</h2>
        {suspended.length === 0 ? (
          <p className="muted">Nobody is suspended.</p>
        ) : (
          <ul className={styles.rows}>
            {suspended.map((s) => (
              <li key={s.userId} className={styles.row}>
                <span className={styles.rowName}>{s.name}</span>
                <span className="muted">{`${s.email} · since ${when.format(new Date(s.at))}, by ${s.by}: ${s.reason}`}</span>
                <details>
                  <summary className="text-link">Lift the suspension</summary>
                  <Form method="post" className={styles.form}>
                    <input type="hidden" name="intent" value="lift" />
                    <input type="hidden" name="userId" value={s.userId} />
                    <div className="field">
                      <label htmlFor={`lift-${s.userId}`} className="field-label">
                        Why (kept in the record)
                      </label>
                      <input id={`lift-${s.userId}`} name="reason" className="input" maxLength={300} required />
                    </div>
                    <button type="submit" className="button button-secondary" disabled={busy}>
                      Lift {s.name}’s suspension
                    </button>
                  </Form>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
