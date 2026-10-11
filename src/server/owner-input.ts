import { z } from 'zod';
import { PRICING_MODELS } from '@/lib/listing-status';
import type { PricingModel } from '@/lib/price';
import { phone, PRICED, website } from './admin/listing-input';

/**
 * What an owner may change on their own listing (D-34, ADR-029), and the checks on it. The
 * business name, web address, town, categories and email stay with the team. Limits match
 * the database and the team's form, so a value the team saved never blocks an owner's save.
 */

export const MAX_SHOWN_SERVICES = 30;
export const MAX_NEW_SERVICES_PER_SAVE = 10;
const MAX_ROWS = 60;

export type Price = { pricingModel: PricingModel; priceCents: number | null };
export type OwnerService = { id: string | null; name: string; description: string | null; price: Price; shown: boolean };
export type OwnerValues = {
  tagline: string | null;
  description: string | null;
  websiteUrl: string | null;
  publicPhone: string | null;
  services: OwnerService[];
};

// Invisible characters that can hide or reorder text (zero-width, direction controls).
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g;
// Web and email addresses don't belong in descriptions: the website has its own box.
const ADDRESS = /:\/\/|www\.|[^\s@]+@[^\s@]+\.[a-z]{2,}|\b[a-z0-9-]{2,}\.(com|ca|net|org|io|co|info|biz|xyz|app|dev|me|us|uk|link|site|online|shop|store|top|ly|gl|to|cc|ru|cn)\b/i;
const NO_ADDRESSES = 'Web and email addresses can’t go here. Put your website in the Website box.';

const clean = (s: string) => s.replace(INVISIBLE, '');

/** One line (short description, service name). */
const line = (max: number, what: string) =>
  z
    .string()
    .default('')
    .transform((s) => clean(s).replace(/\s+/g, ' ').trim())
    .pipe(z.string().max(max, `Keep the ${what} under ${max.toLocaleString('en-CA')} characters.`))
    .refine((s) => !ADDRESS.test(s), NO_ADDRESSES)
    .transform((s) => s || null);

/** Paragraphs (About, service details): line breaks kept, extra blank lines and spaces tidied. */
const paragraphs = (max: number, what: string) =>
  z
    .string()
    .default('')
    .transform((s) =>
      clean(s)
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((l) => l.replace(/[ \t]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
    )
    .pipe(z.string().max(max, `Keep the ${what} under ${max.toLocaleString('en-CA')} characters.`))
    .refine((s) => !ADDRESS.test(s), NO_ADDRESSES)
    .transform((s) => s || null);

const SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'tiny.cc', 'rb.gy'];

/** The owner's website: a full web address of their own, not a shortened link or a bare number. */
const ownerWebsite = website.superRefine((url, ctx) => {
  if (url === null || !URL.canParse(url)) return;
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  if (/^\d+(\.\d+){3}$/.test(host) || host.startsWith('[') || !host.includes('.')) {
    ctx.addIssue({ code: 'custom', message: 'Enter your website’s name, like yourbusiness.ca.' });
  } else if (SHORTENERS.some((s) => host === s || host.endsWith(`.${s}`))) {
    ctx.addIssue({ code: 'custom', message: 'Use your website’s full address, not a shortened link.' });
  }
});

const PRICE_MESSAGE = 'Enter the price in dollars, like 150 or 149.99.';

/** Turns the submitted form into rows of services, by their numbered names (service.0.name …). */
function serviceRows(fields: Record<string, string>) {
  const rows = new Map<number, Record<string, string>>();
  for (const [key, value] of Object.entries(fields)) {
    const m = /^service\.(\d{1,3})\.(id|name|description|pricingModel|price|shown)$/.exec(key);
    if (!m) continue;
    const i = Number(m[1]);
    if (i >= MAX_ROWS) continue;
    const row = rows.get(i) ?? {};
    row[m[2]!] = value;
    rows.set(i, row);
  }
  return [...rows.entries()].sort((a, b) => a[0] - b[0]);
}

export type OwnerInputResult = { ok: true; values: OwnerValues } | { ok: false; errors: Record<string, string> };

/**
 * Checks an owner's form. Fields the owner may not change are simply ignored. A new row
 * left empty is ignored too. Errors are keyed by the box's name (e.g. "service.2.price").
 */
export function parseOwnerForm(fields: Record<string, string>): OwnerInputResult {
  const errors: Record<string, string> = {};
  const take = <T>(name: string, schema: z.ZodType<T>, value: unknown): T | undefined => {
    const r = schema.safeParse(value ?? '');
    if (r.success) return r.data;
    errors[name] ??= r.error.issues[0]?.message ?? 'Check this.';
    return undefined;
  };

  const tagline = take('tagline', line(160, 'short description'), fields.tagline);
  const description = take('description', paragraphs(5000, 'description'), fields.description);
  const websiteUrl = take('websiteUrl', ownerWebsite, fields.websiteUrl ?? '');
  const publicPhone = take('publicPhone', phone, fields.publicPhone ?? '');

  const services: OwnerService[] = [];
  for (const [i, row] of serviceRows(fields)) {
    const id = (row.id ?? '').trim();
    if (id && !/^[0-9a-f-]{36}$/i.test(id)) {
      errors.form ??= 'Something on the page was out of date. Please reload it and try again.';
      continue;
    }
    const blank = !id && !(row.name ?? '').trim() && !(row.description ?? '').trim() && !(row.price ?? '').trim();
    if (blank) continue;
    const name = take(`service.${i}.name`, line(120, 'service name'), row.name);
    if (name === null) errors[`service.${i}.name`] ??= 'Give the service a name, or leave the row empty.';
    const details = take(`service.${i}.description`, paragraphs(2000, 'details'), row.description);
    const model = (PRICING_MODELS as readonly string[]).includes(row.pricingModel ?? '') ? (row.pricingModel as PricingModel) : 'not_listed';
    let priceCents: number | null = null;
    if (PRICED.has(model)) {
      const amount = (row.price ?? '').trim().replace(/[$,\s]/g, '');
      if (/^\d{1,7}(\.\d{1,2})?$/.test(amount)) priceCents = Math.round(Number(amount) * 100);
      else errors[`service.${i}.price`] ??= PRICE_MESSAGE;
    }
    if (name && details !== undefined) {
      services.push({ id: id || null, name, description: details, price: { pricingModel: model, priceCents }, shown: row.shown === 'yes' });
    }
  }
  if (services.filter((s) => s.id === null).length > MAX_NEW_SERVICES_PER_SAVE) {
    errors.form ??= `You can add up to ${MAX_NEW_SERVICES_PER_SAVE} services at a time. Save, then add more.`;
  }
  if (services.filter((s) => s.shown).length > MAX_SHOWN_SERVICES) {
    errors.form ??= `You can show up to ${MAX_SHOWN_SERVICES} services. Hide one to add another.`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      tagline: tagline ?? null,
      description: description ?? null,
      websiteUrl: websiteUrl ?? null,
      publicPhone: publicPhone ?? null,
      services,
    },
  };
}
