import { redirect } from 'react-router';
import { TOKEN } from '@/server/guests.server';
import { browserKey, groupCookie, newBrowserKey } from '@/server/invite-cookie.server';
import type { Route } from './+types/group-link';

/**
 * An event's group link, /g/<token> (Stage 4 part 2, D-08, E §5). Never a page: the token goes
 * into a short-lived cookie (and this browser gets its own random key, so whoever replies can
 * change their reply later), and the guest lands on /group-invite.
 */
export function loader({ request, params }: Route.LoaderArgs) {
  const token = params.token ?? '';
  const valid = TOKEN.test(token);
  const headers = new Headers({
    'X-Robots-Tag': 'noindex',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  });
  headers.append('Set-Cookie', groupCookie(valid ? token : '', valid ? 86400 : 0));
  if (valid && !browserKey(request)) headers.append('Set-Cookie', newBrowserKey().cookie);
  return redirect('/group-invite', { headers });
}
