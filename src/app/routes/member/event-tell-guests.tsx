import { data, Form, Link, redirect, useNavigation, useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { cancelShareText } from '@/lib/guest-terms';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { longDateWithYear, TOO_FAST } from '@/lib/plan-terms';
import { cancelNoticeInfo, sendCancelNotices } from '@/server/guests.server';
import { found, refusal, tooFast } from '@/server/plan-pages.server';
import type { Route } from './+types/event-tell-guests';
import styles from './plan.module.css';

/**
 * After cancelling (C10, D-54; the owner: "allow hosts the option to send a cancellation
 * reminder"): ready-made words for the host to send guests themselves, and a button to have
 * Localites email the guests whose email address the host added, within the daily limits.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Let your guests know'), { name: 'robots', content: 'noindex' }];

export async function loader({ params, context }: Route.LoaderArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const info = await found(cancelNoticeInfo(env, member.userId, params.id));
  if (info.event.status !== 'cancelled') throw redirect(`/events/${params.id}`);
  return info;
}

export async function action({ params, request, context }: Route.ActionArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  if ((await request.formData()).get('intent') !== 'email') throw data(null, { status: 400 });
  if (await tooFast(env, member.userId)) return data({ error: TOO_FAST }, { status: 429 });
  try {
    const r = await sendCancelNotices(env, member.userId, params.id);
    return redirect(`/events/${params.id}/tell-guests?sent=${r.sent}&failed=${r.failed}&held=${r.heldBack}`);
  } catch (err) {
    const { error, status } = refusal(err);
    return data({ error }, { status });
  }
}

export default function TellGuests({ loaderData, actionData }: Route.ComponentProps) {
  const { event, host, guests, toEmail, emailed } = loaderData;
  const busy = useNavigation().state !== 'idle';
  const [params] = useSearchParams();
  const count = (key: string) => Number(params.get(key) ?? 0) || 0;
  const text = cancelShareText(event.name, longDateWithYear(event.date), host);
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        {params.has('cancelled') && (
          <p className="notice" role="status">
            Event cancelled. The businesses you’d marked booked are told.
          </p>
        )}
        <h1 className="title-1">Let your guests know</h1>
        <div className="title-rule" aria-hidden="true" />
        {actionData?.error && (
          <p className="notice" role="alert">
            {actionData.error}
          </p>
        )}
        {params.has('sent') && (
          <p className="notice" role="status">
            {count('sent') > 0 ? `Emailed ${count('sent')} ${count('sent') === 1 ? 'guest' : 'guests'}. ` : ''}
            {count('failed') > 0 ? `${count('failed')} couldn’t be emailed just now: please try again in a few minutes. ` : ''}
            {count('held') > 0
              ? `${count('held')} weren’t emailed, to stay within our email limits (up to 20 per event, a daily limit for each host and for the site, and 2 a day to one address): please tell them yourself, or try again tomorrow.`
              : ''}
            {count('sent') + count('failed') + count('held') === 0 ? 'There was no one left to email.' : ''}
          </p>
        )}
        {guests === 0 ? (
          <p>You haven’t added guests to this event. If you invited anyone another way, tell them yourself.</p>
        ) : (
          <>
            <p>Guests who open their invitation see that it’s cancelled. To tell them now, send them a message yourself:</p>
            <p className={styles.box}>{text}</p>
            <p className={styles.actions}>
              <a className="button button-secondary" href={`sms:?&body=${encodeURIComponent(text)}`}>
                Text message
              </a>
              <a className="button button-secondary" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
                WhatsApp
              </a>
            </p>
            <section className={styles.section} aria-labelledby="email">
              <h2 id="email" className="label">
                Or we can email them
              </h2>
              {toEmail > 0 ? (
                <>
                  <p>
                    {toEmail} {toEmail === 1 ? 'guest has' : 'guests have'} an email address on your list and {toEmail === 1 ? 'hasn’t' : 'haven’t'}{' '}
                    been emailed yet. We’ll email them that {event.name} is cancelled, from Localites, saying it’s from you. We email up to
                    20 guests per event in all, within our daily limits.
                  </p>
                  <Form method="post">
                    <input type="hidden" name="intent" value="email" />
                    <button type="submit" className="button button-primary" disabled={busy}>
                      {busy ? 'Sending…' : `Email ${toEmail === 1 ? 'them' : `the ${Math.min(toEmail, 20)}`}`}
                    </button>
                  </Form>
                </>
              ) : (
                <p className="muted">
                  {emailed > 0 ? `We’ve emailed ${emailed} ${emailed === 1 ? 'guest' : 'guests'}.` : 'None of your guests has an email address on your list.'}
                </p>
              )}
            </section>
          </>
        )}
        <p className="section-gap">
          <Link to={`/events/${event.id}`} className="text-link">
            Back to {event.name}
          </Link>
        </p>
      </main>
    </>
  );
}
