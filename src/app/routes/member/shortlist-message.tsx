import { data, redirect } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { MessageAll } from '@/components/MessageAll';
import { SLUG } from '@/lib/ids.mjs';
import { readGroupName } from '@/lib/group-name';
import { pageMeta } from '@/lib/meta';
import { TOO_FAST } from '@/lib/plan-terms';
import { emailAboutMessage, messageAll, readBody, shortlistMessagePage } from '@/server/messages.server';
import { afterwards, found, refusal, siteUrl, tooFast } from '@/server/plan-pages.server';
import type { Route } from './+types/shortlist-message';

/**
 * "Message all" from the shortlist bar (D-57, step 3): the same words to each chosen business
 * on the person's shortlist that's on Localites, each in its own conversation (not about an
 * event), through the same step as messaging one: the same limits, blocks and emails.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Message your picks'), { name: 'robots', content: 'noindex' }];

export async function loader({ context }: Route.LoaderArgs) {
  const member = context.get(memberContext);
  return { businesses: await found(shortlistMessagePage(context.get(cloudflareContext).env, member.userId)) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const member = context.get(memberContext);
  const { env, ctx } = context.get(cloudflareContext);
  const form = await request.formData();
  const read = readBody(form);
  if ('error' in read) return data({ error: read.error, result: null }, { status: 400 });
  const slugs = [...new Set(form.getAll('slug').map(String))].filter((s) => SLUG.test(s)).slice(0, 50);
  const named = readGroupName(form);
  if ('error' in named) return data({ error: named.error, result: null }, { status: 400 });
  if (await tooFast(env, member.userId)) return data({ error: TOO_FAST, result: null }, { status: 429 });
  try {
    const result = await messageAll(env, member.userId, 'shortlist', slugs, read.body, named.name);
    const url = siteUrl(env, request);
    afterwards(
      ctx,
      Promise.all(result.sent.map((w) => emailAboutMessage(env, { side: 'person', userId: member.userId }, w, url))),
      'message email',
    );
    // All sent: straight to the group in Messages (D-62); otherwise, who wasn't sent it and why.
    if (result.groupId && result.notSent.length === 0 && result.notGrouped.length === 0)
      return redirect(`/messages/groups/${result.groupId}?sent=${result.sent.length}`);
    return { error: null, result: { sentTo: result.sentTo, notSent: result.notSent, groupId: result.groupId, notGrouped: result.notGrouped } };
  } catch (err) {
    const { error, status } = refusal(err);
    return data({ error, result: null }, { status });
  }
}

export default function ShortlistMessage({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <MessageAll
      back={{ to: '/explore', label: 'Browse local', again: 'Back to Browse local' }}
      title="Message your picks"
      none="None of the businesses in your picks can be messaged on Localites yet."
      businesses={loaderData.businesses}
      actionData={actionData}
      intro={
        <p>
          Each business gets your words in its own conversation. They see your name and your message; never who else you messaged. To
          tell them your event’s date, town and guests, add these to an event first and message them from it.
        </p>
      }
    />
  );
}
