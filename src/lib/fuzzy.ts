/**
 * Search that forgives spelling (the owner, 24 October 2026: "I don't want them have to exactly
 * spell the name right"). Capitals, accents, apostrophes and "&"/"and" don't matter; each word
 * typed must match a word of the business's, allowing a slip or two by length (none for three
 * letters or fewer, one up to six, two from seven), the start of a word is enough ("photog"), and
 * words run together still match ("buttertart").
 */

/** Plain lower-case words: no accents, punctuation or apostrophes, "&" read as "and". */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Whether a and b are at most `max` edits apart (a swap of two letters counts as one). */
export function near(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  if (max === 0) return a === b;
  let before: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, before[j - 2]! + 1);
      row.push(v);
      best = Math.min(best, v);
    }
    if (best > max) return false;
    before = prev;
    prev = row;
  }
  return prev[b.length]! <= max;
}

const slips = (word: string) => (word.length <= 3 ? 0 : word.length <= 6 ? 1 : 2);

function wordMatches(q: string, words: string[], joined: string): boolean {
  if (joined.includes(q)) return true;
  const max = slips(q);
  return words.some((w) => near(q, w, max) || (w.length > q.length && near(q, w.slice(0, q.length), max)));
}

/** Whether what was typed finds this text (a business's name, words, kind and place). */
export function fuzzyMatch(query: string, text: string): boolean {
  const q = fold(query);
  if (!q) return true;
  const hay = fold(text);
  const joined = hay.replace(/ /g, '');
  if (joined.includes(q.replace(/ /g, ''))) return true;
  const words = hay.split(' ');
  return q.split(' ').every((w) => wordMatches(w, words, joined));
}
