import { useEffect, useRef, useState } from 'react';
import { Form, Link, useNavigation, useRevalidator, useSearchParams, useSubmit } from 'react-router';
import { MESSAGE_LIMITS, REFRESH } from '@/lib/message-terms';
import { prepareOnePhoto } from '@/lib/photo-prepare';
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
  file: { id: string; name: string; isPhoto: boolean; size: number; width: number | null; height: number | null } | null;
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

/** A file's size in plain words. */
const sizeWords = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/**
 * reportPath: this conversation's Report page; each message from the other side links to it.
 * filePath: where this conversation's files are opened (the site checks who's asking).
 */
export function MessageList({
  messages,
  canRemove,
  reportPath,
  filePath,
}: {
  messages: ShownMessage[];
  canRemove: boolean;
  reportPath: string;
  filePath: string;
}) {
  if (messages.length === 0) return <p className="muted">No messages yet.</p>;
  return (
    <ol className={styles.thread} aria-label="Messages">
      {messages.map((m) => {
        const gone = m.removed || m.hidden;
        return (
          <li key={m.id} className={`${styles.message} ${m.mine ? styles.mine : ''} ${gone ? styles.removed : ''}`}>
            <span className={styles.byline}>
              {m.mine ? 'You' : m.author} · {when.format(new Date(m.createdAt))}
            </span>
            {gone ? (
              <p className={styles.body}>{m.hidden ? 'Hidden by Localites' : 'Message removed'}</p>
            ) : (
              (m.body || !m.file) && <p className={styles.body}>{m.body || 'File removed'}</p>
            )}
            {!gone && m.file?.isPhoto && (
              <a href={`${filePath}/${m.file.id}`} className={styles.filePhoto} target="_blank" rel="noopener">
                <img
                  src={`${filePath}/${m.file.id}`}
                  alt={`Photo sent by ${m.mine ? 'you' : m.author}: ${m.file.name}`}
                  width={m.file.width ?? undefined}
                  height={m.file.height ?? undefined}
                  loading="lazy"
                />
              </a>
            )}
            {!gone && m.file && !m.file.isPhoto && (
              <a href={`${filePath}/${m.file.id}`} className={`text-link ${styles.fileLink}`} download={m.file.name}>
                PDF: {m.file.name} ({sizeWords(m.file.size)})
              </a>
            )}
            {!m.mine && !gone && (
              <Link to={`${reportPath}?message=${m.id}`} className={`${styles.messageActions} ${styles.textButton}`}>
                Report
              </Link>
            )}
            {canRemove && m.mine && !gone && (
              <Form method="post" className={styles.messageActions}>
                <input type="hidden" name="intent" value="remove" />
                <input type="hidden" name="messageId" value={m.id} />
                <button type="submit" className={styles.textButton}>
                  Remove
                </button>
              </Form>
            )}
          </li>
        );
      })}
    </ol>
  );
}

const isPdf = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

/**
 * The reply box. It starts empty again after each message sent (the address carries ?sent=).
 * canAttach: sending files is switched on. With the page's script, a photo is made smaller
 * (and its hidden details left behind) before it's sent; a PDF goes as chosen. Without the
 * script, the server takes a photo only if it's already small enough.
 */
export function ReplyBox({ label, busy, error, canAttach }: { label: string; busy: boolean; error?: string | null; canAttach: boolean }) {
  const [params] = useSearchParams();
  const submit = useSubmit();
  const [problem, setProblem] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  async function send(event: React.FormEvent<HTMLFormElement>) {
    setProblem(null);
    const input = event.currentTarget.elements.namedItem('file');
    const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
    if (!file || isPdf(file)) return; // sent as chosen
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPreparing(true);
    const photo = await prepareOnePhoto(file);
    setPreparing(false);
    if (!photo) {
      setProblem('This browser couldn’t open that file as a photo. Please choose a photo or a PDF.');
      return;
    }
    setProblem(null);
    form.set('file', photo);
    await submit(form, { method: 'post', encType: 'multipart/form-data' });
  }

  const shown = problem ?? error;
  return (
    <Form method="post" encType="multipart/form-data" onSubmit={send} className={styles.reply} key={params.get('sent') ?? 'new'}>
      <input type="hidden" name="intent" value="send" />
      <label htmlFor="body" className="field-label">
        {label}
      </label>
      {shown && (
        <p className="field-error" role="alert">
          {shown}
        </p>
      )}
      <textarea id="body" name="body" className="input" maxLength={MESSAGE_LIMITS.body} />
      {canAttach && (
        <div className="field">
          <label htmlFor="file" className="field-label">
            Add a photo or PDF (optional)
          </label>
          <p className="field-hint" id="file-hint">
            One per message. Photos are made smaller and lose hidden details such as where they were taken. A PDF (a quote, an invoice, a
            menu) goes as it is, up to 4 MB. Only the two of you can open it.
          </p>
          <input id="file" name="file" type="file" accept="image/*,application/pdf,.pdf" aria-describedby="file-hint" />
        </div>
      )}
      <p>
        <button type="submit" className="button button-primary" disabled={busy || preparing}>
          {preparing ? 'Getting the photo ready…' : busy ? 'Sending…' : 'Send'}
        </button>
      </p>
    </Form>
  );
}
