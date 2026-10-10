import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { decline, listSuggestions, markDuplicate, SuggestionConflict } from '@/server/suggestions.server';
import type { Route } from './+types/suggestions';
import styles from './admin.module.css';

/** Screen X19: suggested businesses (D-25). The team vets each one. */
export const meta: Route.MetaFunction = () => [...pageMeta('Suggested businesses · Team'), { name: 'robots', content: 'noindex' }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const show = new URL(request.url).searchParams.get('show') === 'all' ? 'all' : 'new';
  const { env } = context.get(cloudflareContext);
  return { show, suggestions: await listSuggestions(env, show), emailReady: Boolean(env.RESEND_API_KEY) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const admin = context.get(adminContext);
  const form = await request.formData();
  const id = String(form.get('id') ?? '');
  const intent = String(form.get('intent') ?? '');
  if (!isUuid(id)) throw data(null, { status: 400 });
  try {
    if (intent === 'duplicate') {
      const vendorId = String(form.get('vendorId') ?? '');
      if (!isUuid(vendorId)) return data({ id, error: 'Choose the listing it matches.' }, { status: 400 });
      await markDuplicate(env, admin, id, vendorId);
    } else if (intent === 'decline') {
      const reason = String(form.get('reason') ?? '').trim().slice(0, 500);
      if (!reason) return data({ id, error: 'Give a short reason (kept for the team only).' }, { status: 400 });
      await decline(env, admin, id, reason);
    } else {
      return data({ id, error: 'Unknown request.' }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof SuggestionConflict) return data({ id, error: err.message }, { status: 409 });
    throw err;
  }
  return redirect('/admin/suggestions');
}

const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' });
const OUTCOME = { added: 'Added', duplicate: 'Already on Localites', declined: 'Declined', new: 'New' } as const;

export default function Suggestions({ loaderData, actionData }: Route.ComponentProps) {
  const { show, suggestions, emailReady } = loaderData;
  const busy = useNavigation().state === 'submitting';
  return (
    <>
      <h1 className="title-1">Suggested businesses</h1>
      <div className="title-rule" aria-hidden="true" />
      <p className="muted">
        Suggestions from the public (D-25). Use the phone number or email only to find and contact the business; never
        publish it. A business goes live only from its own public information.
      </p>
      {!emailReady && (
        <p className="notice">Email isn’t set up yet (PO-12), so new suggestions appear here without an email to the team.</p>
      )}
      <p>
        {show === 'new' ? (
          <Link to="?show=all" className="text-link">
            Show all, including dealt with
          </Link>
        ) : (
          <Link to="?" className="text-link">
            Show new only
          </Link>
        )}
      </p>
      {suggestions.length === 0 ? (
        <p className="muted">{show === 'new' ? 'No new suggestions.' : 'No suggestions yet.'}</p>
      ) : (
        <ul className={styles.rows}>
          {suggestions.map((s) => (
            <li key={s.id} id={`s-${s.id}`} className={styles.row}>
              <span className={styles.rowName}>{s.businessName}</span>
              <span className="muted">
                <span className={styles.status}>{OUTCOME[s.status]}</span> · {when.format(new Date(s.createdAt))}
                {s.where ? ` · looking at ${s.where}` : ''} · email to team:{' '}
                {s.emailStatus === 'sent' ? 'sent' : s.emailStatus === 'failed' ? `failed (${s.emailError})` : 'waiting'}
              </span>
              <span>
                Website or social page:{' '}
                {s.website ? (
                  /^https?:\/\//i.test(s.website) ? (
                    <a href={s.website} target="_blank" rel="noopener noreferrer nofollow">
                      {s.website}
                    </a>
                  ) : (
                    s.website
                  )
                ) : (
                  <span className="muted">not given</span>
                )}
              </span>
              <span>
                Phone or email (team only): {s.contact ?? <span className="muted">not given</span>}
              </span>
              {s.status !== 'new' ? (
                <span className="muted">
                  {s.vendorId && (
                    <>
                      Listing: <Link to={`/admin/listings/${s.vendorId}`}>{s.vendorName}</Link> ·{' '}
                    </>
                  )}
                  {s.declineReason && <>Reason: “{s.declineReason}” · </>}
                  by {s.reviewedBy ?? 'the team'}
                </span>
              ) : (
                <>
                  {s.matches.length > 0 && (
                    <span className="muted">
                      Possibly already on Localites:{' '}
                      {s.matches.map((m, i) => (
                        <span key={m.id}>
                          {i > 0 && ', '}
                          <Link to={`/admin/listings/${m.id}`}>{m.name}</Link>
                        </span>
                      ))}
                    </span>
                  )}
                  {actionData && 'id' in actionData && actionData.id === s.id && (
                    <p className="notice" role="alert">
                      {actionData.error}
                    </p>
                  )}
                  <div className={styles.buttons}>
                    <Link to={`/admin/listings/new?suggestion=${s.id}`} className="button button-primary">
                      Add as a draft listing
                    </Link>
                  </div>
                  {s.matches.length > 0 && (
                    <Form method="post" className={styles.buttons}>
                      <input type="hidden" name="intent" value="duplicate" />
                      <input type="hidden" name="id" value={s.id} />
                      <label htmlFor={`dup-${s.id}`} className="visually-hidden">
                        Which listing it matches
                      </label>
                      <select id={`dup-${s.id}`} name="vendorId" className="input" defaultValue="">
                        <option value="">It’s already listed as…</option>
                        {s.matches.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="button button-secondary" disabled={busy}>
                        Mark as already listed
                      </button>
                    </Form>
                  )}
                  <Form method="post" className={styles.buttons}>
                    <input type="hidden" name="intent" value="decline" />
                    <input type="hidden" name="id" value={s.id} />
                    <label htmlFor={`why-${s.id}`} className="visually-hidden">
                      Reason for declining
                    </label>
                    <input id={`why-${s.id}`} name="reason" className="input" placeholder="Reason, e.g. not in our area" maxLength={500} />
                    <button type="submit" className="button button-secondary" disabled={busy}>
                      Decline
                    </button>
                  </Form>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
