import { data } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { isUuid, SLUG } from '@/lib/ids.mjs';
import { businessVersion, personVersion } from '@/server/messages.server';
import { found } from '@/server/plan-pages.server';
import type { Route } from './+types/message-check';

/**
 * The quick look an open conversation makes for anything new (MessageThread's useRefresh):
 * one small read instead of reloading the page, and nothing marked read. Registered twice:
 * /messages/:id/check (the person) and /vendors/:slug/messages/:id/check (the business's
 * team). Someone else's conversation is "not found", as on its page.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  if (!isUuid(params.id) || (params.slug !== undefined && !SLUG.test(params.slug))) throw data(null, { status: 404 });
  const { env } = context.get(cloudflareContext);
  const member = context.get(memberContext);
  const version = await found(
    params.slug === undefined ? personVersion(env, member.userId, params.id) : businessVersion(env, member.userId, params.slug, params.id),
  );
  return Response.json({ version });
}
