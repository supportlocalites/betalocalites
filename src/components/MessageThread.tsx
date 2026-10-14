import { useEffect, useRef } from 'react';
import { Form, Link, useNavigation, useRevalidator, useSearchParams } from 'react-router';
import { MESSAGE_LIMITS, REFRESH } from '@/lib/message-terms';
import styles from '@/app/routes/member/messages.module.css';

/**
 * A conversation's messages and its reply box (Stage 2B), shared by the person's page and
 * the business's. While it's open and you're there, the page looks for anything new (D-13),
 * as REFRESH says; no typing indicators or read receipts (E §4.3).
 */

export type ShownMessage = {
  id: string;
  mine: boolean;
  author: string;
  body: string;
  createdAt: string;
  removed: boolean;
  hidden: boolean;
};

const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' });

/**
 * Looks at checkPath (the conversation's quick look) for a version other than the page's,
 * and reloads the page only then. Quiet looks wait twice as long each time, up to
 * REFRESH.slowestSeconds; anything new, or anything you do, brings it back to
 * REFRESH.fastestSeconds. No looks while the tab is hidden or after REFRESH.idleMinutes
 * without you touching the page; coming back looks at once. (Reloading forgets the last
 * form's answer, such as a refusal; it happens only when something new has arrived.)
 */
export function useRefresh(checkPath: string, version: string) {
  const { revalidate } = useRevalidator();
  const busy = useNavigation().state !== 'idle';
  const page = useRef({ version, busy });
  useEffect(() => {
    page.current = { version, busy };
  });
  useEffect(() => {
    const fastest = REFRESH.fastestSeconds * 1000;
    let wait = fastest;
    let lastTouched = Date.now();
    let timer: number | undefined;
    let looking = false;
    let stopped = false;
    const here = () => document.visibilityState === 'visible' && Date.now() - lastTouched < REFRESH.idleMinutes * 60_000;
    const next = () => {
      window.clearTimeout(timer);
      timer = !stopped && here() ? window.setTimeout(look, wait) : undefined;
    };
    async function look() {
      if (stopped || !here()) {
        timer = undefined; // asleep until you come back
        return;
      }
      if (looking || page.current.busy) return next();
      looking = true;
      let changed = false;
      try {
        const res = await fetch(checkPath, { headers: { Accept: 'application/json' } });
        // Gone ("not found": you've left the team, say): reload, so the page says so.
        if (res.status === 404) changed = true;
        else if (res.ok) changed = ((await res.json()) as { version?: string }).version !== page.current.version;
      } catch {
        // Offline, or signed out: look again later.
      }
      looking = false;
      if (changed) {
        wait = fastest;
        if (!stopped) void revalidate();
      } else {
        wait = Math.min(wait * 2, REFRESH.slowestSeconds * 1000);
      }
      next();
    }
    const touched = () => {
      const asleep = timer === undefined;
      lastTouched = Date.now();
      if (asleep && document.visibilityState === 'visible') {
        wait = fastest;
        void look();
      } else if (wait > fastest) {
        wait = fastest;
        next();
      }
    };
    const events = ['pointerdown', 'keydown', 'focus', 'visibilitychange'] as const;
    for (const e of events) (e === 'visibilitychange' ? document : window).addEventListener(e, touched, { passive: true });
    next();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      for (const e of events) (e === 'visibilitychange' ? document : window).removeEventListener(e, touched);
    };
  }, [checkPath, revalidate]);
}

/** reportPath: this conversation's Report page; each message from the other side links to it. */
export function MessageList({ messages, canRemove, reportPath }: { messages: ShownMessage[]; canRemove: boolean; reportPath: string }) {
  if (messages.length === 0) return <p className="muted">No messages yet.</p>;
  return (
    <ol className={styles.thread} aria-label="Messages">
      {messages.map((m) => (
        <li key={m.id} className={`${styles.message} ${m.mine ? styles.mine : ''} ${m.removed || m.hidden ? styles.removed : ''}`}>
          <span className={styles.byline}>
            {m.mine ? 'You' : m.author} · {when.format(new Date(m.createdAt))}
          </span>
          <p className={styles.body}>{m.hidden ? 'Hidden by Localites' : m.removed ? 'Message removed' : m.body}</p>
          {!m.mine && !m.removed && !m.hidden && (
            <Link to={`${reportPath}?message=${m.id}`} className={`${styles.messageActions} ${styles.textButton}`}>
              Report
            </Link>
          )}
          {canRemove && m.mine && !m.removed && !m.hidden && (
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
