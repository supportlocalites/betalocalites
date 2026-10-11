import { z } from 'zod';
import { type Gender, GENDERS, type Province, PROVINCES, type Relationship, RELATIONSHIPS } from '@/lib/claim-terms';

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

/** Blank stays blank (null); otherwise one tidy line, at most `max` characters. */
const optionalLine = (max: number, message: string) =>
  z
    .string()
    .default('')
    .transform(oneLine)
    .pipe(z.string().max(max, message))
    .transform((s) => s || null);

const keyOf = <T extends Record<string, string>>(choices: T) =>
  z
    .string()
    .default('')
    .transform((s) => (Object.hasOwn(choices, s) ? (s as keyof T & string) : null));

/** The date as typed in a date box (YYYY-MM-DD): a real day, from 1900 to today. */
const dateOfBirth = z
  .string()
  .default('')
  .transform((s) => s.trim())
  .refine((s) => {
    if (!s) return true;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return false;
    const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return day.toISOString().slice(0, 10) === s && s >= '1900-01-01' && day.getTime() <= Date.now();
  }, 'Check the date of birth.')
  .transform((s) => s || null);

/** Canadian postal codes, however they're typed ("l3v1a1" becomes "L3V 1A1"). */
const postalCode = z
  .string()
  .default('')
  .transform((s) => s.replace(/\s+/g, '').toUpperCase())
  .refine((s) => !s || /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(s), 'Check the postal code (like L3V 1A1).')
  .transform((s) => (s ? `${s.slice(0, 3)} ${s.slice(3)}` : null));

/**
 * Personal details (D-36). None is required; anything left blank is simply not kept. The
 * province only counts when some of the address is given (the box starts on Ontario).
 */
export const profileInput = z
  .object({
    gender: keyOf(GENDERS),
    genderOther: optionalLine(60, 'Keep this under 60 characters.'),
    dateOfBirth,
    streetAddress: optionalLine(200, 'Keep the street address under 200 characters.'),
    unit: optionalLine(40, 'Keep the unit under 40 characters.'),
    town: optionalLine(100, 'Keep the town under 100 characters.'),
    province: keyOf(PROVINCES),
    postalCode,
  })
  .transform((p) => {
    const gender = p.gender === 'self_described' && !p.genderOther ? null : p.gender;
    const hasAddress = Boolean(p.streetAddress || p.unit || p.town || p.postalCode);
    return {
      gender: gender as Gender | null,
      genderSelfDescribed: gender === 'self_described' ? p.genderOther : null,
      dateOfBirth: p.dateOfBirth,
      streetAddress: p.streetAddress,
      unit: p.unit,
      town: p.town,
      province: hasAddress ? ((p.province ?? 'ON') as Province) : null,
      postalCode: p.postalCode,
    };
  });
export type Profile = z.output<typeof profileInput>;

/** True when someone gave none of the details, so nothing needs keeping. */
export const isEmptyProfile = (p: Profile) => Object.values(p).every((v) => v === null);
