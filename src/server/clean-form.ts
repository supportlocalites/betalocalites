import { cleanText } from '@/lib/clean-text';

let installed = false;

/**
 * Left exactly as sent: a team password must match what Supabase holds, and the owner-edit page's
 * `base` is its copy of the saved values, compared with the database as they are (independent review).
 */
const EXACT = new Set(['password', 'base']);

/**
 * Every form the site reads goes through cleanText (src/lib/clean-text.ts): Request.formData is
 * wrapped once, when the Worker starts, so no page can forget. Files, and the fields in EXACT, are
 * passed through untouched.
 * A request that isn't a form at all (only programs send those) gets a plain "400" instead of an
 * error page.
 */
export function installFormCleaning(): void {
  if (installed) return;
  installed = true;
  const original = Request.prototype.formData;
  Request.prototype.formData = async function cleanedFormData(this: Request): Promise<FormData> {
    let form: FormData;
    try {
      form = await original.call(this);
    } catch {
      throw new Response('That form didn’t come through. Please try again.', { status: 400 });
    }
    const clean = new FormData();
    for (const [key, value] of form.entries()) {
      if (typeof value === 'string') clean.append(cleanText(key), EXACT.has(key) ? value : cleanText(value));
      else clean.append(key, value);
    }
    return clean;
  };
}
