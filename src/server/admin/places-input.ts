import { z } from 'zod';
import { isUuid, slugify } from '@/lib/ids.mjs';
import { tidyLine } from '@/lib/owner-text';

/**
 * What the team types on Admin → Categories and towns (X6, X8), checked before anything is
 * written. The database checks again (migration 0017).
 */

const order = z
  .string()
  .default('')
  .transform((s) => s.trim())
  .pipe(z.string().regex(/^\d{1,4}$/, 'Enter an order from 0 to 9999.'))
  .transform(Number);

const checkbox = z
  .string()
  .optional()
  .transform((s) => s === 'on' || s === 'yes');

const line = (missing: string, max: number) =>
  z
    .string()
    .default('')
    .transform(tidyLine)
    .pipe(z.string().min(1, missing).max(max, `Keep it to ${max} characters.`));

/** A kind of business. parentId: empty for a main kind, or the main kind it sits within. */
export const kindInput = z.object({
  name: line('Give the kind of business a name.', 80),
  description: z
    .string()
    .default('')
    .transform(tidyLine)
    .pipe(z.string().max(300, 'Keep the description to 300 characters.'))
    .transform((s) => s || null),
  sortOrder: order,
  shown: checkbox,
  parentId: z
    .string()
    .default('')
    .transform((s) => s.trim() || null)
    .refine((s) => s === null || isUuid(s), 'Choose a main kind from the list.'),
});
export type KindInput = z.output<typeof kindInput>;

/** A town (municipality). */
export const townInput = z.object({
  name: line('Give the town a name.', 80),
  region: line('Give the region, for example Simcoe County.', 80),
  sortOrder: order,
  shown: checkbox,
});
export type TownInput = z.output<typeof townInput>;

/**
 * The web address part for something new, made from its name and never changed afterwards:
 * "Face & Body Painting" → face-and-body-painting; one already taken gets -2, -3 …
 */
export function newSlug(name: string, taken: Set<string>, fallback: string): string {
  const base = slugify(name).slice(0, 76).replace(/-+$/, '') || fallback;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}
