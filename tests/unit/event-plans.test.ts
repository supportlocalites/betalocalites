import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';
import { torontoDate } from '@/lib/activity';
import {
  BOOKED_SEES,
  budgetWords,
  guestsWords,
  ideasHeading,
  longDate,
  nextStep,
  PLAN_REFUSALS,
  shortDate,
  timeRange,
  vendorSummary,
  whenWords,
} from '@/lib/plan-terms';
import { actAs, PlanCapped, planFailure, PlanNotFound, PlanRefused } from '@/server/acting.server';
import type { Db } from '@/server/db.server';
import { renderEmail, type TemplateName } from '@/server/email-templates.server';
import { emailApiUrl } from '@/server/email.server';
import {
  dateWindow,
  EVENT_MESSAGES,
  eventTypeInput,
  eventTypeKey,
  featuredInput,
  flagInput,
  mostOverlapping,
  parseEventForm,
  parseQuickEventForm,
  parseSuggestions,
} from '@/server/event-input';
import type { BookingNotice } from '@/server/events.server';
import { bookingNoticeValues, flaggedPersonValues } from '@/server/plan-emails.server';

// Dates are read as calendar days: run as Toronto, where a slip to UTC would show.
process.env.TZ = 'America/Toronto';

const TODAY = '2026-10-12';
const TYPE = '01900000-0000-7000-8000-0000000000a1';
const TOWN = '01900000-0000-7000-8000-0000000000b1';
const form = (extra: Record<string, string> = {}) => ({ title: 'Sam’s party', typeId: TYPE, date: '2026-11-14', townId: TOWN, ...extra });

describe('planning an event: the form (D-39)', () => {
  it('needs a name, a date and a town; the kind of event is optional', () => {
    const r = parseEventForm({}, TODAY);
    expect(r).toEqual({ ok: false, errors: { title: EVENT_MESSAGES.title, date: EVENT_MESSAGES.date, townId: EVENT_MESSAGES.town } });
    expect(EVENT_MESSAGES.title).toBe('Give your event a name.');
    for (const skipped of ['', 'none']) {
      const ok = parseEventForm(form({ typeId: skipped }), TODAY);
      expect(ok.ok && ok.values.typeId).toBe(null);
    }
    expect(parseEventForm(form({ typeId: 'birthday' }), TODAY)).toEqual({ ok: false, errors: { typeId: EVENT_MESSAGES.type } });
    expect(parseEventForm(form({ townId: 'orillia' }), TODAY)).toEqual({ ok: false, errors: { townId: EVENT_MESSAGES.town } });
  });

  it('tidies the name and keeps it to 120 characters', () => {
    const r = parseEventForm(form({ title: '  Sam’s   party ' }), TODAY);
    expect(r.ok && r.values.title).toBe('Sam’s party');
    expect(parseEventForm(form({ title: '   ' }), TODAY)).toEqual({ ok: false, errors: { title: EVENT_MESSAGES.title } });
    expect(parseEventForm(form({ title: 'x'.repeat(121) }), TODAY)).toEqual({
      ok: false,
      errors: { title: 'That’s too long. Keep it to 120 characters.' },
    });
  });

  it('allows dates from 60 days back to 3 years ahead (Toronto), as the database does', () => {
    expect(dateWindow(TODAY)).toEqual({ min: '2026-08-13', max: '2029-10-12' });
    expect(dateWindow('2028-02-29').max).toBe('2031-02-28');
    for (const ok of ['2026-08-13', TODAY, '2029-10-12']) expect(parseEventForm(form({ date: ok }), TODAY).ok).toBe(true);
    for (const [bad, message] of [
      ['2026-08-12', EVENT_MESSAGES.dateWindow],
      ['2029-10-13', EVENT_MESSAGES.dateWindow],
      ['2026-02-30', EVENT_MESSAGES.date],
      ['14/11/2026', EVENT_MESSAGES.date],
    ]) {
      expect(parseEventForm(form({ date: bad! }), TODAY)).toEqual({ ok: false, errors: { date: message } });
    }
    // 23:30 in Toronto is already the next day in UTC: today is still Toronto's date.
    expect(torontoDate(new Date('2026-10-13T03:30:00Z'))).toBe('2026-10-12');
  });

  it('checks times, guests and ages', () => {
    const r = parseEventForm(form({ startTime: '13:00', endTime: '16:30:00', guests: '1,200', ageMin: '4', ageMax: '7' }), TODAY);
    expect(r.ok && [r.values.startTime, r.values.endTime, r.values.guests, r.values.ageMin, r.values.ageMax]).toEqual([
      '13:00',
      '16:30',
      1200,
      4,
      7,
    ]);
    expect(parseEventForm(form({ endTime: '16:00' }), TODAY)).toEqual({ ok: false, errors: { startTime: EVENT_MESSAGES.endWithoutStart } });
    expect(parseEventForm(form({ startTime: '1pm' }), TODAY)).toEqual({ ok: false, errors: { startTime: EVENT_MESSAGES.time } });
    for (const guests of ['0', '5001', '2.5', '-3', 'lots']) {
      expect(parseEventForm(form({ guests }), TODAY)).toEqual({ ok: false, errors: { guests: EVENT_MESSAGES.guests } });
    }
    expect(parseEventForm(form({ ageMin: '9', ageMax: '4' }), TODAY)).toEqual({ ok: false, errors: { ageMin: EVENT_MESSAGES.agesOrder } });
    expect(parseEventForm(form({ ageMax: '121' }), TODAY)).toEqual({ ok: false, errors: { ageMax: EVENT_MESSAGES.ages } });
  });

  it('reads the budget in dollars and keeps cents', () => {
    const cents = (budget: string) => {
      const r = parseEventForm(form({ budget }), TODAY);
      return r.ok ? r.values.budgetCents : r.errors.budget;
    };
    expect(cents('1,200.50')).toBe(120050);
    expect(cents('$300')).toBe(30000);
    expect(cents('249.99')).toBe(24999);
    expect(cents('1000000')).toBe(100000000);
    for (const bad of ['-5', 'abc', '1000001', '12.345', '1,20']) expect(cents(bad)).toBe(EVENT_MESSAGES.budget);
  });

  it('turns blank boxes into nothing and tidies text', () => {
    const r = parseEventForm(
      form({ startTime: '', guests: '', budget: ' ', venueNote: '  ', notes: ' Balloons\r\n\r\n\r\n  cake  ' }),
      TODAY,
    );
    expect(r.ok && r.values).toEqual({
      title: 'Sam’s party',
      typeId: TYPE,
      date: '2026-11-14',
      townId: TOWN,
      startTime: null,
      endTime: null,
      venueNote: null,
      guests: null,
      ageMin: null,
      ageMax: null,
      budgetCents: null,
      notes: 'Balloons\n\ncake',
    });
    expect(parseEventForm(form({ venueNote: 'x'.repeat(201) }), TODAY)).toEqual({
      ok: false,
      errors: { venueNote: 'That’s too long. Keep it to 200 characters.' },
    });
  });

  it('C4’s quick form takes only the name, kind, date and town', () => {
    const r = parseQuickEventForm(form({ guests: '0', budget: 'abc', notes: 'ignored', startTime: '13:00' }), TODAY);
    expect(r.ok && [r.values.guests, r.values.budgetCents, r.values.notes, r.values.startTime]).toEqual([null, null, null, null]);
    expect(parseQuickEventForm({ typeId: TYPE }, TODAY).ok).toBe(false);
  });
});

describe('what the team and businesses type (D-41, D-43)', () => {
  it('a flag note is optional, tidied and at most 1,000 characters', () => {
    expect(flagInput.parse({}).note).toBe(null);
    expect(flagInput.parse({ note: '  never heard of them  ' }).note).toBe('never heard of them');
    expect(flagInput.safeParse({ note: 'x'.repeat(1001) }).success).toBe(false);
  });

  it('event types: a name, an order and shown; the key is made from the name', () => {
    expect(eventTypeInput.parse({ name: ' Kids’  party ', sortOrder: '15', shown: 'on' })).toEqual({
      name: 'Kids’ party',
      sortOrder: 15,
      shown: true,
    });
    expect(eventTypeInput.parse({ name: 'Picnic', sortOrder: '0' }).shown).toBe(false);
    for (const bad of [
      { name: '', sortOrder: '1' },
      { name: 'x'.repeat(61), sortOrder: '1' },
      { name: 'Picnic', sortOrder: '-1' },
    ]) {
      expect(eventTypeInput.safeParse(bad).success).toBe(false);
    }
    expect(eventTypeKey('Kids’ Party!', new Set())).toBe('kids_party');
    expect(eventTypeKey('Kids’ Party!', new Set(['kids_party']))).toBe('kids_party_2');
    expect(eventTypeKey('Kids party', new Set(['kids_party', 'kids_party_2']))).toBe('kids_party_3');
    expect(eventTypeKey('50th anniversary', new Set())).toBe('type_50th_anniversary');
    expect(eventTypeKey('!!', new Set())).toBe('type');
    for (const name of ['Fête de famille', 'A', 'x'.repeat(60)]) expect(eventTypeKey(name, new Set())).toMatch(/^[a-z][a-z0-9_]{1,62}$/);
  });

  it('suggested kinds of business: ticked boxes with their order', () => {
    const A = '01900000-0000-7000-8000-0000000000c1';
    const B = '01900000-0000-7000-8000-0000000000c2';
    expect(parseSuggestions({ [`cat.${A}`]: 'on', [`order.${A}`]: '20', [`cat.${B}`]: 'on', [`order.${B}`]: '' })).toEqual([
      { categoryId: A, sortOrder: 20 },
      { categoryId: B, sortOrder: 20 },
    ]);
    expect(parseSuggestions({ [`order.${A}`]: '5' })).toEqual([]);
    expect(parseSuggestions({ 'cat.not-an-id': 'on' })).toBe(null);
    expect(parseSuggestions({ [`cat.${A}`]: 'on', [`order.${A}`]: 'first' })).toBe(null);
  });

  it('a featured placement: a listed business, two dates in order, a short note; no money', () => {
    expect(featuredInput.parse({ vendorSlug: ' Sweet-Treats ', startsOn: '2026-10-12', endsOn: '2026-11-12', note: '' })).toEqual({
      vendorSlug: 'sweet-treats',
      startsOn: '2026-10-12',
      endsOn: '2026-11-12',
      note: null,
    });
    expect(featuredInput.safeParse({ vendorSlug: 'x', startsOn: '2026-11-12', endsOn: '2026-10-12' }).success).toBe(false);
    expect(featuredInput.safeParse({ vendorSlug: '../admin', startsOn: '2026-10-12', endsOn: '2026-10-12' }).success).toBe(false);
    expect(featuredInput.safeParse({ vendorSlug: 'x', startsOn: '2026-10-12', endsOn: '2026-10-12', note: 'x'.repeat(501) }).success).toBe(
      false,
    );
    expect(
      Object.keys(featuredInput.parse({ vendorSlug: 'x', startsOn: '2026-10-12', endsOn: '2026-10-12' })).some((k) =>
        /price|amount|cents|fee/i.test(k),
      ),
    ).toBe(false);
  });

  it('counts how many placements overlap on one day (3 are shown)', () => {
    const r = (startsOn: string, endsOn: string) => ({ startsOn, endsOn });
    expect(mostOverlapping([])).toBe(0);
    expect(mostOverlapping([r('2026-10-01', '2026-10-10'), r('2026-10-11', '2026-10-20')])).toBe(1);
    expect(mostOverlapping([r('2026-10-01', '2026-10-10'), r('2026-10-10', '2026-10-20')])).toBe(2);
    expect(
      mostOverlapping([
        r('2026-10-01', '2026-12-01'),
        r('2026-10-05', '2026-10-06'),
        r('2026-10-06', '2026-10-30'),
        r('2026-10-06', '2026-10-06'),
      ]),
    ).toBe(4);
  });
});

describe('words on plan pages', () => {
  it('never shifts a bare date', () => {
    expect(longDate('2026-11-14')).toBe('Saturday 14 November');
    expect(shortDate('2026-11-14')).toBe('Sat 14 Nov');
    expect(longDate('2026-01-01')).toBe('Thursday 1 January');
    expect(longDate('2027-01-02', TODAY)).toBe('Saturday 2 January 2027');
    expect(shortDate('2026-09-05', TODAY)).toBe('Sat 5 Sep');
  });

  it('says when, what time, how many and how much', () => {
    expect(
      ['2026-10-12', '2026-10-13', '2026-11-17', '2026-10-11', '2026-10-09', '2026-08-13', '2026-08-12'].map((d) => whenWords(d, TODAY)),
    ).toEqual(['Today', 'Tomorrow', 'In 36 days', 'Yesterday', '3 days ago', '60 days ago', null]);
    expect(timeRange('13:00', '16:00')).toBe('1–4 pm');
    expect(timeRange('11:00:00', '13:30:00')).toBe('11 am – 1:30 pm');
    expect(timeRange('00:15', null)).toBe('12:15 am');
    expect(timeRange(null, null)).toBe(null);
    expect(guestsWords(15)).toBe('about 15 guests');
    expect(guestsWords(1)).toBe('about 1 guest');
    expect(guestsWords(null)).toBe(null);
    expect(budgetWords(120000)).toBe('$1,200');
    expect(budgetWords(24999)).toBe('$249.99');
    expect(budgetWords(null)).toBe(null);
  });

  it('a business sees only the town and about how many guests (D-40)', () => {
    expect(vendorSummary({ town: 'Orillia', guests: 15 })).toBe('Orillia · about 15 guests');
    expect(vendorSummary({ town: 'Orillia', guests: null })).toBe('Orillia');
    expect(BOOKED_SEES).toContain('your name, the date, the town and about how many guests');
    expect(BOOKED_SEES).toContain('Never the name you give the event');
  });

  it('heads the ideas with the kind of event in ordinary words (D-43)', () => {
    expect(ideasHeading({ key: 'kids_birthday', name: "Children's birthday party" })).toBe("Ideas for your children's birthday party");
    expect(ideasHeading({ key: 'work_event', name: 'Work or team event' })).toBe('Ideas for your work or team event');
    expect(ideasHeading({ key: 'canada_day', name: 'Canada Day party' })).toBe('Ideas for your Canada Day party');
    expect(ideasHeading({ key: 'other', name: 'Something else' })).toBe('Ideas for your event');
  });

  it('picks what’s next', () => {
    const p = { cancelled: false, passed: false, considering: 0, booked: 0 };
    expect(nextStep(p)).toBe('empty');
    expect(nextStep({ ...p, considering: 2, booked: 1 })).toBe('considering');
    expect(nextStep({ ...p, booked: 1 })).toBe('settled');
    expect(nextStep({ ...p, booked: 1, passed: true })).toBe('passed');
    expect(nextStep({ ...p, passed: true, cancelled: true })).toBe('cancelled');
  });
});

describe('database refusals in plain words (ADR-031)', () => {
  const wrapped = (code: string) => Object.assign(new Error('Failed query'), { cause: Object.assign(new Error('db'), { code }) });

  it('maps each LP code, and treats "not yours" as not found', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const code of ['LP100', 'LP102', 'LP103', 'LP104', 'LP105', 'LP107', 'LP108', 'LP109', 'LP110']) {
      const f = planFailure(wrapped(code));
      expect(f).toBeInstanceOf(PlanRefused);
      expect(f.message).toBe(PLAN_REFUSALS[code]);
      expect(f.status).toBe(409);
    }
    for (const code of ['LP101', '42501', '23503']) {
      const f = planFailure(wrapped(code));
      expect(f).toBeInstanceOf(PlanNotFound);
      expect(f.status).toBe(404);
    }
    expect(planFailure(wrapped('23505')).message).toBe(PLAN_REFUSALS.duplicate);
    const capped = new PlanCapped(PLAN_REFUSALS.savedMax);
    expect(planFailure(capped)).toBe(capped);
    expect(capped.status).toBe(429);
    vi.restoreAllMocks();
  });

  it('rethrows anything else', () => {
    for (const err of [wrapped('23514'), wrapped('LP199'), new Error('connection lost')]) expect(() => planFailure(err)).toThrow(err);
  });
});

describe('who is acting (ADR-031)', () => {
  const USER = '01900000-0000-7000-8000-000000000001';
  const VENDOR = '01900000-0000-7000-8000-000000000002';
  const dialect = new PgDialect();
  const mockDb = () => {
    const log: { sql: string; params: unknown[] }[] = [];
    const tx = {
      execute: async (q: SQL) => {
        log.push(dialect.sqlToQuery(q));
        return [];
      },
    };
    const db = { transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as Db;
    return { db, log };
  };

  it('tells the database who is acting, in one statement, before anything else', async () => {
    const { db, log } = mockDb();
    const seen = await actAs(db, { side: 'business', userId: USER, vendorId: VENDOR }, async () => log.length);
    expect(seen).toBe(1);
    expect(log[0]!.sql).toMatch(
      /set_config\('localites\.user_id', \$1, true\).*set_config\('localites\.side', \$2, true\).*set_config\('localites\.vendor_id', \$3, true\)/s,
    );
    expect(log[0]!.params).toEqual([USER, 'business', VENDOR]);

    const person = mockDb();
    await actAs(person.db, { side: 'person', userId: USER }, async () => null);
    expect(person.log[0]!.params).toEqual([USER, 'person', '']);
  });

  it('accepts only the three sides and real ids', () => {
    const { db } = mockDb();
    expect(() => actAs(db, { side: 'admin', userId: USER } as never, async () => null)).toThrow();
    expect(() => actAs(db, { side: 'person', userId: "x', true); drop table event; --" }, async () => null)).toThrow();
    expect(() => actAs(db, { side: 'business', userId: USER, vendorId: '' }, async () => null)).toThrow();
  });
});

describe('plan emails say only what they may (D-40, D-41)', () => {
  const notice: BookingNotice = {
    kind: 'marked_booked',
    eventVendorId: '01900000-0000-7000-8000-000000000003',
    vendorSlug: 'sweet-treats',
    vendorName: 'Sweet Treats',
    recipients: [{ userId: '01900000-0000-7000-8000-000000000004', email: 'owner@example.com', name: 'Olive Owner' }],
    person: 'Alex Host',
    date: '2026-11-14',
    town: 'Orillia',
    guests: 15,
    was: { date: '2026-11-07', town: 'Rama' },
  };
  const SITE = 'https://localites.example';

  it('fills only the allowed values', () => {
    const values = bookingNoticeValues(notice, 'Olive Owner', SITE);
    expect(Object.keys(values).sort()).toEqual(['business', 'date', 'guests', 'link', 'name', 'person', 'town', 'was']);
    expect(values).toMatchObject({
      date: 'Saturday 14 November 2026',
      guests: ', about 15 guests',
      was: 'Saturday 7 November 2026 in Rama',
      link: `${SITE}/vendors/sweet-treats/bookings`,
    });
    expect(bookingNoticeValues({ ...notice, guests: null, was: undefined }, 'O', SITE)).toMatchObject({ guests: '', was: '' });
  });

  it('never shows private details, even if they were passed, and leaves no placeholders', () => {
    const values = {
      ...bookingNoticeValues(notice, 'Olive Owner', SITE),
      title: 'SECRET-TITLE',
      notes: 'SECRET-NOTE',
      budget: '4321',
      type: 'SECRET-TYPE',
    };
    const templates: TemplateName[] = ['markedBooked', 'bookingUnmarked', 'bookedEventCancelled', 'bookedEventChanged'];
    for (const t of templates) {
      const { subject, text } = renderEmail(t, values);
      const all = `${subject}\n${text}`;
      for (const secret of ['SECRET', '4321', 'owner@example.com']) expect(all).not.toContain(secret);
      expect(all).not.toContain('{{');
      expect(all).toContain('Alex Host');
      expect(all).toContain('Sweet Treats');
      expect(all).not.toMatch(/confirmed|reserved|deposit|pay now/i);
    }
    expect(renderEmail('markedBooked', values).text).toContain('Their event is in Orillia, about 15 guests.');
    expect(renderEmail('bookedEventChanged', values).text).toContain(
      'It’s now Saturday 14 November 2026 in Orillia (it was Saturday 7 November 2026 in Rama).',
    );
    expect(renderEmail('bookedEventCancelled', values).text).toContain('Alex Host cancelled their event on Saturday 14 November 2026.');
  });

  it('a flag: the team hears the business and a link; the person is told politely; never the note', () => {
    const flagged = {
      vendorName: 'Sweet Treats',
      rowId: notice.eventVendorId,
      eventId: '01900000-0000-7000-8000-000000000005',
      date: '2026-11-14',
      person: { userId: '01900000-0000-7000-8000-000000000006', email: 'alex@example.com', name: 'Alex Host' },
    };
    const person = renderEmail('bookingFlaggedPerson', { ...flaggedPersonValues(flagged, SITE), note: 'SECRET-NOTE' });
    expect(person.subject).toBe('Sweet Treats says it isn’t booked for your event');
    expect(person.text).toContain('Hi Alex Host,');
    expect(person.text).toContain('Sweet Treats told us it isn’t booked for your event on Saturday 14 November 2026.');
    expect(person.text).toContain(`${SITE}/events/${flagged.eventId}`);
    expect(person.text).not.toContain('SECRET');
    const team = renderEmail('bookingFlagTeam', { business: 'Sweet Treats', link: `${SITE}/admin/booking-flags` });
    expect(`${team.subject} ${team.text}`).not.toMatch(/Alex|SECRET/);
    expect(team.text).toContain('Sweet Treats told us a booking marked on Localites isn’t right.');
  });
});

describe('the pretend email service (local tests only)', () => {
  it('is used only when it is on this computer; anything else goes to Resend', () => {
    expect(emailApiUrl({})).toBe('https://api.resend.com/emails');
    expect(emailApiUrl({ EMAIL_API_URL: 'http://127.0.0.1:8787/emails' })).toBe('http://127.0.0.1:8787/emails');
    expect(emailApiUrl({ EMAIL_API_URL: 'http://localhost:8787/emails' })).toBe('http://localhost:8787/emails');
    expect(emailApiUrl({ EMAIL_API_URL: 'https://evil.example/emails' })).toBe('https://api.resend.com/emails');
    expect(emailApiUrl({ EMAIL_API_URL: 'not a web address' })).toBe('https://api.resend.com/emails');
  });
});
