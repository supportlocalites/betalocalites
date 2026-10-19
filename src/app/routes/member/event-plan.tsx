import { data, Form, Link, redirect, useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { REVIEW_STATUS_WORDS } from '@/lib/review-terms';
import {
  budgetWords,
  FEATURED_LINE,
  longDate,
  NO_PAYMENTS_PERSON,
  NO_TYPE_IDEAS,
  nextStep,
  STATUS_WORDS,
  whenWords,
} from '@/lib/plan-terms';
import { TOO_FAST } from '@/lib/plan-terms';
import { deleteCancelledEvent, eventPlan, type PlanRow } from '@/server/events.server';
import { found, refusal, todayIso, tooFast } from '@/server/plan-pages.server';
import type { Route } from './+types/event-plan';
import { EventTabs, EventTop } from '@/components/EventHeader';
import { SquarePhoto } from '@/components/SquarePhoto';
import styles from './plan.module.css';

/**
 * Screen C3: one event's plan (D-13, D-39–D-43). The businesses being considered and those
 * the person marked booked, what's next, ideas for the kind of event (the team's
 * suggestions and featured businesses, clearly labelled), and the person's own details.
 * Only ever the person's own event: anyone else's is "not found".
 */
export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta(loaderData ? loaderData.plan.event.name : 'Your event'),
  { name: 'robots', content: 'noindex' },
];

export async function loader({ params, context }: Route.LoaderArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  return {
    plan: await found(eventPlan(env, member.userId, params.id)),
    today: todayIso(),
  };
}

/** M10 (D-54): deleting a cancelled event, from its plan (which can say why not, yet). */
export async function action({ request, params, context }: Route.ActionArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  if ((await request.formData()).get('intent') !== 'delete') throw data(null, { status: 400 });
  if (await tooFast(env, member.userId)) return data({ error: TOO_FAST }, { status: 429 });
  try {
    await deleteCancelledEvent(env, member.userId, params.id);
  } catch (err) {
    const { error, status } = refusal(err);
    return data({ error }, { status });
  }
  return redirect('/events?deleted=1');
}

/** The notice after a change. Names come from the plan itself (the address carries only a row id or web address). */
function useNotice(rows: PlanRow[]): string | null {
  const [params] = useSearchParams();
  const row = (key: string) => {
    const id = params.get(key);
    return id ? rows.find((r) => r.rowId === id) : undefined;
  };
  const booked = row('booked');
  if (booked) return booked.claimed ? `You marked ${booked.name} booked. We’ll let them know.` : `You marked ${booked.name} booked.`;
  const unbooked = row('unbooked');
  if (unbooked) return `${unbooked.name} is back to Considering.`;
  const removed = row('removed');
  if (removed) return `Removed ${removed.name} from this event.`;
  // A business that's no longer listed is hidden once removed (D-46), so its name isn't on the page.
  if (params.has('removed')) return 'Removed from this event.';
  const back = row('back');
  if (back) return `${back.name} is back on your plan as Considering.`;
  const added = params.get('added') ? rows.find((r) => r.slug === params.get('added')) : undefined;
  if (params.has('copied')) {
    const n = Number(params.get('copied')) || 0;
    return n > 0 ? `Copy saved, with ${n === 1 ? 'its business' : `${n} businesses`} as Considering. They aren’t told.` : 'Copy saved.';
  }
  // From the shortlist (D-57).
  if (params.has('moved')) {
    const n = Number(params.get('moved')) || 0;
    const what =
      n > 0
        ? `Added ${n === 1 ? '1 business' : `${n} businesses`} from your shortlist as Considering. They aren’t told.`
        : 'Those businesses were already on this event.';
    return params.has('created') ? `Event saved. ${what}` : what;
  }
  if (params.has('created')) return added ? `Event saved. Added ${added.name} as Considering. They aren’t told.` : 'Event saved.';
  if (added) return `Added ${added.name} as Considering. They aren’t told.`;
  if (params.has('saved')) return 'Saved.';
  if (params.has('cancelled')) return 'Event cancelled.';
  return null;
}

function BusinessName({ row }: { row: PlanRow }) {
  return <span className={styles.name}>{row.listed ? <Link to={`/vendors/${row.slug}`}>{row.name}</Link> : row.name}</span>;
}

const ages = (min: number | null, max: number | null) =>
  min !== null && max !== null
    ? min === max
      ? `${min}`
      : `${min} to ${max}`
    : min !== null
      ? `${min} and up`
      : max !== null
        ? `up to ${max}`
        : null;

export default function EventPlan({ loaderData, actionData }: Route.ComponentProps) {
  const { plan, today } = loaderData;
  const { event, rows, ideas } = plan;
  const notice = useNotice(rows);
  const cancelled = event.status === 'cancelled';
  const open = !cancelled;
  const base = `/events/${event.id}`;
  const booked = rows.filter((r) => r.status === 'booked');
  const considering = rows.filter((r) => r.status === 'considering');
  const removed = rows.filter((r) => r.status === 'removed');
  const step = nextStep({
    cancelled,
    passed: event.passed,
    considering: considering.length,
    booked: booked.length,
  });
  const when = cancelled
    ? 'You cancelled this event.'
    : event.passed
      ? `This was on ${longDate(event.date, today)}.`
      : `${whenWords(event.date, today) ?? ''}.`;
  const privateRows: [string, string | null][] = [
    ['Where', plan.private.venueNote],
    ['Ages', ages(plan.private.ageMin, plan.private.ageMax)],
    ['Budget', budgetWords(plan.private.budgetCents)],
    ['Notes', plan.private.notes],
  ];
  const shownPrivate = privateRows.filter(([, v]) => v);

  // "Message all" (D-58): the businesses on Localites that can be messaged now.
  const messageable = considering.filter((r) => r.claimed && r.listed);
  const bookedOn = (at: string | null) =>
    at
      ? new Date(at).toLocaleDateString('en-CA', {
          month: 'long',
          day: 'numeric',
          timeZone: 'America/Toronto',
        })
      : null;
  const ideaTiles = open && !event.passed && ideas ? ideas.categories : [];

  return (
    <>
      <SiteHeader />
      <main className="page">
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        <EventTop
          event={event}
          today={today}
          booked={booked.length}
          considering={considering.length}
          coming={plan.guestTotals.coming}
          canEdit={open}
        />
        <EventTabs base={base} on="businesses" coming={plan.guestTotals.coming} />

        <div className={styles.evGrid}>
          <div className={styles.evMain}>
            {(cancelled || event.passed) && <p className="muted">{when}</p>}

            {booked.length > 0 && (
              <section aria-labelledby="booked" className={styles.evSection}>
                <SectionHead id="booked" title="Booked" count={booked.length} />
                <ul className={styles.evCards}>
                  {booked.map((r) => (
                    <li key={r.rowId} className={styles.evCard}>
                      {r.listed ? <SquarePhoto photo={r.photo} alt="" size="profile" className={styles.evPhoto} /> : null}
                      <div className={styles.evCardBody}>
                        <span className={styles.evKind}>
                          {[r.category, cancelled ? 'You’d marked this booked' : 'Booked'].filter(Boolean).join(' · ')}
                        </span>
                        <h3 className={styles.evName}>
                          <BusinessName row={r} />
                        </h3>
                        {!r.listed ? (
                          <p className={styles.evText}>No longer listed on Localites. It stays here as your own record.</p>
                        ) : (
                          bookedOn(r.bookedAt) && (
                            <p className={styles.evText}>
                              {`You marked this booked on ${bookedOn(r.bookedAt)}.`}
                              {r.claimed ? ' They see your date, town and number of guests, never your event’s name.' : ''}
                            </p>
                          )
                        )}
                        {r.flaggedAt && <p className={styles.flagged}>{r.name} says it isn’t booked for this event.</p>}
                        {r.review && r.review !== 'withdrawn' ? (
                          <Link to={`${base}/review/${r.rowId}`} className="text-link">
                            {REVIEW_STATUS_WORDS[r.review]}
                          </Link>
                        ) : (
                          (r.canReview === 'yes' || r.canReview === 'grace') && (
                            <Link to={`${base}/review/${r.rowId}`} className="text-link">
                              {r.canReview === 'grace' ? `Review ${r.name} (opens 24 hours after you marked it)` : `Review ${r.name}`}
                            </Link>
                          )
                        )}
                        <p className={styles.evLinks}>
                          {r.claimed && r.listed && <Link to={`/vendors/${r.slug}/message`}>Message</Link>}
                          {/* Un-marked, one that's no longer listed would vanish and couldn't be marked again. */}
                          {open && r.listed && <Link to={`${base}/plan/${r.rowId}/unbook`}>Not booked after all</Link>}
                          {open && <Link to={`${base}/plan/${r.rowId}/remove`}>Remove from this event</Link>}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {considering.length > 0 && (
              <section aria-labelledby="considering" className={styles.evSection}>
                <SectionHead
                  id="considering"
                  title="Considering"
                  count={considering.length}
                  after={
                    open && messageable.length > 1 ? (
                      <Link to={`${base}/message-all`} className={styles.evAll}>
                        Message all {messageable.length}
                      </Link>
                    ) : null
                  }
                />
                <ul className={styles.evCards}>
                  {considering.map((r) => (
                    <li key={r.rowId} className={styles.evCard}>
                      <SquarePhoto photo={r.photo} alt="" size="profile" className={styles.evPhoto} />
                      <div className={styles.evCardBody}>
                        <span className={styles.evKind}>{r.category ?? STATUS_WORDS.considering}</span>
                        <h3 className={styles.evName}>
                          <BusinessName row={r} />
                        </h3>
                        {!r.claimed && <p className={styles.evText}>Not on Localites yet</p>}
                        {open && (
                          <div className={styles.evButtons}>
                            <Link to={`${base}/plan/${r.rowId}/book`} className={styles.evBook}>
                              Mark booked
                            </Link>
                            <Form method="post" action={`${base}/plan/${r.rowId}/remove`}>
                              <button
                                type="submit"
                                className={styles.evRemove}
                                aria-label={`Remove ${r.name} from this event`}
                                title="Remove from this event"
                              >
                                ×
                              </button>
                            </Form>
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {removed.length > 0 && (
              <details className={`${styles.section} ${styles.more}`}>
                <summary>Removed ({removed.length})</summary>
                <ul className={styles.list}>
                  {removed.map((r) => (
                    <li key={r.rowId} className={styles.withPhoto}>
                      <SquarePhoto photo={r.photo} alt="" />
                      <div className={styles.rowBody}>
                        <BusinessName row={r} />
                        {r.category && <span className={styles.meta}>{r.category}</span>}
                        {open && (
                          <div className={styles.rowActions}>
                            <Form method="post" action={`${base}/plan/${r.rowId}/readd`}>
                              <button type="submit" className={styles.textButton}>
                                Put back
                              </button>
                            </Form>
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {step !== 'settled' && (
              <section aria-labelledby="next" className={styles.evSection}>
                <h2 id="next" className="label">
                  What’s next
                </h2>
                {step === 'empty' && (
                  <>
                    <p>Find businesses for your event.</p>
                    <div className={styles.actions}>
                      <Link to="/explore" className="button button-secondary">
                        Browse local
                      </Link>
                    </div>
                  </>
                )}
                {step === 'considering' && (
                  <p>
                    Message the businesses you’re considering, or contact them directly from their page. When you’ve arranged something, tap
                    Mark booked.
                  </p>
                )}
                {step === 'passed' && <p>This event has passed.</p>}
                {step === 'cancelled' && (
                  // M10, C10 (D-54): tell guests, start again from a copy, or delete it.
                  <>
                    <p>You cancelled this event. The businesses you’d marked booked were told.</p>
                    <div className={styles.actions}>
                      <Link to={`${base}/tell-guests`} className="button button-secondary">
                        Let your guests know
                      </Link>
                      <Link to={`/events/new?copy=${event.id}`} className="button button-secondary">
                        Copy this event
                      </Link>
                    </div>
                    <details open={Boolean(actionData?.error)}>
                      <summary className="text-link">Delete this event</summary>
                      <p className="muted">
                        Its plan, guest list, replies, questions and updates are deleted, and your guests’ links stop working (they won’t
                        see that it was cancelled). This can’t be undone.
                      </p>
                      {actionData?.error && (
                        <p className="notice" role="alert">
                          {actionData.error}
                        </p>
                      )}
                      <Form method="post">
                        <input type="hidden" name="intent" value="delete" />
                        <button type="submit" className="button button-secondary">
                          Yes, delete it
                        </button>
                      </Form>
                    </details>
                  </>
                )}
              </section>
            )}

            {open && !event.passed && (
              <section aria-labelledby="ideas" className={styles.evSection}>
                <SectionHead id="ideas" title="Still to find" />
                {ideas ? (
                  <>
                    <p className="muted">{ideas.heading}</p>
                    {ideaTiles.length > 0 && (
                      <ul className={styles.evFind}>
                        {ideaTiles.map((c) => (
                          <li key={c.slug}>
                            <Link to={`/search?category=${encodeURIComponent(c.slug)}`} className={styles.evFindTile}>
                              <span aria-hidden="true" className={styles.evPlus}>
                                +
                              </span>
                              <span className={styles.evFindWords}>
                                <span className={styles.evKind}>{c.name}</span>
                                <span>Find one</span>
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                    {ideas.featured.length > 0 && (
                      <>
                        <h3 className={styles.name}>Featured</h3>
                        <p className={styles.small}>{FEATURED_LINE}</p>
                        <ul className={styles.featured}>
                          {ideas.featured.map((f) => (
                            <li key={f.slug} className={styles.featuredCard}>
                              <SquarePhoto photo={f.photo} alt="" />
                              <span className="label">Featured</span>
                              <Link to={`/vendors/${f.slug}`} className={styles.name}>
                                {f.name}
                              </Link>
                              <span className={styles.meta}>{[f.category, f.town].filter(Boolean).join(' · ')}</span>
                              {f.onPlan ? (
                                <span className={styles.meta}>On your plan</span>
                              ) : (
                                <Link to={`/vendors/${f.slug}/add`} className="text-link">
                                  Add to event
                                </Link>
                              )}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {ideas.featured.length === 0 && ideas.categories.length === 0 && (
                      <p>
                        <Link to="/explore" className="text-link">
                          Browse local
                        </Link>
                      </p>
                    )}
                  </>
                ) : (
                  <p className="muted">
                    <Link to={`${base}/edit`}>{NO_TYPE_IDEAS}</Link>
                  </p>
                )}
              </section>
            )}

            {shownPrivate.length > 0 && (
              <section aria-labelledby="private" className={styles.evSection}>
                <h2 id="private" className="label">
                  Only you can see this
                </h2>
                <dl className={styles.private}>
                  {shownPrivate.map(([label, value]) => (
                    <div key={label} className={styles.privateRow}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            <p className={styles.footer}>{NO_PAYMENTS_PERSON}</p>
          </div>

          <aside aria-label="Your guests" className={styles.evSide}>
            <div className={styles.evGuests}>
              <p className={styles.evGuestsLabel}>Your guests</p>
              <p className={styles.evGuestsTitle}>{`${plan.guestTotals.coming} coming`}</p>
              <dl className={styles.evTally}>
                <div>
                  <dt>replied yes</dt>
                  <dd>{plan.guestTotals.yes}</dd>
                </div>
                <div>
                  <dt>can’t come</dt>
                  <dd>{plan.guestTotals.cantCome}</dd>
                </div>
                <div>
                  <dt>waiting</dt>
                  <dd>{plan.guestTotals.waiting}</dd>
                </div>
              </dl>
              <Link to={`${base}/guests`} className={styles.evGuestsButton}>
                {plan.guestTotals.invited > 0 ? 'Guests and invitations' : 'Invite guests'}
              </Link>
              <p className={styles.evGuestsNote}>
                Guests see the name, date, time and place, and your message. Never your budget, notes or other guests.
              </p>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}

function SectionHead({ id, title, count, after }: { id: string; title: string; count?: number; after?: React.ReactNode }) {
  return (
    <div className={styles.evHead}>
      <h2 id={id}>{title}</h2>
      {count !== undefined && <span className={styles.evCount}>{count}</span>}
      <span aria-hidden="true" className={styles.evRule} />
      {after}
    </div>
  );
}
