import type { ExecutionContext, Hyperdrive } from '@cloudflare/workers-types';

/**
 * What the Worker receives from Cloudflare: bindings from wrangler.jsonc and secrets set
 * in the Cloudflare dashboard. Secret values are never logged or shown (runbook §8).
 */
export type ServerEnv = {
  HYPERDRIVE?: Hyperdrive;
  DATABASE_URL?: string;
};

export type Cloudflare = { env: ServerEnv; ctx: ExecutionContext };
