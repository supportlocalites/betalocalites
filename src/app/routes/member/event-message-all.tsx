import { data } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { MessageAll as MessageAllPage } from '@/components/MessageAll';
import { isUuid, SLUG } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { shortDate, TOO_FAST } from '@/lib/plan-terms';
import { emailAboutMessage, messageAll, messageAllPage, readBody } from '@/server/messages.server';
import { afterwards, found, refusal, siteUrl, todayIso, tooFast } from '@/server/plan-pages.server';
import type { Route } from './+types/event-message-all';

/**
 * "Message all" on an event's Considering list (D-58): the same words to each chosen business
 * on Localites, each in its own conversation about this event, exactly as if sent one by one
 * (the same limits, blocks and emails). Only the person's own event, still being planned.
 */
export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta(loaderData ? `Message the businesses for ${loaderData.event.name}` : 'Message all'),
  { name: 'robots', content: 'noindex' },
];

export async function loader({ params, context }: Route.LoaderArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const page = await found(messageAllPage(context.get(cloudflareContext).env, member.userId, params.id));
  return { ...page, today: todayIso() };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env, ctx } = context.get(cloudflareContext);
  const form = await request.formData();
  const read = readBody(form);
  if ('error' in read) return data({ error: read.error, result: null }, { status: 400 });
  const slugs = [...new Set(form.getAll('slug').map(String))].filter((s) => SLUG.test(s)).slice(0, 50);
  if (await tooFast(env, member.userId)) return data({ error: TOO_FAST, result: null }, { status: 429 });
  try {
    const result = await messageAll(env, member.userId, { eventId: params.id }, slugs, read.body);
    const url = siteUrl(env, request);
    afterwards(
      ctx,
      Promise.all(result.sent.map((w) => emailAboutMessage(env, { side: 'person', userId: member.userId }, w, url))),
      'message email',
    );
    return { error: null, result: { sentTo: result.sentTo, notSent: result.notSent } };
  } catch (err) {
    const { error, status } = refusal(err);
    return data({ error, result: null }, { status });
  }
}

export default function MessageAll({ loaderData, actionData }: Route.ComponentProps) {
  const { event, businesses, today } = loaderData;
  return (
    <MessageAllPage
      back={{ to: `/events/${event.id}`, label: event.name, again: 'Back to your event' }}
      title="Message the businesses you’re considering"
      none="None of the businesses you’re considering for this event can be messaged on Localites yet."
      businesses={businesses}
      actionData={actionData}
      intro={
        <>
          <p>
            {`Each business gets your words in its own conversation, about ${event.name} on ${shortDate(event.date, today)}. They see your name, the date, the town and about how many guests; never your event’s name, your budget or your notes, and never who else you messaged.`}
          </p>
          <p className="muted">
            If you already have a conversation with one of them, your message goes there, and that conversation will be about this event.
          </p>
        </>
      }
    />
  );
}
