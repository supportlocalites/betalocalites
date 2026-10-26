import { Link } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { pageMeta } from '@/lib/meta';
import { type WaitingKind, waitingWork } from '@/server/admin/waiting.server';
import type { Route } from './+types/waiting';
import styles from './admin.module.css';

/**
 * Waiting for you (product owner, 18 October 2026): everything the team has to deal with, in one
 * list, oldest first, each linking to its own page. Counts and dates only, never who. The team
 * handbook (docs/team-handbook.md) says how to handle each.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Waiting for you · Team'), { name: 'robots', content: 'noindex' }];

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  return { work: await waitingWork(env, context.get(adminContext)) };
}

const KINDS: Record<WaitingKind, { label: string; what: string; to: string }> = {
  held_changes: { label: 'Owners’ changes held', what: 'The language check held a save. Put it live or decline it.', to: '/admin/held-changes' },
  reviews: { label: 'Reviews to approve', what: 'Every review waits for a yes or no before it shows.', to: '/admin/reviews' },
  reported_reviews: { label: 'Reported reviews', what: 'Keep the review or remove it.', to: '/admin/reviews' },
  held_replies: { label: 'Businesses’ replies held', what: 'The language check held a reply to a review. Put it live or remove it.', to: '/admin/reviews' },
  reports: { label: 'Reported conversations and messages', what: 'Read the report, then hide, block, or close it.', to: '/admin/reports' },
  claims: { label: 'Claims', what: 'Check the person runs the business, then approve or decline.', to: '/admin/claims' },
  deletions: { label: 'Deleted accounts to finish', what: 'Remove each sign-in record in Supabase within 30 days.', to: '/admin/account-deletions' },
  flags: { label: 'Booking flags', what: 'A business says a booking isn’t right.', to: '/admin/booking-flags' },
  check_ins: { label: 'Bookings to check in on', what: 'A business people booked was taken down. Let them know.', to: '/admin/bookings' },
  suggestions: { label: 'Suggested businesses', what: 'Add it, mark it a duplicate, or decline it.', to: '/admin/suggestions' },
  removals: { label: 'Removal requests', what: 'An owner asked to take their business off. Check who it affects, then be in touch.', to: '/admin/removals' },
  community: { label: 'Community posts', what: 'The language check held one, or someone reported one. Show it or take it down.', to: '/admin/community' },
  inquiries: { label: 'Inquiries', what: 'People asking about businesses that haven’t joined. Invite the business.', to: '/admin/inquiries' },
};

const day = new Intl.DateTimeFormat('en-CA', { month: 'long', day: 'numeric', timeZone: 'America/Toronto' });
const daysAgo = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));

export default function WaitingForYou({ loaderData }: Route.ComponentProps) {
  const waiting = loaderData.work
    .filter((w) => w.count > 0)
    .sort((a, b) => (a.oldest ?? '9').localeCompare(b.oldest ?? '9'));
  const clear = loaderData.work.filter((w) => w.count === 0);
  return (
    <>
      <h1 className="title-1">Waiting for you</h1>
      <div className="title-rule" aria-hidden="true" />
      <p className="muted">Everything the team has to deal with, oldest first. Each links to its own page.</p>

      <section className={styles.section} aria-labelledby="waiting-heading">
        <h2 id="waiting-heading">{waiting.length === 0 ? 'Nothing is waiting' : `Waiting (${waiting.reduce((n, w) => n + w.count, 0)})`}</h2>
        {waiting.length > 0 && (
          <ul className={styles.rows}>
            {waiting.map((w) => {
              const k = KINDS[w.kind];
              const since = w.oldest
                ? `oldest since ${day.format(new Date(w.oldest))} (${daysAgo(w.oldest) === 1 ? '1 day' : `${daysAgo(w.oldest)} days`})`
                : '';
              const due =
                w.kind === 'deletions' && w.oldest ? `, due by ${day.format(new Date(new Date(w.oldest).getTime() + 30 * 86400000))}` : '';
              return (
                <li key={w.kind} className={styles.row}>
                  <span className={styles.rowName}>
                    <Link to={k.to} className="text-link">{`${k.label}: ${w.count}`}</Link>
                  </span>
                  <span className="muted">{[k.what, `${since}${due}`].filter(Boolean).join(' ')}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {clear.length > 0 && (
        <section className={styles.section} aria-labelledby="clear-heading">
          <h2 id="clear-heading">Nothing waiting</h2>
          <p className="muted">{clear.map((w) => KINDS[w.kind].label).join(' · ')}</p>
        </section>
      )}
    </>
  );
}
