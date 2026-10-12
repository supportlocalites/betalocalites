import { z } from 'zod';
import { SLUG, slugify } from '@/lib/ids.mjs';
import { PRICING_MODELS } from '@/lib/listing-status';

/**
 * What the admin listing form accepts (api-strategy §1: declared schemas at every
 * boundary). The database checks the same rules again (two locks, E §1).
 */

const text = (max: number) =>
  z
    .string()
    // Browsers send a box's line breaks as CRLF; stored as plain line breaks.
    .transform((s) => s.replace(/\r\n?/g, '\n').trim())
    .pipe(z.string().max(max, `Keep this under ${max} characters.`));

const optionalText = (max: number) => text(max).transform((s) => (s === '' ? null : s));

const uuid = (message: string) => z.uuid({ message });

export const website = z
  .string()
  .transform((s) => s.trim())
  .transform((s) => (s === '' ? null : /^https?:\/\//i.test(s) ? s : `https://${s}`))
  .refine((s) => s === null || (s.length <= 500 && URL.canParse(s) && /^https?:$/.test(new URL(s).protocol)), {
    message: 'Enter a website address, like example.ca.',
  })
  // "https://realbusiness.ca@elsewhere.example" goes to elsewhere.example: refused.
  .refine((s) => s === null || !URL.canParse(s) || (!new URL(s).username && !new URL(s).password), {
    message: 'Enter just the website’s address, like example.ca, with no @ in it.',
  });

const email = z
  .string()
  .transform((s) => s.trim())
  .transform((s) => (s === '' ? null : s))
  .refine((s) => s === null || (s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)), {
    message: 'Enter an email address, like name@example.ca.',
  });

export const phone = z
  .string()
  .transform((s) => s.trim())
  .transform((s) => (s === '' ? null : s))
  .refine((s) => s === null || /^\+?[0-9 ().-]{7,20}$/.test(s), {
    message: 'Enter a phone number using digits, spaces, brackets or dashes.',
  });

export const listingInput = z
  .object({
    name: text(160).pipe(z.string().min(1, 'Enter the business name.')),
    slug: text(80).transform((s) => s.toLowerCase()),
    tagline: optionalText(160),
    description: optionalText(5000),
    municipalityId: uuid('Choose the town.'),
    websiteUrl: website,
    publicEmail: email,
    publicPhone: phone,
    primaryCategoryId: uuid('Choose the main category.'),
    categoryIds: z.array(z.uuid()).max(20).default([]),
  })
  .transform((v) => ({
    ...v,
    slug: v.slug === '' ? slugify(v.name) : v.slug,
    categoryIds: [...new Set([v.primaryCategoryId, ...v.categoryIds])],
  }))
  .refine((v) => SLUG.test(v.slug), {
    path: ['slug'],
    message: 'Use lowercase letters, numbers and single dashes, like sweet-treats-bakery.',
  });

export type ListingInput = z.output<typeof listingInput>;

export const PRICED = new Set(['fixed', 'starting_at', 'hourly']);

export const serviceInput = z
  .object({
    name: text(120).pipe(z.string().min(1, 'Enter the service name.')),
    description: optionalText(2000),
    pricingModel: z.enum(PRICING_MODELS, { message: 'Choose how the price is shown.' }),
    price: z.string().transform((s) => s.trim().replace(/[$,\s]/g, '')),
    priceNote: optionalText(200),
  })
  .superRefine((v, ctx) => {
    if (PRICED.has(v.pricingModel) && !/^\d{1,7}(\.\d{1,2})?$/.test(v.price)) {
      ctx.addIssue({ code: 'custom', path: ['price'], message: 'Enter the price in dollars, like 150 or 149.99.' });
    }
  })
  .transform((v) => ({
    name: v.name,
    description: v.description,
    pricingModel: v.pricingModel,
    // Honest pricing (database rule): a price only for priced models, never otherwise.
    priceCents: PRICED.has(v.pricingModel) ? Math.round(Number(v.price) * 100) : null,
    priceNote: v.priceNote,
  }));

export type ServiceInput = z.output<typeof serviceInput>;

/**
 * What the team's page showed in the boxes an owner can also change (ADR-029), sent back
 * with the form. A box the team member left alone keeps whatever is there now, so a team
 * save never quietly reverses an owner's newer edit.
 */
const loadedListing = z.object({
  tagline: z.string().nullable(),
  description: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  publicPhone: z.string().nullable(),
});
const loadedService = z.object({
  name: z.string(),
  description: z.string().nullable(),
  pricingModel: z.enum(PRICING_MODELS),
  priceCents: z.number().int().nullable(),
});
export type LoadedListing = z.output<typeof loadedListing>;
export type LoadedService = z.output<typeof loadedService>;

const readJson = <T>(schema: z.ZodType<T>, json: string): T | null => {
  try {
    const r = schema.safeParse(JSON.parse(json));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
};
export const readLoadedListing = (json: string) => readJson(loadedListing, json);
export const readLoadedService = (json: string) => readJson(loadedService, json);

/** Turns a submitted form into plain values for a schema (repeated fields become lists). */
export function formValues(form: FormData, lists: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(form.keys())) {
    out[key] = lists.includes(key) ? form.getAll(key).map(String) : String(form.get(key) ?? '');
  }
  for (const key of lists) out[key] ??= [];
  return out;
}

/** First problem per field, for showing beside each input. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    out[key] ??= issue.message;
  }
  return out;
}
