import { Link } from "react-router";
import type { ConversationCard } from "@/server/messages.server";
import { shortDate } from "@/lib/plan-terms";
import { SquarePhoto } from "./SquarePhoto";
import styles from "./Inbox.module.css";

/** How the list is shown (D-58): grouped by event, newest first, or only the unread ones. */
export const INBOX_VIEWS = ["event", "recent", "unread"] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

export const inboxView = (value: string | null): InboxView =>
  (INBOX_VIEWS as readonly string[]).includes(value ?? "")
    ? (value as InboxView)
    : "event";

const time = new Intl.DateTimeFormat("en-CA", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Toronto",
});
const day = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
  timeZone: "America/Toronto",
});
const dayOf = (d: Date) =>
  d.toLocaleDateString("en-CA", { timeZone: "America/Toronto" });

/** Today's messages show the time; older ones the day. */
function when(at: string | null, today: string) {
  if (!at) return "";
  const d = new Date(at);
  return dayOf(d) === today ? time.format(d) : day.format(d);
}

function status(c: ConversationCard) {
  if (c.rejoined) return "Ended (they’ve joined again)";
  if (c.left) return "No longer on Localites";
  if (c.paused) return "Paused";
  if (c.blocked) return "Blocked";
  return null;
}

/**
 * The person's conversations (C7), as in the approved design (D-58): By event, Most recent or
 * Unread. Links keep the chosen view, so the list stays the same beside an open conversation.
 */
export function Inbox({
  conversations,
  view,
  currentId,
  today,
}: {
  conversations: ConversationCard[];
  view: InboxView;
  currentId?: string;
  today: string;
}) {
  const unread = conversations.filter((c) => c.unread > 0).length;
  const shown =
    view === "unread"
      ? conversations.filter((c) => c.unread > 0)
      : conversations;
  const suffix = view === "event" ? "" : `?view=${view}`;

  const card = (c: ConversationCard, showEvent: boolean) => {
    const note = status(c);
    const current = c.id === currentId;
    return (
      <li key={c.id}>
        <Link
          to={`/messages/${c.id}${suffix}`}
          className={`${styles.card} ${current ? styles.current : ""}`}
          aria-current={current ? "page" : undefined}
        >
          <SquarePhoto photo={c.photo} alt="" className={styles.photo} />
          <span className={styles.words}>
            <span className={styles.top}>
              <span className={styles.name}>{c.vendorName}</span>
              <span className={styles.when}>
                {when(c.lastMessageAt, today)}
              </span>
            </span>
            {showEvent && c.event && (
              <span className={styles.event}>{c.event.name}</span>
            )}
            <span className={styles.bottom}>
              <span
                className={`${styles.snippet} ${c.unread > 0 ? styles.bold : ""}`}
              >
                {note ??
                  (c.snippet
                    ? `${c.lastFromMe ? "You: " : ""}${c.snippet}`
                    : "")}
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
  };

  // By event: the soonest event first, then whatever isn't about an event.
  const groups: {
    key: string;
    title: string;
    when: string;
    items: ConversationCard[];
  }[] = [];
  if (view === "event") {
    for (const c of shown) {
      const key = c.event?.id ?? "";
      let g = groups.find((x) => x.key === key);
      if (!g) {
        g = {
          key,
          title: c.event?.name ?? "Not about an event",
          when: c.event ? shortDate(c.event.date, today) : "",
          items: [],
        };
        groups.push(g);
      }
      g.items.push(c);
    }
    const dateOf = (key: string) =>
      shown.find((c) => c.event?.id === key)?.event?.date ?? "9999";
    groups.sort((a, b) =>
      a.key === ""
        ? 1
        : b.key === ""
          ? -1
          : dateOf(a.key).localeCompare(dateOf(b.key)),
    );
  }

  const views: [InboxView, string][] = [
    ["event", "By event"],
    ["recent", "Most recent"],
    ["unread", unread > 0 ? `Unread · ${unread}` : "Unread"],
  ];
  return (
    <div className={styles.inbox}>
      <nav aria-label="Show" className={styles.views}>
        {views.map(([id, label]) => (
          <Link
            key={id}
            to={`${currentId ? `/messages/${currentId}` : "/messages"}${id === "event" ? "" : `?view=${id}`}`}
            className={`${styles.view} ${view === id ? styles.on : ""}`}
            aria-current={view === id ? "true" : undefined}
            preventScrollReset
          >
            {label}
          </Link>
        ))}
      </nav>
      {shown.length === 0 ? (
        <p className={`muted ${styles.empty}`}>
          {conversations.length === 0
            ? "No messages yet. You can message a business from its page once it has joined Localites."
            : "Nothing unread."}
        </p>
      ) : view === "event" ? (
        groups.map((g) => (
          <section key={g.key || "none"} aria-label={g.title}>
            <h2 className={styles.group}>
              <span className={styles.groupTitle}>{g.title}</span>
              {g.when && <span className={styles.groupWhen}>{g.when}</span>}
              <span aria-hidden="true" className={styles.groupRule} />
              <span className={styles.groupWhen}>{g.items.length}</span>
            </h2>
            <ul className={styles.list}>
              {g.items.map((c) => card(c, false))}
            </ul>
          </section>
        ))
      ) : (
        <ul className={styles.list}>{shown.map((c) => card(c, true))}</ul>
      )}
    </div>
  );
}
