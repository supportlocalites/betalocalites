import { describe, expect, it } from 'vitest';
import { READABLE_MAX_CHARS, READABLE_ROWS, readableData, tooLongForReadable } from '@/server/readable-data';

describe('the readable copy of Download your data (M21, D-54)', () => {
  const page = readableData({
    made_at: '2026-10-19T16:30:00+00:00',
    about: 'Your information',
    account: { name: 'Pat Q.', email: 'pat@example.com', joined: '2026-10-01T12:00:00Z' },
    events: [{ name: '<b>Party</b>', date: '2026-11-02', notes: 'Line one\nLine two', businesses: [{ business: 'Vee', status: 'booked' }] }],
    saved_businesses: [],
    for_your_businesses: [
      { business: 'Vee', page_changes_you_saved: [{ saved: '2026-10-19T12:00:00Z', changes: { name: { from: 'Old', to: 'New' } } }] },
    ],
    activity: Array.from({ length: READABLE_ROWS + 3 }, (_, i) => ({ what: `view ${i}`, seconds: i })),
    something_new: { yes: true },
  });

  it('is a whole page, with the sections in order and a heading each', () => {
    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(page.indexOf('<h2>Your account</h2>')).toBeLessThan(page.indexOf('<h2>Your events</h2>'));
    expect(page.indexOf('<h2>Your events</h2>')).toBeLessThan(page.indexOf('<h2>What you did for your businesses</h2>'));
    expect(page).toContain('<h2>Something new</h2>');
  });

  it('shows dates and choices in words, and an empty list as “None.”', () => {
    expect(page).toContain('Made October 19, 2026');
    expect(page).toContain('November 2, 2026');
    expect(page).toContain('<dd>Yes</dd>');
    expect(page).toMatch(/<h2>Saved businesses<\/h2><p>None\.<\/p>/);
  });

  it('escapes everything typed, keeping line breaks', () => {
    expect(page).not.toContain('<b>Party</b>');
    expect(page).toContain('&lt;b&gt;Party&lt;/b&gt;');
    expect(page).toContain('Line one<br>Line two');
  });

  it('says a change to a page in plain words', () => {
    expect(page).toContain('Business name: “Old” → “New”');
  });

  it('shows the newest rows of a very long list, and says so', () => {
    expect(page).toContain(`Showing ${READABLE_ROWS} of ${READABLE_ROWS + 3}`);
    expect(page).toContain(`view ${READABLE_ROWS - 1}`);
    expect(page).not.toContain(`view ${READABLE_ROWS}<`);
  });
});

describe('the readable copy, when lists were cut or there is too much', () => {
  it('says how many there were when the database already cut a list', () => {
    const page = readableData({ activity: [{ what: 'view' }] }, { activity: 4321 });
    expect(page).toContain(`Showing ${READABLE_ROWS} of 4321`);
  });

  it('says plainly when an account is too big for it', () => {
    expect(tooLongForReadable()).toContain('Everything is in the data file');
    expect(READABLE_MAX_CHARS).toBeLessThanOrEqual(150_000);
  });
});
