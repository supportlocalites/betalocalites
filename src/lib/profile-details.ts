import { cleanText } from './clean-text';

/** The three details the Base44 profile shows (0056, D-59): the neighbourhood, word tags and the team's note. */
export type ProfileDetails = { neighbourhood: string | null; tags: string[]; curatorNote: string | null };

export const MAX_TAGS = 6;
export const MAX_TAG = 24;
export const MAX_NOTE = 280;
export const MAX_NEIGHBOURHOOD = 60;

const tidy = (v: FormDataEntryValue | null) => cleanText(String(v ?? '')).replace(/\s+/g, ' ').trim();

/**
 * The team's form for them, checked as the database will (0056): tags typed with commas between
 * them, at most 6 of up to 24 letters, no repeats (any capitals); a note up to 280 letters.
 */
export function readProfileDetails(form: FormData): { value: ProfileDetails } | { error: string } {
  const neighbourhood = tidy(form.get('neighbourhood'));
  const note = cleanText(String(form.get('curatorNote') ?? '')).trim();
  const tags = tidy(form.get('tags'))
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (neighbourhood.length > MAX_NEIGHBOURHOOD) return { error: `Keep the neighbourhood to ${MAX_NEIGHBOURHOOD} letters.` };
  if (tags.length > MAX_TAGS) return { error: `Use at most ${MAX_TAGS} tags.` };
  const long = tags.find((t) => t.length > MAX_TAG);
  if (long) return { error: `“${long}” is too long: keep each tag to ${MAX_TAG} letters.` };
  if (new Set(tags.map((t) => t.toLowerCase())).size !== tags.length) return { error: 'Each tag only once, please.' };
  if (note.length > MAX_NOTE) return { error: `Keep the note to ${MAX_NOTE} letters.` };
  return { value: { neighbourhood: neighbourhood || null, tags, curatorNote: note || null } };
}
