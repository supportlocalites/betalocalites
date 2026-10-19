import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { isUuid } from '@/lib/ids.mjs';
import { REPORT_REASONS } from '@/lib/message-terms';
import { pageMeta } from '@/lib/meta';
import { PlanRefused } from '@/server/acting.server';
import { decideReport, emailReportOutcome, reportDetail } from '@/server/reports.server';
import { afterwards, found } from '@/server/plan-pages.server';
import type { Route } from './+types/report';
import styles from './admin.module.css';

/**
 * One report (X13): the reported conversation, read only through it; the database writes
 * each look to the audit log with the report. The team can hide the reported message, block
 * or unblock the conversation, and close the report as dealt with or dismissed, with a note.
 * Every decision is recorded.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Report · Team'), { name: 'robots', content: 'noindex' }];

export async function loader({ params, context }: Route.LoaderArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const { env } = context.get(cloudflareContext);
  return { report: await found(reportDetail(env, context.get(adminContext), params.id)) };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const { env, ctx } = context.get(cloudflareContext);
  const admin = context.get(adminContext);
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  if (intent === 'hide' || intent === 'block' || intent === 'unblock') {
    try {
      await found(decideReport(env, admin, params.id, { kind: intent }));
    } catch (err) {
      if (err instanceof PlanRefused) return data({ error: err.message }, { status: 409 });
      throw err;
    }
  } else if (intent === 'actioned' || intent === 'dismissed') {
    const note = String(form.get('note') ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1000);
    if (!note) return data({ error: 'Write a note: what you did, or why it needs nothing.' }, { status: 400 });
    const closed = await found(decideReport(env, admin, params.id, { kind: 'close', outcome: intent, note }));
    // The person who reported it is told the outcome, never the note (M7, D-54).
    if (closed) afterwards(ctx, emailReportOutcome(env, params.id, closed), 'report outcome email');
  } else {
    throw data(null, { status: 400 });
  }
  return redirect(`/admin/reports/${params.id}`);
}

const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' });

export default function ReportPage({ loaderData: { report }, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state === 'submitting';
  const reported = report.messages.find((m) => m.reported);
  const blockedByTeam = report.conversationStatus === 'blocked_by_team';
  return (
    <>
      <Link to="/admin/reports" className="text-link">
        ← All reports
      </Link>
      <h1 className="title-1 section-gap">{REPORT_REASONS[report.reason]}</h1>
      <div className="title-rule" aria-hidden="true" />
      <p>
        {report.aboutMessage ? 'A message' : 'The conversation'} between {report.person} and {report.business}, reported by{' '}
        {report.reporter} ({report.reporterSide === 'consumer' ? 'the customer' : 'the business'}) on{' '}
        {when.format(new Date(report.createdAt))}.
      </p>
      {report.details && <p>“{report.details}”</p>}
      <p className="muted">This look is recorded in the audit log, with this report.</p>
      {actionData?.error && (
        <p className="notice" role="alert">
          {actionData.error}
        </p>
      )}

      <section className={styles.section} aria-labelledby="conversation">
        <h2 id="conversation">The conversation</h2>
        <ol className={styles.rows}>
          {report.messages.map((m) => (
            <li key={m.id} className={styles.row}>
              <span className="muted">
                {m.author} ({m.side === 'consumer' ? 'customer' : 'business'}) · {when.format(new Date(m.createdAt))}
                {m.reported ? ' · Reported' : ''}
                {m.hidden ? ' · Hidden by the team' : ''}
                {m.removed
                  ? m.body
                    ? ' · Removed by its author after the report (its words kept for you)'
                    : ' · Removed by its author'
                  : ''}
              </span>
              <span dir="auto">{m.removed && !m.body ? <span className="muted">(removed)</span> : m.body}</span>
              {m.versions.map((v) => (
                <span key={v.replacedAt} className="muted" dir="auto">
                  Before {when.format(new Date(v.replacedAt))} it said: “{v.body}”
                </span>
              ))}
              {m.file &&
                (m.file.gone ? (
                  <span className="muted">
                    {m.file.isPhoto ? 'Photo' : 'PDF'} “{m.file.name}” (deleted, not kept for this report)
                  </span>
                ) : (
                  <a href={`/admin/reports/${report.id}/files/${m.file.id}`} className="text-link" target="_blank" rel="noopener">
                    Open the {m.file.isPhoto ? 'photo' : 'PDF'} “{m.file.name}” (each look is recorded)
                  </a>
                ))}
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.section} aria-labelledby="decide">
        <h2 id="decide">Decide</h2>
        <p>
          Conversation:{' '}
          <span className={styles.status}>
            {blockedByTeam ? 'Blocked by the team' : report.conversationStatus === 'open' ? 'Open' : 'Blocked by one side'}
          </span>
          {report.status !== 'open' && (
            <>
              {' '}
              · Report: <span className={styles.status}>{report.status === 'actioned' ? 'Dealt with' : 'Dismissed'}</span>
              {report.decisionNote ? ` (“${report.decisionNote}”)` : ''}
            </>
          )}
        </p>
        <div className={styles.statusPanel}>
          {reported && !reported.hidden && !reported.removed && (
            <Form method="post">
              <input type="hidden" name="intent" value="hide" />
              <button type="submit" className="button button-secondary" disabled={busy}>
                Hide the reported message
              </button>
            </Form>
          )}
          <Form method="post">
            <input type="hidden" name="intent" value={blockedByTeam ? 'unblock' : 'block'} />
            <button type="submit" className="button button-secondary" disabled={busy}>
              {blockedByTeam ? 'Unblock the conversation' : 'Block the conversation'}
            </button>
          </Form>
        </div>
        {report.status === 'open' && (
          <Form method="post" className={styles.statusPanel}>
            <div className={`field ${styles.reasonField}`}>
              <label htmlFor="note" className="field-label">
                Note (kept with the report)
              </label>
              <input id="note" name="note" className="input" maxLength={1000} required />
            </div>
            <button type="submit" name="intent" value="actioned" className="button button-primary" disabled={busy}>
              Close: dealt with
            </button>
            <button type="submit" name="intent" value="dismissed" className="button button-secondary" disabled={busy}>
              Close: nothing to do
            </button>
          </Form>
        )}
      </section>
    </>
  );
}
