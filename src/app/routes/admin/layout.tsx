import { Form, Link, NavLink, Outlet } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { Wordmark } from '@/components/Wordmark';
import { teamMenuCounts } from '@/server/admin/team-bookings.server';
import { countPendingDeletions } from '@/server/account-deletion.server';
import { adminGate } from '@/server/auth/admin.server';
import { countOpenClaims } from '@/server/claims.server';
import { countNewSuggestions } from '@/server/suggestions.server';
import type { Route } from './+types/layout';
import styles from './admin.module.css';

/**
 * Every admin page and form sits under this route, so every admin request passes the
 * gate first (session, team role in our database, two-step code, fresh sign-in).
 */
export const middleware: Route.MiddlewareFunction[] = [
  async ({ request, context }, next) => {
    const { env } = context.get(cloudflareContext);
    const { admin, setCookies } = await adminGate(request, env);
    context.set(adminContext, admin);
    const response = await next();
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Robots-Tag', 'noindex');
    for (const cookie of setCookies) response.headers.append('Set-Cookie', cookie);
    return response;
  },
];

export async function loader({ context }: Route.LoaderArgs) {
  const admin = context.get(adminContext);
  const { env } = context.get(cloudflareContext);
  const [newSuggestions, openClaims, { openFlags, checkIns, inquiries, openReports }, deletions] = await Promise.all([
    countNewSuggestions(env),
    countOpenClaims(env),
    teamMenuCounts(env, admin),
    countPendingDeletions(env, admin),
  ]);
  return { name: admin.name, email: admin.email, newSuggestions, openClaims, openFlags, deletions, checkIns, inquiries, openReports };
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <header className={styles.header}>
        <Link to="/admin" className={styles.wordmark}>
          <Wordmark small />
          <span className="label"> Team</span>
        </Link>
        <nav aria-label="Admin" className={styles.nav}>
          <NavLink to="/admin" end className="text-link">
            Listings
          </NavLink>
          <NavLink to="/admin/claims" className="text-link">
            Claims{loaderData.openClaims > 0 ? ` (${loaderData.openClaims} waiting)` : ''}
          </NavLink>
          <NavLink to="/admin/reports" className="text-link">
            Reports{loaderData.openReports > 0 ? ` (${loaderData.openReports} open)` : ''}
          </NavLink>
          <NavLink to="/admin/inquiries" className="text-link">
            Inquiries{loaderData.inquiries > 0 ? ` (${loaderData.inquiries} waiting)` : ''}
          </NavLink>
          <NavLink to="/admin/suggestions" className="text-link">
            Suggestions{loaderData.newSuggestions > 0 ? ` (${loaderData.newSuggestions} new)` : ''}
          </NavLink>
          <NavLink to="/admin/activity" className="text-link">
            Activity
          </NavLink>
          <NavLink to="/admin/categories" className="text-link">
            Categories and towns
          </NavLink>
          <NavLink to="/admin/event-types" className="text-link">
            Event types
          </NavLink>
          <NavLink to="/admin/bookings" className="text-link">
            Bookings{loaderData.checkIns > 0 ? ` (${loaderData.checkIns} to check in)` : ''}
          </NavLink>
          <NavLink to="/admin/booking-flags" className="text-link">
            Booking flags ({loaderData.openFlags})
          </NavLink>
          <NavLink to="/admin/photos" className="text-link">
            Photos
          </NavLink>
          <NavLink to="/admin/account-deletions" className="text-link">
            Deleted accounts{loaderData.deletions > 0 ? ` (${loaderData.deletions} to finish)` : ''}
          </NavLink>
          <Link to="/explore" className="text-link">
            Public site
          </Link>
        </nav>
        <div className={styles.account}>
          <span className="muted">{loaderData.email}</span>
          <Form method="post" action="/sign-out">
            <button type="submit" className={`text-link ${styles.linkButton}`}>
              Sign out
            </button>
          </Form>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </>
  );
}
