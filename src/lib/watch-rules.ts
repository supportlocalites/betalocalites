/**
 * The site watch (runbook F §8, D-11): every 5 minutes a separate Cloudflare Worker
 * (workers/watch.ts) looks at the site and emails supportlocalites@gmail.com when it's down,
 * every 6 hours while it stays down, and once when it's back. These are its rules, as plain
 * functions so they can be tested without an outage.
 */

export type WatchState = {
  /** When the current outage was first seen (ms), or null while the site is fine. */
  downSince: number | null;
  /** When we last emailed about the current outage (ms). */
  lastAlertAt: number | null;
  /** What was wrong, in plain words. */
  problem: string | null;
  /** True once the "alerts are switched on" email (or any alert) has gone out. */
  welcomed: boolean;
};

export const FRESH: WatchState = { downSince: null, lastAlertAt: null, problem: null, welcomed: false };

/** How often to remind while the site stays down. */
export const REMIND_EVERY = 6 * 60 * 60 * 1000;

export type Alert = { kind: 'down' | 'still-down' | 'back-up' | 'switched-on'; subject: string; text: string };

const toronto = (ms: number) =>
  new Date(ms).toLocaleString('en-US', { timeZone: 'America/Toronto', dateStyle: 'medium', timeStyle: 'short' }); // e.g. Oct 13, 2026, 6:43 PM

function lasted(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} hour${hours === 1 ? '' : 's'}${rest ? ` ${rest} minute${rest === 1 ? '' : 's'}` : ''}`;
}

const SESSION = (problem: string) =>
  `What to do: start a Claude Code session on the Localites project and paste this:\n` +
  `"The site watch says the test site is down: ${problem} Please find out why and fix it, following runbook F."`;

/**
 * What to do after a look at the site: the state to keep, and the email to send, if any.
 * If the email can't be sent, keep the old state instead, so the next look tries again.
 */
export function decide(state: WatchState, look: { ok: true } | { ok: false; problem: string }, now: number, site: string) {
  if (look.ok) {
    if (state.downSince !== null) {
      const alert: Alert = {
        kind: 'back-up',
        subject: 'Localites test site is back up',
        text:
          `The Localites test site (${site}) is working again, as of ${toronto(now)}.\n\n` +
          `It was down for about ${lasted(now - state.downSince)}, from ${toronto(state.downSince)}. ` +
          `What was wrong: ${state.problem ?? 'not recorded'}\n\nNothing more to do unless it happens again.`,
      };
      return { state: { ...FRESH, welcomed: true }, alert };
    }
    if (!state.welcomed) {
      const alert: Alert = {
        kind: 'switched-on',
        subject: 'Localites alerts are switched on',
        text:
          `This is the Localites site watch. It looks at the test site (${site}) every 5 minutes and ` +
          `emails this address if it stops working, every 6 hours while it stays down, and once ` +
          `when it's back.\n\nThe site is working now (${toronto(now)}). Nothing to do: this email only ` +
          `shows that alerts reach you (PO-19).`,
      };
      return { state: { ...state, welcomed: true }, alert };
    }
    return { state, alert: null };
  }

  if (state.downSince === null) {
    const alert: Alert = {
      kind: 'down',
      subject: 'Localites test site is down',
      text:
        `The Localites site watch found the test site (${site}) not working at ${toronto(now)}, ` +
        `and again 20 seconds later.\n\nWhat's wrong: ${look.problem}\n\n${SESSION(look.problem)}\n\n` +
        `You'll get a reminder every 6 hours while it stays down, and an email when it's back.`,
    };
    return { state: { downSince: now, lastAlertAt: now, problem: look.problem, welcomed: true }, alert };
  }
  if (state.lastAlertAt === null || now - state.lastAlertAt >= REMIND_EVERY) {
    const alert: Alert = {
      kind: 'still-down',
      subject: 'Localites test site is still down',
      text:
        `The Localites test site (${site}) has been down for about ${lasted(now - state.downSince)}, ` +
        `since ${toronto(state.downSince)}.\n\nWhat's wrong now: ${look.problem}\n\n${SESSION(look.problem)}`,
    };
    return { state: { ...state, lastAlertAt: now, problem: look.problem }, alert };
  }
  return { state: { ...state, problem: look.problem }, alert: null };
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * One look at the site: its health page (website and database), the home page and Explore
 * (which reads the database). Returns what's wrong in plain words. Never includes secrets:
 * the health page itself never shows the database address or password.
 */
export async function lookAtSite(site: string, get: Fetch): Promise<{ ok: true } | { ok: false; problem: string }> {
  const open = async (path: string) => {
    try {
      return await get(new URL(path, site).toString(), {
        headers: { 'User-Agent': 'Localites-site-watch' },
        signal: AbortSignal.timeout(15000),
        redirect: 'manual',
      });
    } catch (err) {
      return err instanceof Error && err.name === 'TimeoutError' ? 'took more than 15 seconds to answer' : 'didn’t answer at all';
    }
  };
  const health = await open('/api/health');
  if (typeof health === 'string') return { ok: false, problem: `The site ${health}.` };
  const said = (await health.json().catch(() => null)) as { website?: unknown; database?: unknown; detail?: unknown } | null;
  if (!health.ok || said?.website !== 'ok' || said?.database !== 'ok') {
    // The health page's own words, e.g. "cannot reach: The database did not answer."
    const why = [said?.database, said?.detail]
      .filter((v): v is string => typeof v === 'string' && v !== 'ok')
      .map((v) => v.slice(0, 200).replace(/\.$/, ''))
      .join(': ');
    return {
      ok: false,
      problem: `The site's health check answered ${health.status}${why ? `, saying the database is ${why}` : ''}.`,
    };
  }
  for (const [path, name] of [
    ['/', 'The home page'],
    ['/explore', 'The Explore page'],
  ] as const) {
    const page = await open(path);
    if (typeof page === 'string') return { ok: false, problem: `${name} ${page}.` };
    await page.arrayBuffer().catch(() => undefined); // read to the end, so the connection closes cleanly
    if (page.status !== 200) return { ok: false, problem: `${name} answered ${page.status} instead of showing.` };
  }
  return { ok: true };
}
