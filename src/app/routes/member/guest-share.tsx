import { useState, useSyncExternalStore } from 'react';
import { data, Form, Link, redirect, useNavigation, useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { RESPONSE_WORDS, shareText } from '@/lib/guest-terms';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { longDateWithYear, TOO_FAST } from '@/lib/plan-terms';
import { guestShare, newGuestLink } from '@/server/guests.server';
import { found, refusal, siteUrl, tooFast } from '@/server/plan-pages.server';
import type { Route } from './+types/guest-share';
import styles from './plan.module.css';

/**
 * Sending one guest's invitation (C14, Stage 4 part 1; D-08): their own link, shared from the
 * host's phone by text, WhatsApp or email, or copied. Localites sends nothing to guests. A new
 * link replaces the old one at once (a link sent to the wrong person).
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Send an invitation'), { name: 'robots', content: 'noindex' }];

function ids(params: { id?: string; guestId?: string }) {
  const { id, guestId } = params;
  if (!id || !guestId || !isUuid(id) || !isUuid(guestId)) throw data(null, { status: 404 });
  return { eventId: id, guestId };
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { eventId, guestId } = ids(params);
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const share = await found(guestShare(env, member.userId, eventId, guestId, siteUrl(env, request)));
  return { ...share, text: shareText(share.guest.name, share.event.name, longDateWithYear(share.event.date), share.link) };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const { eventId, guestId } = ids(params);
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  if (form.get('intent') !== 'new-link') throw data(null, { status: 400 });
  if (await tooFast(env, member.userId)) return data({ error: TOO_FAST }, { status: 429 });
  try {
    await newGuestLink(env, member.userId, eventId, guestId);
  } catch (err) {
    const { error, status } = refusal(err);
    return data({ error }, { status });
  }
  return redirect(`/events/${eventId}/guests/${guestId}?new=1`);
}

const noChanges = () => () => undefined;

/** Copy, or the phone's own share sheet where there is one (needs the page's script). */
function CopyAndShare({ link, text }: { link: string; text: string }) {
  const [copied, setCopied] = useState(false);
  // The server has no share sheet: shown only once the page runs in the browser.
  const canShare = useSyncExternalStore(
    noChanges,
    () => typeof navigator.share === 'function',
    () => false,
  );
  return (
    <p className={styles.actions}>
      {canShare && (
        <button type="button" className="button button-primary" onClick={() => void navigator.share({ text }).catch(() => undefined)}>
          Share…
        </button>
      )}
      <button
        type="button"
        className="button button-secondary"
        onClick={() =>
          void navigator.clipboard?.writeText(link).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </p>
  );
}

export default function GuestShare({ loaderData, actionData }: Route.ComponentProps) {
  const { event, guest, link, text } = loaderData;
  const busy = useNavigation().state !== 'idle';
  const [params] = useSearchParams();
  const body = encodeURIComponent(text);
  const digits = guest.phone?.replace(/[^0-9+]/g, '') ?? '';
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <p>
          <Link to={`/events/${event.id}/guests`} className="text-link">
            ← Guests
          </Link>
        </p>
        <h1 className="title-1">Invite {guest.name}</h1>
        <div className="title-rule" aria-hidden="true" />
        {params.has('added') && (
          <p className="notice" role="status">
            {guest.name} is on your list. Send them their link now, or any time from your guest list.
          </p>
        )}
        {params.has('new') && (
          <p className="notice" role="status">
            New link made. The old one no longer works.
          </p>
        )}
        {actionData?.error && (
          <p className="notice" role="alert">
            {actionData.error}
          </p>
        )}
        <p>
          {guest.response
            ? `${RESPONSE_WORDS[guest.response]}${guest.partySize && guest.partySize > 1 ? ` · ${guest.partySize} people` : ''}`
            : guest.opened
              ? 'They’ve opened their invitation but haven’t replied yet.'
              : 'No reply yet.'}
        </p>

        <section className={styles.section} aria-labelledby="send">
          <h2 id="send" className="label">
            Send it from your phone
          </h2>
          <p className="muted">This link is for {guest.name} only. It opens their invitation and lets them reply; no account needed.</p>
          <p className={styles.box} style={{ overflowWrap: 'anywhere' }}>
            {text}
          </p>
          <CopyAndShare link={link} text={text} />
          <p className={styles.actions}>
            <a className="button button-secondary" href={`sms:${digits}?&body=${body}`}>
              Text message
            </a>
            <a
              className="button button-secondary"
              href={`https://wa.me/${digits.replace('+', '')}?text=${body}`}
              target="_blank"
              rel="noreferrer"
            >
              WhatsApp
            </a>
            <a
              className="button button-secondary"
              href={`mailto:${guest.email ?? ''}?subject=${encodeURIComponent(`You’re invited: ${event.name}`)}&body=${body}`}
            >
              Email
            </a>
          </p>
        </section>

        <section className={styles.section} aria-labelledby="replace">
          <h2 id="replace" className="label">
            Sent it to the wrong person?
          </h2>
          <p className="muted">Make a new link for {guest.name}. The old one stops working at once; their reply so far is kept.</p>
          <Form method="post">
            <input type="hidden" name="intent" value="new-link" />
            <button type="submit" className="button button-secondary" disabled={busy}>
              Make a new link
            </button>
          </Form>
        </section>
      </main>
    </>
  );
}
