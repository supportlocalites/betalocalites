import type { DurableObjectNamespace, DurableObjectState, ScheduledController } from '@cloudflare/workers-types';
import { decide, FRESH, lookAtSite, type WatchState } from '@/lib/watch-rules';
import { sendEmail, TEAM_ADDRESS } from '@/server/email.server';

/**
 * The site watch (runbook F §8, D-11): its own small Cloudflare Worker, apart from the site,
 * so a broken site update can't silence it. Every 5 minutes it looks at the site; if that
 * fails twice, 20 seconds apart, it emails the team (rules: src/lib/watch-rules.ts).
 * Deployed by CI after the site (wrangler.watch.jsonc); its email key is its own secret
 * (PO-19). Free plan: one scheduled trigger, a tiny Durable Object for what it remembers.
 */
type Env = {
  SITE_URL: string;
  RESEND_API_KEY?: string;
  STATE: DurableObjectNamespace;
};

/**
 * What the watch remembers between looks: is there an outage, and when it last emailed.
 * Reached only by the watch itself (GET reads, PUT writes); it has no address of its own.
 */
export class Memory {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method === 'PUT') {
      await this.state.storage.put('state', await request.json());
      return new Response(null, { status: 204 });
    }
    return Response.json((await this.state.storage.get<WatchState>('state')) ?? FRESH);
  }
}

const SECOND_LOOK_AFTER = 20_000;

export default {
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    let look = await lookAtSite(env.SITE_URL, fetch);
    if (!look.ok) {
      // One more look before alarming anyone: a single slow moment isn't an outage.
      await new Promise((r) => setTimeout(r, SECOND_LOOK_AFTER));
      look = await lookAtSite(env.SITE_URL, fetch);
    }
    const memory = env.STATE.get(env.STATE.idFromName('site'));
    const before = (await (await memory.fetch('https://memory/')).json()) as WatchState;
    const { state, alert } = decide(before, look, Date.now(), env.SITE_URL);
    if (alert) {
      const sent = await sendEmail(env, { to: TEAM_ADDRESS, subject: alert.subject, text: alert.text });
      if (!sent.sent) {
        // Remember nothing new, so the next look tries the email again.
        console.error('site watch: alert not sent', alert.kind, sent.reason);
        return;
      }
      console.log('site watch: emailed', alert.kind);
    }
    await memory.fetch('https://memory/', { method: 'PUT', body: JSON.stringify(state) });
    if (!look.ok) console.log('site watch: site down', look.problem);
  },

  // Nothing to see: the watch only works on its schedule.
  async fetch(): Promise<Response> {
    return new Response('Not found', { status: 404 });
  },
};
