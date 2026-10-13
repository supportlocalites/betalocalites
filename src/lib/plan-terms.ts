/**
 * Words and limits for planning an event (slice 2A: D-13, D-39–D-43, ADR-031) that screens
 * and emails show. Plain functions with no other imports, so pages can use them without
 * sending the input checks (src/server/event-input.ts) to the browser. Scanned by
 * `npm run check:words`.
 */

export const PLAN_LIMITS = {
  title: 120,
  venue: 200,
  notes: 5000,
  guestsMin: 1,
  guestsMax: 5000,
  ageMax: 120,
  budgetMaxDollars: 1_000_000,
  /** The date window (Toronto dates), the same as the database's (LP105). */
  pastDays: 60,
  futureYears: 3,
  flagNote: 1000,
  /** Caps per person, counted in the database (PlanCapped). */
  eventsPerDay: 10,
  openEvents: 50,
  vendorsPerEvent: 40,
  bookedMarksPerDay: 15,
  savedMax: 500,
  /** Featured businesses shown per kind of event (D-43), and the team's note on one. */
  featuredShown: 3,
  featuredNote: 500,
  /** Suggested kinds of business per kind of event (D-43). */
  suggestedMax: 30,
} as const;

export type PlanStatus = 'considering' | 'booked' | 'removed';

export const STATUS_WORDS = { considering: 'Considering', booked: 'You marked this booked' } as const;

export const NO_PAYMENTS_PERSON = 'Localites doesn’t process payments. Arrange payment directly with the business.';
export const NO_PAYMENTS_BUSINESS = 'Localites doesn’t process payments. Arrange payment directly with your customer.';

/** C2's privacy box (D-40): exactly what a business sees once it's marked booked. */
export const BOOKED_SEES =
  'If you mark a business as booked, they’ll see your name, the date, the town and about how many guests. ' +
  'Never the name you give the event, where it is, the ages, your budget or your notes.';

/** Always shown with featured businesses (D-43), never hidden in a tooltip. */
export const FEATURED_LINE = 'Featured businesses are promoted by the Localites team.';

/** Shown on a plan with no kind of event chosen (D-43), linking to Edit details. */
export const NO_TYPE_IDEAS = 'Tell us what kind of event it is to see ideas.';

/** Every 2A form, when the per-person limit (PLAN_LIMIT) is reached. */
export const TOO_FAST = 'You’re going a bit fast. Please wait a minute and try again.';

/**
 * Plain words for a refusal: the database's LPnnn codes (migration 0012) and the server's
 * own caps. LP101 (not yours) is never shown: it is answered as "not found".
 */
export const PLAN_REFUSALS: Record<string, string> = {
  LP100: 'That can’t be changed.',
  LP102: 'This event is cancelled, so it can’t be changed.',
  LP103: 'That kind of event isn’t offered any more. Please choose another.',
  LP104: 'Localites doesn’t cover that town yet. Please choose another.',
  LP105: 'Choose a date in the last 60 days or the next 3 years.',
  LP107: 'That business isn’t listed on Localites right now.',
  LP108: 'This is your business, so it can’t go on your own event plan.',
  LP109: 'That change isn’t possible right now.',
  LP110: 'You’ve already told us about this booking.',
  duplicate: 'That’s already there.',
  eventsPerDay: 'You’ve planned a lot of events today. Please try again tomorrow.',
  openEvents: `You have ${PLAN_LIMITS.openEvents} events on the go. Cancel one you no longer need first.`,
  vendorsPerEvent: `This event already has ${PLAN_LIMITS.vendorsPerEvent} businesses on it. Remove one first.`,
  bookedMarksPerDay: 'You’ve marked a lot of businesses booked today. Please try again tomorrow.',
  savedMax: 'Your saved list is full. Remove one first.',
};

// ------------------------------------------------------------------ dates and times

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A bare date (YYYY-MM-DD) read as a calendar day: never shifted by anyone's time zone. */
const parts = (isoDate: string) => {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  return { weekday: d.getUTCDay(), day: d.getUTCDate(), month: d.getUTCMonth(), year: d.getUTCFullYear() };
};

/** "Saturday 14 November"; with today's date, the year is added when it isn't this year. */
export function longDate(isoDate: string, todayIso?: string): string {
  const p = parts(isoDate);
  const year = todayIso && todayIso.slice(0, 4) !== String(p.year) ? ` ${p.year}` : '';
  return `${WEEKDAYS[p.weekday]} ${p.day} ${MONTHS[p.month]}${year}`;
}

/** "Saturday 14 November 2026": emails always give the year (they may be read much later). */
export function longDateWithYear(isoDate: string): string {
  return `${longDate(isoDate)} ${parts(isoDate).year}`;
}

/** "Sat 14 Nov"; with today's date, the year is added when it isn't this year. */
export function shortDate(isoDate: string, todayIso?: string): string {
  const p = parts(isoDate);
  const year = todayIso && todayIso.slice(0, 4) !== String(p.year) ? ` ${p.year}` : '';
  return `${WEEKDAYS[p.weekday]!.slice(0, 3)} ${p.day} ${MONTHS[p.month]!.slice(0, 3)}${year}`;
}

/** "13:00" or "13:00:00" → { hour 1, minutes '', half 'pm' } for "1 pm" / "1:30 pm". */
const clock = (t: string) => {
  const [h = 0, m = 0] = t.split(':').map(Number);
  return { text: `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, '0')}` : ''}`, half: h < 12 ? 'am' : 'pm' };
};

/** "1–4 pm", "11 am – 1 pm", "1 pm", or null without a start time. */
export function timeRange(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const s = clock(start);
  if (!end) return `${s.text} ${s.half}`;
  const e = clock(end);
  return s.half === e.half ? `${s.text}–${e.text} ${e.half}` : `${s.text} ${s.half} – ${e.text} ${e.half}`;
}

const dayNumber = (isoDate: string) => Math.round(new Date(`${isoDate.slice(0, 10)}T00:00:00Z`).getTime() / 86_400_000);

/** "Today", "Tomorrow", "In 36 days", "Yesterday", "3 days ago"; null once it's more than 60 days ago. */
export function whenWords(isoDate: string, todayIso: string): string | null {
  const n = dayNumber(isoDate) - dayNumber(todayIso);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n > 1) return `In ${n.toLocaleString('en-CA')} days`;
  if (n === -1) return 'Yesterday';
  return n >= -PLAN_LIMITS.pastDays ? `${-n} days ago` : null;
}

// ------------------------------------------------------------------ what's shown

/** "about 15 guests", or null when the person didn't say. */
export function guestsWords(n: number | null): string | null {
  if (n === null) return null;
  return `about ${n.toLocaleString('en-CA')} ${n === 1 ? 'guest' : 'guests'}`;
}

/** "$1,200" or "$249.99" (the person's own figure; only they see it). */
export function budgetWords(cents: number | null): string | null {
  if (cents === null) return null;
  const dollars = cents / 100;
  return `$${dollars.toLocaleString('en-CA', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/**
 * What a booked business is told about the event (D-40): "Orillia · about 15 guests". Its
 * argument has no room for the event's name, type, start time, where, ages, budget or notes.
 */
export function vendorSummary(s: { town: string; guests: number | null }): string {
  return [s.town, guestsWords(s.guests)].filter(Boolean).join(' · ');
}

/**
 * "Ideas for your children's birthday party" (D-43). The type's name in lower case when it
 * reads as ordinary words ("Work or team event"); a name with other capitals ("Canada Day
 * party") is kept as written. "Something else" is just "your event".
 */
export function ideasHeading(type: { key: string; name: string }): string {
  if (type.key === 'other') return 'Ideas for your event';
  const name = /[A-Z]/.test(type.name.slice(1)) ? type.name : type.name.charAt(0).toLowerCase() + type.name.slice(1);
  return `Ideas for your ${name}`;
}

export type NextStep = 'cancelled' | 'passed' | 'empty' | 'considering' | 'settled';

/** C3's "What's next" (no promises): which line to show. */
export function nextStep(p: { cancelled: boolean; passed: boolean; considering: number; booked: number }): NextStep {
  if (p.cancelled) return 'cancelled';
  if (p.passed) return 'passed';
  if (p.considering === 0 && p.booked === 0) return 'empty';
  return p.considering > 0 ? 'considering' : 'settled';
}

/**
 * What the edit and cancel pages promise about telling booked businesses: only the ones we
 * can tell (claimed, with someone to tell); the rest are named as not told (no promise we
 * can't keep).
 */
export function tellWords(booked: { told: number; notTold: number }, what: 'cancel' | 'change'): string[] {
  const out: string[] = [];
  const them = (n: number) => (n === 1 ? 'the business you marked as booked' : `the ${n} businesses you marked as booked`);
  if (booked.told > 0) {
    out.push(
      what === 'cancel'
        ? `We’ll let ${them(booked.told)} know it’s cancelled.`
        : `If you change the date or town, we’ll let ${them(booked.told)} know.`,
    );
  }
  if (booked.notTold > 0) {
    const n = booked.notTold;
    out.push(
      `${n === 1 ? 'One business you marked as booked isn’t' : `${n} businesses you marked as booked aren’t`} on Localites yet, so we can’t tell ${n === 1 ? 'it' : 'them'}. Contact ${n === 1 ? 'it' : 'them'} directly.`,
    );
  }
  if (what === 'cancel' && booked.told === 0 && booked.notTold === 0) out.push('No business is told.');
  return out;
}
