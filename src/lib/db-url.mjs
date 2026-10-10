// Turns a database address pasted from Supabase into one that's safe to connect with.
// Tolerates what people commonly paste: spaces or quotes around it, the square
// brackets left from [YOUR-PASSWORD], and passwords with symbols (encoded here).
// Never includes the address or password in an error message.

const SHAPE = /^(postgres(?:ql)?):\/\/([^:@/\s]+)(?::(.+))?@([^@/\s]+)\/([^\s?]+)(\?\S*)?$/;

/** @param {string | undefined} raw */
export function normalizeDatabaseUrl(raw) {
  const s = String(raw ?? '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '');
  if (!s) throw new Error('The database address is empty.');
  if (s.includes('[YOUR-PASSWORD]')) {
    throw new Error('The database address still contains [YOUR-PASSWORD]. Replace it, brackets included, with the password.');
  }
  const m = s.match(SHAPE);
  if (!m) {
    throw new Error(
      'The database address is not in the expected form postgresql://USER:PASSWORD@HOST:PORT/postgres ' +
        '(one line, no spaces). Copy it again from Supabase > Connect.',
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
