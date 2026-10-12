import { z } from 'zod';
import { PRICING_MODELS } from '@/lib/listing-status';
import { addressProblem, tidyLine, tidyParagraphs } from '@/lib/owner-text';
import type { PricingModel } from '@/lib/price';
import { phone, PRICED, website } from './admin/listing-input';

/**
 * What an owner may change on their own listing (D-34, ADR-029), and the checks on it. The
 * business name, web address, town, categories and email stay with the team. Only what the
 * owner changed is checked: a box left as the page showed it keeps its value exactly, so
 * text the team saved never blocks an owner's save or shows up as a change they didn't make.
 */

export const MAX_SHOWN_SERVICES = 30;
export const MAX_NEW_SERVICES_PER_SAVE = 10;
/** Matches the most services the page's own copy of its values may list (readBase). */
const MAX_ROWS = 500;

export type Price = { pricingModel: PricingModel; priceCents: number | null };
export type OwnerService = { id: string | null; name: string; description: string | null; price: Price; shown: boolean };
export type OwnerValues = {
  tagline: string | null;
  description: string | null;
  websiteUrl: string | null;
  publicPhone: string | null;
  services: OwnerService[];
};

const OUT_OF_DATE = 'Something on the page was out of date. Please reload it and try again.';

const noAddresses = (s: string, ctx: z.RefinementCtx) => {
  const problem = addressProblem(s);
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
};
const tooLong = (max: number, what: string) => `Keep the ${what} under ${max.toLocaleString('en-CA')} characters.`;

/** One line (short description, service name). */
const line = (max: number, what: string) =>
  z
    .string()
    .transform(tidyLine)
    .pipe(z.string().max(max, tooLong(max, what)))
    .superRefine(noAddresses)
    .transform((s) => s || null);

/** Paragraphs (About, service details): line breaks kept, extra blank lines and spaces tidied. */
const paragraphs = (max: number, what: string) =>
  z
    .string()
    .transform(tidyParagraphs)
    .pipe(z.string().max(max, tooLong(max, what)))
    .superRefine(noAddresses)
    .transform((s) => s || null);

const TAGLINE = line(160, 'short description');
const ABOUT = paragraphs(5000, 'description');
const SERVICE_NAME = line(120, 'service name');
const DETAILS = paragraphs(2000, 'details');

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
  let tooMany = false;
  for (const [key, value] of Object.entries(fields)) {
    const m = /^service\.(\d{1,3})\.(id|name|description|pricingModel|price|shown)$/.exec(key);
    if (!m) continue;
    const i = Number(m[1]);
    if (i >= MAX_ROWS) {
      tooMany = true;
      continue;
    }
    const row = rows.get(i) ?? {};
    row[m[2]!] = value;
    rows.set(i, row);
  }
  return { rows: [...rows.entries()].sort((a, b) => a[0] - b[0]), tooMany };
}

export type OwnerInputResult = { ok: true; values: OwnerValues } | { ok: false; errors: Record<string, string> };

/**
 * Checks an owner's form against what the page showed them (`base`, from readBase).
 * Fields the owner may not change are simply ignored. A new row left empty is ignored too.
 * Errors are keyed by the box's name (e.g. "service.2.price").
 */
export function parseOwnerForm(fields: Record<string, string>, base: OwnerValues | null = null): OwnerInputResult {
  const errors: Record<string, string> = {};
  const take = <T>(name: string, schema: z.ZodType<T>, value: string | undefined): T | undefined => {
    const r = schema.safeParse(value ?? '');
    if (r.success) return r.data;
    errors[name] ??= r.error.issues[0]?.message ?? 'Check this.';
    return undefined;
  };
  // Left as it was (ignoring spaces the save would tidy anyway): keep exactly what's stored.
  const kept = (submitted: string | undefined, before: string | null | undefined, tidy: (s: string) => string) =>
    before !== undefined && tidy(submitted ?? '') === tidy(before ?? '');

  const tagline = kept(fields.tagline, base?.tagline, tidyLine) ? base!.tagline : take('tagline', TAGLINE, fields.tagline);
  const description = kept(fields.description, base?.description, tidyParagraphs)
    ? base!.description
    : take('description', ABOUT, fields.description);
  const site = (fields.websiteUrl ?? '').trim();
  const websiteUrl =
    base && (site === (base.websiteUrl ?? '') || (site !== '' && `https://${site}` === base.websiteUrl))
      ? base.websiteUrl
      : take('websiteUrl', ownerWebsite, site);
  const publicPhone =
    base && (fields.publicPhone ?? '').trim() === (base.publicPhone ?? '') ? base.publicPhone : take('publicPhone', phone, fields.publicPhone);

  const before = new Map((base?.services ?? []).map((s) => [s.id, s]));
  const { rows, tooMany } = serviceRows(fields);
  if (tooMany) errors.form ??= OUT_OF_DATE;
  const services: OwnerService[] = [];
  for (const [i, row] of rows) {
    const id = (row.id ?? '').trim();
    if (id && !/^[0-9a-f-]{36}$/i.test(id)) {
      errors.form ??= OUT_OF_DATE;
      continue;
    }
    const blank = !id && !(row.name ?? '').trim() && !(row.description ?? '').trim() && !(row.price ?? '').trim();
    if (blank) continue;
    const was = id ? before.get(id) : undefined;
    const name = kept(row.name, was?.name, tidyLine) ? was!.name : take(`service.${i}.name`, SERVICE_NAME, row.name);
    if (name === null) errors[`service.${i}.name`] ??= 'Give the service a name, or leave the row empty.';
    const details = kept(row.description, was?.description, tidyParagraphs) ? was!.description : take(`service.${i}.description`, DETAILS, row.description);
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
    errors.services ??= `You can add up to ${MAX_NEW_SERVICES_PER_SAVE} services at a time. Save, then add more.`;
  }
  // Only a save that shows more services than before can pass the limit (the team may have shown more).
  const shown = services.filter((s) => s.shown).length;
  if (shown > MAX_SHOWN_SERVICES && shown > (base?.services.filter((s) => s.shown).length ?? 0)) {
    errors.services ??= `You can show up to ${MAX_SHOWN_SERVICES} services. Hide one to add another.`;
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
