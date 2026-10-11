import { z } from 'zod';
import { type Relationship, RELATIONSHIPS } from '@/lib/claim-terms';

// The words and limits shown on screens live in src/lib/claim-terms.ts, so pages don't
// send this checking code (zod) to the browser.
export * from '@/lib/claim-terms';

/**
 * What people type when they join or claim a business (D-27, D-32, D-33), and the limits
 * shown to them. Names appear to the team and, later, to businesses, so web addresses
 * and markup are refused.
 */

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

// Bare web addresses ("evil-site.com/login") too: email apps turn them into links.
const WEB_ADDRESS = /[a-z0-9-]{2,}\.(com|ca|net|org|io|co|info|biz|xyz|app|dev|me|us|uk|link|site|online|shop|store|top|ly|gl|to|cc|ru|cn)\b/i;

export const nameInput = z
  .string()
  .default('')
  .transform(oneLine)
  .pipe(
    z
      .string()
      .min(1, 'Enter your name.')
      .max(80, 'Keep your name under 80 characters.')
      .refine((s) => !/:\/\/|www\.|[<>@]/i.test(s) && !WEB_ADDRESS.test(s), 'Enter just your name (no web or email addresses).'),
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
