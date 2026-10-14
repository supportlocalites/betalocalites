import { data, Form, Link, useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { REVIEW_STATUS_WORDS } from '@/lib/review-terms';
import {
  budgetWords,
  FEATURED_LINE,
  guestsWords,
  longDate,
  NO_PAYMENTS_PERSON,
  NO_TYPE_IDEAS,
  nextStep,
  STATUS_WORDS,
  timeRange,
  whenWords,
} from '@/lib/plan-terms';
import { eventPlan, type PlanRow } from '@/server/events.server';
import { found, todayIso } from '@/server/plan-pages.server';
import type { Route } from './+types/event-plan';
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
  return { plan: await found(eventPlan(env, member.userId, params.id)), today: todayIso() };
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

export default function EventPlan({ loaderData }: Route.ComponentProps) {
  const { plan, today } = loaderData;
  const { event, rows, ideas } = plan;
  const notice = useNotice(rows);
  const cancelled = event.status === 'cancelled';
  const open = !cancelled;
  const base = `/events/${event.id}`;
  const booked = rows.filter((r) => r.status === 'booked');
  const considering = rows.filter((r) => r.status === 'considering');
  const removed = rows.filter((r) => r.status === 'removed');
  const step = nextStep({ cancelled, passed: event.passed, considering: considering.length, booked: booked.length });
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

  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {event.typeName && <p className="label">{event.typeName}</p>}
        <h1 className="title-1">{event.name}</h1>
        <div className="title-rule" aria-hidden="true" />
        <p>
          {[longDate(event.date, today), timeRange(event.startTime, event.endTime), event.town, guestsWords(event.guests)]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <p className="muted">{when}</p>
        <p>
          {open && (
            <>
              <Link to={`${base}/edit`} className="text-link">
                Edit details
              </Link>
              {' · '}
            </>
          )}
          <Link to={`${base}/guests`} className="text-link">
            Guests and invitations
          </Link>
        </p>

        {booked.length > 0 && (
          <section aria-labelledby="booked" className={styles.section}>
            <h2 id="booked" className="label">
              Booked
            </h2>
            <ul className={styles.list}>
              {booked.map((r) => (
                <li key={r.rowId} className={r.listed ? styles.withPhoto : undefined}>
                  {r.listed && <SquarePhoto photo={r.photo} alt="" />}
                  <div className={styles.rowBody}>
                    <div className={styles.rowHead}>
                      <BusinessName row={r} />
                      <span className={styles.pill}>{STATUS_WORDS.booked}</span>
                    </div>
                    {r.category && <span className={styles.meta}>{r.category}</span>}
                    {!r.listed && <span className={styles.meta}>No longer listed on Localites. It stays here as your own record.</span>}
                    {r.flaggedAt && <span className={styles.flagged}>{r.name} says it isn’t booked for this event.</span>}
                    {r.review && r.review !== 'withdrawn' ? (
                      <Link to={`${base}/review/${r.rowId}`} className="text-link">
                        {REVIEW_STATUS_WORDS[r.review]}
                      </Link>
                    ) : (
                      r.canReview === 'yes' && (
                        <Link to={`${base}/review/${r.rowId}`} className="text-link">
                          Review {r.name}
                        </Link>
                      )
                    )}
                    {open && (
                      <details className={styles.change}>
                        <summary>Change this</summary>
                        <div className={styles.rowActions}>
                          {/* Un-marked, one that's no longer listed would vanish and couldn't be marked again. */}
                          {r.listed && (
                            <Link to={`${base}/plan/${r.rowId}/unbook`} className="text-link">
                              Un-mark as booked
                            </Link>
                          )}
                          <Link to={`${base}/plan/${r.rowId}/remove`} className="text-link">
                            Remove from this event
                          </Link>
                        </div>
                      </details>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {considering.length > 0 && (
          <section aria-labelledby="considering" className={styles.section}>
            <h2 id="considering" className="label">
              Considering
            </h2>
            <ul className={styles.list}>
              {considering.map((r) => (
                <li key={r.rowId} className={styles.withPhoto}>
                  <SquarePhoto photo={r.photo} alt="" />
                  <div className={styles.rowBody}>
                    <div className={styles.rowHead}>
                      <BusinessName row={r} />
                      <span className={styles.pill}>{STATUS_WORDS.considering}</span>
                    </div>
                    {r.category && <span className={styles.meta}>{r.category}</span>}
                    {!r.claimed && <span className={styles.meta}>Not on Localites yet</span>}
                    {open && (
                      <div className={styles.rowActions}>
                        <Link to={`${base}/plan/${r.rowId}/book`} className="button button-primary">
                          Mark as booked
                        </Link>
                        <Form method="post" action={`${base}/plan/${r.rowId}/remove`}>
                          <button type="submit" className={styles.textButton}>
                            Remove
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

        <section aria-labelledby="next" className={styles.section}>
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
              Contact the businesses you’re considering directly: their phone number and website are on their page. When you’ve arranged
              something, tap Mark as booked.
            </p>
          )}
          {step === 'settled' && <p>Everything you’ve marked is here. Arrange the details directly with each business.</p>}
          {step === 'passed' && <p>This event has passed.</p>}
          {step === 'cancelled' && <p>You cancelled this event.</p>}
        </section>

        {open && !event.passed && (
          <section aria-labelledby="ideas" className={styles.section}>
            {ideas ? (
              <>
                <h2 id="ideas" className="label">
                  {ideas.heading}
                </h2>
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
                {ideas.categories.length > 0 && (
                  <>
                    <h3 className={styles.name}>Businesses people often need</h3>
                    <ul className={styles.ideaLinks}>
                      {ideas.categories.map((c) => (
                        <li key={c.slug}>
                          <Link to={`/search?category=${encodeURIComponent(c.slug)}`} className="text-link">
                            {c.name}
                          </Link>
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
              <>
                <h2 id="ideas" className="label">
                  Ideas
                </h2>
                <p className="muted">
                  <Link to={`${base}/edit`}>{NO_TYPE_IDEAS}</Link>
                </p>
              </>
            )}
          </section>
        )}

        {shownPrivate.length > 0 && (
          <section aria-labelledby="private" className={styles.section}>
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
        <p>
          <Link to="/events" className="text-link">
            My events
          </Link>
        </p>
      </main>
    </>
  );
}
