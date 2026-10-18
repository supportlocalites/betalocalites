import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { MessageList, ReplyBox, useRefresh } from '@/components/MessageThread';
import { SiteHeader } from '@/components/SiteHeader';
import { SquarePhoto } from '@/components/SquarePhoto';
import { isUuid } from '@/lib/ids.mjs';
import { MESSAGE_REFUSALS, NO_PAYMENTS_IN_CONVERSATION, SHARE_CAREFULLY } from '@/lib/message-terms';
import { pageMeta } from '@/lib/meta';
import { cleanUpConversationFiles, filesOn, MAX_FILE_UPLOAD, readAttachment } from '@/server/conversation-files.server';
import { shortDate, TOO_FAST } from '@/lib/plan-terms';
import { emailAboutMessage, personChange, personSend, personThread, readBody } from '@/server/messages.server';
import { afterwards, found, refusal, siteUrl, todayIso, tooFast } from '@/server/plan-pages.server';
import type { Route } from './+types/conversation';
import styles from './messages.module.css';
import { discardBody } from '@/server/discard-body';

/**
 * Screen C8: one conversation, as the person (Stage 2B). Only their own: anyone else's is
 * "not found". Opening it marks it read for them (their own unread count, never shown to
 * the business). They can mention one of their events, block, and remove their own messages.
 */
export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta(loaderData ? `Messages with ${loaderData.thread.vendor.name}` : 'Messages'),
  { name: 'robots', content: 'noindex' },
];

export async function loader({ params, context }: Route.LoaderArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  return { thread: await found(personThread(env, member.userId, params.id)), today: todayIso(), canAttach: filesOn(env) };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
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
  const here = `/messages/${params.id}`;
  try {
    if (intent === 'send') {
      const file = await readAttachment(form.get('file'));
      if (file && 'error' in file) return data({ error: file.error }, { status: 400 });
      const read = readBody(form, Boolean(file));
      if ('error' in read) return data({ error: read.error }, { status: 400 });
      const written = await personSend(env, member.userId, params.id, read.body, file);
      afterwards(ctx, emailAboutMessage(env, { side: 'person', userId: member.userId }, written, siteUrl(env, request)), 'message email');
      return redirect(`${here}?sent=${written.messageId}`);
    }
    if (intent === 'remove') {
      const messageId = String(form.get('messageId') ?? '');
      if (!isUuid(messageId)) throw data(null, { status: 400 });
      await personChange(env, member.userId, params.id, { kind: 'remove', messageId });
      afterwards(ctx, cleanUpConversationFiles(env, 2), 'file clean-up');
      return redirect(here);
    }
    if (intent === 'block' || intent === 'unblock') {
      await personChange(env, member.userId, params.id, { kind: intent });
      return redirect(here);
    }
    if (intent === 'event') {
      const eventId = String(form.get('eventId') ?? '');
      if (eventId && !isUuid(eventId)) throw data(null, { status: 400 });
      await personChange(env, member.userId, params.id, { kind: 'event', eventId: eventId || null });
      return redirect(here);
    }
    throw data(null, { status: 400 });
  } catch (err) {
    // Anything that isn't a refusal (including the 400s above) is rethrown by refusal().
    const { error, status } = refusal(err);
    return data({ error }, { status });
  }
}

export default function Conversation({ loaderData: { thread, today, canAttach }, actionData }: Route.ComponentProps) {
  useRefresh(`/messages/${thread.id}/check`, thread.version);
  const error = actionData?.error;
  const busy = useNavigation().state === 'submitting';
  const { vendor, status } = thread;
  const canWrite = status === 'open' && !vendor.left && !vendor.paused;
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <p>
          <Link to="/messages" className="text-link">
            ← All messages
          </Link>
        </p>
        <div className={`${styles.card} ${styles.withPhoto}`}>
          <SquarePhoto photo={vendor.photo} alt="" />
          <span className={styles.cardBody}>
            <h1 className="title-2">{vendor.name}</h1>
            {!vendor.left && !vendor.paused && (
              <Link to={`/vendors/${vendor.slug}`} className="text-link">
                See their page
              </Link>
            )}
          </span>
        </div>

        {!vendor.left && (
          <Form method="post" className={styles.eventBox}>
            <input type="hidden" name="intent" value="event" />
            <label htmlFor="eventId" className="field-label">
              About one of your events (optional)
            </label>
            <select id="eventId" name="eventId" className="input" defaultValue={thread.event?.id ?? ''}>
              <option value="">No event</option>
              {thread.events.map((e) => (
                <option key={e.id} value={e.id}>
                  {`${e.name} · ${shortDate(e.date, today)}`}
                </option>
              ))}
            </select>
            <p className="field-hint">
              {vendor.name} sees only the date, the town and about how many guests. Never your event’s name, where it is, the ages, your
              budget or your notes.
            </p>
            <p>
              <button type="submit" className="button button-secondary" disabled={busy}>
                Save
              </button>
            </p>
          </Form>
        )}

        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        <MessageList
          messages={thread.messages}
          canRemove
          reportPath={`/messages/${thread.id}/report`}
          filePath={`/messages/${thread.id}/files`}
        />
        {canWrite ? (
          <ReplyBox label={`Message ${vendor.name}`} busy={busy} canAttach={canAttach} />
        ) : (
          <p className="notice" role="status">
            {vendor.rejoined ? (
              <>
                This conversation has ended: {vendor.name} left Localites, and has since joined again.{' '}
                <Link to={`/vendors/${vendor.slug}/message`} className="text-link">
                  Message {vendor.name} afresh
                </Link>
              </>
            ) : thread.ended ? (
              `${vendor.name} left Localites, so this conversation has ended. If they join again, you can message them afresh.`
            ) : vendor.left ? (
              `${vendor.name} isn’t on Localites at the moment, so no new messages can be sent.`
            ) : vendor.paused ? (
              `${vendor.name} isn’t listed on Localites at the moment, so messages are paused.`
            ) : status === 'blocked_by_team' ? (
              'The Localites team has closed this conversation, so no new messages can be sent.'
            ) : status === 'blocked_by_consumer' ? (
              'You blocked this conversation, so neither of you can send messages.'
            ) : (
              `${vendor.name} has blocked this conversation, so no new messages can be sent.`
            )}
          </p>
        )}

        <div className={styles.footer}>
          <p className="muted">{NO_PAYMENTS_IN_CONVERSATION}</p>
          <p className="muted">{SHARE_CAREFULLY}</p>
          {!vendor.left && (status === 'open' || status === 'blocked_by_consumer') && (
            <Form method="post">
              <input type="hidden" name="intent" value={status === 'blocked_by_consumer' ? 'unblock' : 'block'} />
              <button type="submit" className={styles.textButton} disabled={busy}>
                {status === 'blocked_by_consumer' ? 'Unblock this conversation' : `Block ${vendor.name}`}
              </button>
            </Form>
          )}
          <Link to={`/messages/${thread.id}/report`} className={styles.textButton}>
            Report this conversation
          </Link>
        </div>
      </main>
    </>
  );
}
