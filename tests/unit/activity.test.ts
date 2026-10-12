import { describe, expect, it } from 'vitest';
import { isbot } from 'isbot';
import { change, classifySource, deviceFrom, duration, maskOf, ordinal, parseBeacon, periodRanges, small, torontoDate } from '@/lib/activity';
import { readNote, signNote } from '@/lib/activity-token';

const SITE = 'https://localites.ca';

describe('where a visitor came from (read on the server)', () => {
  it('names search engines, social media, other sites and Localites itself', () => {
    expect(classifySource('https://www.google.ca/', SITE)).toBe('web_search');
    expect(classifySource('https://www.google.co.uk/', SITE)).toBe('web_search');
    expect(classifySource('https://www.bing.com/', SITE)).toBe('web_search');
    expect(classifySource('https://duckduckgo.com/', SITE)).toBe('web_search');
    expect(classifySource('https://l.facebook.com/', SITE)).toBe('social');
    expect(classifySource('https://l.instagram.com/', SITE)).toBe('social');
    expect(classifySource('https://t.co/', SITE)).toBe('social');
    expect(classifySource('https://orilliamatters.com/news', SITE)).toBe('other_site');
    expect(classifySource(`${SITE}/search?q=cakes`, SITE)).toBe('search');
    expect(classifySource(`${SITE}/search?category=bakers`, SITE)).toBe('category');
    expect(classifySource(`${SITE}/search`, SITE)).toBe('category');
    expect(classifySource(`${SITE}/vendors/x`, SITE)).toBe('other');
    expect(classifySource(null, SITE)).toBe('direct');
    expect(classifySource('not a web address', SITE)).toBe('direct');
  });
});

describe('phone, tablet or computer', () => {
  it('reads what the browser says', () => {
    expect(deviceFrom('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148', null)).toBe('phone');
    expect(deviceFrom('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', null)).toBe('tablet');
    expect(deviceFrom('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36', null)).toBe('phone');
    expect(deviceFrom('Mozilla/5.0 (Linux; Android 14; SM-X710) Safari/537.36', null)).toBe('tablet');
    expect(deviceFrom('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130', null)).toBe('computer');
    expect(deviceFrom('Mozilla/5.0 (Linux) Chrome/130', '?1')).toBe('phone');
  });
});

describe('a browser’s report', () => {
  const token = 'a'.repeat(50);
  it('accepts only what a page sends', () => {
    expect(parseBeacon(JSON.stringify({ t: 'list', token, seen: [1, 2, 30] }))).toEqual({ t: 'list', token, seen: [1, 2, 30] });
    expect(parseBeacon(JSON.stringify({ t: 'view', token, pos: 3, list: '01900000-0000-7000-8000-000000000001' }))).toMatchObject({ pos: 3 });
    expect(parseBeacon(JSON.stringify({ t: 'view', token }))).toEqual({ t: 'view', token, pos: null, list: null });
    expect(parseBeacon(JSON.stringify({ t: 'tap', token, kind: 'phone_tap' }))).toEqual({ t: 'tap', token, kind: 'phone_tap' });
    expect(parseBeacon(JSON.stringify({ t: 'time', token, seconds: 1800 }))).toEqual({ t: 'time', token, seconds: 1800 });
  });
  it('refuses anything else', () => {
    for (const bad of [
      'not json',
      JSON.stringify([1]),
      JSON.stringify({ t: 'list', token, seen: [0] }),
      JSON.stringify({ t: 'list', token, seen: [31] }),
      JSON.stringify({ t: 'list', token, seen: [1, 1] }),
      JSON.stringify({ t: 'list', token, seen: [1.5] }),
      JSON.stringify({ t: 'view', token, pos: 99 }),
      JSON.stringify({ t: 'view', token, pos: 1, list: 'nope' }),
      JSON.stringify({ t: 'tap', token, kind: 'email_tap' }),
      JSON.stringify({ t: 'time', token, seconds: 0 }),
      JSON.stringify({ t: 'time', token, seconds: 1801 }),
      JSON.stringify({ t: 'ad', token }),
      JSON.stringify({ t: 'list', seen: [] }),
      JSON.stringify({ t: 'list', token, seen: [], pad: 'x'.repeat(5000) }),
    ]) {
      expect(parseBeacon(bad), bad.slice(0, 60)).toBeNull();
    }
  });
  it('marks the places seen, ignoring any past the end of the list', () => {
    expect(maskOf([1, 2], 3)).toBe(3);
    expect(maskOf([3, 6], 3)).toBe(4);
    expect(maskOf([30], 30)).toBe(2 ** 29);
  });
});

describe('a page’s signed note', () => {
  const key = 'test-key-'.repeat(5);
  const note = { k: 'view' as const, pv: 'p', v: 'v', src: 'direct', x: 2_000_000_000 };
  it('reads back only when untouched, ours and not expired', async () => {
    const t = await signNote(key, note);
    expect(await readNote(key, t, 1_000)).toEqual(note);
    expect(await readNote('another-key-'.repeat(4), t, 1_000)).toBeNull();
    expect(await readNote(key, `${t.slice(0, -2)}xx`, 1_000)).toBeNull();
    const [body, mac] = t.split('.');
    const changed = Buffer.from(JSON.stringify({ ...note, v: 'someone-else' })).toString('base64url');
    expect(await readNote(key, `${changed}.${mac}`, 1_000)).toBeNull();
    expect(await readNote(key, `${body}.${mac}.extra`, 1_000)).toBeNull();
    expect(await readNote(key, t, 2_000_000_001)).toBeNull();
  });
});

describe('bots get no note', () => {
  it('knows search engines and link previews, not people', () => {
    expect(isbot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
    expect(isbot('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/130.0')).toBe(true);
    expect(isbot('facebookexternalhit/1.1')).toBe(true);
    expect(isbot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1')).toBe(false);
  });
});

describe('report periods (Toronto days)', () => {
  it('last week is Monday to Sunday, compared with the week before and 52 weeks earlier', () => {
    const r = periodRanges('week', '2026-10-14'); // a Wednesday
    expect(r.now).toEqual({ from: '2026-10-05', to: '2026-10-12', people: { period: 'week', startsOn: '2026-10-05' } });
    expect(r.before?.from).toBe('2026-09-28');
    expect(r.lastYear.from).toBe('2025-10-06');
  });
  it('last month is the whole calendar month', () => {
    const r = periodRanges('month', '2026-03-31');
    expect(r.now).toEqual({ from: '2026-02-01', to: '2026-03-01', people: { period: 'month', startsOn: '2026-02-01' } });
    expect(r.before?.from).toBe('2026-01-01');
    expect(r.lastYear).toMatchObject({ from: '2025-02-01', to: '2025-03-01' });
  });
  it('this year so far runs to the end of yesterday; visitors aren’t compared with last year', () => {
    const r = periodRanges('year', '2026-10-12');
    expect(r.now).toEqual({ from: '2026-01-01', to: '2026-10-12', people: { period: 'year', startsOn: '2026-01-01' } });
    expect(r.before).toBeNull();
    expect(r.lastYear).toEqual({ from: '2025-01-01', to: '2025-10-12', people: null });
  });
  it('a Toronto day changes at Toronto midnight', () => {
    expect(torontoDate(new Date('2025-11-02T03:30:00Z'))).toBe('2025-11-01');
    expect(torontoDate(new Date('2025-11-02T05:30:00Z'))).toBe('2025-11-02');
  });
});

describe('words on the owner’s page', () => {
  it('hides small figures, and says changes in words', () => {
    expect(small(0)).toBe('0');
    expect(small(4)).toBe('fewer than 5');
    expect(small(5)).toBe('5');
    expect(change(12, 6, 'the week before')).toBe('Up 6 on the week before');
    expect(change(3, 5, 'the week before')).toBe('Down 2 on the week before');
    expect(change(5, 5, 'the week before')).toBe('Same as the week before');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st']);
    expect(duration(45)).toBe('45 s');
    expect(duration(80)).toBe('1 min 20 s');
    expect(duration(120)).toBe('2 min');
  });
});
