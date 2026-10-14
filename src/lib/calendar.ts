/**
 * "Add to your calendar" for a guest (Stage 4): links for Google, Outlook.com, Microsoft 365
 * and Yahoo, and a calendar file (.ics) that Apple Calendar, Outlook on a computer and most
 * other calendars open. Nothing is stored or sent anywhere until the guest taps one. Never
 * the guest's invitation link (it would hand it to the calendar company).
 */

export type CalendarEvent = {
  title: string;
  /** YYYY-MM-DD in the event's own time zone. */
  date: string;
  /** HH:MM, or null for a whole-day event. */
  startTime: string | null;
  endTime: string | null;
  timezone: string;
  location: string;
  details: string;
};

/** Minutes the zone is ahead of UTC at that moment (e.g. -240 for Toronto in summer). */
function offsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return (Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - utcMs) / 60000;
}

/** A wall-clock time in a zone, as the moment it is (milliseconds since 1970, UTC). */
export function zonedToUtc(date: string, time: string, timeZone: string): number {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const wall = Date.UTC(y!, mo! - 1, d!, h!, mi!);
  const first = wall - offsetMinutes(wall, timeZone) * 60000;
  return wall - offsetMinutes(first, timeZone) * 60000;
}

const addDays = (date: string, days: number) => {
  const t = new Date(`${date}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};

/** Start and end: exact moments, or whole days (the end day is the day after). */
export function eventTimes(e: CalendarEvent): { allDay: true; start: string; end: string } | { allDay: false; start: number; end: number } {
  if (!e.startTime) return { allDay: true, start: e.date, end: addDays(e.date, 1) };
  const start = zonedToUtc(e.date, e.startTime, e.timezone);
  let end = e.endTime ? zonedToUtc(e.date, e.endTime, e.timezone) : start + 2 * 3600_000; // no end given: 2 hours
  if (end <= start) end += 24 * 3600_000; // runs past midnight
  return { allDay: false, start, end };
}

const stamp = (ms: number) =>
  new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, ''); // 20261020T180000Z
const day = (iso: string) => iso.replace(/-/g, '');
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}/, '');

export function calendarLinks(e: CalendarEvent): { google: string; outlook: string; office365: string; yahoo: string } {
  const t = eventTimes(e);
  const google = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: t.allDay ? `${day(t.start)}/${day(t.end)}` : `${stamp(t.start)}/${stamp(t.end)}`,
    details: e.details,
    location: e.location,
  });
  const outlookParams = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: e.title,
    startdt: t.allDay ? t.start : iso(t.start),
    enddt: t.allDay ? t.end : iso(t.end),
    allday: String(t.allDay),
    body: e.details,
    location: e.location,
  });
  const yahoo = new URLSearchParams(
    t.allDay
      ? { v: '60', title: e.title, st: day(t.start), dur: 'allday', desc: e.details, in_loc: e.location }
      : { v: '60', title: e.title, st: stamp(t.start), et: stamp(t.end), desc: e.details, in_loc: e.location },
  );
  return {
    google: `https://calendar.google.com/calendar/render?${google}`,
    outlook: `https://outlook.live.com/calendar/0/deeplink/compose?${outlookParams}`,
    office365: `https://outlook.office.com/calendar/0/deeplink/compose?${outlookParams}`,
    yahoo: `https://calendar.yahoo.com/?${yahoo}`,
  };
}

/** Text in a calendar file: backslashes, commas, semicolons and line breaks escaped. */
const text = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Lines longer than 75 characters continue on the next line, after a space (RFC 5545). */
const fold = (line: string) => {
  const out: string[] = [];
  for (let i = 0; i < line.length; i += 74) out.push((i ? ' ' : '') + line.slice(i, i + 74));
  return out.join('\r\n');
};

/** A calendar file with this one event. uid: the same each time for one guest, so adding again updates it. */
export function calendarFile(e: CalendarEvent, uid: string, nowMs: number): string {
  const t = eventTimes(e);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Localites//Invitation//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}@localites.ca`,
    `DTSTAMP:${stamp(nowMs)}`,
    ...(t.allDay
      ? [`DTSTART;VALUE=DATE:${day(t.start)}`, `DTEND;VALUE=DATE:${day(t.end)}`]
      : [`DTSTART:${stamp(t.start)}`, `DTEND:${stamp(t.end)}`]),
    `SUMMARY:${text(e.title)}`,
    `LOCATION:${text(e.location)}`,
    `DESCRIPTION:${text(e.details)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
