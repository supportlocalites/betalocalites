import { useRef } from 'react';
import { data, Form, Link, redirect, useLocation, useSearchParams } from 'react-router';
import { cloudflareContext } from '@/app/context';
import { useVendorActivity } from '@/components/ActivityTracker';
import { SiteHeader } from '@/components/SiteHeader';
import { ReportLink, ReviewList } from '@/components/Reviews';
import { ChoiceButtons } from '@/components/BrowseCard';
import { VendorPage } from '@/components/VendorPage';
import { shortDate } from '@/lib/plan-terms';
import { cookieHeaders, viewTrack } from '@/server/activity.server';
import { hasSessionCookie, signedInUserId } from '@/server/auth/session.server';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta, shareMeta } from '@/lib/meta';
import { findRenamed, getVendor } from '@/server/catalog.server';
import { withDb } from '@/server/db.server';
import { addingChoices } from '@/server/events.server';
import { publicReviews } from '@/server/reviews.server';
import { teamRoleAt } from '@/server/team.server';
import type { Route } from './+types/vendor';
import styles from '@/components/VendorPage.module.css';

export const meta: Route.MetaFunction = ({ loaderData, matches }) =>
  loaderData
    ? shareMeta(
        matches,
        `/vendors/${loaderData.slug}`,
        loaderData.vendor.name,
        loaderData.vendor.tagline ?? `${loaderData.vendor.name} in ${loaderData.vendor.town}, on Localites.`,
        loaderData.vendor.photos?.[0]?.url ?? loaderData.vendor.profile?.url,
      )
    : pageMeta('Not found');

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const found = await getVendor(env, params.slug);
  if (!found) {
    // A renamed listing: its old web address keeps working (shared links, Google).
    const current = await findRenamed(env, params.slug);
    if (current) throw redirect(`/vendors/${current}`, 301);
    throw data(null, { status: 404 });
  }
  const { id, ...vendor } = found;
  const reviews = await withDb(env, (db) => publicReviews(db, id));
  // C6 (D-54): someone on this business's team sees it as theirs, not as a customer.
  const userId = hasSessionCookie(request) ? await signedInUserId(request, env) : null;
  const yours = userId ? await teamRoleAt(env, userId, id) : null;
  // The person's own events, shortlist and favourites, for the panel beside the page (D-58).
  const choices = userId && !yours ? await addingChoices(env, userId, params.slug).catch(() => null) : null;
  // A signed note of this page, for counting real visits and taps (ADR-030).
  const { track, setCookie } = await viewTrack(env, request, id);
  const origin = new URL(request.url).origin;
  const headers = new Headers(cookieHeaders(setCookie));
  // What a signed-in visitor sees depends on who they are (C6): never kept by a shared cache.
  if (hasSessionCookie(request)) headers.set('Cache-Control', 'private, no-store');
  return data(
    {
      vendor,
      reviews,
      slug: params.slug,
      signedIn: hasSessionCookie(request),
      yours,
      track,
      origin,
      mine: choices ? { shortlisted: choices.vendor.shortlisted, saved: choices.vendor.saved, events: choices.events } : null,
    },
    { headers },
  );
}

// The visitor cookie a new browser gets with the page (ADR-030).
export const headers: Route.HeadersFunction = ({ loaderHeaders }) => loaderHeaders;

/** Where the visitor came from, if they opened this page from a Localites list. */
const listPlace = (state: unknown) => {
  const s = state as { pos?: unknown; list?: unknown } | null;
  return s && typeof s.pos === 'number' && typeof s.list === 'string' ? { pos: s.pos, list: s.list } : null;
};

/**
 * What happened after Save or Add to event (C4, C6), read from the address. Only an event
 * id goes in it; the event's page checks it's the person's own.
 */
function PlanNotice({ name }: { name: string }) {
  const [params] = useSearchParams();
  const event = (key: string) => {
    const id = params.get(key);
    return id && isUuid(id) ? id : null;
  };
  const added = event('added');
  const already = event('already');
  const message = params.has('saved')
    ? { text: 'Saved. Only you can see your saved businesses.', link: '/saved', label: 'See saved' }
    : added
      ? { text: 'Added to your event as Considering.', link: `/events/${added}`, label: 'See your plan' }
      : already
        ? { text: `${name} is already on that event.`, link: `/events/${already}`, label: 'See your plan' }
        : null;
  if (!message) return null;
  return (
    <p className="notice" role="status">
      {message.text}{' '}
      <Link to={message.link} className="text-link">
        {message.label}
      </Link>
    </p>
  );
}

export default function VendorProfile({ loaderData: { vendor, reviews, slug, signedIn, yours, track, origin, mine } }: Route.ComponentProps) {
  const pageRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const onTap = useVendorActivity(track, pageRef, listPlace(location.state), location.key);
  const choosable = { slug, name: vendor.name, shortlisted: mine?.shortlisted ?? false, saved: mine?.saved ?? false };
  // The phone's bar at the bottom (D-58): Message, the +, the bookmark. Not for the business's own team.
  const bar = !yours;
  return (
    <>
      <SiteHeader />
      <main className={`page ${bar ? styles.withBar : ''}`} ref={pageRef} onClickCapture={onTap}>
        <PlanNotice name={vendor.name} />
        <VendorPage
          vendor={vendor}
          rating={{ count: reviews.count, average: reviews.average }}
          crumb={
            <nav aria-label="Where you are" className={styles.crumb}>
              <Link to="/explore">Browse local</Link>
              {vendor.categories[0] && (
                <>
                  {' '}
                  <span aria-hidden="true">/</span> {vendor.categories[0]}
                </>
              )}
            </nav>
          }
          main={
            <>
              <section aria-labelledby="reviews" className={styles.reviews}>
                <div className={styles.reviewsHead}>
                  <h2 id="reviews">Reviews</h2>
                  {reviews.count > 0 && <span className={styles.reviewsCount}>{reviews.count}</span>}
                  <span aria-hidden="true" className={styles.reviewsRule} />
                </div>
                <p className="muted">
                  Only people who booked {vendor.name} for an event can review it, after the event. Our team reads every review before it’s
                  published.
                </p>
                <ReviewList
                  businessName={vendor.name}
                  count={reviews.count}
                  average={reviews.average}
                  reviews={reviews.reviews}
                  after={(r) => <ReportLink to={`/reviews/${r.id}/report`} />}
                />
              </section>
              <section aria-labelledby="owner" className={styles.owner}>
                <h2 id="owner" className="label">
                  Is this your business?
                </h2>
                {vendor.claimed ? (
                  <>
                    <p className="muted">
                      This business manages its own listing on Localites. Something wrong? Email supportlocalites@gmail.com.
                    </p>
                    {/* Only a hint: the edit page itself checks who the owner is. */}
                    {signedIn && !yours && (
                      <p>
                        Your business?{' '}
                        <Link to={`/vendors/${slug}/edit`} className="text-link">
                          Edit your listing
                        </Link>
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="muted">Claim it to manage this listing yourself. Claiming is free.</p>
                    <div className={styles.contact}>
                      <Link to={`/vendors/${slug}/claim`} className="button button-secondary">
                        Claim this business
                      </Link>
                    </div>
                    <p className="muted">
                      Rather not be listed?{' '}
                      <a href={`mailto:supportlocalites@gmail.com?subject=${encodeURIComponent(`Please remove ${vendor.name}`)}`}>
                        Ask us to remove it
                      </a>
                      .
                    </p>
                  </>
                )}
              </section>
              <p className="muted">
                Something wrong with this listing?{' '}
                <a
                  href={`mailto:supportlocalites@gmail.com?subject=${encodeURIComponent(`Something wrong with ${vendor.name}`)}&body=${encodeURIComponent(
                    `The listing: ${origin}/vendors/${slug}\n\nWhat's wrong:\n`,
                  )}`}
                >
                  Tell us
                </a>
                .
              </p>
            </>
          }
        >
          {/* C6 (D-54): the business's own team sees what they can do, not the customer's buttons. */}
          {yours ? (
            <section aria-labelledby="yours" className={styles.panel}>
              <h2 id="yours" className={styles.panelLabel}>
                This is your business
              </h2>
              <p className={styles.panelNote}>
                You’re on {vendor.name}’s team, so this is how customers see your page. Messages, saving and adding to events are for
                customers.
              </p>
              <div className={styles.panelLinks}>
                <Link to="/business" className={styles.panelMain}>
                  My business
                </Link>
                {yours !== 'staff' && (
                  <Link to={`/vendors/${slug}/edit`} className={styles.panelSecond}>
                    Edit your listing
                  </Link>
                )}
              </div>
            </section>
          ) : (
            <section aria-labelledby="plan" className={styles.panel}>
              <h2 id="plan" className={styles.panelLabel}>
                Planning an event?
              </h2>
              {vendor.claimed ? (
                <>
                  <p className={styles.panelTitle}>Talk to {vendor.name} directly.</p>
                  <Link to={`/vendors/${slug}/message`} className={styles.panelMain}>
                    Message {vendor.name}
                  </Link>
                </>
              ) : (
                <>
                  <p className={styles.panelTitle}>{vendor.name} isn’t on Localites yet.</p>
                  <p className={styles.panelNote}>Tell our team you’re interested and we’ll invite them to join.</p>
                  <Link to={`/vendors/${slug}/inquire`} className={styles.panelMain}>
                    Inquire
                  </Link>
                </>
              )}
              <ChoiceButtons card={choosable} signedIn={signedIn} look="panel" />
              <AddToEvent slug={slug} name={vendor.name} events={mine?.events ?? null} />
              <p className={styles.panelNote}>
                Arrange everything directly with the business. {vendor.name} isn’t told when you save, shortlist or add it to an event.
              </p>
            </section>
          )}
        </VendorPage>
        {bar && (
          <div className={styles.phoneBar}>
            {vendor.claimed ? (
              <Link to={`/vendors/${slug}/message`} className={styles.panelMain}>
                Message
              </Link>
            ) : (
              <Link to={`/vendors/${slug}/inquire`} className={styles.panelMain}>
                Inquire
              </Link>
            )}
            <ChoiceButtons card={choosable} signedIn={signedIn} look="bar" />
          </div>
        )}
      </main>
    </>
  );
}

/** "Add to one of your events" (C4), in the panel: choose the event, then Add. */
function AddToEvent({
  slug,
  name,
  events,
}: {
  slug: string;
  name: string;
  events: { id: string; name: string; date: string; status: string | null }[] | null;
}) {
  if (!events || events.length === 0) {
    return (
      <Link to={`/vendors/${slug}/add`} className={styles.panelSecond}>
        {events ? `Start an event with ${name}` : 'Add to an event'}
      </Link>
    );
  }
  return (
    <Form method="post" action={`/vendors/${slug}/add`} className={styles.addForm}>
      <input type="hidden" name="intent" value="add" />
      <label htmlFor="add-event" className={styles.panelLabel}>
        Add to one of your events
      </label>
      <div className={styles.addRow}>
        <select id="add-event" name="eventId" className={styles.addSelect}>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {`${e.name} · ${shortDate(e.date)}${e.status ? ' (already on it)' : ''}`}
            </option>
          ))}
        </select>
        <button type="submit" className={styles.panelSecond}>
          Add
        </button>
      </div>
    </Form>
  );
}
