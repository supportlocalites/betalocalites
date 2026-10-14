import { data, Link } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { SLUG } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { businessInbox } from '@/server/messages.server';
import { found } from '@/server/plan-pages.server';
import type { Route } from './+types/business-messages';
import styles from './messages.module.css';

/**
 * Screen V6: a business's messages (Stage 2B). Anyone on its team (owner, manager or staff),
 * checked in the database on every request; anyone else gets "not found". Each team
 * member's unread count is their own.
 */
export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta(loaderData ? `Messages · ${loaderData.business.name}` : 'Messages'),
  { name: 'robots', content: 'noindex' },
];

export async function loader({ params, context }: Route.LoaderArgs) {
  if (!SLUG.test(params.slug)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  return found(businessInbox(context.get(cloudflareContext).env, member.userId, params.slug));
}

const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeZone: 'America/Toronto' });

export default function BusinessMessages({ loaderData: { business, conversations } }: Route.ComponentProps) {
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <p>
          <Link to="/business" className="text-link">
            ← My business
          </Link>
        </p>
        <p className="label">{business.name}</p>
        <h1 className="title-1">Messages</h1>
        <div className="title-rule" aria-hidden="true" />
        {!business.listed && (
          <p className="notice" role="status">
            Your business isn’t listed on Localites at the moment, so messages are paused: you can read them, but neither side can send any
            until it’s listed again.
          </p>
        )}
        {conversations.length === 0 ? (
          <p>No messages yet. People who find you on Localites can message you from your page; you’ll be emailed when they do.</p>
        ) : (
          <ul className={styles.inbox}>
            {conversations.map((c) => (
              <li key={c.id}>
                <Link to={`/vendors/${business.slug}/messages/${c.id}`} className={styles.card}>
                  <span className={styles.cardBody}>
                    <span className={styles.name}>{c.person}</span>
                    {c.snippet && (
                      <span className={styles.snippet}>
                        {c.lastFromUs ? 'Your team: ' : ''}
                        {c.snippet}
                      </span>
                    )}
                    {(c.blocked || c.ended) && <span className={styles.snippet}>{c.ended ? 'Left Localites' : 'Blocked'}</span>}
                  </span>
                  <span className={styles.cardBody}>
                    {c.lastMessageAt && <span className={styles.when}>{when.format(new Date(c.lastMessageAt))}</span>}
                    {c.unread > 0 && (
                      <span className={styles.unread} aria-label={`${c.unread} new`}>
                        {c.unread}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
