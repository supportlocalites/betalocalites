import type { ExecutionContext } from '@cloudflare/workers-types';
import { data } from 'react-router';
import { torontoDate } from '@/lib/activity';
import { planFailure, PlanNotFound } from './acting.server';
import type { ServerEnv } from './env';

/**
 * What every planning page (slice 2A: /events…, /saved, /vendors/:slug/add, /business,
 * /vendors/:slug/bookings) does the same way around its server calls.
 */

/** Today's date in Toronto (YYYY-MM-DD): the date window and "In 36 days" count from it. */
export const todayIso = () => torontoDate(new Date());

/** The per-person limit on planning changes (PLAN_LIMIT, kept by Cloudflare): true when it's reached. */
export async function tooFast(env: ServerEnv, userId: string): Promise<boolean> {
  return Boolean(env.PLAN_LIMIT && !(await env.PLAN_LIMIT.limit({ key: userId })).success);
}

/**
 * A planning step that didn't happen, as the page answers it: someone else's event, plan
 * row or business is a plain 404 (thrown); a refusal (409) or a cap (429) comes back with
 * its plain words and status for the page to show. Anything unexpected is rethrown.
 */
export function refusal(err: unknown): { error: string; status: number } {
  const failure = planFailure(err);
  if (failure instanceof PlanNotFound) throw data(null, { status: 404 });
  return { error: failure.message, status: failure.status };
}

/** For a page's loader: someone else's event, plan row or business, like a missing one, is a 404. */
export async function found<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (err) {
    if (err instanceof PlanNotFound) throw data(null, { status: 404 });
    throw err;
  }
}

/** Where links in planning emails point. */
export const siteUrl = (env: ServerEnv, request: Request) => env.SITE_URL ?? new URL(request.url).origin;

/** Emails go after the page answers; each one's outcome is recorded, and a failure is only logged. */
export function afterwards(ctx: ExecutionContext, work: Promise<unknown>, what: string) {
  ctx.waitUntil(work.catch((err) => console.error(`${what} not recorded`, err instanceof Error ? err.message : err)));
}

/** A whole form's fields as text (files are never sent to these pages). */
export const formFields = (form: FormData): Record<string, string> =>
  Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : '']));
