import { data, Form, Link, redirect, useNavigation, useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { isUuid, SLUG } from '@/lib/ids.mjs';
import { REPORT_REASONS, REPORT_SENT, type ReportReason } from '@/lib/message-terms';
import { pageMeta } from '@/lib/meta';
import { TOO_FAST } from '@/lib/plan-terms';
import { found, refusal, siteUrl, tooFast } from '@/server/plan-pages.server';
import { businessChange, personChange } from '@/server/messages.server';
import { businessReportTarget, personReportTarget, sendReport } from '@/server/reports.server';
import type { Route } from './+types/report';
import styles from './member.module.css';

/**
 * Report a conversation, or one message in it, to the Localites team (Stage 2B part 2, E §4.3).
 * Two addresses, one page: /messages/<id>/report as the person, and
 * /vendors/<name>/messages/<id>/report as anyone on the business's team. The team then
 * reads the conversation through the report, and each look is logged.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Report'), { name: 'robots', content: 'noindex' }];

function where(params: { id?: string; slug?: string }) {
  if (!params.id || !isUuid(params.id) || (params.slug !== undefined && !SLUG.test(params.slug))) throw data(null, { status: 404 });
  const back = params.slug ? `/vendors/${params.slug}/messages/${params.id}` : `/messages/${params.id}`;
  return { id: params.id, slug: params.slug ?? null, back };
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { id, slug, back } = where(params);
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const messageParam = new URL(request.url).searchParams.get('message');
  const messageId = messageParam && isUuid(messageParam) ? messageParam : null;
  const target = await found(
    slug ? businessReportTarget(env, member.userId, slug, id, messageId) : personReportTarget(env, member.userId, id, messageId),
  );
  return { withName: target.withName, message: target.message, back };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const { id, slug, back } = where(params);
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const reason = String(form.get('reason') ?? '');
  if (!Object.hasOwn(REPORT_REASONS, reason)) return data({ error: 'Choose a reason.' }, { status: 400 });
  const details = String(form.get('details') ?? '').trim();
  if (details.length > 2000) return data({ error: 'Please keep it under 2,000 characters.' }, { status: 400 });
  const messageParam = String(form.get('messageId') ?? '');
  const messageId = isUuid(messageParam) ? messageParam : null;
  if (await tooFast(env, member.userId)) return data({ error: TOO_FAST }, { status: 429 });
  try {
    const acting = slug
      ? ({
          side: 'business',
          userId: member.userId,
          vendorId: (await businessReportTarget(env, member.userId, slug, id, messageId)).vendorId,
        } as const)
      : ({ side: 'person', userId: member.userId } as const);
    await sendReport(env, acting, id, { messageId, reason: reason as ReportReason, details: details || null }, siteUrl(env, request));
  } catch (err) {
    const { error, status } = refusal(err);
    return data({ error }, { status });
  }
  // "Also block this conversation" (scenario tests): best effort after the report is in. Staff
  // can't block for a business, and an already-blocked conversation stays as it is.
  // A block that didn't happen is said on the next page, not silently dropped (independent review).
  let blocked = '';
  if (form.get('block') === 'on') {
    try {
      if (slug) await businessChange(env, member.userId, slug, id, { kind: 'block' });
      else await personChange(env, member.userId, id, { kind: 'block' });
      blocked = '&blocked=1';
    } catch {
      blocked = '&blocked=0';
    }
  }
  return redirect(`${back}/report?sent=1${blocked}`);
}

export default function Report({ loaderData: { withName, message, back }, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== 'idle';
  const [params] = useSearchParams();
  if (params.has('sent')) {
    return (
      <>
        <SiteHeader />
        <main className="page narrow">
          <h1 className="title-1">Reported</h1>
          <div className="title-rule" aria-hidden="true" />
          <p role="status">{REPORT_SENT}</p>
          {params.get('blocked') === '1' ? (
            <p>The conversation is blocked too: {withName} can’t send any more messages in it. You can unblock it from the conversation.</p>
          ) : params.get('blocked') === '0' ? (
            <p className="notice" role="alert">
              The conversation couldn’t be blocked as well. It may be blocked already, and for a business only the owner or a manager can
              block. Your report was still sent.
            </p>
          ) : (
            <p>If you don’t want to hear from {withName} again, you can also block the conversation.</p>
          )}
          <p className="section-gap">
            <Link to={back} className="text-link">
              Back to the conversation
            </Link>
          </p>
        </main>
      </>
    );
  }
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">{message ? 'Report a message' : `Report this conversation`}</h1>
        <div className="title-rule" aria-hidden="true" />
        <p>
          Tell the Localites team what’s wrong. Because you reported it, our team can read this conversation with {withName}; otherwise
          nobody at Localites reads it. {withName} isn’t told who reported it.
        </p>
        {message && (
          <blockquote className="notice">
            <p dir="auto">{message.body}</p>
          </blockquote>
        )}
        {actionData?.error && (
          <p className="notice" role="alert">
            {actionData.error}
          </p>
        )}
        <Form method="post" noValidate>
          {message && <input type="hidden" name="messageId" value={message.id} />}
          <fieldset className={styles.choices}>
            <legend>What’s wrong?</legend>
            {Object.entries(REPORT_REASONS).map(([value, label]) => (
              <label key={value} className={styles.choice}>
                <input type="radio" name="reason" value={value} required /> {label}
              </label>
            ))}
          </fieldset>
          <div className="field">
            <label htmlFor="details" className="field-label">
              Anything else our team should know (optional)
            </label>
            <textarea id="details" name="details" className="input" maxLength={2000} />
          </div>
          <label className={styles.choice}>
            <input type="checkbox" name="block" /> Also block this conversation, so {withName} can’t send any more messages in it
          </label>
          <p className="section-gap">
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? 'Sending…' : 'Send report'}
            </button>
          </p>
        </Form>
        <p>
          <Link to={back} className="text-link">
            Back to the conversation
          </Link>
        </p>
      </main>
    </>
  );
}
