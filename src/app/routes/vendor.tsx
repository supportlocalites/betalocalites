import { useRef } from 'react';
import { data, Form, Link, redirect, useLocation, useSearchParams } from 'react-router';
import { cloudflareContext } from '@/app/context';
import { useVendorActivity } from '@/components/ActivityTracker';
import { SiteHeader } from '@/components/SiteHeader';
import { VendorPage } from '@/components/VendorPage';
import { cookieHeaders, viewTrack } from '@/server/activity.server';
import { hasSessionCookie } from '@/server/auth/session.server';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { findRenamed, getVendor } from '@/server/catalog.server';
import type { Route } from './+types/vendor';
import styles from '@/components/VendorPage.module.css';

export const meta: Route.MetaFunction = ({ loaderData }) =>
  loaderData ? pageMeta(loaderData.vendor.name, loaderData.vendor.tagline ?? undefined) : pageMeta('Not found');

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
  // A signed note of this page, for counting real visits and taps (ADR-030).
  const { track, setCookie } = await viewTrack(env, request, id);
  return data({ vendor, slug: params.slug, signedIn: hasSessionCookie(request), track }, { headers: cookieHeaders(setCookie) });
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

export default function VendorProfile({ loaderData: { vendor, slug, signedIn, track } }: Route.ComponentProps) {
  const pageRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const onTap = useVendorActivity(track, pageRef, listPlace(location.state), location.key);
  return (
    <>
      <SiteHeader />
      <main className="page" ref={pageRef} onClickCapture={onTap}>
        <PlanNotice name={vendor.name} />
        <VendorPage vendor={vendor}>
          {/* Only here, not on the owner's edit page or preview (they share VendorPage). */}
          {vendor.claimed && (
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
                {signedIn && (
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
        </VendorPage>
      </main>
    </>
  );
}
