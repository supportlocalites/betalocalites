import { data, Form, Link, redirect, useNavigation, useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { CopyAndShare } from '@/components/CopyAndShare';
import { SiteHeader } from '@/components/SiteHeader';
import { GUEST_LIMITS, RESPONSE_WORDS, shareText, type GuestResponse } from '@/lib/guest-terms';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { longDateWithYear, TOO_FAST } from '@/lib/plan-terms';
import { guestShare, hostSetReply, newGuestLink, readReply } from '@/server/guests.server';
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
  const intent = String(form.get('intent') ?? '');
  if (intent !== 'new-link' && intent !== 'set-reply') throw data(null, { status: 400 });
  if (await tooFast(env, member.userId)) return data({ error: TOO_FAST }, { status: 429 });
  try {
    if (intent === 'new-link') {
      await newGuestLink(env, member.userId, eventId, guestId);
      return redirect(`/events/${eventId}/guests/${guestId}?new=1`);
    }
    const reply = readReply(form);
    if ('error' in reply) return data({ error: reply.error }, { status: 400 });
    const told = await hostSetReply(env, member.userId, eventId, guestId, reply, siteUrl(env, request));
    return redirect(`/events/${eventId}/guests/${guestId}?changed=${told}`);
  } catch (err) {
    const { error, status } = refusal(err);
    return data({ error }, { status });
  }
}

export default function GuestShare({ loaderData, actionData }: Route.ComponentProps) {
  const { event, guest, link, text } = loaderData;
  const busy = useNavigation().state !== 'idle';
  const [params] = useSearchParams();
  const body = encodeURIComponent(text);
  const digits = guest.phone?.replace(/[^0-9+]/g, '') ?? '';
  // Email: the phone or computer's own email program, or the webmail most people use, each
  // opened with the invitation written and the guest's address filled in (if given).
  const to = guest.email ?? '';
  const subject = `You’re invited: ${event.name}`;
  const q = (params: Record<string, string>) => new URLSearchParams(params).toString();
  const mail = {
    gmail: `https://mail.google.com/mail/?${q({ view: 'cm', fs: '1', to, su: subject, body: text })}`,
    outlook: `https://outlook.live.com/mail/0/deeplink/compose?${q({ to, subject, body: text })}`,
    yahoo: `https://compose.mail.yahoo.com/?${q({ to, subject, body: text })}`,
    app: `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${body}`,
  };
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
          </p>
          <h3 className="label">By email</h3>
          <p className={styles.actions}>
            <a className="button button-secondary" href={mail.gmail} target="_blank" rel="noreferrer">
              Gmail
            </a>
            <a className="button button-secondary" href={mail.outlook} target="_blank" rel="noreferrer">
              Outlook.com
            </a>
            <a className="button button-secondary" href={mail.yahoo} target="_blank" rel="noreferrer">
              Yahoo Mail
            </a>
            <a className="button button-secondary" href={mail.app}>
              Email app
            </a>
          </p>
          <p className="muted">
            “Email app” opens the email program on this phone or computer, if one is set up. If nothing happens, use Gmail, Outlook.com or
            Yahoo Mail, or Copy link and paste it into any email.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="change">
          <h2 id="change" className="label">
            Change their reply
          </h2>
          {params.has('changed') && (
            <p className="notice" role="status">
              {params.get('changed') === 'emailed'
                ? `Changed. We emailed ${guest.name} to let them know.`
                : params.get('changed') === 'email_failed'
                  ? `Changed, but the email to ${guest.name} didn’t go. You may want to tell them yourself.`
                  : params.get('changed') === 'held_back'
                    ? `Changed, but we didn’t email ${guest.name}: that’s the most emails for today. Please tell them yourself.`
                    : `Changed. ${guest.name} sees it on their invitation.`}
            </p>
          )}
          <p className="muted">
            {guest.email
              ? `If you change it before the event, we’ll email ${guest.name} at ${guest.email} to let them know, with their link.`
              : `We have no email for ${guest.name}, so they’ll see the change on their invitation.`}
          </p>
          {event.status === 'cancelled' ? (
            <p className="muted">This event was cancelled.</p>
          ) : (
            <Form method="post">
              <input type="hidden" name="intent" value="set-reply" />
              <fieldset className={styles.choices}>
                <legend>Their reply</legend>
                {(Object.entries(RESPONSE_WORDS) as [GuestResponse, string][]).map(([value, label]) => (
                  <label key={value} className={styles.choice}>
                    <input type="radio" name="response" value={value} defaultChecked={guest.response === value} required /> {label}
                  </label>
                ))}
              </fieldset>
              <div className="field">
                <label htmlFor="partySize" className="field-label">
                  How many, including them (if coming or maybe)
                </label>
                <input
                  id="partySize"
                  name="partySize"
                  className="input"
                  type="number"
                  min={1}
                  max={GUEST_LIMITS.partySize}
                  defaultValue={guest.partySize ?? 1}
                />
              </div>
              <button type="submit" className="button button-secondary" disabled={busy}>
                Save their reply
              </button>
            </Form>
          )}
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
