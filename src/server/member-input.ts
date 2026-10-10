import { z } from 'zod';

/**
 * What people type when they join or claim a business (D-27, D-32, D-33), and the limits
 * shown to them. Names appear to the team and, later, to businesses, so web addresses
 * and markup are refused.
 */

/** How long an emailed sign-in code works (the Supabase setting in PO-13 matches). */
export const CODE_MINUTES = 15;

/** Open claims one person may have at a time (keeps the team's queue honest). */
export const OPEN_CLAIMS_PER_PERSON = 3;

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

export const nameInput = z
  .string()
  .default('')
  .transform(oneLine)
  .pipe(
    z
      .string()
      .min(1, 'Enter your name.')
      .max(80, 'Keep your name under 80 characters.')
      .refine((s) => !/:\/\/|www\.|[<>@]/i.test(s), 'Enter just your name (no web or email addresses).'),
  );

export const emailInput = z
  .string()
  .default('')
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.string().max(254, 'Please check the email address.').regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please check the email address.'));

/** Digits only; people often paste codes with spaces. */
export const codeInput = z
  .string()
  .default('')
  .transform((s) => s.replace(/\s+/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from the email.'));

export const RELATIONSHIPS = {
  owner: 'I own it',
  manager: 'I manage it',
  employee: 'I work there',
  other: 'Something else',
} as const;
export type Relationship = keyof typeof RELATIONSHIPS;

export const claimInput = z.object({
  relationship: z.enum(Object.keys(RELATIONSHIPS) as [Relationship, ...Relationship[]], {
    error: 'Choose how you’re connected to the business.',
  }),
  note: z
    .string()
    .default('')
    .transform((s) => s.trim())
    .pipe(z.string().max(1000, 'Keep this under 1,000 characters.'))
    .transform((s) => s || null),
  authorised: z.literal('yes', { error: 'Confirm you’re allowed to manage this business’s listing.' }),
});
export type ClaimInput = z.output<typeof claimInput>;

/** How the team confirmed a claim (D-33). Only a matching email address can skip contacting the business. */
export const CHECKS = {
  email_domain: 'Their email address is at the business’s own website',
  phoned_business: 'I phoned the business at its published number',
  emailed_business: 'I emailed the business at its published address',
} as const;
export type Check = keyof typeof CHECKS;

/** The reason given to everyone else who claimed a business when one claim is approved (D-35). */
export const AUTO_DECLINE_REASON = 'Another claim for this business was approved.';
