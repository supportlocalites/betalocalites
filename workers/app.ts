import type { ExecutionContext } from '@cloudflare/workers-types';
import { createRequestHandler, RouterContextProvider } from 'react-router';
import * as build from 'virtual:react-router/server-build';
import { cloudflareContext } from '@/app/context';
import type { ServerEnv } from '@/server/env';
import { withSecurityHeaders } from '@/server/security-headers';

// Loaded when the Worker starts, not during a visitor's request: Cloudflare's free plan
// counts processing time per request (10 ms), and preparing the pages takes longer.
const handleRequest = createRequestHandler(build, import.meta.env.MODE);

/** The Cloudflare Worker: every page and API request comes through here. */
export default {
  async fetch(request: Request, env: ServerEnv, ctx: ExecutionContext): Promise<Response> {
    const context = new RouterContextProvider();
    context.set(cloudflareContext, { env, ctx });
    return withSecurityHeaders(await handleRequest(request, context));
  },
};
