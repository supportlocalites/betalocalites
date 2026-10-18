import { data } from 'react-router';
import { cloudflareContext } from '@/app/context';
import { calendarFile } from '@/lib/calendar';
import { groupInvitationFor, invitationFor, tokenHash } from '@/server/guests.server';
import { calendarEvent } from '@/server/invite-calendar.server';
import { browserKey, groupToken, inviteToken } from '@/server/invite-cookie.server';
import type { Route } from './+types/invite-calendar';

/**
 * The guest's event as a calendar file (Stage 4): Apple Calendar on an iPhone or Mac, Outlook
 * on a computer and most other calendars open it. Only with the guest's own link (its cookie),
 * or the group link at /group-invite/calendar.ics (part 2).
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const group = new URL(request.url).pathname.startsWith('/group-invite');
  const token = group ? groupToken(request) : inviteToken(request);
  const invitation = !token ? null : group ? await groupInvitationFor(env, token, browserKey(request), false) : await invitationFor(env, token);
  if (!token || !invitation || invitation.status === 'cancelled') throw data(null, { status: 404 });
  // The same id each time for this link, so adding it again updates the same entry.
  const uid = (await tokenHash(`calendar:${token}`)).slice(0, 32);
  return new Response(calendarFile(calendarEvent(invitation), uid, Date.now()), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="invitation.ics"',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
