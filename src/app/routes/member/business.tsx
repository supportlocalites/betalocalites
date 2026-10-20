import { data, Form, isRouteErrorResponse, Link, redirect, useNavigation, useRouteError, useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SideSwitch } from '@/components/SideSwitch';
import { SiteHeader } from '@/components/SiteHeader';
import { pageMeta } from '@/lib/meta';
import { isUuid } from '@/lib/ids.mjs';
import { myBusinesses } from '@/server/bookings.server';
import { leaveTeam, TeamRefused } from '@/server/team.server';
import type { Route } from './+types/business';
import styles from './plan.module.css';

/**
 * Screen V1, first version: My business (D-13, D-29). The businesses this person runs as an
 * owner or manager, each with its bookings marked coming up. Conversations come in 2B.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('My business'), { name: 'robots', content: 'noindex' }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const member = context.get(memberContext);
  const businesses = await myBusinesses(context.get(cloudflareContext).env, member.userId);
  // Just stepped back from the only one (D-54): said here, not as "not on a team".
  const stepped = ['off', 'handed', 'left'].some((k) => new URL(request.url).searchParams.has(k));
  if (businesses.length === 0 && !stepped) throw data(null, { status: 404 });
  return { businesses };
}

/** M18 (D-54): a manager or staff member leaves a business's team. */
export async function action({ request, context }: Route.ActionArgs) {
  const member = context.get(memberContext);
  const form = await request.formData();
  const vendorId = String(form.get('vendorId') ?? '');
  if (form.get('intent') !== 'leave' || !isUuid(vendorId)) throw data(null, { status: 400 });
  try {
    await leaveTeam(context.get(cloudflareContext).env, member.userId, vendorId);
  } catch (err) {
    if (err instanceof TeamRefused) throw data(null, { status: 404 });
    throw err;
  }
  return redirect('/business?left=1');
}

const NOTICES: Record<string, string> = {
  handed: 'Done. They’re the owner now, and we’re emailing them to say so. You’re a manager; you can leave the team below.',
  off: 'Your business is off Localites. Thank you for being part of it. To come back, email supportlocalites@gmail.com and we’ll add it again.',
  left: 'You’ve left the team. You no longer have access to that business.',
};

export default function MyBusiness({ loaderData: { businesses } }: Route.ComponentProps) {
  const busy = useNavigation().state !== 'idle';
  const [params] = useSearchParams();
  const notice = Object.keys(NOTICES).find((k) => params.has(k));
  return (
    <>
      <SiteHeader />
      <main className="page">
        <SideSwitch current="business" />
        <h1 className="title-1">My business</h1>
        <div className="title-rule" aria-hidden="true" />
        {notice && (
          <p className="notice" role="status">
            {NOTICES[notice]}
          </p>
        )}
        {businesses.length === 0 && <p className="muted">You’re not on a business’s team on Localites now.</p>}
        <ul className={styles.bizList}>
          {businesses.map((b) => {
            // Each place to go, with a line on what's there (the approved look's tiles, D-55).
            const tiles: [string, string, string][] = b.archived
              ? []
              : [
                  [`/vendors/${b.slug}/messages`, b.unread > 0 ? `Messages (${b.unread} new)` : 'Messages', 'Conversations with customers'],
                  ...(b.role !== 'staff'
                    ? ([[`/vendors/${b.slug}/bookings`, 'Bookings marked', 'Events that marked you booked']] as [string, string, string][])
                    : []),
                  [`/vendors/${b.slug}/reviews`, 'Reviews', 'What customers said, and your replies'],
                  ...(b.role !== 'staff'
                    ? ([
                        [`/vendors/${b.slug}/edit`, 'Edit your listing', 'Your words, services and contact'],
                        [`/vendors/${b.slug}/address`, 'Address and map', 'Where your pin goes'],
                        [`/vendors/${b.slug}/photos`, 'Photos', 'Your page photos and profile photo'],
                      ] as [string, string, string][])
                    : []),
                  ...(b.role !== 'staff' && b.analytics
                    ? ([[`/vendors/${b.slug}/analytics`, 'Analytics', 'Who looked, and what they tapped']] as [string, string, string][])
                    : []),
                  ...(b.role === 'owner' ? ([[`/vendors/${b.slug}/team`, 'Team', 'Who helps you run it']] as [string, string, string][]) : []),
                ];
            return (
              <li key={b.id} className={styles.bizCard}>
                <p className={styles.evKind}>{`Your business · ${b.role === 'owner' ? 'Owner' : b.role === 'manager' ? 'Manager' : 'Staff'}`}</p>
                <h2 className={styles.bizName}>{b.listed ? <Link to={`/vendors/${b.slug}`}>{b.name}</Link> : b.name}</h2>
                {b.archived ? (
                  <p className={styles.evText}>No longer on Localites. Email supportlocalites@gmail.com with questions.</p>
                ) : (
                  <>
                    {b.hidden && <p className={styles.evText}>Hidden by its owner: not showing on Localites</p>}
                    <dl className={styles.guestTally}>
                      <div>
                        <dt>new messages</dt>
                        <dd>{b.unread}</dd>
                      </div>
                      {b.role !== 'staff' && (
                        <div>
                          <dt>{b.comingUp === 1 ? 'booking marked coming up' : 'bookings marked coming up'}</dt>
                          <dd>{b.comingUp}</dd>
                        </div>
                      )}
                    </dl>
                    <ul className={styles.bizTiles}>
                      {tiles.map(([to, label, what]) => (
                        <li key={to}>
                          <Link to={to} className={styles.bizTile}>
                            <span className={styles.bizTileName}>{label}</span>
                            <span className={styles.evText}>{what}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {b.role !== 'owner' && (
                  // M18 (D-54): leaving, with a confirm step. The owner hands over first (Team).
                  <details>
                    <summary className={styles.textButton}>Leave this team</summary>
                    <p className="muted">You’ll no longer see {b.name}’s messages or anything else of its. The owner can invite you again.</p>
                    <Form method="post">
                      <input type="hidden" name="intent" value="leave" />
                      <input type="hidden" name="vendorId" value={b.id} />
                      <button type="submit" className="button button-secondary" disabled={busy}>
                        Yes, leave {b.name}
                      </button>
                    </Form>
                  </details>
                )}
              </li>
            );
          })}
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
