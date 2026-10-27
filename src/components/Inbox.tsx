import { Link } from 'react-router';
import type { ConversationCard } from '@/server/messages.server';
import { shortDate } from '@/lib/plan-terms';
import { SquarePhoto } from './SquarePhoto';
import styles from './Inbox.module.css';

/**
 * How the list is shown: Groups (the person's Message all groups, then the rest), Unread or
 * All (the owner, 25 October 2026, D-62). By event (D-58) stays for now while events are
 * paused (D-59, G19), only by its address; "recent" was All's old name.
 */
export const INBOX_VIEWS = ['groups', 'unread', 'all', 'event'] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];
export type InboxOrder = 'new' | 'old';

export const inboxView = (value: string | null): InboxView =>
  value === 'recent' ? 'all' : (INBOX_VIEWS as readonly string[]).includes(value ?? '') ? (value as InboxView) : 'groups';
export const inboxOrder = (value: string | null): InboxOrder => (value === 'old' ? 'old' : 'new');

/** The view and order as an address's ending, so a link keeps them (empty for the usual ones). */
export function inboxQuery(view: InboxView, order: InboxOrder): string {
  const q = new URLSearchParams();
  if (view !== 'groups') q.set('view', view);
  if (order === 'old') q.set('order', 'old');
  const s = q.toString();
  return s ? `?${s}` : '';
}

const time = new Intl.DateTimeFormat('en-CA', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/Toronto',
});
const day = new Intl.DateTimeFormat('en-CA', {
  month: 'short',
  day: 'numeric',
  timeZone: 'America/Toronto',
});
const dayOf = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });

/** Today's messages show the time; older ones the day. */
/** When the last message was: the time today, else the day. */
export function when(at: string | null, today: string) {
  if (!at) return '';
  const d = new Date(at);
  return dayOf(d) === today ? time.format(d) : day.format(d);
}

function status(c: ConversationCard) {
  if (c.rejoined) return 'Ended (they’ve joined again)';
  if (c.left) return 'No longer on Localites';
  if (c.paused) return 'Paused';
  if (c.blocked) return 'Blocked';
  return null;
}

type Group = { id: string; name: string; items: ConversationCard[]; latest: string };

/**
 * The person's conversations (C7) in Style A (D-62): Groups (each Message all's businesses
 * together in a box, its name opening the group's page; then those in no group),
 * Unread, or All, newest or oldest first. Links keep the chosen view.
 */
export function Inbox({
  conversations,
  view,
  order = 'new',
  currentId,
  currentGroup,
  today,
}: {
  conversations: ConversationCard[];
  view: InboxView;
  order?: InboxOrder;
  currentId?: string;
  currentGroup?: string;
  today: string;
}) {
  const unread = conversations.filter((c) => c.unread > 0).length;
  const query = inboxQuery(view, order);
  const at = (c: ConversationCard) => c.lastMessageAt ?? '';
  const sorted = [...conversations].sort((a, b) => (order === 'old' ? at(a).localeCompare(at(b)) : at(b).localeCompare(at(a))));
  const shown = view === 'unread' ? sorted.filter((c) => c.unread > 0) : sorted;

  const card = (c: ConversationCard, showGroups: boolean) => {
    const note = status(c);
    const current = c.id === currentId;
    return (
      <li key={c.id}>
        <Link
          to={`/messages/${c.id}${query}`}
          className={`${styles.card} ${current ? styles.current : ''}`}
          aria-current={current ? 'page' : undefined}
        >
          <SquarePhoto photo={c.photo} alt="" className={styles.photo} />
          <span className={styles.words}>
            <span className={styles.top}>
              <span className={`${styles.name} ${c.unread > 0 ? styles.bold : ''}`}>{c.vendorName}</span>
              <span className={styles.when}>{when(c.lastMessageAt, today)}</span>
            </span>
            <span className={styles.bottom}>
              <span className={`${styles.snippet} ${c.unread > 0 ? styles.bold : ''}`}>
                {note ?? (c.snippet ? `${c.lastFromMe ? 'You: ' : ''}${c.snippet}` : '')}
              </span>
              {c.unread > 0 && (
                <span className={styles.unread}>
                  <span className="visually-hidden">{`${c.unread} new`}</span>
                </span>
              )}
            </span>
            {(c.kind || (showGroups && c.groups.length > 0)) && (
              <span className={styles.meta}>
                {c.kind}
                {showGroups &&
                  c.groups.map((g) => (
                    <span key={g.id} className={styles.tag}>
                      {g.name}
                    </span>
                  ))}
              </span>
            )}
          </span>
        </Link>
      </li>
    );
  };

  // Groups: each of the person's groups, the latest (or earliest) activity first.
  const groups: Group[] = [];
  for (const c of shown) {
    for (const g of c.groups) {
      let found = groups.find((x) => x.id === g.id);
      if (!found) {
        found = { id: g.id, name: g.name, items: [], latest: '' };
        groups.push(found);
      }
      found.items.push(c);
      if (at(c) > found.latest) found.latest = at(c);
    }
  }
  groups.sort((a, b) => (order === 'old' ? a.latest.localeCompare(b.latest) : b.latest.localeCompare(a.latest)));
  const loose = shown.filter((c) => c.groups.length === 0);

  // By event (D-58), kept while events are paused: the soonest event first, then the rest.
  const events: { key: string; title: string; when: string; items: ConversationCard[] }[] = [];
  if (view === 'event') {
    for (const c of shown) {
      const key = c.event?.id ?? '';
      let g = events.find((x) => x.key === key);
      if (!g) {
        g = { key, title: c.event?.name ?? 'Not about an event', when: c.event ? shortDate(c.event.date, today) : '', items: [] };
        events.push(g);
      }
      g.items.push(c);
    }
    const dateOf = (key: string) => shown.find((c) => c.event?.id === key)?.event?.date ?? '9999';
    events.sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : dateOf(a.key).localeCompare(dateOf(b.key))));
  }

  const here = currentId ? `/messages/${currentId}` : currentGroup ? `/messages/groups/${currentGroup}` : '/messages';
  const views: [InboxView, string][] = [
    ['groups', 'Groups'],
    ['unread', unread > 0 ? `Unread · ${unread}` : 'Unread'],
    ['all', 'All'],
  ];
  return (
    <div className={styles.inbox}>
      <div className={styles.controls}>
        <nav aria-label="Show" className={styles.views}>
          {views.map(([id, label]) => (
            <Link
              key={id}
              to={`${here}${inboxQuery(id, order)}`}
              className={`${styles.view} ${view === id ? styles.on : ''}`}
              aria-current={view === id ? 'true' : undefined}
              preventScrollReset
            >
              {label}
            </Link>
          ))}
        </nav>
        <Link to={`${here}${inboxQuery(view, order === 'new' ? 'old' : 'new')}`} className={styles.order} preventScrollReset>
          {order === 'new' ? 'Newest first' : 'Oldest first'}
          <span className="visually-hidden"> (change)</span>
        </Link>
      </div>
      {shown.length === 0 ? (
        <p className={`muted ${styles.empty}`}>
          {conversations.length === 0
            ? 'No messages yet. You can message a business from its page once it has joined Localites.'
            : 'You’re all caught up.'}
        </p>
      ) : view === 'groups' ? (
        <>
          {groups.length > 0 && <h2 className={styles.heading}>Your groups</h2>}
          {groups.map((g) => {
            const news = g.items.filter((c) => c.unread > 0).length;
            return (
              <section key={g.id} aria-label={g.name} className={`${styles.groupBox} ${g.id === currentGroup ? styles.groupOn : ''}`}>
                <div className={styles.groupHead}>
                  <Link to={`/messages/groups/${g.id}${query}`} className={styles.groupName}>
                    {g.name}
                  </Link>
                  <span className={styles.groupCount}>
                    {`${g.items.length} ${g.items.length === 1 ? 'business' : 'businesses'}${news ? ` · ${news} new` : ''}`}
                  </span>
                </div>
                <ul className={styles.list}>{g.items.map((c) => card(c, false))}</ul>
              </section>
            );
          })}
          {loose.length > 0 && (
            <>
              <h2 className={styles.heading}>{groups.length > 0 ? 'Not in a group' : 'Your conversations'}</h2>
              <ul className={styles.list}>{loose.map((c) => card(c, false))}</ul>
            </>
          )}
          {groups.length === 0 && (
            <p className={`muted ${styles.hint}`}>Message several businesses at once from My picks, and they’re kept together here as a group.</p>
          )}
        </>
      ) : view === 'event' ? (
        events.map((g) => (
          <section key={g.key || 'none'} aria-label={g.title}>
            <h2 className={styles.heading}>
              {g.title}
              {g.when && ` · ${g.when}`}
            </h2>
            <ul className={styles.list}>{g.items.map((c) => card(c, false))}</ul>
          </section>
        ))
      ) : (
        <ul className={styles.list}>{shown.map((c) => card(c, true))}</ul>
      )}
    </div>
  );
}
