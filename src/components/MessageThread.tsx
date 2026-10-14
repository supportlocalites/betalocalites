import { useEffect } from 'react';
import { Form, useRevalidator, useSearchParams } from 'react-router';
import { MESSAGE_LIMITS, REFRESH_SECONDS } from '@/lib/message-terms';
import styles from '@/app/routes/member/messages.module.css';

/**
 * A conversation's messages and its reply box (Stage 2B), shared by the person's page and
 * the business's. The page looks for new messages about every 15 seconds while it's open
 * and visible (D-13); no typing indicators or read receipts (E §4.3).
 */

export type ShownMessage = { id: string; mine: boolean; author: string; body: string; createdAt: string; removed: boolean };

const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' });

/** Reloads the page's data every REFRESH_SECONDS while the tab is visible and nothing is being sent. */
export function useRefresh() {
  const { revalidate, state } = useRevalidator();
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible' && state === 'idle') void revalidate();
    }, REFRESH_SECONDS * 1000);
    return () => window.clearInterval(id);
  }, [revalidate, state]);
}

export function MessageList({ messages, canRemove }: { messages: ShownMessage[]; canRemove: boolean }) {
  if (messages.length === 0) return <p className="muted">No messages yet.</p>;
  return (
    <ol className={styles.thread} aria-label="Messages">
      {messages.map((m) => (
        <li key={m.id} className={`${styles.message} ${m.mine ? styles.mine : ''} ${m.removed ? styles.removed : ''}`}>
          <span className={styles.byline}>
            {m.mine ? 'You' : m.author} · {when.format(new Date(m.createdAt))}
          </span>
          {m.removed ? <p className={styles.body}>Message removed</p> : <p className={styles.body}>{m.body}</p>}
          {canRemove && m.mine && !m.removed && (
            <Form method="post" className={styles.messageActions}>
              <input type="hidden" name="intent" value="remove" />
              <input type="hidden" name="messageId" value={m.id} />
              <button type="submit" className={styles.textButton}>
                Remove
              </button>
            </Form>
          )}
        </li>
      ))}
    </ol>
  );
}

/** The reply box. It starts empty again after each message sent (the address carries ?sent=). */
export function ReplyBox({ label, busy, error }: { label: string; busy: boolean; error?: string | null }) {
  const [params] = useSearchParams();
  return (
    <Form method="post" className={styles.reply} key={params.get('sent') ?? 'new'}>
      <input type="hidden" name="intent" value="send" />
      <label htmlFor="body" className="field-label">
        {label}
      </label>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <textarea id="body" name="body" className="input" maxLength={MESSAGE_LIMITS.body} required />
      <p>
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? 'Sending…' : 'Send'}
        </button>
      </p>
    </Form>
  );
}
