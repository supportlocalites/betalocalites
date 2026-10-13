import { data, isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SideSwitch } from '@/components/SideSwitch';
import { SiteHeader } from '@/components/SiteHeader';
import { pageMeta } from '@/lib/meta';
import { myBusinesses } from '@/server/bookings.server';
import type { Route } from './+types/business';
import styles from './plan.module.css';

/**
 * Screen V1, first version: My business (D-13, D-29). The businesses this person runs as an
 * owner or manager, each with its bookings marked coming up. Conversations come in 2B.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('My business'), { name: 'robots', content: 'noindex' }];

export async function loader({ context }: Route.LoaderArgs) {
  const member = context.get(memberContext);
  const businesses = await myBusinesses(context.get(cloudflareContext).env, member.userId);
  if (businesses.length === 0) throw data(null, { status: 404 });
  return { businesses };
}

export default function MyBusiness({ loaderData: { businesses } }: Route.ComponentProps) {
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <SideSwitch current="business" />
        <h1 className="title-1">My business</h1>
        <div className="title-rule" aria-hidden="true" />
        <ul className={styles.list}>
          {businesses.map((b) => (
            <li key={b.id}>
              <span className={styles.name}>{b.listed ? <Link to={`/vendors/${b.slug}`}>{b.name}</Link> : b.name}</span>
              {b.archived ? (
                <span className={styles.meta}>No longer on Localites. Email supportlocalites@gmail.com with questions.</span>
              ) : (
                <>
                  {b.role !== 'staff' && (
                    <span className={styles.meta}>
                      {b.comingUp === 0
                        ? 'No bookings marked coming up'
                        : `${b.comingUp} ${b.comingUp === 1 ? 'booking' : 'bookings'} marked coming up`}
                    </span>
                  )}
                  {b.role === 'staff' ? (
                    <span className={styles.meta}>
                      You’ll be able to read and reply to customers’ messages here when messaging arrives.
                    </span>
                  ) : (
                    <div className={styles.rowActions}>
                      <Link to={`/vendors/${b.slug}/bookings`} className="text-link">
                        Bookings marked
                      </Link>
                      <Link to={`/vendors/${b.slug}/edit`} className="text-link">
                        Edit your listing
                      </Link>
                      <Link to={`/vendors/${b.slug}/photos`} className="text-link">
                        Photos
                      </Link>
                      {b.analytics && (
                        <Link to={`/vendors/${b.slug}/analytics`} className="text-link">
                          Analytics
                        </Link>
                      )}
                      {b.role === 'owner' && (
                        <Link to={`/vendors/${b.slug}/team`} className="text-link">
                          Team
                        </Link>
                      )}
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
        <p className="section-gap">
          <Link to="/account" className="text-link">
            Your account
          </Link>
        </p>
      </main>
    </>
  );
}

/** Not on a business's team: said plainly. */
export function ErrorBoundary() {
  const error = useRouteError();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">{missing ? 'My business' : 'Something went wrong'}</h1>
        <div className="title-rule" aria-hidden="true" />
        <p className="muted">
          {missing
            ? 'You’re not on a business’s team on Localites. If your business is listed, open its page and choose “Claim this business”.'
            : 'The page didn’t load. Please try again in a moment.'}
        </p>
        <Link to="/events" className="button button-primary">
          My events
        </Link>
      </main>
    </>
  );
}
