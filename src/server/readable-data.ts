import { type ChangeSet, describeChanges } from './owner-changes';

/**
 * The readable copy of Download your data (M21, D-54): the same information as the data file,
 * as a page that opens in any browser and prints, with headings, tables and dates in words.
 * Plain HTML with no styling of its own (every colour and size lives in tokens.css, and this
 * file is opened away from the site). Everything typed by anyone is escaped.
 */

/** The file's sections, in the order people look for them; anything else follows under its own name. */
const SECTIONS: [string, string][] = [
  ['account', 'Your account'],
  ['optional_details', 'Your optional details'],
  ['email_choices', 'Your email choices'],
  ['events', 'Your events'],
  ['saved_businesses', 'Saved businesses'],
  ['conversations', 'Your conversations'],
  ['reviews', 'Your reviews'],
  ['inquiries', 'Inquiries'],
  ['suggested_businesses', 'Businesses you suggested'],
  ['reports_you_made', 'Reports you made'],
  ['claims', 'Businesses you claimed'],
  ['business_teams', 'Business teams you’re or were on'],
  ['for_your_businesses', 'What you did for your businesses'],
  ['activity', 'How you used Localites'],
  ['searches', 'Your searches'],
];
const SKIP = new Set(['made_at', 'about']);
/** Long lists in the readable copy: this many (the newest, for activity and searches; all are in the data file). */
export const READABLE_ROWS = 500;
/** Past this much information, the copy would take too long to make: the page says so instead. */
export const READABLE_MAX_CHARS = 150_000;

// Kept quick: a busy account's copy has thousands of values, and a request has 10 ms of work (ADR-005).
const ENTITY: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const SPECIAL = /[&<>"']/g;
const escape = (s: string) => s.replace(SPECIAL, (c) => ENTITY[c]!);

const labels = new Map<string, string>();
const label = (key: string) => {
  let l = labels.get(key);
  if (l === undefined) {
    const words = key.replace(/_/g, ' ');
    l = escape(words.charAt(0).toUpperCase() + words.slice(1));
    labels.set(key, l);
  }
  return l;
};

const WHEN = new Intl.DateTimeFormat('en-CA', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Toronto' });
const DAY = new Intl.DateTimeFormat('en-CA', { dateStyle: 'long', timeZone: 'UTC' });

function text(value: unknown): string {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  const s = String(value);
  if (s.charCodeAt(4) === 45 && s.charCodeAt(7) === 45) {
    if (s.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(s)) return DAY.format(new Date(`${s}T00:00:00Z`));
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !Number.isNaN(Date.parse(s))) return WHEN.format(new Date(s));
  }
  // Line breaks people typed stay.
  return s.includes('\n') ? escape(s).replace(/\r?\n/g, '<br>') : escape(s);
}

// An empty list counts as plain (a "—" in its table cell), so rows without answers stay a table.
const isPlain = (v: unknown) => v === null || typeof v !== 'object' || (Array.isArray(v) && v.length === 0);
const isChange = (v: unknown) => Boolean(v) && typeof v === 'object' && !Array.isArray(v) && 'from' in (v as object) && 'to' in (v as object);

function value(key: string, v: unknown, depth: number): string {
  if (key === 'changes' && v && typeof v === 'object' && Object.values(v).every(isChange)) {
    const lines = describeChanges(v as ChangeSet, () => 'a service');
    return lines.length ? `<ul>${lines.map((l) => `<li>${escape(l)}</li>`).join('')}</ul>` : '—';
  }
  if (Array.isArray(v)) return list(v, depth);
  if (v && typeof v === 'object') return fields(v as Record<string, unknown>, depth);
  return text(v);
}

function fields(o: Record<string, unknown>, depth: number): string {
  const rows = Object.entries(o).map(([k, v]) => `<dt>${label(k)}</dt><dd>${value(k, v, depth + 1)}</dd>`);
  return rows.length ? `<dl>${rows.join('')}</dl>` : '—';
}

function list(items: unknown[], depth: number): string {
  if (items.length === 0) return '<p>None.</p>';
  if (items.every(isPlain)) return `<ul>${items.map((i) => `<li>${text(i)}</li>`).join('')}</ul>`;
  const objects = items.filter((i): i is Record<string, unknown> => Boolean(i) && typeof i === 'object' && !Array.isArray(i));
  // Rows of plain values: a table. Anything with lists inside: one block each.
  if (objects.length === items.length && objects.every((o) => Object.values(o).every(isPlain))) {
    const keys = [...new Set(objects.flatMap((o) => Object.keys(o)))];
    const head = keys.map((k) => `<th scope="col">${label(k)}</th>`).join('');
    const body = objects.map((o) => `<tr>${keys.map((k) => `<td>${text(o[k])}</td>`).join('')}</tr>`).join('');
    return `<table border="1" cellpadding="4"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }
  const h = `h${Math.min(depth + 3, 6)}`;
  return items
    .map((item, n) => {
      const o = item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : null;
      const title = o ? (o.business ?? o.name ?? o.date ?? null) : null;
      return `<section><${h}>${title ? text(title) : `Item ${n + 1}`}</${h}>${value('', item, depth)}</section>`;
    })
    .join('');
}

/**
 * `totals`: how many there were of a list the database already cut to READABLE_ROWS.
 */
export function readableData(data: Record<string, unknown>, totals: Record<string, number> = {}): string {
  const keys = [...SECTIONS.map(([k]) => k), ...Object.keys(data).filter((k) => !SKIP.has(k) && !SECTIONS.some(([s]) => s === k))];
  const parts = keys
    .filter((k) => k in data)
    .map((k) => {
      const heading = SECTIONS.find(([s]) => s === k)?.[1] ?? label(k);
      let v = data[k];
      const total = Math.max(totals[k] ?? 0, Array.isArray(v) ? v.length : 0);
      if (Array.isArray(v) && v.length > READABLE_ROWS) v = v.slice(0, READABLE_ROWS);
      const note = total > READABLE_ROWS ? `<p>Showing ${READABLE_ROWS} of ${total}. All of them are in the data file.</p>` : '';
      return `<section><h2>${escape(heading)}</h2>${note}${value(k, v, 0)}</section>`;
    });
  return page([
    `<p>Made ${text(data.made_at)}.</p>`,
    typeof data.about === 'string' ? `<p>${escape(data.about)}</p>` : '',
    ...parts,
  ]);
}

/** Said instead, for an account with more than READABLE_MAX_CHARS of information. */
export function tooLongForReadable(): string {
  return page([
    '<p>You have more information on Localites than the readable copy can hold. Everything is in the data file: download it from',
    'Your account, then Download your data. If you’d like a readable copy anyway, email supportlocalites@gmail.com and we’ll send one.</p>',
  ]);
}

const page = (body: string[]) =>
  [
    '<!doctype html>',
    '<html lang="en-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Your information on Localites</title></head><body>',
    '<h1>Your information on Localites</h1>',
    ...body,
    '</body></html>',
  ].join('\n');
