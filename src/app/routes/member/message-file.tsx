import { data } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { isUuid, SLUG } from '@/lib/ids.mjs';
import { fileResponse } from '@/server/conversation-files.server';
import { businessFile, personFile } from '@/server/messages.server';
import { found } from '@/server/plan-pages.server';
import type { Route } from './+types/message-file';

/**
 * A photo or PDF sent in a conversation (migration 0028), handed over by the site itself
 * after the database's rules say this person may see it: /messages/:id/files/:fileId (the
 * person) and /vendors/:slug/messages/:id/files/:fileId (the business's team). Anyone else,
 * or a file that's gone, is "not found". Files are never at a public address.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  if (!isUuid(params.id) || !isUuid(params.fileId) || (params.slug !== undefined && !SLUG.test(params.slug))) {
    throw data(null, { status: 404 });
  }
  const { env } = context.get(cloudflareContext);
  const member = context.get(memberContext);
  const file = await found(
    params.slug === undefined
      ? personFile(env, member.userId, params.id, params.fileId)
      : businessFile(env, member.userId, params.slug, params.id, params.fileId),
  );
  return fileResponse(file.body, file);
}
