/**
 * Invisible characters people paste by accident (or on purpose), removed from every form and
 * search before anything reads them (scenario tests, 18 October 2026): control characters (a
 * "null" one made the database refuse the whole request), characters that flip the direction of
 * the text around them (they can make a name read backwards), and zero-width spaces. Line breaks
 * and tabs stay, and so do the joiners emoji and some languages need. Then the usual Unicode form,
 * so "é" typed two ways is the same "é".
 */
// eslint-disable-next-line no-control-regex -- finding control characters is the point
const INVISIBLE = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u202A-\\u202E\\u2066-\\u2069\\u200B\\u2060\\uFEFF]', 'g');

export function cleanText(s: string): string {
  return s.replace(INVISIBLE, '').normalize('NFC');
}

/** Characters that count as letters or symbols but show as blank space (Hangul fillers, blank braille). */
const BLANK = /[\u115F\u1160\u3164\uFFA0\u2800]/gu;

/** A name (a person's, a guest's) needs at least one letter, number or symbol you can see. */
export function hasVisible(s: string): boolean {
  return /[\p{L}\p{N}\p{S}]/u.test(s.replace(BLANK, ''));
}
