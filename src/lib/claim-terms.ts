/**
 * Words and limits for signing in, personal details and claiming that screens show (D-32,
 * D-33, D-35, D-36). Kept apart from the input checks (src/server/member-input.ts) so
 * pages stay small.
 */

/** How long an emailed sign-in code works (the Supabase setting in PO-13 matches). */
export const CODE_MINUTES = 15;

/**
 * How long to wait before asking for another code: the "Send a new code" button counts
 * down from this, and the server refuses sooner requests. It matches Supabase's own minimum
 * interval between emails to one address (60 seconds, its default), so a code asked for
 * once the button is ready is really sent. If Supabase's setting ever changes, change this.
 */
export const RESEND_WAIT_SECONDS = 60;

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

/** Gender choices (D-36). "Describe it myself" comes with a box for their own words. */
export const GENDERS = {
  woman: 'Woman',
  man: 'Man',
  non_binary: 'Non-binary',
  self_described: 'I’ll describe it myself',
  prefer_not_to_say: 'Prefer not to say',
} as const;
export type Gender = keyof typeof GENDERS;

export const PROVINCES = {
  ON: 'Ontario',
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon',
} as const;
export type Province = keyof typeof PROVINCES;
