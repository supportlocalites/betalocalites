import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { MessageList, ReplyBox, useRefresh } from '@/components/MessageThread';
import { SiteHeader } from '@/components/SiteHeader';
import { isUuid, SLUG } from '@/lib/ids.mjs';
import { MESSAGE_REFUSALS, NO_PAYMENTS_IN_CONVERSATION, SHARE_CAREFULLY } from '@/lib/message-terms';
import { pageMeta } from '@/lib/meta';
import { cleanUpConversationFiles, filesOn, MAX_FILE_UPLOAD, readAttachment } from '@/server/conversation-files.server';
import { guestsWords, longDateWithYear, TOO_FAST } from '@/lib/plan-terms';
import { businessChange, businessReply, businessThread, emailAboutMessage, readBody } from '@/server/messages.server';
import { afterwards, found, refusal, siteUrl, tooFast } from '@/server/plan-pages.server';
import type { Route } from './+types/business-conversation';
import styles from './messages.module.css';
import { discardBody } from '@/server/discard-body';

/**
 * Screen V7: one conversation, as the business's team (Stage 2B). Anyone on the team
 * replies; owners and managers can block. If the person mentioned an event, the team sees
 * only D-40's summary: the date, the town and about how many guests.
 */
export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta(loaderData ? `Messages with ${loaderData.person}` : 'Messages'),
  { name: 'robots', content: 'noindex' },
];

export async function loader({ params, context }: Route.LoaderArgs) {
  if (!SLUG.test(params.slug) || !isUuid(params.id)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  return { ...(await found(businessThread(env, member.userId, params.slug, params.id))), canAttach: filesOn(env) };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  if (!SLUG.test(params.slug) || !isUuid(params.id)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env, ctx } = context.get(cloudflareContext);
  // A file is at most 4 MB: anything clearly bigger is refused before it's read.
  // Browsers always say how big a form is; one that doesn't isn't read either (security review).
  const size = request.headers.get('content-length');
  if (size === null || !/^\d{1,9}$/.test(size) || Number(size) > MAX_FILE_UPLOAD) {
    await discardBody(request);
    return data({ error: size === null ? MESSAGE_REFUSALS.notReceived : MESSAGE_REFUSALS.pdfTooBig }, { status: size === null ? 411 : 413 });
  }
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  if (await tooFast(env, member.userId)) return data({ error: TOO_FAST }, { status: 429 });
  const here = `/vendors/${params.slug}/messages/${params.id}`;
  try {
    if (intent === 'send') {
      const file = await readAttachment(form.get('file'));
      if (file && 'error' in file) return data({ error: file.error }, { status: 400 });
      const read = readBody(form, Boolean(file));
      if ('error' in read) return data({ error: read.error }, { status: 400 });
      const written = await businessReply(env, member.userId, params.slug, params.id, read.body, file);
      afterwards(
        ctx,
        emailAboutMessage(env, { side: 'business', userId: member.userId, vendorId: written.vendorId }, written, siteUrl(env, request)),
        'message email',
      );
      return redirect(`${here}?sent=${written.messageId}`);
    }
    if (intent === 'remove') {
      const messageId = String(form.get('messageId') ?? '');
      if (!isUuid(messageId)) throw data(null, { status: 400 });
      await businessChange(env, member.userId, params.slug, params.id, { kind: 'remove', messageId });
      afterwards(ctx, cleanUpConversationFiles(env, 2), 'file clean-up');
      return redirect(here);
    }
    if (intent === 'block' || intent === 'unblock') {
      await businessChange(env, member.userId, params.slug, params.id, { kind: intent });
      return redirect(here);
    }
    throw data(null, { status: 400 });
  } catch (err) {
    // Anything that isn't a refusal (including the 400s above) is rethrown by refusal().
    const { error, status } = refusal(err);
    return data({ error }, { status });
  }
}

export default function BusinessConversation({ loaderData, actionData }: Route.ComponentProps) {
  useRefresh(`/vendors/${loaderData.business.slug}/messages/${loaderData.id}/check`, loaderData.version);
  const error = actionData?.error;
  const busy = useNavigation().state === 'submitting';
  const { business, person, status, ended, event, messages } = loaderData;
  const canBlock = business.role !== 'staff' && !ended;
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <p>
          <Link to={`/vendors/${business.slug}/messages`} className="text-link">
            ← All messages
          </Link>
        </p>
        <p className="label">{business.name}</p>
        <h1 className="title-2">{person}</h1>
        {event && (
          <div className={styles.eventBox}>
            <span className="label">Their event</span>
            <span>
              {[longDateWithYear(event.date), event.town, guestsWords(event.guests)].filter(Boolean).join(' · ')}
              {event.cancelled ? ' · Cancelled' : ''}
            </span>
          </div>
        )}
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        <MessageList
          messages={messages}
          canRemove
          reportPath={`/vendors/${business.slug}/messages/${loaderData.id}/report`}
          filePath={`/vendors/${business.slug}/messages/${loaderData.id}/files`}
        />
        {status === 'open' && !ended && business.listed ? (
          <ReplyBox label={`Reply to ${person}`} busy={busy} canAttach={loaderData.canAttach} />
        ) : (
          <p className="notice" role="status">
            {ended
              ? 'This person has left Localites, so no new messages can be sent.'
              : !business.listed
                ? 'Your business isn’t listed on Localites at the moment, so messages are paused until it is.'
                : status === 'blocked_by_team'
                  ? 'The Localites team has closed this conversation, so no new messages can be sent.'
                  : status === 'blocked_by_vendor'
                    ? 'Your business blocked this conversation, so neither of you can send messages.'
                    : `${person} has blocked this conversation, so no new messages can be sent.`}
          </p>
        )}
        <div className={styles.footer}>
          <p className="muted">{NO_PAYMENTS_IN_CONVERSATION}</p>
          <p className="muted">{SHARE_CAREFULLY}</p>
          {canBlock && status === 'blocked_by_vendor' && (
            <Form method="post">
              <input type="hidden" name="intent" value="unblock" />
              <button type="submit" className={styles.textButton} disabled={busy}>
                Unblock this conversation
              </button>
            </Form>
          )}
          {canBlock && status === 'open' && (
            // A confirm step first (scenario tests): what blocking does, and what the person still sees.
            <details>
              <summary className={styles.textButton}>Block {person}</summary>
              <p className="muted">
                {person} won’t be able to send any more messages here. They’ll still see the conversation so far, and that your business
                blocked it. You can unblock it later.
              </p>
              <Form method="post">
                <input type="hidden" name="intent" value="block" />
                <button type="submit" className="button button-secondary" disabled={busy}>
                  Yes, block {person}
                </button>
              </Form>
            </details>
          )}
          <Link to={`/vendors/${business.slug}/messages/${loaderData.id}/report`} className={styles.textButton}>
            Report this conversation
          </Link>
        </div>
      </main>
    </>
  );
}
