import type { ExecutionContext, ScheduledController } from '@cloudflare/workers-types';
import { createRequestHandler, RouterContextProvider } from 'react-router';
import * as build from 'virtual:react-router/server-build';
import { cloudflareContext } from '@/app/context';
import type { ServerEnv } from '@/server/env';
import { runActivityRollup } from '@/server/activity-rollup.server';
import { runDailyNote } from '@/server/daily-note.server';
import { closeInterruptedPlanEmails } from '@/server/email-templates.server';
import { sendPlanSummaries } from '@/server/plan-emails.server';
import { cleanUpConversationFiles, expireConversationFiles } from '@/server/conversation-files.server';
import { cleanUpRemovedPhotos } from '@/server/photos.server';
import { sendReviewRequests } from '@/server/review-requests.server';
import { eraseGuestContacts } from '@/server/guests.server';
import { discardBody } from '@/server/discard-body';
import { refuseCrossSiteForm, withSecurityHeaders } from '@/server/security-headers';

// Loaded when the Worker starts, not during a visitor's request: Cloudflare's free plan
// counts processing time per request (10 ms), and preparing the pages takes longer.
const handleRequest = createRequestHandler(build, import.meta.env.MODE);

/** The Cloudflare Worker: every page and API request comes through here. */
export default {
  async fetch(request: Request, env: ServerEnv, ctx: ExecutionContext): Promise<Response> {
    const refused = refuseCrossSiteForm(request);
    if (refused) {
      await discardBody(request); // not read, but let it arrive before answering
      return withSecurityHeaders(refused);
    }
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
   * Cloudflare's scheduler (wrangler.jsonc triggers, 8 and 10 in the morning in Orillia in
   * summer): the team's daily note of owners' changes, the nightly count of activity
   * (ADR-030), "How was it?" emails, and tidying. Each is claimed per day, so the
   * second run of the day only retries what failed.
   */
  async scheduled(_controller: ScheduledController, env: ServerEnv, ctx: ExecutionContext): Promise<void> {
    // Always: it only adds up what's already recorded (even after the key is removed).
    ctx.waitUntil(
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
    // Plan emails left "queued" by a run that was cut short: recorded as failed (not known if sent).
    ctx.waitUntil(
      closeInterruptedPlanEmails(env).then(
        (n) => console.log('interrupted plan emails closed:', n),
        (err) => console.error('closing interrupted plan emails failed', err instanceof Error ? err.message : err),
      ),
    );
    // Files from conversations that went with their messages (conversation-files.server.ts).
    ctx.waitUntil(
      expireConversationFiles(env)
        .then((n) => console.log('expired conversation files:', n))
        .then(() => cleanUpConversationFiles(env, 30))
        .then(
          (outcome) => console.log('removed conversation files:', outcome),
          (err) => console.error('conversation files clean-up failed', err instanceof Error ? err.message : err),
        ),
    );
    // "How was it?" emails the morning after events (review-requests.server.ts); the second
    // run of the morning sends what the first couldn't.
    ctx.waitUntil(
      sendReviewRequests(env).then(
        (outcome) => console.log('review requests:', outcome),
        (err) => console.error('review requests failed', err instanceof Error ? err.message : err),
      ),
    );
    // The morning summary of booking emails (D-53, plan-emails.server.ts); the second run sends the rest.
    ctx.waitUntil(
      sendPlanSummaries(env).then(
        (outcome) => console.log('booking summaries:', outcome),
        (err) => console.error('booking summaries failed', err instanceof Error ? err.message : err),
      ),
    );
    // Guests' phone numbers and emails, 90 days after the event (D-10, guests.server.ts).
    ctx.waitUntil(
      eraseGuestContacts(env).then(
        (n) => console.log('guest contact details erased:', n),
        (err) => console.error('erasing guest contact details failed', err instanceof Error ? err.message : err),
      ),
    );
    // Removed photos whose files couldn't be deleted at the time (photos.server.ts).
    ctx.waitUntil(
      cleanUpRemovedPhotos(env).then(
        (outcome) => console.log('removed photos:', outcome),
        (err) => console.error('removed photos clean-up failed', err instanceof Error ? err.message : err),
      ),
    );
  },
};
