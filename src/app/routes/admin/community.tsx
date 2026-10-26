import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { REPORT_REASONS } from '@/lib/community-terms';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { communityQueue, CommunityRefused, decidePost } from '@/server/community.server';
import type { Route } from './+types/community';
import styles from './admin.module.css';

/**
 * Community posts waiting for the team (D-62, migration 0061): ones the language check held
 * (only their author sees them until shown), and ones someone reported. Show it, or take it down;
 * its open reports are decided with it, and the audit log records who did which.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Community · Team'), { name: 'robots', content: 'noindex' }];

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  return { posts: await communityQueue(env, context.get(adminContext)) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const id = String(form.get('id') ?? '');
  const kind = String(form.get('kind') ?? '');
  const intent = String(form.get('intent') ?? '');
  if (!isUuid(id) || (kind !== 'question' && kind !== 'answer') || (intent !== 'show' && intent !== 'remove')) throw data(null, { status: 400 });
  const note = String(form.get('note') ?? '').trim().slice(0, 500) || null;
  try {
    await decidePost(env, context.get(adminContext), { kind, id }, intent, note);
  } catch (err) {
    if (err instanceof CommunityRefused) return data({ id, error: err.message }, { status: err.status });
    throw err;
  }
  return redirect('/admin/community');
}

const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' });

export default function TeamCommunity({ loaderData: { posts }, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state === 'submitting';
  return (
    <>
      <h1 className="title-1">Community</h1>
      <div className="title-rule" aria-hidden="true" />
      <p className="muted">
        Questions and answers the language check held (nobody but their author sees them yet), and ones someone reported (still
        showing). Show it, or take it down. Taking down a question hides its answers with it.
      </p>
      {posts.length === 0 ? (
        <p className="muted">Nothing waiting.</p>
      ) : (
        <ul className={styles.rows}>
          {posts.map((p) => (
            <li key={p.id} className={styles.row}>
              <span className={styles.rowName}>
                {p.kind === 'question' ? 'Question' : 'Answer'} ·{' '}
                {p.status === 'held' ? 'held by the language check' : p.status === 'removed' ? 'taken down' : 'showing'}
              </span>
              <span>
                On:{' '}
                {p.questionShown ? (
                  <Link to={`/community/${p.questionId}`} className="text-link">
                    {p.questionTitle}
                  </Link>
                ) : (
                  `${p.questionTitle} (not showing)`
                )}
              </span>
              {p.words && <span>“{p.words}”</span>}
              {p.business && <span>Business suggested: {p.business}</span>}
              <span className="muted">
                By {p.author} · {when.format(new Date(p.createdAt))}
              </span>
              {p.flag && <span className="muted">Why it was held: {p.flag}</span>}
              {p.reports.map((r) => (
                <span key={r.id}>
                  Reported: {REPORT_REASONS[r.reason]}
                  {r.details ? ` · “${r.details}”` : ''} · by {r.reporter}, {when.format(new Date(r.createdAt))}
                </span>
              ))}
              {actionData && 'id' in actionData && actionData.id === p.id && (
                <p className="notice" role="alert">
                  {actionData.error}
                </p>
              )}
              <Form method="post" className={styles.buttons}>
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="kind" value={p.kind} />
                <label htmlFor={`note-${p.id}`} className="visually-hidden">
                  Note for the team
                </label>
                <input id={`note-${p.id}`} name="note" className="input" placeholder="Note for the team (optional)" maxLength={500} />
                <button type="submit" name="intent" value="show" className="button button-secondary" disabled={busy}>
                  {p.status === 'shown' ? 'Keep it' : 'Show it'}
                </button>
                <button type="submit" name="intent" value="remove" className="button button-primary" disabled={busy}>
                  Take it down
                </button>
              </Form>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
