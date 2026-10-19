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
  LP184: 'This review came back as you wrote it when you marked the business booked again, so it can’t be changed.',
  LP185: 'You marked this business booked after your event, so you can review it 24 hours after marking it.',
  LP186: 'Only a review that’s waiting for our team can be withdrawn. You can ask us to remove a published one.',
  LP156: 'You’ve already replied to this review.',
  LP157: 'Say why, in a few words.',
  LP158: 'You can’t report your own review.',
  LP159: 'You’ve already reported this review. Our team will look at it.',
  LP160: 'That’s a lot of reports for one day. Please try again tomorrow.',
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
  withdrawn: 'Withdrawn (by its author, or account deleted, booking unmarked or event cancelled)',
} as const;

/** Reporting a published review (Stage 3, part 2): why, in the reporter's words. */
export const REVIEW_REPORT_REASONS = {
  not_genuine: 'It isn’t a real customer’s review',
  conflict: 'It’s from a competitor, or someone too close to the business',
  personal_details: 'It shares someone’s personal details',
  offensive: 'It’s abusive or offensive',
  other: 'Something else',
} as const;
export type ReviewReportReason = keyof typeof REVIEW_REPORT_REASONS;

/** Its author asking for a published review to be removed (M4, D-54): a report only they can send. */
export const AUTHOR_REQUEST = 'Its author asks for it to be removed';
/** Every reason a report can have, as the team's pages say it. */
export const REPORT_REASON_WORDS: Record<ReviewReportReason | 'author_request', string> = {
  ...REVIEW_REPORT_REASONS,
  author_request: AUTHOR_REQUEST,
};
export const REMOVAL_ASKED = 'Thanks. Our team will look at your request and email you when they’ve decided.';

export const REVIEW_REPORT_SENT = 'Thanks. Our team will look at it. The review stays up unless they decide it breaks our rules.';

/** The "How was it?" emails (Stage 3, part 2), as the account page describes them. */
export const REVIEW_REQUESTS = {
  label: 'Email me after my events to ask how the businesses I booked did',
  hint: 'The morning after an event, and once more a week later if you haven’t reviewed them yet.',
} as const;

/** The email to the person who sent a report, once the team has decided (M7, D-54). Never the team's note. */
export const REPORT_OUTCOMES = {
  reviewRemoved: (business: string) => `We looked at the review of ${business} you reported, and we’ve removed it.`,
  reviewKept: (business: string) => `We looked at the review of ${business} you reported. It doesn’t break our rules, so it stays up.`,
  ownRemoved: (business: string) => `We’ve removed your review of ${business}, as you asked.`,
  ownKept: (business: string) =>
    `We looked at your request to remove your review of ${business}, and it stays up for now. If you’d like to talk about it, reply to this email.`,
  conversationActioned: (other: string) => `We looked at your report about your conversation with ${other}, and we’ve dealt with it.`,
  conversationDismissed: (other: string) =>
    `We looked at your report about your conversation with ${other}. We didn’t find anything that breaks our rules, so we’ve left it as it is. If something else happens, you can report it again.`,
} as const;

/** The team's decision on a business's "this wasn't booked" note (M8, D-54), to the person and the business. */
export const FLAG_OUTCOMES = {
  personStands: (business: string, date: string) =>
    `Our team looked at ${business}’s note about your booking for ${date}. The booking stands, so it can be reviewed in the usual way, from your event’s plan.`,
  personNotReal: (business: string, date: string, removed: boolean) =>
    `Our team looked into ${business}’s note about your booking for ${date} and agreed it wasn’t booked through them, so it can’t be reviewed.${removed ? ' Your review of it has been removed.' : ''} If you did arrange something with them, please contact them directly.`,
  businessStands: (date: string) =>
    `We looked at the booking for ${date} you told us wasn’t right. Our team decided it stands, so the customer can review you. If you think that’s wrong, reply to this email.`,
  businessNotReal: (date: string, removed: boolean) =>
    `We looked at the booking for ${date} you told us wasn’t right, and agreed. It won’t count, and it can’t be reviewed.${removed ? ' The review of it has been removed.' : ''}`,
} as const;
