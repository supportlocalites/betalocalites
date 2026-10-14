import { data, Form, redirect, useNavigation, useSearchParams } from 'react-router';
import { cloudflareContext } from '@/app/context';
import { GUEST_LIMITS, RESPONSE_CHOICES, type GuestResponse } from '@/lib/guest-terms';
import { pageMeta } from '@/lib/meta';
import { longDateWithYear, timeRange } from '@/lib/plan-terms';
import { invitationFor, readReply, replyToInvitation } from '@/server/guests.server';
import { calendarEvent } from '@/server/invite-calendar.server';
import { inviteToken } from '@/server/invite-cookie.server';
import { calendarLinks } from '@/lib/calendar';
import { refusal } from '@/server/plan-pages.server';
import type { Route } from './+types/invite';
import styles from './member/plan.module.css';

/**
 * Screens G1 to G4: a guest's invitation and reply (Stage 4, part 1; D-08, E §4.6 and §5). No
 * account. The guest's own link (kept in a short-lived cookie) opens only their own invitation:
 * the event's name, date, times, town, where, the host's first name and message, and their own
 * reply; never other guests, the plan, the businesses or anything private. Not for search engines.
 */
export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta(loaderData?.invitation ? `You’re invited: ${loaderData.invitation.title}` : 'Invitation'),
  { name: 'robots', content: 'noindex' },
  { name: 'referrer', content: 'no-referrer' },
];

export const headers: Route.HeadersFunction = () => ({ 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store' });

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const token = inviteToken(request);
  const invitation = token ? await invitationFor(env, token) : null;
  if (!invitation) throw data({ invitation: null }, { status: 404 });
  // Coming or maybe: offer to add it to their calendar (links made here; nothing sent anywhere).
  const calendar =
    invitation.status === 'open' && (invitation.response === 'yes' || invitation.response === 'maybe')
      ? calendarLinks(calendarEvent(invitation))
      : null;
  return { invitation, calendar };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const token = inviteToken(request);
  if (!token) throw data(null, { status: 404 });
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (env.INVITE_LIMIT && !(await env.INVITE_LIMIT.limit({ key: ip })).success) {
    return data({ error: 'That’s a lot of replies at once. Please wait a minute and try again.' }, { status: 429 });
  }
  const reply = readReply(await request.formData());
  if ('error' in reply) return data({ error: reply.error }, { status: 400 });
  try {
    await replyToInvitation(env, token, reply);
  } catch (err) {
    const { error, status } = refusal(err);
    return data({ error }, { status });
  }
  return redirect('/invite?replied=1');
}

export default function Invite({ loaderData: { invitation: i, calendar }, actionData }: Route.ComponentProps) {
  // The host's first name, or plain words when they haven't given one.
  const Host = i.host ?? 'Your host';
  const host = i.host ?? 'your host';
  const busy = useNavigation().state !== 'idle';
  const [params] = useSearchParams();
  const when = [longDateWithYear(i.date), timeRange(i.startTime, i.endTime)].filter(Boolean).join(' · ');
  return (
    <main className="page narrow">
      <p className="label">Hi {i.guestName},</p>
      <p>{Host} invites you to</p>
      <h1 className="title-1">{i.title}</h1>
      <div className="title-rule" aria-hidden="true" />
      <p>
        <strong>{when}</strong>
        <br />
        {i.where ? `${i.where}, ${i.town}` : i.town}
      </p>
      {i.message && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{i.message}</p>}

      {params.has('replied') && i.response && (
        <p className="notice" role="status">
          Thanks! {Host} can see your reply: {RESPONSE_CHOICES[i.response]}
          {i.response !== 'no' && i.partySize ? ` (${i.partySize} ${i.partySize === 1 ? 'person' : 'people'})` : ''}. You can change it here
          until the event.
        </p>
      )}
      {i.replyBy === 'host' && i.response && !params.has('replied') && (
        <p className="notice">
          {Host} set your reply to: {RESPONSE_CHOICES[i.response]}
          {i.response !== 'no' && i.partySize ? ` (${i.partySize} ${i.partySize === 1 ? 'person' : 'people'})` : ''}.
          {i.status === 'open' ? ' If that isn’t right, change it below.' : ''}
        </p>
      )}
      {calendar && (
        <section className={styles.section} aria-labelledby="calendar">
          <h2 id="calendar" className="label">
            Add it to your calendar
          </h2>
          <p className={styles.actions}>
            <a className="button button-secondary" href={calendar.google} target="_blank" rel="noreferrer">
              Google Calendar
            </a>
            <a className="button button-secondary" href="/invite/calendar.ics" download="invitation.ics">
              Apple Calendar (iPhone, Mac)
            </a>
            <a className="button button-secondary" href={calendar.outlook} target="_blank" rel="noreferrer">
              Outlook.com
            </a>
            <a className="button button-secondary" href={calendar.office365} target="_blank" rel="noreferrer">
              Microsoft 365
            </a>
            <a className="button button-secondary" href={calendar.yahoo} target="_blank" rel="noreferrer">
              Yahoo
            </a>
            <a className="button button-secondary" href="/invite/calendar.ics" download="invitation.ics">
              Other (calendar file)
            </a>
          </p>
          <p className="muted">Your invitation link isn’t added to your calendar; keep this message to change your reply.</p>
        </section>
      )}
      {i.status === 'cancelled' && <p className="notice">This event was cancelled.</p>}
      {i.status === 'closed' && (
        <p className="notice">
          This event is over, so replies are closed.
          {i.response ? ` Your reply was: ${RESPONSE_CHOICES[i.response]}.` : ''}
        </p>
      )}
      {actionData?.error && (
        <p className="notice" role="alert">
          {actionData.error}
        </p>
      )}

      {i.status === 'open' && (
        <Form method="post" className={styles.section}>
          <fieldset className={styles.choices}>
            <legend>Can you come?</legend>
            {(Object.entries(RESPONSE_CHOICES) as [GuestResponse, string][]).map(([value, label]) => (
              <label key={value} className={styles.choice}>
                <input type="radio" name="response" value={value} defaultChecked={i.response === value} required /> {label}
              </label>
            ))}
          </fieldset>
          <div className="field">
            <label htmlFor="partySize" className="field-label">
              How many of you, including you? (if you’re coming)
            </label>
            <input
              id="partySize"
              name="partySize"
              className="input"
              type="number"
              min={1}
              max={GUEST_LIMITS.partySize}
              defaultValue={i.partySize ?? 1}
            />
          </div>
          <div className="field">
            <label htmlFor="note" className="field-label">
              A note for {host} (optional)
            </label>
            <textarea id="note" name="note" className="input" maxLength={GUEST_LIMITS.note} defaultValue={i.note ?? ''} />
          </div>
          <button type="submit" className="button button-primary" disabled={busy}>
            {i.response ? 'Change my reply' : 'Send my reply'}
          </button>
        </Form>
      )}
      <p className="muted section-gap">
        Only {host} sees your reply. This invitation is sent through Localites, a local events site in Orillia; you don’t need an account.
      </p>
    </main>
  );
}

export function ErrorBoundary() {
  return (
    <main className="page narrow">
      <h1 className="title-1">This link doesn’t work</h1>
      <div className="title-rule" aria-hidden="true" />
      <p>It may have been replaced by a newer one, or the event was more than 30 days ago.</p>
      <p>Please ask the person who invited you to send it again.</p>
    </main>
  );
}
