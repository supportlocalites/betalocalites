import { cloudflareContext, memberContext } from '@/app/context';
import { myData, myReadableData } from '@/server/my-data.server';
import type { Route } from './+types/account-data-download';

/**
 * The file itself for Download your data (migration 0043): the signed-in person's own, nobody else's.
 * ?readable gives the readable copy (M21, D-54), a page saved to open in any browser.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date());
  const readable = new URL(request.url).searchParams.has('readable');
  return new Response(readable ? await myReadableData(env, member.userId) : await myData(env, member.userId), {
    headers: {
      'Content-Type': readable ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="localites-my-data-${day}.${readable ? 'html' : 'json'}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
