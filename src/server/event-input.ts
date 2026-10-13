import { z } from 'zod';
import { isUuid, SLUG, slugify } from '@/lib/ids.mjs';
import { tidyLine, tidyParagraphs } from '@/lib/owner-text';
import { PLAN_LIMITS } from '@/lib/plan-terms';

/**
 * What a person types when they plan an event (C2, C4), what a business types when it says
 * a booking isn't right (V8), and what the team types about event types (X12, D-43). The
 * database checks the same rules again (migration 0012); these give the plain words.
 */

export type EventValues = {
  /** The event's name (D-39): required, private to the person. */
  title: string;
  /** Optional, one tap (D-39). */
  typeId: string | null;
  date: string;
  townId: string;
  startTime: string | null;
  endTime: string | null;
  venueNote: string | null;
  guests: number | null;
  ageMin: number | null;
  ageMax: number | null;
  budgetCents: number | null;
  notes: string | null;
};

/** The form's boxes, by name. */
export type EventField =
  | 'title'
  | 'typeId'
  | 'date'
  | 'townId'
  | 'startTime'
  | 'endTime'
  | 'venueNote'
  | 'guests'
  | 'ageMin'
  | 'ageMax'
  | 'budget'
  | 'notes';
export type EventErrors = Partial<Record<EventField, string>>;
export type EventInputResult = { ok: true; values: EventValues } | { ok: false; errors: EventErrors };

export const EVENT_MESSAGES = {
  title: 'Give your event a name.',
  type: 'Choose a kind of event from the list, or none.',
  date: 'Choose the date.',
  dateWindow: `Choose a date in the last ${PLAN_LIMITS.pastDays} days or the next ${PLAN_LIMITS.futureYears} years.`,
  town: 'Choose the town.',
  endWithoutStart: 'Add a start time before an end time.',
  time: 'Use a time like 1:00 pm.',
  guests: `Enter a number of guests from ${PLAN_LIMITS.guestsMin} to ${PLAN_LIMITS.guestsMax.toLocaleString('en-CA')}, or leave it empty.`,
  ages: `Ages go from 0 to ${PLAN_LIMITS.ageMax}.`,
  agesOrder: 'Put the younger age first.',
  budget: 'Enter the budget in dollars, like 300 or 249.99, or leave it empty.',
} as const;

export const tooLong = (n: number) => `That’s too long. Keep it to ${n.toLocaleString('en-CA')} characters.`;

// ------------------------------------------------------------------ dates (Toronto)

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (s: string) => new Date(`${s}T00:00:00Z`);
const asText = (d: Date) => d.toISOString().slice(0, 10);

/** A real calendar date written YYYY-MM-DD (2026-02-30 isn't). */
export const isRealDate = (s: string) => DATE.test(s) && !Number.isNaN(asDate(s).getTime()) && asText(asDate(s)) === s;

const addDays = (s: string, n: number) => asText(new Date(asDate(s).getTime() + n * 86_400_000));

/** Years later, as Postgres counts them: 29 February becomes 28 February. */
function addYears(s: string, n: number): string {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y + n, m, 0)).getUTCDate();
  return `${y + n}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** The dates an event may have, from today's Toronto date (the database checks the same, LP105). */
export function dateWindow(todayIso: string): { min: string; max: string } {
  return { min: addDays(todayIso, -PLAN_LIMITS.pastDays), max: addYears(todayIso, PLAN_LIMITS.futureYears) };
}

// ------------------------------------------------------------------ the event form

const TIME = /^([01]\d|2[0-3]):([0-5]\d)(:00)?$/;
const WHOLE = /^\d{1,7}$/;
const BUDGET = /^\$?\d{1,3}(,?\d{3})*(\.\d{1,2})?$/;

/** Checks C2 (`full`) or C4's quick form (name, kind, date and town only). */
function parse(fields: Record<string, string>, todayIso: string, full: boolean, storedDate: string | null = null): EventInputResult {
  const errors: EventErrors = {};
  const raw = (k: string) => (fields[k] ?? '').trim();
  const text = (key: EventField, tidy: (s: string) => string, max: number): string | null => {
    const s = tidy(fields[key] ?? '');
    if (s.length > max) errors[key] ??= tooLong(max);
    return s || null;
  };
  const whole = (key: EventField, min: number, max: number, message: string): number | null => {
    const s = raw(key).replace(/,/g, '');
    if (!s) return null;
    if (!WHOLE.test(s) || Number(s) < min || Number(s) > max) {
      errors[key] ??= message;
      return null;
    }
    return Number(s);
  };

  const title = text('title', tidyLine, PLAN_LIMITS.title);
  if (!title) errors.title ??= EVENT_MESSAGES.title;

  // "None" (or nothing chosen) skips the kind of event.
  const type = raw('typeId');
  const typeId = type === '' || type === 'none' ? null : isUuid(type) ? type.toLowerCase() : null;
  if (type !== '' && type !== 'none' && typeId === null) errors.typeId = EVENT_MESSAGES.type;

  const date = raw('date');
  if (!isRealDate(date)) errors.date = EVENT_MESSAGES.date;
  else if (date !== storedDate) {
    // The window applies to a new or changed date only: an older event's other details can
    // still be edited (the database checks the same way).
    const { min, max } = dateWindow(todayIso);
    if (date < min || date > max) errors.date = EVENT_MESSAGES.dateWindow;
  }

  const town = raw('townId');
  if (!isUuid(town)) errors.townId = EVENT_MESSAGES.town;

  const values: EventValues = {
    title: title ?? '',
    typeId,
    date,
    townId: town.toLowerCase(),
    startTime: null,
    endTime: null,
    venueNote: null,
    guests: null,
    ageMin: null,
    ageMax: null,
    budgetCents: null,
    notes: null,
  };

  if (full) {
    const time = (key: 'startTime' | 'endTime') => {
      const s = raw(key);
      if (!s) return null;
      const m = TIME.exec(s);
      if (!m) {
        errors[key] ??= EVENT_MESSAGES.time;
        return null;
      }
      return `${m[1]}:${m[2]}`;
    };
    values.startTime = time('startTime');
    values.endTime = time('endTime');
    if (values.endTime && !values.startTime && !errors.startTime) errors.startTime = EVENT_MESSAGES.endWithoutStart;

    values.guests = whole('guests', PLAN_LIMITS.guestsMin, PLAN_LIMITS.guestsMax, EVENT_MESSAGES.guests);
    values.ageMin = whole('ageMin', 0, PLAN_LIMITS.ageMax, EVENT_MESSAGES.ages);
    values.ageMax = whole('ageMax', 0, PLAN_LIMITS.ageMax, EVENT_MESSAGES.ages);
    if (values.ageMin !== null && values.ageMax !== null && values.ageMin > values.ageMax) errors.ageMin ??= EVENT_MESSAGES.agesOrder;

    const budget = raw('budget').replace(/\s+/g, '');
    if (budget) {
      const dollars = BUDGET.test(budget) ? Number(budget.replace(/[$,]/g, '')) : NaN;
      if (Number.isFinite(dollars) && dollars <= PLAN_LIMITS.budgetMaxDollars) values.budgetCents = Math.round(dollars * 100);
      else errors.budget = EVENT_MESSAGES.budget;
    }

    values.venueNote = text('venueNote', tidyLine, PLAN_LIMITS.venue);
    values.notes = text('notes', tidyParagraphs, PLAN_LIMITS.notes);
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values };
}

/**
 * C2: the whole form. `todayIso` is today's Toronto date (torontoDate). When editing, pass
 * the event's stored date: keeping it is always allowed, even once it's outside the window.
 */
export function parseEventForm(fields: Record<string, string>, todayIso: string, storedDate: string | null = null): EventInputResult {
  return parse(fields, todayIso, true, storedDate);
}

/** C4's quick form: name, kind of event (optional), date and town; the rest can be added later. */
export function parseQuickEventForm(fields: Record<string, string>, todayIso: string): EventInputResult {
  return parse(fields, todayIso, false);
}

// ------------------------------------------------------------------ a business's flag (V8)

/** "Anything we should know?" (optional, only the team sees it, D-41): tidied; empty is null. */
export const flagInput = z.object({
  note: z
    .string()
    .default('')
    .transform(tidyParagraphs)
    .pipe(z.string().max(PLAN_LIMITS.flagNote, tooLong(PLAN_LIMITS.flagNote)))
    .transform((s) => s || null),
});

// ------------------------------------------------------------------ the team's event types (X12, D-43)

const order = z
  .string()
  .default('')
  .transform((s) => s.trim())
  .pipe(z.string().regex(/^\d{1,4}$/, 'Enter an order from 0 to 9999.'))
  .transform(Number);

/** Add or change a kind of event. `shown` is the checkbox "Shown to people planning". */
export const eventTypeInput = z.object({
  name: z
    .string()
    .default('')
    .transform(tidyLine)
    .pipe(z.string().min(1, 'Give the kind of event a name.').max(60, 'Keep the name to 60 characters.')),
  sortOrder: order,
  shown: z
    .string()
    .optional()
    .transform((s) => s === 'on' || s === 'yes'),
});
export type EventTypeInput = z.output<typeof eventTypeInput>;

const KEY = /^[a-z][a-z0-9_]{1,62}$/;

/**
 * The key for a new kind of event, made from its name and never changed afterwards:
 * "Kids’ Party!" → kids_party; a key already taken gets _2, _3 …
 */
export function eventTypeKey(name: string, taken: Set<string>): string {
  let base = slugify(name).replace(/-/g, '_').slice(0, 58).replace(/_+$/, '');
  if (!/^[a-z]/.test(base)) base = `type_${base}`.replace(/_+$/, '');
  if (!KEY.test(base)) base = 'type';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
}

export type Suggestion = { categoryId: string; sortOrder: number };

/**
 * The kinds of business suggested for a kind of event (D-43): a ticked box `cat.<id>` with
 * its order `order.<id>`. Returns null when something on the page was out of date.
 */
export function parseSuggestions(fields: Record<string, string>): Suggestion[] | null {
  const chosen: Suggestion[] = [];
  for (const [key, value] of Object.entries(fields)) {
    const m = /^cat\.(.+)$/.exec(key);
    if (!m || value !== 'on') continue;
    if (!isUuid(m[1]!)) return null;
    const o = (fields[`order.${m[1]}`] ?? '').trim();
    const sortOrder = o === '' ? (chosen.length + 1) * 10 : /^\d{1,4}$/.test(o) ? Number(o) : null;
    if (sortOrder === null) return null;
    chosen.push({ categoryId: m[1]!.toLowerCase(), sortOrder });
  }
  return chosen.length > PLAN_LIMITS.suggestedMax ? null : chosen;
}

/** Feature a business for a kind of event between two Toronto dates (D-43). No money is recorded. */
export const featuredInput = z
  .object({
    vendorSlug: z
      .string()
      .default('')
      .transform((s) => s.trim().toLowerCase())
      .pipe(z.string().regex(SLUG, 'Choose a business that’s listed on Localites.')),
    startsOn: z.string().default('').refine(isRealDate, 'Choose the first day.'),
    endsOn: z.string().default('').refine(isRealDate, 'Choose the last day.'),
    note: z
      .string()
      .default('')
      .transform(tidyLine)
      .pipe(z.string().max(PLAN_LIMITS.featuredNote, tooLong(PLAN_LIMITS.featuredNote)))
      .transform((s) => s || null),
  })
  .refine((f) => f.endsOn >= f.startsOn, { path: ['endsOn'], message: 'The last day can’t be before the first.' });
export type FeaturedInput = z.output<typeof featuredInput>;

/**
 * The most placements that overlap on any one day (D-43: only 3 are shown per kind of
 * event, so the team page warns above that). Ranges are Toronto dates, both included.
 */
export function mostOverlapping(ranges: { startsOn: string; endsOn: string }[]): number {
  const edges = ranges.flatMap((r) => [
    { at: r.startsOn, step: 1 },
    { at: addDays(r.endsOn, 1), step: -1 },
  ]);
  edges.sort((a, b) => (a.at === b.at ? a.step - b.step : a.at < b.at ? -1 : 1));
  let now = 0;
  let most = 0;
  for (const e of edges) {
    now += e.step;
    most = Math.max(most, now);
  }
  return most;
}
