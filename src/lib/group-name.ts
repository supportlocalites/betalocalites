import { cleanText, hasVisible } from './clean-text';

/** A group's name in Messages (D-62): up to 60 letters, private to the person. */
export const GROUP_NAME_MAX = 60;

/**
 * The name typed for a group, tidied (invisible characters out, spaces squeezed). Blank is
 * allowed when making one (the date is used); a rename needs a name.
 */
export function readGroupName(form: FormData, required = false): { name: string } | { error: string } {
  const name = cleanText(String(form.get('groupName') ?? ''))
    .replace(/\s+/g, ' ')
    .trim();
  if (name && !hasVisible(name)) return { error: 'Give the group a name you can read.' };
  if (!name && required) return { error: 'Give the group a name.' };
  if (name.length > GROUP_NAME_MAX) return { error: `A group’s name can be up to ${GROUP_NAME_MAX} letters.` };
  return { name };
}

/** A new group's name when none is given (the owner: "date is fine"): "Message all · 25 Oct". */
export function groupNameFor(name: string, at = new Date()): string {
  const given = name.trim();
  if (given) return given;
  const parts = new Intl.DateTimeFormat('en-CA', { day: 'numeric', month: 'short', timeZone: 'America/Toronto' }).formatToParts(at);
  const part = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `Message all · ${part('day')} ${part('month').replace('.', '')}`;
}
