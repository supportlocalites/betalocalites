import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { decideRemoval, listRemovals, RequestRefused } from '@/server/business-requests.server';
import type { Route } from './+types/removals';
import styles from './admin.module.css';

/**
 * Owners asking us to take their business off Localites (D-63). Nothing happens on its own:
 * check who it affects, talk to the owner, archive the listing on its page, then mark it done.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Removal requests · Team'), { name: 'robots', content: 'noindex' }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const show = new URL(request.url).searchParams.get('show') === 'all' ? 'all' : 'open';
  const { env } = context.get(cloudflareContext);
  return { show, requests: await listRemovals(env, context.get(adminContext), show) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const admin = context.get(adminContext);
  const form = await request.formData();
  const id = String(form.get('id') ?? '');
  const intent = String(form.get('intent') ?? '');
  if (!isUuid(id) || (intent !== 'done' && intent !== 'declined')) throw data(null, { status: 400 });
  const note = String(form.get('note') ?? '').trim().slice(0, 500) || null;
  try {
    await decideRemoval(env, admin, id, intent, note);
  } catch (err) {
    if (err instanceof RequestRefused) return data({ id, error: err.message }, { status: 409 });
    throw err;
  }
  return redirect('/admin/removals');
}

const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' });
const OUTCOME = { new: 'Waiting', done: 'Removed', declined: 'Not removed', withdrawn: 'Withdrawn by the owner' } as const;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function Removals({ loaderData: { show, requests }, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state === 'submitting';
  return (
    <>
      <h1 className="title-1">Removal requests</h1>
      <div className="title-rule" aria-hidden="true" />
      <p className="muted">
        Owners asking us to take their business off Localites (D-63). We told them our team will be in touch. Check who it
        affects, speak to the owner, then archive the listing on its page and mark the request done. Or decline it, with a note.
      </p>
      <p>
        {show === 'open' ? (
          <Link to="?show=all" className="text-link">
            Show all, including dealt with
          </Link>
        ) : (
          <Link to="?" className="text-link">
            Show waiting only
          </Link>
        )}
      </p>
      {requests.length === 0 ? (
        <p className="muted">{show === 'open' ? 'No requests waiting.' : 'No requests yet.'}</p>
      ) : (
        <ul className={styles.rows}>
          {requests.map((r) => (
            <li key={r.id} id={`r-${r.id}`} className={styles.row}>
              <span className={styles.rowName}>
                <Link to={`/admin/listings/${r.vendor.id}`}>{r.vendor.name}</Link>
              </span>
              <span className="muted">
                <span className={styles.status}>{OUTCOME[r.status]}</span> · asked {when.format(new Date(r.createdAt))} · listing is{' '}
                {r.vendor.status}
              </span>
              <span>
                Asked by:{' '}
                {r.person ? (
                  <>
                    {`${r.person.name} <${r.person.email}>`}
                    {!r.person.stillOwner && <strong> · no longer the owner</strong>}
                  </>
                ) : (
                  <span className="muted">an account since deleted</span>
                )}
              </span>
              {r.reason && <span>Their reason: “{r.reason}”</span>}
              <span>
                {`It would affect: ${plural(r.affects.team, 'person on its team', 'people on its team')}, ${plural(r.affects.conversations, 'conversation', 'conversations')} active in the last 90 days, ${plural(r.affects.bookings, 'upcoming booking', 'upcoming bookings')}, saved by ${plural(r.affects.saved, 'person', 'people')}.`}
              </span>
              {r.status !== 'new' ? (
                <span className="muted">
                  {r.decisionNote && <>Note: “{r.decisionNote}” · </>}
                  {r.decidedBy ? `by ${r.decidedBy}` : ''}
                </span>
              ) : (
                <>
                  {actionData && 'id' in actionData && actionData.id === r.id && (
                    <p className="notice" role="alert">
                      {actionData.error}
                    </p>
                  )}
                  <Form method="post" className={styles.buttons}>
                    <input type="hidden" name="id" value={r.id} />
                    <label htmlFor={`note-${r.id}`} className="visually-hidden">
                      Note for the team
                    </label>
                    <input id={`note-${r.id}`} name="note" className="input" placeholder="Note, e.g. spoke to them 12 Nov" maxLength={500} />
                    <button type="submit" name="intent" value="done" className="button button-primary" disabled={busy || r.vendor.status !== 'archived'}>
                      Mark done
                    </button>
                    <button type="submit" name="intent" value="declined" className="button button-secondary" disabled={busy}>
                      Decline
                    </button>
                  </Form>
                  {r.vendor.status !== 'archived' && <span className="muted">Archive the listing on its page first; then Mark done.</span>}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
