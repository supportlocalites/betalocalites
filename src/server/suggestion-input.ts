import { z } from 'zod';

/** Suggest a business (D-25, ADR-027). Limits keep spam and the email budget in check (also Add my business, D-63). */
export const PER_VISITOR_PER_HOUR = 5;
export const ALL_VISITORS_PER_DAY = 100;
/** One home connection a day (M22, D-54): fresh browsers can't use up everyone's 100. */
export const PER_CONNECTION_PER_DAY = 10;

/** Suggest a business (D-25, ADR-027): three questions, only the name required. */
const text = (max: number, message: string) =>
  z
    .string()
    .default('')
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(z.string().max(max, message));

export const suggestionInput = z.object({
  businessName: text(200, 'Keep the name under 200 characters.').pipe(z.string().min(1, 'Enter the business’s name.')),
  website: text(500, 'Keep this under 500 characters.').transform((s) => s || null),
  contact: text(200, 'Keep this under 200 characters.').transform((s) => s || null),
  // Where the person was browsing, so the team knows what they were looking for.
  category: text(80, '').transform((s) => (/^[a-z0-9-]+$/.test(s) ? s : null)),
  q: text(200, '').transform((s) => s || null),
});

export type SuggestionInput = z.output<typeof suggestionInput>;

/** The team's email about a suggestion (plain text; the admin page has the full record). */
export function teamEmail(s: SuggestionInput & { id: string; categoryName: string | null }, siteUrl: string) {
  const lines = [
    'Someone suggested a business for Localites.',
    '',
    `Business: ${s.businessName}`,
    `Website or social page: ${s.website ?? '(not given)'}`,
    `Phone or email: ${s.contact ?? '(not given)'}`,
    `They were looking at: ${s.categoryName ?? (s.q ? `a search for “${s.q}”` : 'Localites')}`,
    '',
    'Check it, then add it, mark it as already listed, or decline it:',
    `${siteUrl}/admin/suggestions#s-${s.id}`,
    '',
    'The phone number or email was typed by a member of the public. Use it only to find and',
    'contact the business; never publish it (ADR-027).',
  ];
  return { subject: `Suggested business: ${s.businessName.slice(0, 80)}`, text: lines.join('\n') };
}
