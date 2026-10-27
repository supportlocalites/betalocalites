import { Link } from 'react-router';
import type { BusinessCard } from '@/server/messages.server';
import { when } from './Inbox';
import styles from './Inbox.module.css';

/**
 * A business's conversations in the same Style A list as a person's (the owner, 27 October 2026:
 * "the messages page still seems very dated … ensure it is aligned with the current design"):
 * Unread or All, newest first, each person by name with their first letter, the last words and
 * when; this team member's own unread count.
 */
export function BusinessInbox({
  slug,
  conversations,
  view,
  currentId = null,
  today,
}: {
  slug: string;
  conversations: BusinessCard[];
  view: 'unread' | 'all';
  currentId?: string | null;
  today: string;
}) {
  const base = `/vendors/${slug}/messages`;
  const here = currentId ? `${base}/${currentId}` : base;
  const query = view === 'unread' ? '?view=unread' : '';
  const unread = conversations.filter((c) => c.unread > 0).length;
  const shown = view === 'unread' ? conversations.filter((c) => c.unread > 0) : conversations;
  return (
    <div className={styles.inbox}>
      <div className={styles.controls}>
        <nav aria-label="Show" className={styles.views}>
          {(
            [
              ['all', 'All'],
              ['unread', unread > 0 ? `Unread · ${unread}` : 'Unread'],
            ] as const
          ).map(([id, label]) => (
            <Link
              key={id}
              to={`${here}${id === 'unread' ? '?view=unread' : ''}`}
              className={`${styles.view} ${view === id ? styles.on : ''}`}
              aria-current={view === id ? 'true' : undefined}
              preventScrollReset
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
      {shown.length === 0 ? (
        <p className={`muted ${styles.empty}`}>
          {conversations.length === 0
            ? 'No messages yet. People who find you on Localites can message you from your page; you’ll be emailed when they do.'
            : 'You’re all caught up.'}
        </p>
      ) : (
        <ul className={styles.list}>
          {shown.map((c) => {
            const current = c.id === currentId;
            const note = c.ended ? 'Left Localites' : c.blocked ? 'Blocked' : null;
            return (
              <li key={c.id}>
                <Link to={`${base}/${c.id}${query}`} className={`${styles.card} ${current ? styles.current : ''}`} aria-current={current ? 'page' : undefined}>
                  <span className={`${styles.photo} ${styles.initial}`} aria-hidden="true">
                    {c.person.trim().charAt(0).toUpperCase()}
                  </span>
                  <span className={styles.words}>
                    <span className={styles.top}>
                      <span className={`${styles.name} ${c.unread > 0 ? styles.bold : ''}`}>{c.person}</span>
                      <span className={styles.when}>{when(c.lastMessageAt, today)}</span>
                    </span>
                    <span className={styles.bottom}>
                      <span className={`${styles.snippet} ${c.unread > 0 ? styles.bold : ''}`}>
                        {note ?? (c.snippet ? `${c.lastFromUs ? 'Your team: ' : ''}${c.snippet}` : '')}
                      </span>
                      {c.unread > 0 && (
                        <span className={styles.unread}>
                          <span className="visually-hidden">{`${c.unread} new`}</span>
                        </span>
                      )}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
