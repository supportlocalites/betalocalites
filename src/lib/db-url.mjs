// Turns a database address pasted from Supabase into one that's safe to connect with.
// Tolerates what people commonly paste: spaces or quotes around it, the square
// brackets left from [YOUR-PASSWORD], and passwords with symbols (encoded here).
// Never includes the address or password in an error message.

const SHAPE = /^(postgres(?:ql)?):\/\/([^:@/\s]+)(?::(.+))?@([^@/\s]+)\/([^\s?]+)(\?\S*)?$/;
const CANDIDATE = /postgres(?:ql)?:\/\/[^\s"'`]+/g;

/**
 * Yes/no facts about what was received, safe to print even in public logs:
 * never any characters of the value itself.
 */
function describe(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean).length;
  const facts = [
    `${lines} line${lines === 1 ? '' : 's'}`,
    text.includes('://') ? 'has "://"' : 'no "://"',
    text.includes('@') ? 'has "@"' : 'no "@"',
    /supabase\.(co|com)/.test(text) ? 'mentions supabase' : 'does not mention supabase',
    /\s/.test(text.trim()) ? 'contains spaces or line breaks' : 'no spaces',
  ];
  return facts.join(', ');
}

/** @param {string | undefined} raw */
export function normalizeDatabaseUrl(raw) {
  const text = String(raw ?? '');
  if (!text.trim()) throw new Error('The database address is empty.');
  if (text.includes('[YOUR-PASSWORD]')) {
    throw new Error('The database address still contains [YOUR-PASSWORD]. Replace it, brackets included, with the password.');
  }
  const whole = text.trim().replace(/^['"]+|['"]+$/g, '');
  // Pasted text sometimes carries extra words, quotes or a second line; then use the first address in it.
  const m =
    whole.match(SHAPE) ?? ((text.match(CANDIDATE) ?? [])[0] ?? '').replace(/[;,)]+$/, '').match(SHAPE);
  if (!m) {
    throw new Error(
      'The text saved as the database address is not a database address. It should be one line that ' +
        'starts with postgresql:// and ends with /postgres, copied from Supabase > Connect. ' +
        `What was received: ${describe(text)}.`,
    );
  }
  const [, scheme, user, rawPassword, host, db, query = ''] = m;
  const login = encodeURIComponent(decodeURIComponent(user));
  if (rawPassword === undefined) return `${scheme}://${login}@${host}/${db}${query}`;
  let password = rawPassword;
  try {
    password = decodeURIComponent(rawPassword);
  } catch {
    // Not percent-encoded; use as typed.
  }
  if (password.startsWith('[') && password.endsWith(']')) password = password.slice(1, -1);
  return `${scheme}://${login}:${encodeURIComponent(password)}@${host}/${db}${query}`;
}

/** Hosted databases are always reached over an encrypted connection. @param {string} url */
export const requiresTls = (url) => !/@(localhost|127\.0\.0\.1)[:/]/.test(url);
