import { useRef } from 'react';
import { data, Form, Link, redirect, useLocation, useSearchParams } from 'react-router';
import { cloudflareContext } from '@/app/context';
import { useVendorActivity } from '@/components/ActivityTracker';
import { SiteHeader } from '@/components/SiteHeader';
import { ReportLink, ReviewList } from '@/components/Reviews';
import { VendorPage } from '@/components/VendorPage';
import { cookieHeaders, viewTrack } from '@/server/activity.server';
import { hasSessionCookie, signedInUserId } from '@/server/auth/session.server';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta, shareMeta } from '@/lib/meta';
import { findRenamed, getVendor } from '@/server/catalog.server';
import { withDb } from '@/server/db.server';
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
  // A signed note of this page, for counting real visits and taps (ADR-030).
  const { track, setCookie } = await viewTrack(env, request, id);
  const origin = new URL(request.url).origin;
  const headers = new Headers(cookieHeaders(setCookie));
  // What a signed-in visitor sees depends on who they are (C6): never kept by a shared cache.
  if (hasSessionCookie(request)) headers.set('Cache-Control', 'private, no-store');
  return data({ vendor, reviews, slug: params.slug, signedIn: hasSessionCookie(request), yours, track, origin }, { headers });
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

export default function VendorProfile({ loaderData: { vendor, reviews, slug, signedIn, yours, track, origin } }: Route.ComponentProps) {
  const pageRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const onTap = useVendorActivity(track, pageRef, listPlace(location.state), location.key);
  return (
    <>
      <SiteHeader />
      <main className="page" ref={pageRef} onClickCapture={onTap}>
        <PlanNotice name={vendor.name} />
        <VendorPage vendor={vendor}>
          {/* C6 (D-54): the business's own team sees what they can do, not the customer's buttons. */}
          {yours && (
            <section aria-labelledby="yours" className={styles.owner}>
              <h2 id="yours" className="label">
                This is your business
              </h2>
              <p className="muted">
                You’re on {vendor.name}’s team, so this is how customers see your page. Messages, saving and adding to events are for
                customers.
              </p>
              <div className={styles.contact}>
                <Link to="/business" className="button button-secondary">
                  My business
                </Link>
                {yours !== 'staff' && (
                  <Link to={`/vendors/${slug}/edit`} className="button button-secondary">
                    Edit your listing
                  </Link>
                )}
              </div>
            </section>
          )}
          {/* Only here, not on the owner's edit page or preview (they share VendorPage). */}
          {vendor.claimed && !yours && (
            <section aria-labelledby="message" className={styles.owner}>
              <h2 id="message" className="label">
                Questions?
              </h2>
              <p className="muted">{vendor.name} is on Localites. Message them here; they reply on Localites.</p>
              <div className={styles.contact}>
                <Link to={`/vendors/${slug}/message`} className="button button-secondary">
                  Message {vendor.name}
                </Link>
              </div>
            </section>
          )}
          {!vendor.claimed && (
            <section aria-labelledby="inquire" className={styles.owner}>
              <h2 id="inquire" className="label">
                Interested?
              </h2>
              <p className="muted">{vendor.name} isn’t on Localites yet. Tell our team you’re interested and we’ll invite them to join.</p>
              <div className={styles.contact}>
                <Link to={`/vendors/${slug}/inquire`} className="button button-secondary">
                  Inquire
                </Link>
              </div>
            </section>
          )}
          {!yours && (
            <section aria-labelledby="plan" className={styles.owner}>
              <h2 id="plan" className="label">
                Planning an event?
              </h2>
              <div className={styles.contact}>
                <Link to={`/vendors/${slug}/add`} className="button button-secondary">
                  Add to event
                </Link>
                <Form method="post" action={`/vendors/${slug}/add`}>
                  <input type="hidden" name="intent" value="save" />
                  <input type="hidden" name="return" value="profile" />
                  <button type="submit" className="button button-secondary">
                    Save
                  </button>
                </Form>
              </div>
              <p className="muted">Saving and adding to an event are private. {vendor.name} isn’t told.</p>
            </section>
          )}
          <section aria-labelledby="reviews" className={styles.owner}>
            <h2 id="reviews" className="label">
              Reviews
            </h2>
            <ReviewList
              businessName={vendor.name}
              count={reviews.count}
              average={reviews.average}
              reviews={reviews.reviews}
              after={(r) => <ReportLink to={`/reviews/${r.id}/report`} />}
            />
            <p className="muted">
              Only people who booked {vendor.name} for an event can review it, after the event. Our team reads every review before it’s
              published.
            </p>
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
        </VendorPage>
      </main>
    </>
  );
}
