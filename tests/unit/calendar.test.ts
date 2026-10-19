import { describe, expect, it } from 'vitest';
import { calendarFile, calendarLinks, zonedToUtc } from '@/lib/calendar';

// "Add to your calendar" (Stage 4): the right moment in every calendar, whatever the season.
const party = {
  title: 'Sam’s 8th, with cake; games',
  date: '2026-10-20',
  startTime: '14:00',
  endTime: '17:00',
  timezone: 'America/Toronto',
  location: 'Our backyard, Orillia',
  details: 'Bring a swimsuit!\nFrom Ann',
};

describe('calendar', () => {
  it('turns Orillia time into the right moment, summer and winter', () => {
    expect(new Date(zonedToUtc('2026-07-01', '14:00', 'America/Toronto')).toISOString()).toBe('2026-07-01T18:00:00.000Z');
    expect(new Date(zonedToUtc('2026-12-01', '14:00', 'America/Toronto')).toISOString()).toBe('2026-12-01T19:00:00.000Z');
  });
  it('makes links for Google, Outlook, Microsoft 365 and Yahoo', () => {
    const l = calendarLinks(party);
    expect(l.google).toContain('dates=20261020T180000Z%2F20261020T210000Z');
    expect(l.outlook).toContain('startdt=2026-10-20T18%3A00%3A00Z');
    expect(l.office365.startsWith('https://outlook.office.com/')).toBe(true);
    expect(l.yahoo).toContain('st=20261020T180000Z');
  });
  it('a whole-day event, and one with no end time (2 hours)', () => {
    expect(calendarLinks({ ...party, startTime: null, endTime: null }).google).toContain('dates=20261020%2F20261021');
    expect(calendarLinks({ ...party, endTime: null }).google).toContain('20261020T200000Z');
  });
  it('a calendar file: escaped, folded, the same id each time', () => {
    const f = calendarFile(party, 'abc', Date.UTC(2026, 9, 14));
    expect(f).toContain('DTSTART:20261020T180000Z');
    expect(f).toContain('SUMMARY:Sam’s 8th\\, with cake\\; games');
    expect(f).toContain('DESCRIPTION:Bring a swimsuit!\\nFrom Ann');
    expect(f).toContain('UID:abc@localites.ca');
    expect(f.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
  });
  it('a later file for the same guest has a higher SEQUENCE, so adding it again updates the entry (M11)', () => {
    const seq = (f: string) => Number(/SEQUENCE:(\d+)/.exec(f)?.[1]);
    expect(seq(calendarFile(party, 'abc', Date.UTC(2026, 9, 15)))).toBeGreaterThan(seq(calendarFile(party, 'abc', Date.UTC(2026, 9, 14))));
  });
  it('long titles with accents and emoji fold by bytes, never mid-letter; a lone line break is escaped', () => {
    const f = calendarFile({ ...party, title: 'Fête 🎉 '.repeat(20), details: 'a\rb' }, 'abc', 0);
    expect(f.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
    expect(f).not.toContain('\uFFFD');
    expect(f.replace(/\r\n /g, '')).toContain(`SUMMARY:${'Fête 🎉 '.repeat(20)}`);
    expect(f).toContain('DESCRIPTION:a\\nb');
  });
});
