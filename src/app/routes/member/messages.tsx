import { useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { Inbox, inboxOrder, inboxView } from '@/components/Inbox';
import { TopBar } from '@/components/TopBar';
import { pageMeta } from '@/lib/meta';
import { myConversations } from '@/server/messages.server';
import { todayIso } from '@/server/plan-pages.server';
import type { Route } from './+types/messages';
import styles from './messages.module.css';

/**
 * Screen C7: the person's conversations with businesses (Stage 2B), in Style A (D-62): Groups,
 * Unread or All, newest or oldest first. Only their own. On computers the open conversation (or
 * group) sits beside the list.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Messages'), { name: 'robots', content: 'noindex' }];

export async function loader({ context }: Route.LoaderArgs) {
  const member = context.get(memberContext);
  return {
    conversations: await myConversations(context.get(cloudflareContext).env, member.userId),
    today: todayIso(),
  };
}

export default function Messages({ loaderData: { conversations, today } }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const deleted = params.has('deleted');
  return (
    <>
      <TopBar unread={conversations.filter((c) => c.unread > 0).length} />
      <main className={`page ${styles.split}`}>
        <section aria-labelledby="messages" className={styles.listPane}>
          <h1 id="messages" className={styles.paneTitle}>
            Messages
          </h1>
          {deleted && (
            <p className="notice" role="status">
              The conversation is deleted.
            </p>
          )}
          <Inbox conversations={conversations} view={inboxView(params.get('view'))} order={inboxOrder(params.get('order'))} today={today} />
        </section>
        <div className={`${styles.readPane} ${styles.choose}`}>
          <p className="muted">{conversations.length > 0 ? 'Choose a group or a conversation to read it here.' : ''}</p>
        </div>
      </main>
    </>
  );
}
