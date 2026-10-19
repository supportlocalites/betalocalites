import { data, Form, Link, useNavigation } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { isUuid, SLUG } from '@/lib/ids.mjs';
import { MESSAGE_LIMITS, NO_PAYMENTS_IN_CONVERSATION, SHARE_CAREFULLY } from '@/lib/message-terms';
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
    const result = await messageAll(env, member.userId, params.id, slugs, read.body);
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
  const busy = useNavigation().state !== 'idle';
  const base = `/events/${event.id}`;
  const result = actionData?.result;
  const many = businesses.length > MESSAGE_LIMITS.messageAllMax;
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <p>
          <Link to={base} className="text-link">
            ← {event.name}
          </Link>
        </p>
        <h1 className="title-1">Message the businesses you’re considering</h1>
        <div className="title-rule" aria-hidden="true" />
        {result ? (
          <>
            {result.sentTo.length > 0 && (
              <p className="notice" role="status">
                {`Sent to ${result.sentTo.join(', ')}. Each is its own conversation in your Messages; we’ll email you when they reply.`}
              </p>
            )}
            {result.notSent.length > 0 && (
              <div className="notice" role="alert">
                <p>Not sent to:</p>
                <ul>
                  {result.notSent.map((n) => (
                    <li key={n.name}>{`${n.name}: ${n.why}`}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="section-gap">
              <Link to="/messages" className="button button-secondary">
                See your messages
              </Link>{' '}
              <Link to={base} className="button button-secondary">
                Back to your event
              </Link>
            </p>
          </>
        ) : businesses.length === 0 ? (
          <>
            <p>None of the businesses you’re considering for this event can be messaged on Localites yet.</p>
            <p>
              <Link to={base} className="text-link">
                Back to your event
              </Link>
            </p>
          </>
        ) : (
          <>
            <p>
              {`Each business gets your words in its own conversation, about ${event.name} on ${shortDate(event.date, today)}. They see your name, the date, the town and about how many guests; never your event’s name, your budget or your notes, and never who else you messaged.`}
            </p>
            {actionData?.error && (
              <p className="notice" role="alert">
                {actionData.error}
              </p>
            )}
            <Form method="post">
              <fieldset className="field">
                <legend className="field-label">
                  {many ? `Send to (up to ${MESSAGE_LIMITS.messageAllMax} at a time)` : 'Send to'}
                </legend>
                {businesses.map((b, i) => (
                  <label key={b.slug} className="field-hint">
                    <input type="checkbox" name="slug" value={b.slug} defaultChecked={i < MESSAGE_LIMITS.messageAllMax} /> {b.name}
                  </label>
                ))}
              </fieldset>
              <div className="field">
                <label htmlFor="body" className="field-label">
                  Your message
                </label>
                <textarea id="body" name="body" className="input" maxLength={MESSAGE_LIMITS.body} required />
              </div>
              <p className="muted">{NO_PAYMENTS_IN_CONVERSATION}</p>
              <p className="muted">{SHARE_CAREFULLY}</p>
              <p>
                <button type="submit" className="button button-primary" disabled={busy}>
                  Send to each
                </button>
              </p>
            </Form>
          </>
        )}
      </main>
    </>
  );
}
