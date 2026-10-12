import type { ExecutionContext, ScheduledController } from '@cloudflare/workers-types';
import { createRequestHandler, RouterContextProvider } from 'react-router';
import * as build from 'virtual:react-router/server-build';
import { cloudflareContext } from '@/app/context';
import type { ServerEnv } from '@/server/env';
import { runActivityRollup } from '@/server/activity-rollup.server';
import { trackingOn } from '@/server/activity.server';
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
    const cf = (request as Request & { cf?: { city?: unknown; regionCode?: unknown } }).cf;
    const place = {
      town: typeof cf?.city === 'string' && cf.city ? cf.city.slice(0, 60) : null,
      region: typeof cf?.regionCode === 'string' && cf.regionCode ? cf.regionCode.slice(0, 6) : null,
    };
    context.set(cloudflareContext, { env, ctx, place });
    return withSecurityHeaders(await handleRequest(request, context));
  },

  /**
   * Cloudflare's scheduler (wrangler.jsonc triggers): the team's daily note of owners'
   * changes, and the nightly count of activity (ADR-030). Each is claimed per day, so the
   * second run of the day only retries what failed.
   */
  async scheduled(_controller: ScheduledController, env: ServerEnv, ctx: ExecutionContext): Promise<void> {
    if (trackingOn(env)) ctx.waitUntil(
      runActivityRollup(env).then(
        (outcome) => console.log('activity count:', outcome),
        (err) => console.error('activity count failed', err instanceof Error ? err.message : err),
      ),
    );
    ctx.waitUntil(
      runDailyNote(env).then(
        (outcome) => console.log('daily note:', outcome),
        (err) => console.error('daily note failed', err instanceof Error ? err.message : err),
      ),
    );
  },
};
