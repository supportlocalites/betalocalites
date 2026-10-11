import type { ExecutionContext, ScheduledController } from '@cloudflare/workers-types';
import { createRequestHandler, RouterContextProvider } from 'react-router';
import * as build from 'virtual:react-router/server-build';
import { cloudflareContext } from '@/app/context';
import type { ServerEnv } from '@/server/env';
import { runDailyNote } from '@/server/daily-note.server';
import { refuseCrossSiteForm, withSecurityHeaders } from '@/server/security-headers';

// Loaded when the Worker starts, not during a visitor's request: Cloudflare's free plan
// counts processing time per request (10 ms), and preparing the pages takes longer.
const handleRequest = createRequestHandler(build, import.meta.env.MODE);

/** The Cloudflare Worker: every page and API request comes through here. */
export default {
  async fetch(request: Request, env: ServerEnv, ctx: ExecutionContext): Promise<Response> {
    const refused = refuseCrossSiteForm(request);
    if (refused) return withSecurityHeaders(refused);
    const context = new RouterContextProvider();
    context.set(cloudflareContext, { env, ctx });
    return withSecurityHeaders(await handleRequest(request, context));
  },

  /** Cloudflare's scheduler (wrangler.jsonc triggers): the team's daily note of owners' changes. */
  async scheduled(_controller: ScheduledController, env: ServerEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runDailyNote(env).then(
        (outcome) => console.log('daily note:', outcome),
        (err) => console.error('daily note failed', err instanceof Error ? err.message : err),
      ),
    );
  },
};
