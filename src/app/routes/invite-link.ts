import { redirect } from 'react-router';
import { TOKEN } from '@/server/guests.server';
import { inviteCookie } from '@/server/invite-cookie.server';
import { invitePreview } from '@/server/invite-preview.server';
import type { Route } from './+types/invite-link';

/**
 * A guest's personal link, /i/<token> (Stage 4, E §5). Never a page: the token goes into a
 * short-lived cookie and the guest lands on /invite. Something that can't be a token isn't
 * kept, and /invite says the link doesn't work. A link-preview robot gets a plain card instead.
 */
export function loader({ request, params }: Route.LoaderArgs) {
  const preview = invitePreview(request);
  if (preview) return preview;
  const token = params.token ?? '';
  const valid = TOKEN.test(token);
  const headers = new Headers({
    'Set-Cookie': inviteCookie(valid ? token : '', valid ? 86400 : 0),
    'X-Robots-Tag': 'noindex',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  });
  return redirect('/invite', { headers });
}
