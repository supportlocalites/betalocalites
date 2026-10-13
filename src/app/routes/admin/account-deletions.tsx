import { data, Form, useNavigation } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { accountDeletions, markSignInRemoved } from '@/server/account-deletion.server';
import type { Route } from './+types/account-deletions';
import styles from './admin.module.css';

/**
 * People who deleted their account (E §8). Our data is already erased; the team removes
 * each person's sign-in record in Supabase by hand, within 30 days, then marks it done here
 * (recorded in the audit log). The page shows only an account's id: nothing personal is left.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Deleted accounts · Team'), { name: 'robots', content: 'noindex' }];

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  return { rows: await accountDeletions(env, context.get(adminContext)) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const userId = String(form.get('userId') ?? '');
  if (form.get('intent') !== 'done' || !isUuid(userId)) throw data(null, { status: 400 });
  const done = await markSignInRemoved(env, context.get(adminContext), userId);
  return { done };
}

const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeZone: 'America/Toronto' });
const DAY = 24 * 60 * 60 * 1000;

export default function AccountDeletions({ loaderData: { rows } }: Route.ComponentProps) {
  const busy = useNavigation().state !== 'idle';
  return (
    <>
      <h1 className="title-1">Deleted accounts</h1>
      <div className="title-rule" aria-hidden="true" />
      <p className="notice">
        These people deleted their Localites account. Everything of theirs in our database is already erased. One step is left for each: in
        Supabase, open <strong>Authentication → Users</strong>, search for the account id below, and delete that user. Then click{' '}
        <strong>Done</strong> here. Please do it within 30 days of the request.
      </p>
      {rows.length === 0 ? (
        <p className="muted">No deleted accounts.</p>
      ) : (
        <ul className={styles.rows}>
          {rows.map((r) => {
            const due = new Date(new Date(r.requestedAt).getTime() + 30 * DAY);
            return (
              <li key={r.userId} className={styles.row}>
                <span className={styles.rowName}>
                  <code>{r.userId}</code>
                </span>
                <span className="muted">Deleted {when.format(new Date(r.requestedAt))}</span>
                {r.removedAt ? (
                  <span className="muted">
                    Sign-in record removed {when.format(new Date(r.removedAt))}
                    {r.removedBy ? ` by ${r.removedBy}` : ''}
                  </span>
                ) : (
                  <Form method="post">
                    <input type="hidden" name="intent" value="done" />
                    <input type="hidden" name="userId" value={r.userId} />
                    <span className="muted">Remove the sign-in record by {when.format(due)}. </span>
                    <button type="submit" className="button button-secondary" disabled={busy}>
                      Done
                    </button>
                  </Form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
