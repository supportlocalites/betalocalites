import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { declineHeld, HeldRefused, heldEdits, publishHeld } from '@/server/admin/held-edits.server';
import { formFields } from '@/server/plan-pages.server';
import type { Route } from './+types/held-changes';
import styles from './admin.module.css';

/**
 * Owners' saves the language check held (D-50, migration 0036): what they changed and what
 * the check found. Put live (as the owner's own save) or decline with a reason; the owner is
 * emailed either way, and both are in the audit log.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Held changes · Team'), { name: 'robots', content: 'noindex' }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  return { cards: await heldEdits(env), done: new URL(request.url).searchParams.get('done') };
}

type Reply = { id: string; error: string };

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const admin = context.get(adminContext);
  const fields = formFields(await request.formData());
  const id = fields.id ?? '';
  const refuse = (error: string, status = 400) => data<Reply>({ id, error }, { status });
  if (!isUuid(id)) return refuse('Something on the page was out of date. Please reload it and try again.');
  try {
    if (fields.intent === 'publish') {
      await publishHeld(env, admin, id);
      return redirect('/admin/held-changes?done=published');
    }
    if (fields.intent === 'decline') {
      const reason = (fields.reason ?? '').trim();
      if (!reason || reason.length > 1000) return refuse('Say why, in up to 1,000 characters. The owner is emailed this.');
      await declineHeld(env, admin, id, reason);
      return redirect('/admin/held-changes?done=declined');
    }
    return refuse('Unknown request.');
  } catch (err) {
    if (err instanceof HeldRefused) return refuse(err.message, 409);
    throw err;
  }
}

const DONE: Record<string, string> = {
  published: 'Put live, and the owner was emailed.',
  declined: 'Declined, and the owner was emailed why.',
};
const STATUS: Record<string, string> = { published: 'Put live', declined: 'Declined', withdrawn: 'Withdrawn by the owner' };
const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' });

export default function HeldChanges({ loaderData, actionData }: Route.ComponentProps) {
  const { cards, done } = loaderData;
  const busy = useNavigation().state === 'submitting';
  const waiting = cards.filter((c) => c.status === 'waiting');
  const decided = cards.filter((c) => c.status !== 'waiting');
  return (
    <>
      <h1 className="title-1">Held changes</h1>
      <div className="title-rule" aria-hidden="true" />
      <p className="muted">
        Changes owners saved that the language check held: a word list, and Cloudflare’s AI checker for hate, threats and sexual content.
        Nothing here is live. Put a change live if it’s fine (it’s saved as the owner’s own change), or decline it with a reason the owner
        is emailed.
      </p>
      {done && DONE[done] && !actionData && (
        <p className="notice" role="status">
          {DONE[done]}
        </p>
      )}
      <h2 className="label section-gap">Waiting ({waiting.length})</h2>
      {waiting.length === 0 ? (
        <p className="muted">Nothing waiting.</p>
      ) : (
        <ul className={styles.rows}>
          {waiting.map((c) => (
            <li key={c.id} className={styles.row}>
              <span className={styles.rowName}>
                <Link to={`/admin/listings/${c.vendorId}`}>{c.business}</Link>
              </span>
              <span className="muted">{`${c.owner ?? 'A removed account'} · ${when.format(new Date(c.at))}${c.emailStatus === 'skipped' ? ' · no email (the day’s limit)' : ''}`}</span>
              <span>{`What the check found: ${c.reason}`}</span>
              <ul className={styles.history}>
                {c.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              {actionData && actionData.id === c.id && (
                <p className="notice" role="alert">
                  {actionData.error}
                </p>
              )}
              <div className={styles.buttons}>
                <Form method="post">
                  <input type="hidden" name="intent" value="publish" />
                  <input type="hidden" name="id" value={c.id} />
                  <button type="submit" className="button button-secondary" disabled={busy}>
                    Put live
                  </button>
                </Form>
              </div>
              <Form method="post" className={styles.form}>
                <input type="hidden" name="intent" value="decline" />
                <input type="hidden" name="id" value={c.id} />
                <div className="field">
                  <label htmlFor={`reason-${c.id}`} className="field-label">
                    Or decline it. Why (the owner is emailed this)
                  </label>
                  <input id={`reason-${c.id}`} name="reason" className="input" maxLength={1000} required />
                </div>
                <button type="submit" className="button button-secondary" disabled={busy}>
                  Decline
                </button>
              </Form>
            </li>
          ))}
        </ul>
      )}
      {decided.length > 0 && (
        <>
          <h2 className="label section-gap">The last 30 days</h2>
          <ul className={styles.rows}>
            {decided.map((c) => (
              <li key={c.id} className={styles.row}>
                <span className={styles.rowName}>{c.business}</span>
                <span className="muted">
                  {`${STATUS[c.status] ?? c.status}${c.decidedBy ? ` by ${c.decidedBy}` : ''}${c.decidedAt ? `, ${when.format(new Date(c.decidedAt))}` : ''}`}
                </span>
                {c.decisionReason && <span>{`Why: ${c.decisionReason}`}</span>}
                <span className="muted">{`What the check found: ${c.reason}`}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
