import { data, Form, redirect, useNavigation, useSearchParams } from 'react-router';
import { cloudflareContext } from '@/app/context';
import { GUEST_LIMITS, GUEST_REFUSALS, RESPONSE_CHOICES, type GuestResponse } from '@/lib/guest-terms';
import { pageMeta } from '@/lib/meta';
import { longDateWithYear, timeRange } from '@/lib/plan-terms';
import {
  answerInvitation,
  groupInvitationFor,
  invitationExtras,
  invitationFor,
  readAnswers,
  readReply,
  replyToGroup,
  replyToInvitation,
} from '@/server/guests.server';
import { calendarEvent } from '@/server/invite-calendar.server';
import { browserKey, groupToken, inviteToken } from '@/server/invite-cookie.server';
import { calendarLinks } from '@/lib/calendar';
import { refusal } from '@/server/plan-pages.server';
import type { Route } from './+types/invite';
import styles from './invite.module.css';
import { addressKey } from '@/server/visitor.server';

/**
 * Screens G1 to G4: a guest's invitation and reply (Stage 4; D-08, E §4.6 and §5). No account.
 * The guest's own link (kept in a short-lived cookie) opens only their own invitation: the
 * event's name, date, times, town, where, the host's first name (once, D-58) and message, the host's
 * questions and updates (part 2), and their own reply; never other guests, the plan, the
 * businesses or anything private. The same page at /group-invite answers the event's group
 * link: no name until they give one, and only this browser's own reply. Not for search engines.
 */
const isGroup = (request: Request) => new URL(request.url).pathname.startsWith('/group-invite');
export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta(loaderData?.invitation ? `You’re invited: ${loaderData.invitation.title}` : 'Invitation'),
  { name: 'robots', content: 'noindex' },
  { name: 'referrer', content: 'no-referrer' },
];

export const headers: Route.HeadersFunction = () => ({ 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store' });

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const group = isGroup(request);
  const token = group ? groupToken(request) : inviteToken(request);
  const found = !token
    ? null
    : group
      ? await groupInvitationFor(env, token, browserKey(request))
      : await invitationFor(env, token).then(async (i) => (i ? { ...i, replyName: null, extras: await invitationExtras(env, token) } : null));
  if (!found) throw data({ invitation: null }, { status: 404 });
  const { extras, replyName, ...invitation } = found;
  // Coming or maybe: offer to add it to their calendar (links made here; nothing sent anywhere).
  const calendar =
    invitation.status === 'open' && (invitation.response === 'yes' || invitation.response === 'maybe')
      ? calendarLinks(calendarEvent(invitation))
      : null;
  return { invitation, calendar, extras, group, replyName, calendarFile: group ? '/group-invite/calendar.ics' : '/invite/calendar.ics' };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const group = isGroup(request);
  const token = group ? groupToken(request) : inviteToken(request);
  if (!token) throw data(null, { status: 404 });
  // One home or phone connection counts once, however many addresses it has (security review).
  if (env.INVITE_LIMIT && !(await env.INVITE_LIMIT.limit({ key: addressKey(request) })).success) {
    return data({ error: 'That’s a lot of replies at once. Please wait a minute and try again.' }, { status: 429 });
  }
  const form = await request.formData();
  const reply = readReply(form);
  if ('error' in reply) return data({ error: reply.error }, { status: 400 });
  const answers = readAnswers(form);
  if ('error' in answers) return data({ error: answers.error }, { status: 400 });
  try {
    if (group) {
      const key = browserKey(request);
      if (!key) return data({ error: GUEST_REFUSALS.noBrowserKey }, { status: 400 });
      const name = String(form.get('name') ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!name) return data({ error: GUEST_REFUSALS.yourName }, { status: 400 });
      if (name.length > GUEST_LIMITS.name) return data({ error: GUEST_REFUSALS.nameTooLong }, { status: 400 });
      await replyToGroup(env, token, key, { ...reply, name }, answers);
    } else {
      await replyToInvitation(env, token, reply);
      await answerInvitation(env, token, answers);
    }
  } catch (err) {
    const { error, status } = refusal(err);
    return data({ error }, { status });
  }
  return redirect(`${group ? '/group-invite' : '/invite'}?replied=1`);
}

export default function Invite({ loaderData, actionData }: Route.ComponentProps) {
  const { invitation: i, calendar, extras, group, replyName, calendarFile } = loaderData;
  const busy = useNavigation().state !== 'idle';
  const [params] = useSearchParams();
  const party = (n: number | null) => (n ? ` (${n} ${n === 1 ? 'person' : 'people'})` : '');
  const place = i.where ? `${i.where}, ${i.town}` : i.town;
  return (
    <main className={styles.page}>
      <div className={styles.frame}>
        <header className={styles.top}>
          <p className={styles.label}>{group ? 'You’re invited' : `You’re invited, ${i.guestName}`}</p>
          <h1 className={styles.title} dir="auto">
            {i.title}
          </h1>
          <div className={styles.rule} aria-hidden="true" />
          {i.message && (
            <p className={styles.message} dir="auto">
              {i.message}
            </p>
          )}
        </header>

        {/* The host is named once, here (the owner, 19 October 2026); elsewhere it's "the host". */}
        <dl className={styles.facts}>
          <div>
            <dt>When</dt>
            <dd>
              {longDateWithYear(i.date)}
              {timeRange(i.startTime, i.endTime) && (
                <>
                  <br />
                  {timeRange(i.startTime, i.endTime)}
                </>
              )}
            </dd>
          </div>
          <div>
            <dt>Where</dt>
            <dd>
              {i.where ? (
                <>
                  {i.where}
                  <br />
                  {i.town}
                </>
              ) : (
                i.town
              )}
              <br />
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`}
                target="_blank"
                rel="noreferrer"
                className={styles.small}
              >
                Directions
              </a>
            </dd>
          </div>
          {i.host && (
            <div>
              <dt>Host</dt>
              <dd>{i.host}</dd>
            </div>
          )}
        </dl>

        {params.has('replied') && i.response && (
          <p className="notice" role="status">
            Thanks! The host can see your reply: {RESPONSE_CHOICES[i.response]}
            {i.response !== 'no' ? party(i.partySize) : ''}. You can change it here until the event.
          </p>
        )}
        {i.replyBy === 'host' && i.response && !params.has('replied') && (
          <p className="notice">
            The host set your reply to: {RESPONSE_CHOICES[i.response]}
            {i.response !== 'no' ? party(i.partySize) : ''}.{i.status === 'open' ? ' If that isn’t right, change it below.' : ''}
          </p>
        )}
        {calendar && (
          <section className={styles.section} aria-labelledby="calendar">
            <h2 id="calendar" className={styles.label}>
              Add it to your calendar
            </h2>
            <p className={styles.calendar}>
              <a href={calendar.google} target="_blank" rel="noreferrer">
                Google Calendar
              </a>
              <a href={calendarFile} download="invitation.ics">
                Apple Calendar (iPhone, Mac)
              </a>
              <a href={calendar.outlook} target="_blank" rel="noreferrer">
                Outlook.com
              </a>
              <a href={calendar.office365} target="_blank" rel="noreferrer">
                Microsoft 365
              </a>
              <a href={calendar.yahoo} target="_blank" rel="noreferrer">
                Yahoo
              </a>
              <a href={calendarFile} download="invitation.ics">
                Other (calendar file)
              </a>
            </p>
            <p className={styles.small}>
              Your invitation link isn’t added to your calendar. To change your reply later, open your original message with the link
              again (Localites can’t send it to you), so keep it.
            </p>
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
            <h2 className={styles.ask}>Can you come?</h2>
            {group && (
              <div className="field">
                <label htmlFor="name" className={styles.label}>
                  Your name
                </label>
                <input id="name" name="name" className="input" maxLength={GUEST_LIMITS.name} defaultValue={replyName ?? ''} required />
              </div>
            )}
            <fieldset className={styles.choices}>
              <legend className="visually-hidden">Your reply</legend>
              {(Object.entries(RESPONSE_CHOICES) as [GuestResponse, string][]).map(([value, label]) => (
                <label key={value} className={styles.choice}>
                  <input type="radio" name="response" value={value} defaultChecked={i.response === value} required />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>
            <div className="field">
              <label htmlFor="partySize" className={styles.label}>
                How many of you, including you? (if you’re coming)
              </label>
              <input
                id="partySize"
                name="partySize"
                className={`input ${styles.number}`}
                type="number"
                min={1}
                max={GUEST_LIMITS.partySize}
                defaultValue={i.partySize ?? 1}
              />
            </div>
            {extras.questions.map((q) => (
              <div className="field" key={q.id}>
                <label htmlFor={`answer-${q.id}`} className={styles.label}>
                  {q.question} (optional)
                </label>
                <input
                  id={`answer-${q.id}`}
                  name={`answer.${q.id}`}
                  className="input"
                  maxLength={GUEST_LIMITS.answer}
                  defaultValue={q.answer ?? ''}
                />
              </div>
            ))}
            <div className="field">
              <label htmlFor="note" className={styles.label}>
                A note for the host (optional)
              </label>
              <textarea id="note" name="note" className="input" maxLength={GUEST_LIMITS.note} defaultValue={i.note ?? ''} />
            </div>
            <button type="submit" className={styles.send} disabled={busy}>
              {i.response ? 'Change my reply' : 'Send my reply'}
            </button>
            <p className={styles.small}>
              {group ? 'Only the host sees your reply (and you, on this phone or computer).' : 'Only the host sees your reply.'} You can
              change it any time from this link.
            </p>
          </Form>
        )}

        {extras.updates.length > 0 && (
          <section className={styles.section} aria-labelledby="updates">
            <h2 id="updates" className={styles.label}>
              Event updates
            </h2>
            <ul className={styles.updates}>
              {extras.updates.map((u) => (
                <li key={u.id}>
                  <p dir="auto" className={styles.update}>
                    {u.body}
                  </p>
                  <p className={styles.small}>{longDateWithYear(u.at)}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className={styles.sent}>
          Sent with <span className={styles.brand}>Localites</span>, a local events site in Orillia. You don’t need an account.
        </p>
      </div>
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
