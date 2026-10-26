import { Outlet, redirect } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { memberGate } from '@/server/auth/member.server';
import { findRenamed } from '@/server/catalog.server';
import type { Route } from './+types/layout';

/** A page of a business's, by web address (not a .data request). */
const OLD_LINK = /^\/vendors\/([a-z0-9]+(?:-[a-z0-9]+)*)(\/[^.]*)$/;

/**
 * Pages that need an account (D-27) sit under this route, so every request for them,
 * page or form, passes the gate first. Anyone not signed in is sent to /join and
 * brought back afterwards.
 */
export const middleware: Route.MiddlewareFunction[] = [
  async ({ request, context }, next) => {
    const { env } = context.get(cloudflareContext);
    const { member, setCookies } = await memberGate(request, env);
    context.set(memberContext, member);
    let response = await next();
    // A business's old web address (renamed, M20): links to message, add, inquire or claim
    // that find nothing go on to its new one. Only a listed business's, as its public page does.
    const old = response.status === 404 && request.method === 'GET' ? OLD_LINK.exec(new URL(request.url).pathname) : null;
    if (old) {
      const current = await findRenamed(env, old[1]!);
      if (current) response = redirect(`/vendors/${current}${old[2]}${new URL(request.url).search}`);
    }
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Robots-Tag', 'noindex');
    for (const cookie of setCookies) response.headers.append('Set-Cookie', cookie);
    return response;
  },
];

/** For the header (C6, D-54): someone on a business's team gets a My business link. */
export function loader({ context }: Route.LoaderArgs) {
  const member = context.get(memberContext);
  return { onTeam: member.onTeam, businesses: member.businesses };
}

export default function MemberLayout() {
  return <Outlet />;
}
