/**
 * Words and limits for signing in and claiming that screens show (D-32, D-33, D-35). Kept
 * apart from the input checks (src/server/member-input.ts) so pages stay small.
 */

/** How long an emailed sign-in code works (the Supabase setting in PO-13 matches). */
export const CODE_MINUTES = 15;

/** Open claims one person may have at a time (keeps the team's queue honest). */
export const OPEN_CLAIMS_PER_PERSON = 3;

export const RELATIONSHIPS = {
  owner: 'I own it',
  manager: 'I manage it',
  employee: 'I work there',
  other: 'Something else',
} as const;
export type Relationship = keyof typeof RELATIONSHIPS;

/** How the team confirmed a claim (D-33). Only a matching email address can skip contacting the business. */
export const CHECKS = {
  email_domain: 'Their email address is at the business’s own website',
  phoned_business: 'I phoned the business at its published number',
  emailed_business: 'I emailed the business at its published address',
} as const;
export type Check = keyof typeof CHECKS;

/** The reason given to everyone else who claimed a business when one claim is approved (D-35). */
export const AUTO_DECLINE_REASON = 'Another claim for this business was approved.';
