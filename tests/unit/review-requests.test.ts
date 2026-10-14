import { describe, expect, it } from 'vitest';
import { requestEmail } from '@/server/review-requests.server';

// "How was it?" emails (Stage 3, part 2): what they say, and what they never say.
const due = {
  notificationId: '00000000-0000-7000-8000-000000000001',
  kind: 'review_request' as const,
  email: 'a@example.test',
  name: 'Ann',
  eventId: '00000000-0000-7000-8000-0000000000e1',
  eventDate: '2026-10-10',
  businesses: 1,
  rowId: '00000000-0000-7000-8000-0000000000f1',
};

describe('review request emails', () => {
  it('one business: links straight to its review form, with the last day and how to stop them', () => {
    const e = requestEmail(due, 'https://site.test');
    expect(e.subject).toBe('How was your event on Saturday 10 October 2026?');
    expect(e.text).toContain('https://site.test/events/00000000-0000-7000-8000-0000000000e1/review/00000000-0000-7000-8000-0000000000f1');
    expect(e.text).toContain('the business you booked');
    expect(e.text).toContain('until Wednesday 9 December 2026');
    expect(e.text).toContain('https://site.test/account#emails');
  });
  it('several businesses: links to the event plan, and counts them', () => {
    const e = requestEmail({ ...due, businesses: 3, rowId: null }, 'https://site.test');
    expect(e.text).toContain('the 3 businesses you booked');
    expect(e.text).toContain('https://site.test/events/00000000-0000-7000-8000-0000000000e1\n');
  });
  it('the reminder says it is the only one', () => {
    const e = requestEmail({ ...due, kind: 'review_reminder' }, 'https://site.test');
    expect(e.subject).toBe('A reminder: how was your event on Saturday 10 October 2026?');
    expect(e.text).toContain('the only reminder');
  });
});
