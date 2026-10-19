import { data, Form, Link, redirect, useNavigation, useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { isUuid, SLUG } from '@/lib/ids.mjs';
import { REPORT_REASONS, type ReportReason } from '@/lib/message-terms';
import { pageMeta } from '@/lib/meta';
import { TOO_FAST } from '@/lib/plan-terms';
import { businessInbox } from '@/server/messages.server';
import { found, refusal, siteUrl, tooFast } from '@/server/plan-pages.server';
import { deletedConversations, reportDeleted } from '@/server/reports.server';
import type { Route } from './+types/business-messages';
import styles from './messages.module.css';

/**
 * Screen V6: a business's messages (Stage 2B). Anyone on its team (owner, manager or staff),
 * checked in the database on every request; anyone else gets "not found". Each team
 * member's unread count is their own.
 */
export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta(loaderData ? `Messages · ${loaderData.business.name}` : 'Messages'),
  { name: 'robots', content: 'noindex' },
];

export async function loader({ params, context }: Route.LoaderArgs) {
  if (!SLUG.test(params.slug)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const inbox = await found(businessInbox(env, member.userId, params.slug));
  return { ...inbox, deleted: await deletedConversations(env, member.userId, params.slug) };
}

/** Reporting a conversation the person deleted (D-54): the team reads it through the report; the business can't. */
export async function action({ request, params, context }: Route.ActionArgs) {
  if (!SLUG.test(params.slug)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const conversationId = String(form.get('conversationId') ?? '');
  const reason = String(form.get('reason') ?? '');
  if (!isUuid(conversationId)) throw data(null, { status: 400 });
  if (!Object.hasOwn(REPORT_REASONS, reason)) return data({ error: 'Choose a reason.' }, { status: 400 });
  const details = String(form.get('details') ?? '').trim();
  if (details.length > 2000) return data({ error: 'Please keep it under 2,000 characters.' }, { status: 400 });
  if (await tooFast(env, member.userId)) return data({ error: TOO_FAST }, { status: 429 });
  try {
    await reportDeleted(env, member.userId, params.slug, conversationId, { reason: reason as ReportReason, details: details || null }, siteUrl(env, request));
  } catch (err) {
    const { error, status } = refusal(err);
    return data({ error }, { status });
  }
  return redirect(`/vendors/${params.slug}/messages?reported=1`);
}

const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeZone: 'America/Toronto' });

export default function BusinessMessages({ loaderData: { business, conversations, deleted }, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== 'idle';
  const reported = useSearchParams()[0].has('reported');
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <p>
          <Link to="/business" className="text-link">
            ← My business
          </Link>
        </p>
        <p className="label">{business.name}</p>
        <h1 className="title-1">Messages</h1>
        <div className="title-rule" aria-hidden="true" />
        {!business.listed && (
          <p className="notice" role="status">
            Your business isn’t listed on Localites at the moment, so messages are paused: you can read them, but neither side can send any
            until it’s listed again.
          </p>
        )}
        {actionData?.error && (
          <p className="notice" role="alert">
            {actionData.error}
          </p>
        )}
        {reported && (
          <p className="notice" role="status">
            Thanks. Our team will look at it.
          </p>
        )}
        {conversations.length === 0 ? (
          <p>No messages yet. People who find you on Localites can message you from your page; you’ll be emailed when they do.</p>
        ) : (
          <ul className={styles.inbox}>
            {conversations.map((c) => (
              <li key={c.id}>
                <Link to={`/vendors/${business.slug}/messages/${c.id}`} className={styles.card}>
                  <span className={styles.cardBody}>
                    <span className={styles.name}>{c.person}</span>
                    {c.snippet && (
                      <span className={styles.snippet}>
                        {c.lastFromUs ? 'Your team: ' : ''}
                        {c.snippet}
                      </span>
                    )}
                    {(c.blocked || c.ended) && <span className={styles.snippet}>{c.ended ? 'Left Localites' : 'Blocked'}</span>}
                  </span>
                  <span className={styles.cardBody}>
                    {c.lastMessageAt && <span className={styles.when}>{when.format(new Date(c.lastMessageAt))}</span>}
                    {c.unread > 0 && (
                      <span className={styles.unread} aria-label={`${c.unread} new`}>
                        {c.unread}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {deleted.length > 0 && (
          // D-54: the person deleted it, so it's gone for both sides; for 30 days it can still be reported.
          <section className="section-gap" aria-labelledby="deleted">
            <h2 id="deleted" className="label">
              Deleted by the customer
            </h2>
            <ul className={styles.inbox}>
              {deleted.map((d) => (
                <li key={d.id} className={styles.card}>
                  <span className={styles.cardBody}>
                    <span className={styles.name}>{d.person}</span>
                    <span className={styles.snippet}>
                      Deleted this conversation on {when.format(new Date(d.deletedAt))}, so neither of you can see it now.
                    </span>
                    {d.reported ? (
                      <span className={styles.snippet}>You reported it. Our team will look at it.</span>
                    ) : (
                      <details>
                        <summary className={styles.textButton}>Report it</summary>
                        <Form method="post">
                          <input type="hidden" name="conversationId" value={d.id} />
                          <p className="muted">If something in it broke our rules, our team can still read it for 30 days after it was deleted.</p>
                          <label htmlFor={`reason-${d.id}`} className="field-label">
                            Why?
                          </label>
                          <select id={`reason-${d.id}`} name="reason" className="input" defaultValue="" required>
                            <option value="" disabled>
                              Choose a reason
                            </option>
                            {Object.entries(REPORT_REASONS).map(([k, label]) => (
                              <option key={k} value={k}>
                                {label}
                              </option>
                            ))}
                          </select>
                          <label htmlFor={`details-${d.id}`} className="field-label">
                            Anything else? (optional)
                          </label>
                          <textarea id={`details-${d.id}`} name="details" className="input" maxLength={2000} />
                          <button type="submit" className="button button-secondary" disabled={busy}>
                            Send the report
                          </button>
                        </Form>
                      </details>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
