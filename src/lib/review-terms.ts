/**
 * Reviews (Stage 3; D-06, D-48, E §4.4 and §4.5): the words both sides and the team see, in
 * one place so the pages, emails and tests agree.
 */

export const REVIEW_LIMITS = { body: 3000, reply: 1500, reason: 1000, windowDays: 60 } as const;

/** Under the stars on the form and on the page. */
export const STAR_WORDS: Record<number, string> = {
  1: 'Poor',
  2: 'Fair',
  3: 'Good',
  4: 'Very good',
  5: 'Excellent',
};

/** The label on a review when the business never replied to the person on Localites (D-06, option B). */
export const PLANNED_OUTSIDE = 'Planned outside Localites';
export const PLANNED_ON = 'Planned on Localites';

/** The badge for the top 1% of reviewers (D-48). */
export const LIVING_LOCAL = 'Living Local';
export const LIVING_LOCAL_HINT = 'One of the top 1% of reviewers on Localites.';

/** On the event plan, beside a booked business the person reviewed. */
export const REVIEW_STATUS_WORDS = {
  pending: 'Your review: waiting for our team',
  published: 'Your review: published',
  declined: 'Your review: not published',
  removed: 'Your review: removed by our team',
  withdrawn: 'Your review: withdrawn',
} as const;

/** Said on the form, plainly. */
export const REVIEW_PROMISE =
  'Our team reads every review before it’s published. It shows your first name and the first letter of your last name, the month of your event, and your words.';

export const REVIEW_REFUSALS = {
  LP100: 'That can’t be changed.',
  LP108: 'You can’t review your own business.',
  LP109: 'That isn’t possible right now.',
  LP150: 'A business can be reviewed once it’s marked booked for an event that went ahead.',
  LP151: 'You can review this business once your event has happened.',
  LP152: 'The 60 days to review this booking have passed.',
  LP153: 'The business says it wasn’t booked for this event. Our team will look at it; you can review it if they confirm it was.',
  LP154: 'This business isn’t listed on Localites at the moment.',
  LP155: 'Your review can’t be changed now that our team has looked at it.',
  LP156: 'You’ve already replied to this review.',
  LP157: 'Say why, in a few words.',
  '23505': 'You’ve already reviewed this booking.',
  rating: 'Choose from 1 to 5 stars.',
  body: 'Write a few words about how it went.',
  bodyTooLong: 'Please keep your review under 3,000 characters.',
  reply: 'Write your reply first.',
  replyTooLong: 'Please keep your reply under 1,500 characters.',
} as const;

/** A review's state, as the team's pages say it. */
export const REVIEW_STATUS = {
  pending: 'Waiting',
  published: 'Published',
  declined: 'Declined',
  removed: 'Removed',
  withdrawn: 'Withdrawn (account deleted)',
} as const;
