import { Link, useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { SquarePhoto } from '@/components/SquarePhoto';
import { pageMeta } from '@/lib/meta';
import { myConversations } from '@/server/messages.server';
import type { Route } from './+types/messages';
import styles from './messages.module.css';

/** Screen C7: the person's conversations with businesses, newest first (Stage 2B). Only their own. */
export const meta: Route.MetaFunction = () => [...pageMeta('Messages'), { name: 'robots', content: 'noindex' }];

export async function loader({ context }: Route.LoaderArgs) {
  const member = context.get(memberContext);
  return { conversations: await myConversations(context.get(cloudflareContext).env, member.userId) };
}

const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeZone: 'America/Toronto' });

export default function Messages({ loaderData: { conversations } }: Route.ComponentProps) {
  const deleted = useSearchParams()[0].has('deleted');
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">Messages</h1>
        <div className="title-rule" aria-hidden="true" />
        {deleted && (
          <p className="notice" role="status">
            The conversation is deleted.
          </p>
        )}
        {conversations.length === 0 ? (
          <p>No messages yet. You can message a business from its page once it has joined Localites.</p>
        ) : (
          <ul className={styles.inbox}>
            {conversations.map((c) => (
              <li key={c.id}>
                <Link to={`/messages/${c.id}`} className={`${styles.card} ${styles.withPhoto}`}>
                  <SquarePhoto photo={c.photo} alt="" />
                  <span className={styles.cardBody}>
                    <span className={styles.name}>{c.vendorName}</span>
                    {c.snippet && (
                      <span className={styles.snippet}>
                        {c.lastFromMe ? 'You: ' : ''}
                        {c.snippet}
                      </span>
                    )}
                    {(c.blocked || c.left || c.paused) && (
                      <span className={styles.snippet}>
                        {c.rejoined ? 'Ended (they’ve joined again)' : c.left ? 'No longer on Localites' : c.paused ? 'Paused' : 'Blocked'}
                      </span>
                    )}
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
        <p className="section-gap">
          <Link to="/events" className="text-link">
            My events
          </Link>
        </p>
      </main>
    </>
  );
}
