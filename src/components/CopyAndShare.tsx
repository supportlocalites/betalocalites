import { useState, useSyncExternalStore } from 'react';
import styles from '@/app/routes/member/plan.module.css';

const noChanges = () => () => undefined;

/** Copy, or the phone's own share sheet where there is one (needs the page's script). */
export function CopyAndShare({ link, text }: { link: string; text: string }) {
  const [copied, setCopied] = useState(false);
  // The server has no share sheet: shown only once the page runs in the browser.
  const canShare = useSyncExternalStore(
    noChanges,
    () => typeof navigator.share === 'function',
    () => false,
  );
  return (
    <p className={styles.actions}>
      {canShare && (
        <button type="button" className="button button-primary" onClick={() => void navigator.share({ text }).catch(() => undefined)}>
          Share…
        </button>
      )}
      <button
        type="button"
        className="button button-secondary"
        onClick={() =>
          void navigator.clipboard?.writeText(link).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </p>
  );
}
