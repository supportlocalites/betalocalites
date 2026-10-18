import { cloudflareContext, memberContext } from '@/app/context';
import { myData } from '@/server/my-data.server';
import type { Route } from './+types/account-data-download';

/** The file itself for Download your data (migration 0043): the signed-in person's own, nobody else's. */
export async function loader({ context }: Route.LoaderArgs) {
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date());
  return new Response(await myData(env, member.userId), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="localites-my-data-${day}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
