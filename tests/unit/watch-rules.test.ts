import { describe, expect, it } from 'vitest';
import { decide, FRESH, lookAtSite, REMIND_EVERY, type WatchState } from '@/lib/watch-rules';

const SITE = 'https://localites.example.test';
const T0 = Date.UTC(2026, 9, 13, 16, 0);
const MIN = 60_000;
const down = (problem = 'The site didn’t answer at all.') => ({ ok: false as const, problem });
const up = { ok: true as const };

describe('when the site watch emails', () => {
  it('says once that alerts are switched on, then stays quiet while all is well', () => {
    const first = decide(FRESH, up, T0, SITE);
    expect(first.alert?.kind).toBe('switched-on');
    expect(first.alert?.text).toContain('every 5 minutes');
    const next = decide(first.state, up, T0 + 5 * MIN, SITE);
    expect(next.alert).toBeNull();
  });

  it('emails when the site goes down, with what to paste into a session', () => {
    const quiet: WatchState = { ...FRESH, welcomed: true };
    const r = decide(quiet, down('The home page answered 500 instead of showing.'), T0, SITE);
    expect(r.alert?.kind).toBe('down');
    expect(r.alert?.text).toContain('The home page answered 500');
    expect(r.alert?.text).toContain('start a Claude Code session');
    expect(r.state.downSince).toBe(T0);
  });

  it('stays quiet while down, then reminds every 6 hours', () => {
    let s = decide({ ...FRESH, welcomed: true }, down(), T0, SITE).state;
    for (let t = T0 + 5 * MIN; t < T0 + REMIND_EVERY; t += 5 * MIN) {
      const r = decide(s, down(), t, SITE);
      expect(r.alert).toBeNull();
      s = r.state;
    }
    const later = decide(s, down(), T0 + REMIND_EVERY, SITE);
    expect(later.alert?.kind).toBe('still-down');
    expect(later.alert?.text).toContain('about 6 hours');
  });

  it('says when it is back, and how long it was down', () => {
    const s = decide({ ...FRESH, welcomed: true }, down('The site took more than 15 seconds to answer.'), T0, SITE).state;
    const back = decide(s, up, T0 + 95 * MIN, SITE);
    expect(back.alert?.kind).toBe('back-up');
    expect(back.alert?.text).toContain('about 1 hour 35 minutes');
    expect(back.alert?.text).toContain('took more than 15 seconds');
    expect(back.state.downSince).toBeNull();
    expect(decide(back.state, up, T0 + 100 * MIN, SITE).alert).toBeNull();
  });

  it('a first look at a down site counts as the switched-on email too', () => {
    const r = decide(FRESH, down(), T0, SITE);
    expect(r.alert?.kind).toBe('down');
    expect(r.state.welcomed).toBe(true);
  });
});

describe('looking at the site', () => {
  const answers = (map: Record<string, Response | Error>) => async (url: string) => {
    const a = map[new URL(url).pathname];
    if (!a) throw new Error('unexpected ' + url);
    if (a instanceof Error) throw a;
    return a;
  };
  const healthy = () => Response.json({ website: 'ok', database: 'ok', publishedListings: 7 });

  it('all well: health, home and Explore answer', async () => {
    const r = await lookAtSite(SITE, answers({ '/api/health': healthy(), '/': new Response('ok'), '/explore': new Response('ok') }));
    expect(r).toEqual({ ok: true });
  });

  it('the database is down: quotes the health page’s own words', async () => {
    const r = await lookAtSite(
      SITE,
      answers({
        '/api/health': Response.json({ website: 'ok', database: 'cannot reach', detail: 'The database did not answer.' }, { status: 503 }),
      }),
    );
    expect(r).toEqual({
      ok: false,
      problem: "The site's health check answered 503, saying the database is cannot reach: The database did not answer.",
    });
  });

  it('no answer at all', async () => {
    const r = await lookAtSite(SITE, answers({ '/api/health': new TypeError('fetch failed') }));
    expect(r).toEqual({ ok: false, problem: 'The site didn’t answer at all.' });
  });

  it('a page fails', async () => {
    const r = await lookAtSite(SITE, answers({ '/api/health': healthy(), '/': new Response('oops', { status: 500 }) }));
    expect(r).toEqual({ ok: false, problem: 'The home page answered 500 instead of showing.' });
  });
});
