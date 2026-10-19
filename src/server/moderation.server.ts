import type { ServerEnv } from './env';
import { OFFENSIVE_WORDS } from './moderation-words';

/**
 * The language check (D-50): words a business owner saves, reviews and businesses' replies
 * are checked before they show. Two parts:
 *   1. a word list (moderation-words.ts), on this server, always;
 *   2. Cloudflare's AI checker (Workers AI, Llama Guard 3, free daily allowance), for harmful
 *      writing a list can't see: hate, threats, sexual content, harassment. If it's unavailable
 *      (allowance used up, an error, too slow), the word list's answer stands, so a save is never
 *      blocked or charged for.
 * A flag only holds the words for the team; it never refuses or deletes anything. The reason
 * says which part found what, for the team (never shown to the writer).
 */

export type LanguageCheck = { flagged: false } | { flagged: true; reason: string };

export const MODEL = '@cf/meta/llama-guard-3-8b';
/** How long the AI checker may take before the word list's answer stands. */
const AI_WAIT_MS = 4000;
/** Characters sent to the AI checker (well inside the free allowance per day). */
const AI_MAX_CHARS = 6000;

/**
 * Llama Guard's categories (MLCommons), in plain words, for the ones that hold words. Left out:
 * S6 specialised advice, S7 privacy (a business's own phone number would trip it), S8
 * intellectual property, S13 elections, S14 code: not what this check is for.
 */
export const AI_CATEGORIES: Record<string, string> = {
  S1: 'violent crime',
  S2: 'non-violent crime',
  S3: 'sex-related crime',
  S4: 'child sexual exploitation',
  S5: 'defamation',
  S9: 'weapons',
  S10: 'hate',
  S11: 'suicide or self-harm',
  S12: 'sexual content',
};

const WORDS = new Set(OFFENSIVE_WORDS);
// Look-alike characters people use to slip past a list.
const LOOK_ALIKES: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i' };

/**
 * Lower case, accents off; then the words of letters only, and the same words with look-alikes
 * inside them swapped ("sh1t", "a$$hole"), but not at their ends ("Great cakes!" stays "cakes").
 */
export function normalise(text: string): string[] {
  const plain = text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const words = plain.split(/[^a-z*]+/).filter(Boolean);
  const disguised = plain
    .split(/[^a-z0-9@$!*]+/)
    .map((w) => w.replace(/^[!]+|[!]+$/g, ''))
    .filter((w) => /[a-z]/.test(w) && /[0-9@$!]/.test(w))
    .map((w) => w.replace(/[013457@$!]/g, (c) => LOOK_ALIKES[c] ?? c));
  return [...words, ...disguised];
}

/** The list's matches, each once, in the order found. Also "f*ck"-style words with stars (two real letters at least, so "*****" stars aren't a word). */
export function listMatches(texts: string[]): string[] {
  const found: string[] = [];
  for (const word of texts.flatMap(normalise)) {
    const hit = WORDS.has(word)
      ? word
      : word.includes('*') && (word.match(/[a-z]/g) ?? []).length >= 2
        ? OFFENSIVE_WORDS.find((w) => w.length === word.length && [...word].every((c, i) => c === '*' || c === w[i]))
        : undefined;
    if (hit && !found.includes(hit)) found.push(hit);
  }
  return found;
}

type AiBinding = { run(model: string, input: unknown): Promise<unknown> };

/** Llama Guard's answer, whichever shape it comes in: { response: { safe, categories } } or text. */
export function readVerdict(out: unknown): { safe: boolean; categories: string[] } | null {
  const r = out && typeof out === 'object' && 'response' in out ? (out as { response: unknown }).response : out;
  if (r && typeof r === 'object' && 'safe' in r) {
    const cats = (r as { categories?: unknown }).categories;
    return { safe: Boolean((r as { safe: unknown }).safe), categories: Array.isArray(cats) ? cats.map(String) : [] };
  }
  if (typeof r === 'string') {
    const text = r.trim().toLowerCase();
    if (text.startsWith('safe')) return { safe: true, categories: [] };
    if (text.startsWith('unsafe')) return { safe: false, categories: (r.match(/S\d{1,2}/g) ?? []).map(String) };
  }
  return null;
}

async function askAi(env: ServerEnv, text: string): Promise<string[] | null> {
  const input = { messages: [{ role: 'user', content: text.slice(0, AI_MAX_CHARS) }] };
  const local = localCheckerUrl(env);
  const ask = local
    ? fetch(local, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, ...input }) }).then(
        (r) => (r.ok ? r.json() : Promise.reject(new Error(`checker ${r.status}`))),
      )
    : (env.AI as AiBinding | undefined)?.run(MODEL, input);
  if (!ask) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('the AI checker took too long')), AI_WAIT_MS);
  });
  try {
    const verdict = readVerdict(await Promise.race([ask, late]));
    if (!verdict) throw new Error('the AI checker gave an answer we couldn’t read');
    return verdict.safe ? [] : verdict.categories.filter((c) => c in AI_CATEGORIES);
  } finally {
    clearTimeout(timer);
  }
}

/** Local tests only: a pretend checker on this computer (ignored unless it is localhost). */
function localCheckerUrl(env: ServerEnv): string | null {
  if (!env.MODERATION_URL) return null;
  try {
    const host = new URL(env.MODERATION_URL).hostname;
    return host === '127.0.0.1' || host === 'localhost' ? env.MODERATION_URL : null;
  } catch {
    return null;
  }
}

const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
// A number, then one to four capitalised words, then a kind of street ("12 Mississaga Street",
// "4 Oak Cres"): capitals, so "took 2 kids to the dr" or "5 stars on the way" aren't addresses.
const STREET_KINDS = ['street', 'st', 'avenue', 'ave', 'road', 'rd', 'drive', 'dr', 'lane', 'ln', 'crescent', 'cres', 'boulevard']
  .concat(['blvd', 'court', 'ct', 'way', 'place', 'pl', 'line', 'concession', 'sideroad', 'trail', 'circle', 'cir'])
  .map((k) => `[${k.charAt(0)}${k.charAt(0).toUpperCase()}]${k.slice(1)}`)
  .join('|');
const STREET = new RegExp(`\\b\\d{1,5}\\s+(?:[A-ZÀ-Þ][A-Za-zÀ-ÿ'.-]*\\s+){1,4}(?:${STREET_KINDS})\\b`);

/**
 * Someone's phone number, email or street address in a review or a reply (scenario tests,
 * 18 October 2026): not for the public page, so the team is told. Not run on a business's own
 * page, which is meant to carry its phone and email.
 */
export function personalDetails(texts: string[]): string[] {
  const all = texts.join('\n');
  return [PHONE.test(all) && 'a phone number', EMAIL.test(all) && 'an email address', STREET.test(all) && 'a street address'].filter(
    (x): x is string => Boolean(x),
  );
}

/** Checks the words; empty or missing texts are skipped. With `personal`, also personal details. */
export async function checkLanguage(
  env: ServerEnv,
  texts: (string | null | undefined)[],
  { personal = false }: { personal?: boolean } = {},
): Promise<LanguageCheck> {
  const words = texts.filter((t): t is string => typeof t === 'string' && t.trim() !== '');
  if (words.length === 0) return { flagged: false };
  const reasons: string[] = [];
  const listed = listMatches(words);
  if (listed.length > 0) reasons.push(`Word list: ${listed.join(', ')}`);
  const details = personal ? personalDetails(words) : [];
  if (details.length > 0) reasons.push(`Personal details: ${details.join(', ')}`);
  try {
    const cats = await askAi(env, words.join('\n\n'));
    if (cats && cats.length > 0) reasons.push(`AI checker: ${cats.map((c) => AI_CATEGORIES[c]).join(', ')}`);
  } catch (err) {
    // The word list's answer stands (D-50); the team isn't told, the log is.
    console.error('language check: AI checker unavailable:', err instanceof Error ? err.message : err);
  }
  return reasons.length > 0 ? { flagged: true, reason: reasons.join('. ').slice(0, 500) } : { flagged: false };
}
