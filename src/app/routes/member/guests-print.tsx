import { renderSVG } from 'uqr';
import { data, Link } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { longDateWithYear, timeRange } from '@/lib/plan-terms';
import { groupLinkFor, guestShare } from '@/server/guests.server';
import { found, siteUrl } from '@/server/plan-pages.server';
import type { Route } from './+types/guests-print';
import styles from './guests-print.module.css';

/**
 * A printable invitation with a QR code (C14, D-08, E §5): the group link by default, or one
 * guest's link (?guest=<id>). Only the host. The code is the same link drawn as a square, with
 * the same protections; a printed code can't be taken back, so the page says to make a new
 * group link if one is shared too widely.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Print an invitation'), { name: 'robots', content: 'noindex' }];

export async function loader({ params, request, context }: Route.LoaderArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const guestId = new URL(request.url).searchParams.get('guest');
  const site = siteUrl(env, request);
  if (guestId) {
    if (!isUuid(guestId)) throw data(null, { status: 404 });
    const share = await found(guestShare(env, member.userId, params.id, guestId, site));
    return { event: share.event, link: share.link, guest: share.guest.name, qr: renderSVG(share.link) };
  }
  const { event, link } = await found(groupLinkFor(env, member.userId, params.id, site));
  return { event, link, guest: null, qr: link ? renderSVG(link) : null };
}

export default function GuestsPrint({ loaderData: { event, link, guest, qr } }: Route.ComponentProps) {
  return (
    <main className={`page narrow ${styles.sheet}`}>
      <p className={styles.noPrint}>
        <Link to={`/events/${event.id}/guests`} className="text-link">
          ← Guests
        </Link>
      </p>
      {!link || !qr ? (
        <p className="notice">The group link is switched off. Make one on the Guests page first.</p>
      ) : (
        <>
          <p className="label">{guest ? `For ${guest}` : 'You’re invited'}</p>
          <h1 className="title-1">{event.name}</h1>
          <p>
            <strong>{[longDateWithYear(event.date), timeRange(event.startTime, null)].filter(Boolean).join(' · ')}</strong>
            <br />
            {event.town}
          </p>
          {/* The SVG is made on the server from the link alone: no outside service sees it. */}
          <div className={styles.qr} role="img" aria-label="QR code for the invitation" dangerouslySetInnerHTML={{ __html: qr }} />
          <p>Scan the code with your phone’s camera to reply, or open:</p>
          <p className={styles.link}>{link}</p>
          <div className={styles.noPrint}>
            <p>
              <button type="button" className="button button-primary" onClick={() => window.print()}>
                Print
              </button>
            </p>
            <p className="muted">
              {guest
                ? `This code is ${guest}’s own link: whoever scans it replies as ${guest}.`
                : 'Anyone who scans this code can reply, giving their name. A printed code can’t be taken back: if it’s shared more widely than you meant, make a new group link on the Guests page and this one stops working.'}
            </p>
          </div>
        </>
      )}
    </main>
  );
}
