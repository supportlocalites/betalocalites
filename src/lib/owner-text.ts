/**
 * How an owner's text is tidied, and the one thing it may not hold: a web or email address
 * (D-34, ADR-029). Plain functions with no other imports, so the edit page's "View as a
 * visitor" tidies text exactly as the save will.
 */

// Invisible characters that can hide or reorder text (zero-width, direction controls).
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g;

/** One line (short description, service name): spaces squeezed, ends trimmed. */
export const tidyLine = (s: string) => s.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();

/** Paragraphs (About, service details): line breaks kept, extra blank lines and spaces tidied. */
export const tidyParagraphs = (s: string) =>
  s
    .replace(INVISIBLE, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// A web address written out, "www.", or an email address.
const WRITTEN = /\b[a-z][a-z0-9+.-]*:\/\/\S+|\bwww\.\S+|[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
// A bare address like sweettreats.ca. The ending must be lower case and stand alone, so a
// missed space after a full stop ("area.To book", "since 1999.Co-owned") isn't one.
const BARE = /\b[A-Za-z0-9-]{2,}\.(?:com|ca|net|org|io|co|info|biz|xyz|app|dev|me|us|uk|link|site|online|shop|store|top|ly|gl|to|cc|ru|cn)(?=$|[\s/?#:,;!)'"”’]|\.(?:\s|$))/;

/**
 * Why this text can't be saved as it is, naming the words that look like an address, or
 * null when it's fine. Web and email addresses belong in the Website box.
 */
export function addressProblem(s: string): string | null {
  const written = WRITTEN.exec(s)?.[0];
  if (written) return `“${clip(written)}” is a web or email address. Those can’t go here: put your website in the Website box.`;
  const bare = BARE.exec(s)?.[0];
  if (bare) {
    return `“${clip(bare)}” looks like a web address, which can’t go here: put your website in the Website box. If it isn’t one, add a space after the full stop.`;
  }
  return null;
}

const clip = (s: string) => (s.length > 40 ? `${s.slice(0, 39)}…` : s);
