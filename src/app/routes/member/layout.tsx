import { Outlet } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { memberGate } from '@/server/auth/member.server';
import type { Route } from './+types/layout';

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
    const response = await next();
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Robots-Tag', 'noindex');
    for (const cookie of setCookies) response.headers.append('Set-Cookie', cookie);
    return response;
  },
];

export default function MemberLayout() {
  return <Outlet />;
}
