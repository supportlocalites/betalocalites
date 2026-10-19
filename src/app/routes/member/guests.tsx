import { data, Form, Link, redirect, useNavigation, useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { CopyAndShare } from '@/components/CopyAndShare';
import { SiteHeader } from '@/components/SiteHeader';
import {
  CONTACT_KEPT,
  GROUP_LINK_SAYS,
  GUEST_LIMITS,
  GUEST_REFUSALS,
  GUESTS_PROMISE,
  GUESTS_SEE,
  groupShareText,
  RESPONSE_WORDS,
} from '@/lib/guest-terms';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { longDate, longDateWithYear, TOO_FAST } from '@/lib/plan-terms';
import {
  addGuest,
  addQuestion,
  type Answer,
  groupLinkOff,
  guestList,
  invitesOn,
  matchGroupReply,
  newGroupLink,
  postUpdate,
  readGuest,
  readLine,
  removeGroupReply,
  removeUnmatchedReplies,
  removeGuest,
  removeQuestion,
  removeUpdate,
  setGuestMessage,
} from '@/server/guests.server';
import { found, refusal, siteUrl, todayIso, tooFast } from '@/server/plan-pages.server';
import type { Route } from './+types/guests';
import styles from './plan.module.css';

/**
 * Screen C13: the host's guest list (Stage 4; D-08, E §4.6). Only the host. Add a guest (a
 * name; a phone number or email only to send the link from their own phone), send each their
 * own link, see who opened it and who replied, and write a message for guests. Part 2: the
 * group link (share it, print it as a QR code, replace it or switch it off) and matching its
 * replies to the list; the host's questions and each guest's answers; updates to guests.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Guests'), { name: 'robots', content: 'noindex' }];

export async function loader({ params, request, context }: Route.LoaderArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const list = await found(guestList(env, member.userId, params.id, siteUrl(env, request)));
  return { ...list, invitesOn: invitesOn(env), today: todayIso() };
}

/** Each form's intent, and where the page returns to after it. */
const BACK: Record<string, string> = {
  'group-new': 'group',
  'group-off': 'group',
  match: 'list',
  'remove-reply': 'list',
  'remove-unmatched': 'list',
  'question-add': 'questions',
  'question-remove': 'questions',
  'update-post': 'updates',
  'update-remove': 'updates',
};

export async function action({ request, params, context }: Route.ActionArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  const id = (name: string) => {
    const v = String(form.get(name) ?? '');
    if (!isUuid(v)) throw data(null, { status: 400 });
    return v;
  };
  const back = (saved: string) => redirect(`/events/${params.id}/guests?saved=${saved}#${BACK[intent] ?? 'list'}`);
  if (await tooFast(env, member.userId)) return data({ intent, error: TOO_FAST }, { status: 429 });
  try {
    if (intent === 'add') {
      const input = readGuest(form);
      if ('error' in input) return data({ intent, error: input.error }, { status: 400 });
      const guestId = await addGuest(env, member.userId, params.id, input);
      return redirect(`/events/${params.id}/guests/${guestId}?added=1`);
    }
    if (intent === 'remove') {
      await removeGuest(env, member.userId, params.id, id('guestId'));
      return redirect(`/events/${params.id}/guests?removed=1`);
    }
    if (intent === 'message') {
      const message =
        String(form.get('message') ?? '')
          .replace(/\r\n?/g, '\n')
          .trim() || null;
      if (message && message.length > GUEST_LIMITS.message) return data({ intent, error: GUEST_REFUSALS.messageTooLong }, { status: 400 });
      await setGuestMessage(env, member.userId, params.id, message);
      return redirect(`/events/${params.id}/guests?saved=message#message`);
    }
    if (intent === 'group-new') {
      await newGroupLink(env, member.userId, params.id);
      return back('group-new');
    }
    if (intent === 'group-off') {
      await groupLinkOff(env, member.userId, params.id);
      return back('group-off');
    }
    if (intent === 'match') {
      await matchGroupReply(env, member.userId, params.id, id('replyId'), id('guestId'));
      return back('match');
    }
    if (intent === 'remove-reply') {
      await removeGroupReply(env, member.userId, params.id, id('replyId'));
      return back('remove-reply');
    }
    if (intent === 'remove-unmatched') {
      await removeUnmatchedReplies(env, member.userId, params.id);
      return back('remove-unmatched');
    }
    if (intent === 'question-add') {
      const q = readLine(form, 'question', GUEST_LIMITS.question, GUEST_REFUSALS.question!, GUEST_REFUSALS.questionTooLong!);
      if ('error' in q) return data({ intent, error: q.error }, { status: 400 });
      await addQuestion(env, member.userId, params.id, q.text);
      return back('question');
    }
    if (intent === 'question-remove') {
      await removeQuestion(env, member.userId, params.id, id('questionId'));
      return back('question-removed');
    }
    if (intent === 'update-post') {
      const u = readLine(form, 'body', GUEST_LIMITS.update, GUEST_REFUSALS.update!, GUEST_REFUSALS.updateTooLong!);
      if ('error' in u) return data({ intent, error: u.error }, { status: 400 });
      await postUpdate(env, member.userId, params.id, u.text);
      return back('update');
    }
    if (intent === 'update-remove') {
      await removeUpdate(env, member.userId, params.id, id('updateId'));
      return back('update-removed');
    }
  } catch (err) {
    const { error, status } = refusal(err);
    return data({ intent, error }, { status });
  }
  throw data(null, { status: 400 });
}

const SAVED: Record<string, string> = {
  message: 'Saved. Guests see it on their invitation.',
  'group-new': 'Group link ready. Any older group link no longer works.',
  'group-off': 'Group link switched off. It no longer opens; replies already sent stay.',
  match: 'Matched. That guest now shows the reply.',
  'remove-reply': 'Removed.',
  'remove-unmatched': 'Removed every reply that wasn’t matched to a guest.',
  question: 'Question added. Guests see it on their invitation.',
  'question-removed': 'Question removed, with its answers.',
  update: 'Posted. Guests see it on their invitation.',
  'update-removed': 'Update removed.',
};

function Answers({ answers }: { answers: Answer[] }) {
  if (answers.length === 0) return null;
  return (
    <ul className={styles.answers}>
      {answers.map((a) => (
        <li key={a.question} className={styles.meta}>{`${a.question} ${a.answer}`}</li>
      ))}
    </ul>
  );
}

export default function Guests({ loaderData, actionData }: Route.ComponentProps) {
  const { event, guests, groupReplies, questions, updates, groupLink, totals, invitesOn: on, today } = loaderData;
  const busy = useNavigation().state !== 'idle';
  const [params] = useSearchParams();
  const open = event.status === 'planning' && !event.passed;
  const saved = params.get('saved');
  const notice = (section: string) =>
    saved && SAVED[saved] && sectionOf(saved) === section ? (
      <p className="notice" role="status">
        {SAVED[saved]}
      </p>
    ) : null;
  const errorFor = (...intents: string[]) =>
    actionData && intents.includes(actionData.intent) && actionData.error ? (
      <p className="notice" role="alert">
        {actionData.error}
      </p>
    ) : null;
  const groupText = groupLink ? groupShareText(event.name, longDateWithYear(event.date), groupLink) : '';
  const unreplied = guests.filter((g) => g.response === null);
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

        {guests.length + groupReplies.length > 0 && (
          <p aria-label="Replies so far">
            <strong>{totals.coming}</strong> coming · <strong>{totals.maybe}</strong> maybe · <strong>{totals.cantCome}</strong> can’t come
            · <strong>{totals.noReply}</strong> no reply yet
          </p>
        )}

        <section className={styles.section} aria-labelledby="list-title" id="list">
          <h2 id="list-title" className="label">
            Your guest list ({guests.length})
          </h2>
          {notice('list')}
          {errorFor('remove')}
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
                    <Answers answers={g.answers} />
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

        {groupReplies.length > 0 && (
          <section className={styles.section} aria-labelledby="group-replies-title" id="group-replies">
            <h2 id="group-replies-title" className="label">
              Replies from the group link, not matched yet ({groupReplies.length})
            </h2>
            {errorFor('match', 'remove-reply', 'remove-unmatched')}
            <p className="muted">Match each one to a guest on your list, so you can see who’s still to reply. They count in the totals either way.</p>
            <ul className={styles.list}>
              {groupReplies.map((r) => (
                <li key={r.id}>
                  <div className={styles.rowBody}>
                    <div className={styles.rowHead}>
                      <span className={styles.name}>{r.name}</span>
                      <span className={styles.pill}>
                        {`${RESPONSE_WORDS[r.response]}${r.partySize && r.partySize > 1 ? ` · ${r.partySize} people` : ''}`}
                      </span>
                    </div>
                    {r.note && <span className={styles.meta}>“{r.note}”</span>}
                    <Answers answers={r.answers} />
                    {guests.length > 0 && event.status === 'planning' && (
                      <Form method="post" className={styles.rowActions}>
                        <input type="hidden" name="intent" value="match" />
                        <input type="hidden" name="replyId" value={r.id} />
                        <label htmlFor={`match-${r.id}`} className="visually-hidden">
                          Which guest is {r.name}?
                        </label>
                        <select id={`match-${r.id}`} name="guestId" className="input" required defaultValue="">
                          <option value="" disabled>
                            This is…
                          </option>
                          {(unreplied.length > 0 ? unreplied : guests).map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                        <button type="submit" className="button button-secondary" disabled={busy}>
                          Match
                        </button>
                      </Form>
                    )}
                    <Form method="post">
                      <input type="hidden" name="intent" value="remove-reply" />
                      <input type="hidden" name="replyId" value={r.id} />
                      <button type="submit" className={styles.textButton} disabled={busy}>
                        Remove this reply
                      </button>
                    </Form>
                  </div>
                </li>
              ))}
            </ul>
            {groupReplies.length > 1 && (
              <Form method="post">
                <input type="hidden" name="intent" value="remove-unmatched" />
                <button type="submit" className={styles.textButton} disabled={busy}>
                  Remove all {groupReplies.length} unmatched replies (if they aren’t from your guests)
                </button>
              </Form>
            )}
          </section>
        )}

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

        <section className={styles.section} aria-labelledby="group-title" id="group">
          <h2 id="group-title" className="label">
            Group link
          </h2>
          {notice('group')}
          {errorFor('group-new', 'group-off')}
          <p className="muted">{GROUP_LINK_SAYS}</p>
          {groupLink ? (
            <>
              <p className={styles.box} style={{ overflowWrap: 'anywhere' }}>
                {groupText}
              </p>
              <CopyAndShare link={groupLink} text={groupText} />
              <p className={styles.actions}>
                <a className="button button-secondary" href={`sms:?&body=${encodeURIComponent(groupText)}`}>
                  Text message
                </a>
                <a
                  className="button button-secondary"
                  href={`https://wa.me/?text=${encodeURIComponent(groupText)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  WhatsApp
                </a>
                <Link className="button button-secondary" to={`/events/${event.id}/guests/print`}>
                  Print with a QR code
                </Link>
              </p>
              {event.status === 'planning' && (
                <div className={styles.rowActions}>
                  <Form method="post">
                    <input type="hidden" name="intent" value="group-new" />
                    <button type="submit" className={styles.textButton} disabled={busy}>
                      Make a new group link (this one stops working)
                    </button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="group-off" />
                    <button type="submit" className={styles.textButton} disabled={busy}>
                      Switch the group link off
                    </button>
                  </Form>
                </div>
              )}
            </>
          ) : (
            open && (
              <Form method="post">
                <input type="hidden" name="intent" value="group-new" />
                <button type="submit" className="button button-secondary" disabled={busy || !on}>
                  Make a group link
                </button>
              </Form>
            )
          )}
        </section>

        <section className={styles.section} aria-labelledby="questions-title" id="questions">
          <h2 id="questions-title" className="label">
            Questions for guests ({questions.length} of {GUEST_LIMITS.questions})
          </h2>
          {notice('questions')}
          {errorFor('question-add', 'question-remove')}
          <p className="muted">
            Asked on every invitation, for a short answer, such as “Any allergies?” Answering is optional. You see the answers above.
          </p>
          {questions.length > 0 && (
            <ul className={styles.list}>
              {questions.map((q) => (
                <li key={q.id}>
                  <div className={styles.rowHead}>
                    <span>{q.question}</span>
                    {event.status === 'planning' && (
                      <Form method="post">
                        <input type="hidden" name="intent" value="question-remove" />
                        <input type="hidden" name="questionId" value={q.id} />
                        <button type="submit" className={styles.textButton} disabled={busy}>
                          Remove
                        </button>
                      </Form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {event.status === 'planning' && questions.length < GUEST_LIMITS.questions && (
            <Form method="post">
              <input type="hidden" name="intent" value="question-add" />
              <div className="field">
                <label htmlFor="question" className="field-label">
                  Ask a question
                </label>
                <input id="question" name="question" className="input" maxLength={GUEST_LIMITS.question} required />
              </div>
              <button type="submit" className="button button-secondary" disabled={busy}>
                Add question
              </button>
            </Form>
          )}
        </section>

        <section className={styles.section} aria-labelledby="updates-title" id="updates">
          <h2 id="updates-title" className="label">
            Updates for guests
          </h2>
          {notice('updates')}
          {errorFor('update-post', 'update-remove')}
          <p className="muted">
            A short note, such as “We’ve moved to 3 pm”, shown at the top of every invitation. Localites doesn’t send it to anyone: share
            it from your phone if you like.
          </p>
          {open && (
            <Form method="post">
              <input type="hidden" name="intent" value="update-post" />
              <div className="field">
                <label htmlFor="update-body" className="field-label">
                  New update
                </label>
                <textarea id="update-body" name="body" className="input" maxLength={GUEST_LIMITS.update} required />
              </div>
              <button type="submit" className="button button-secondary" disabled={busy}>
                Post update
              </button>
            </Form>
          )}
          {updates.length > 0 && (
            <ul className={styles.list}>
              {updates.map((u) => (
                <li key={u.id}>
                  <div className={styles.rowBody}>
                    <span className={styles.meta}>{longDateWithYear(u.at)}</span>
                    <p dir="auto" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{u.body}</p>
                    <div className={styles.rowActions}>
                      <a
                        className="text-link"
                        href={`https://wa.me/?text=${encodeURIComponent(`${event.name}: ${u.body}`)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Share on WhatsApp
                      </a>
                      <a className="text-link" href={`sms:?&body=${encodeURIComponent(`${event.name}: ${u.body}`)}`}>
                        Text message
                      </a>
                      {event.status === 'planning' && (
                        <Form method="post">
                          <input type="hidden" name="intent" value="update-remove" />
                          <input type="hidden" name="updateId" value={u.id} />
                          <button type="submit" className={styles.textButton} disabled={busy}>
                            Remove
                          </button>
                        </Form>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.section} aria-labelledby="message-title" id="message">
          <h2 id="message-title" className="label">
            Your message to guests
          </h2>
          {notice('message')}
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

/** Which section a "saved" note belongs to. */
function sectionOf(saved: string): string {
  if (saved === 'message') return 'message';
  if (saved === 'question' || saved === 'question-removed') return 'questions';
  if (saved === 'update' || saved === 'update-removed') return 'updates';
  // After matching, the reply leaves its section (which may be gone): said above the list.
  if (saved === 'match' || saved === 'remove-reply' || saved === 'remove-unmatched') return 'list';
  return BACK[saved] ?? 'list';
}
