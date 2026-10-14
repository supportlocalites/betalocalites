import { data, Form, Link, redirect, useNavigation, useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { CONTACT_KEPT, GUEST_LIMITS, GUEST_REFUSALS, GUESTS_PROMISE, GUESTS_SEE, RESPONSE_WORDS } from '@/lib/guest-terms';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { longDate, TOO_FAST } from '@/lib/plan-terms';
import { addGuest, guestList, invitesOn, readGuest, removeGuest, setGuestMessage } from '@/server/guests.server';
import { found, refusal, todayIso, tooFast } from '@/server/plan-pages.server';
import type { Route } from './+types/guests';
import styles from './plan.module.css';

/**
 * Screen C13: the host's guest list (Stage 4, part 1; D-08, E §4.6). Only the host. Add a
 * guest (a name; a phone number or email only to send the link from their own phone), send
 * each their own link, see who opened it and who replied, and write a message for guests.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Guests'), { name: 'robots', content: 'noindex' }];

export async function loader({ params, context }: Route.LoaderArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const list = await found(guestList(env, member.userId, params.id));
  return { ...list, invitesOn: invitesOn(env), today: todayIso() };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  if (await tooFast(env, member.userId)) return data({ intent, error: TOO_FAST }, { status: 429 });
  try {
    if (intent === 'add') {
      const input = readGuest(form);
      if ('error' in input) return data({ intent, error: input.error }, { status: 400 });
      const id = await addGuest(env, member.userId, params.id, input);
      return redirect(`/events/${params.id}/guests/${id}?added=1`);
    }
    if (intent === 'remove') {
      const guestId = String(form.get('guestId') ?? '');
      if (!isUuid(guestId)) throw data(null, { status: 400 });
      await removeGuest(env, member.userId, params.id, guestId);
      return redirect(`/events/${params.id}/guests?removed=1`);
    }
    if (intent === 'message') {
      const message =
        String(form.get('message') ?? '')
          .replace(/\r\n?/g, '\n')
          .trim() || null;
      if (message && message.length > GUEST_LIMITS.message) return data({ intent, error: GUEST_REFUSALS.messageTooLong }, { status: 400 });
      await setGuestMessage(env, member.userId, params.id, message);
      return redirect(`/events/${params.id}/guests?saved=1#message`);
    }
  } catch (err) {
    const { error, status } = refusal(err);
    return data({ intent, error }, { status });
  }
  throw data(null, { status: 400 });
}

export default function Guests({ loaderData, actionData }: Route.ComponentProps) {
  const { event, guests, totals, invitesOn: on, today } = loaderData;
  const busy = useNavigation().state !== 'idle';
  const [params] = useSearchParams();
  const open = event.status === 'planning' && !event.passed;
  const errorFor = (intent: string) =>
    actionData?.intent === intent && actionData.error ? (
      <p className="notice" role="alert">
        {actionData.error}
      </p>
    ) : null;
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <p>
          <Link to={`/events/${event.id}`} className="text-link">
            ← {event.name}
          </Link>
        </p>
        <h1 className="title-1">Guests</h1>
        <div className="title-rule" aria-hidden="true" />
        <p className="muted">
          {event.name} · {longDate(event.date, today)} · {event.town}
        </p>
        {params.has('removed') && (
          <p className="notice" role="status">
            Removed. Their link no longer works.
          </p>
        )}
        {event.status === 'cancelled' && <p className="notice">This event was cancelled. Guests who open their link are told.</p>}
        {!on && <p className="notice">{GUEST_REFUSALS.noKey}</p>}
        <p>{GUESTS_PROMISE}</p>

        {guests.length > 0 && (
          <p aria-label="Replies so far">
            <strong>{totals.coming}</strong> coming · <strong>{totals.maybe}</strong> maybe · <strong>{totals.cantCome}</strong> can’t come
            · <strong>{totals.noReply}</strong> no reply yet
          </p>
        )}

        <section className={styles.section} aria-labelledby="list">
          <h2 id="list" className="label">
            Your guest list ({guests.length})
          </h2>
          {guests.length === 0 ? (
            <p className="muted">No guests yet. Add the first one below.</p>
          ) : (
            <ul className={styles.list}>
              {guests.map((g) => (
                <li key={g.id}>
                  <div className={styles.rowBody}>
                    <div className={styles.rowHead}>
                      <span className={styles.name}>{g.name}</span>
                      <span className={styles.pill}>
                        {g.response
                          ? `${RESPONSE_WORDS[g.response]}${g.partySize && g.partySize > 1 ? ` · ${g.partySize} people` : ''}`
                          : g.opened
                            ? 'Opened, no reply yet'
                            : 'No reply yet'}
                      </span>
                    </div>
                    {g.note && <span className={styles.meta}>“{g.note}”</span>}
                    <div className={styles.rowActions}>
                      <Link to={`/events/${event.id}/guests/${g.id}`} className="text-link">
                        Send invitation
                      </Link>
                      <Form method="post">
                        <input type="hidden" name="intent" value="remove" />
                        <input type="hidden" name="guestId" value={g.id} />
                        <button type="submit" className={styles.textButton} disabled={busy}>
                          Remove {g.name}
                        </button>
                      </Form>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {open && (
          <section className={styles.section} aria-labelledby="add">
            <h2 id="add" className="label">
              Add a guest
            </h2>
            {errorFor('add')}
            <Form method="post">
              <input type="hidden" name="intent" value="add" />
              <div className="field">
                <label htmlFor="name" className="field-label">
                  Name
                </label>
                <input id="name" name="name" className="input" maxLength={GUEST_LIMITS.name} required autoComplete="off" />
              </div>
              <div className="field">
                <label htmlFor="phone" className="field-label">
                  Phone number (optional)
                </label>
                <input id="phone" name="phone" className="input" type="tel" inputMode="tel" maxLength={20} autoComplete="off" />
              </div>
              <div className="field">
                <label htmlFor="email" className="field-label">
                  Email (optional)
                </label>
                <input id="email" name="email" className="input" type="email" maxLength={254} autoComplete="off" />
                <p className="muted">{CONTACT_KEPT}</p>
              </div>
              <button type="submit" className="button button-primary" disabled={busy || !on}>
                Add guest
              </button>
            </Form>
          </section>
        )}

        <section className={styles.section} aria-labelledby="message-title" id="message">
          <h2 id="message-title" className="label">
            Your message to guests
          </h2>
          {params.has('saved') && (
            <p className="notice" role="status">
              Saved. Guests see it on their invitation.
            </p>
          )}
          {errorFor('message')}
          <p className="muted">{GUESTS_SEE}</p>
          {event.status === 'planning' ? (
            <Form method="post">
              <input type="hidden" name="intent" value="message" />
              <div className="field">
                <label htmlFor="message-box" className="field-label">
                  Message (optional)
                </label>
                <textarea
                  id="message-box"
                  name="message"
                  className="input"
                  maxLength={GUEST_LIMITS.message}
                  defaultValue={event.message ?? ''}
                />
              </div>
              <button type="submit" className="button button-secondary" disabled={busy}>
                Save message
              </button>
            </Form>
          ) : (
            event.message && <p style={{ whiteSpace: 'pre-wrap' }}>{event.message}</p>
          )}
        </section>
      </main>
    </>
  );
}
