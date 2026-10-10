import type { ExecutionContext } from '@cloudflare/workers-types';
import { createRequestHandler, RouterContextProvider } from 'react-router';
import { cloudflareContext } from '@/app/context';
import type { ServerEnv } from '@/server/env';
import { withSecurityHeaders } from '@/server/security-headers';

const handleRequest = createRequestHandler(() => import('virtual:react-router/server-build'), import.meta.env.MODE);

/** The Cloudflare Worker: every page and API request comes through here. */
export default {
  async fetch(request: Request, env: ServerEnv, ctx: ExecutionContext): Promise<Response> {
    const context = new RouterContextProvider();
    context.set(cloudflareContext, { env, ctx });
    return withSecurityHeaders(await handleRequest(request, context));
  },
};
