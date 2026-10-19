import { redirect } from 'react-router';
import { safeBack, THEME_COOKIE } from '@/lib/theme';
import type { Route } from './+types/theme';

/**
 * The moon and sun (D-57): keeps the visitor's choice of look in a cookie for a year and goes
 * back to the page they were on. The cookie holds only "light" or "dark".
 */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const to = form.get('to') === 'dark' ? 'dark' : 'light';
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return redirect(safeBack(String(form.get('back') ?? '/').slice(0, 2000)), {
    headers: { 'Set-Cookie': `${THEME_COOKIE}=${to}; Path=/; Max-Age=31536000; SameSite=Lax${secure}` },
  });
}

export function loader() {
  return redirect('/');
}
