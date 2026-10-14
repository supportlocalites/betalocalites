/**
 * Inquire (ADR-024, D-04, D-05): the words people and the team see, in one place so the
 * pages, the emails and the tests agree. Nothing here may suggest the business received a
 * message: it hasn't, until our team invites it and it joins.
 */

export const INQUIRY_LIMITS = {
  note: 1000,
  perDay: 10,
  /** Inquiry emails to the team in a day, across the whole site (Resend's free plan: 100 a day for everything). */
  teamEmailsPerDay: 40,
} as const;

/** After sending (ADR-024's own words). */
export const INQUIRY_SENT =
  'This business isn’t on Localites yet. We’ve passed your interest to our team, who’ll get in touch with them. ' +
  'We’ll let you know if they join.';

/** When the team email didn't go: the inquiry is still on the team's list, and says so. */
export const INQUIRY_EMAIL_FAILED =
  'We’ve saved your interest on our team’s list, but couldn’t email our team just now. They check the list, ' +
  'and you can try sending the email again below.';

/** Exactly what the team receives (shown on the form, D-04). */
export const INQUIRY_SHARES =
  'Our team receives your name, your email, your note and, if you choose an event, its kind, date, town and about ' +
  'how many guests. Never its name, where it is, the ages, your budget or your notes. The business isn’t sent anything.';

export const INQUIRY_REFUSALS: Record<string, string> = {
  LP107: 'That business isn’t listed on Localites right now.',
  LP108: 'This is your own business.',
  LP130: 'This business is on Localites now: contact them using the details on their page.',
  LP131: 'You’ve already told us you’re interested in this business.',
  perDay: 'You’ve sent a lot of inquiries today. Please try again tomorrow.',
};
