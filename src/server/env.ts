import type { ExecutionContext, Hyperdrive, RateLimit } from '@cloudflare/workers-types';

/**
 * What the Worker receives from Cloudflare: bindings from wrangler.jsonc and settings
 * set in the Cloudflare dashboard. Secret values are never logged or shown (runbook §8).
 */
export type ServerEnv = {
  HYPERDRIVE?: Hyperdrive;
  DATABASE_URL?: string;
  /** The Supabase project's address, e.g. https://abcd.supabase.co (sign-in, ADR-003). */
  SUPABASE_URL?: string;
  /** Supabase's publishable key: identifies the project to its sign-in service. */
  SUPABASE_PUBLISHABLE_KEY?: string;
  /** Local development only: a local sign-in server's address, used instead of the two above. */
  SUPABASE_AUTH_URL?: string;
  /** Resend's sending key (ADR-013, PO-12). Without it, emails wait and the admin page says so. */
  RESEND_API_KEY?: string;
  /** Suggest a business: a per-address limit kept by Cloudflare, never stored (wrangler.jsonc). */
  SUGGEST_LIMIT?: RateLimit;
};

export type Cloudflare = { env: ServerEnv; ctx: ExecutionContext };
