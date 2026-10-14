import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { MessageList, ReplyBox, useRefresh } from '@/components/MessageThread';
import { SiteHeader } from '@/components/SiteHeader';
import { isUuid, SLUG } from '@/lib/ids.mjs';
import { NO_PAYMENTS_IN_CONVERSATION, SHARE_CAREFULLY } from '@/lib/message-terms';
import { pageMeta } from '@/lib/meta';
import { guestsWords, longDateWithYear, TOO_FAST } from '@/lib/plan-terms';
import { businessChange, businessReply, businessThread, emailAboutMessage, readBody } from '@/server/messages.server';
import { afterwards, found, refusal, siteUrl, tooFast } from '@/server/plan-pages.server';
import type { Route } from './+types/business-conversation';
import styles from './messages.module.css';

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
  return found(businessThread(context.get(cloudflareContext).env, member.userId, params.slug, params.id));
}

export async function action({ request, params, context }: Route.ActionArgs) {
  if (!SLUG.test(params.slug) || !isUuid(params.id)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env, ctx } = context.get(cloudflareContext);
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  if (await tooFast(env, member.userId)) return data({ error: TOO_FAST }, { status: 429 });
  const here = `/vendors/${params.slug}/messages/${params.id}`;
  try {
    if (intent === 'send') {
      const read = readBody(form);
      if ('error' in read) return data({ error: read.error }, { status: 400 });
      const written = await businessReply(env, member.userId, params.slug, params.id, read.body);
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
  useRefresh();
  const busy = useNavigation().state === 'submitting';
  const { business, person, status, event, messages } = loaderData;
  const canBlock = business.role !== 'staff';
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
        {actionData?.error && (
          <p className="notice" role="alert">
            {actionData.error}
          </p>
        )}
        <MessageList messages={messages} canRemove />
        {status === 'open' ? (
          <ReplyBox label={`Reply to ${person}`} busy={busy} />
        ) : (
          <p className="notice" role="status">
            {status === 'blocked_by_vendor'
              ? 'Your business blocked this conversation, so neither of you can send messages.'
              : `${person} has blocked this conversation, so no new messages can be sent.`}
          </p>
        )}
        <div className={styles.footer}>
          <p className="muted">{NO_PAYMENTS_IN_CONVERSATION}</p>
          <p className="muted">{SHARE_CAREFULLY}</p>
          {canBlock && status !== 'blocked_by_consumer' && (
            <Form method="post">
              <input type="hidden" name="intent" value={status === 'blocked_by_vendor' ? 'unblock' : 'block'} />
              <button type="submit" className={styles.textButton} disabled={busy}>
                {status === 'blocked_by_vendor' ? 'Unblock this conversation' : `Block ${person}`}
              </button>
            </Form>
          )}
        </div>
      </main>
    </>
  );
}
