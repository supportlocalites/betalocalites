import { useEffect, useRef, useState } from 'react';

/**
 * Cloudflare's "are you human" check (Turnstile, ADR-028). Usually it passes by itself in a
 * second; now and then it asks for a tick. One check per screen: its answer goes in a hidden
 * field of every form on the screen (HumanCheckField), and a fresh check starts after each
 * sending, since an answer works only once.
 */

type Turnstile = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<Turnstile> | null = null;

function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('not loaded')));
    s.onerror = () => reject(new Error('not loaded'));
    document.head.appendChild(s);
  }).catch((err: unknown) => {
    loading = null; // let a later screen try again
    throw err;
  });
  return loading;
}

/**
 * The check's answer (empty until it passes) and the box to show it in. `fresh` changes
 * after each sending (the form's reply), which starts a new check.
 */
export function useHumanCheck(siteKey: string | null, action: string, fresh: unknown) {
  const box = useRef<HTMLDivElement>(null);
  // What the check said, kept with the round it belongs to: a new round starts empty.
  const [said, setSaid] = useState<{ round: unknown; answer: string; trouble: boolean }>({ round: fresh, answer: '', trouble: false });
  const current = said.round === fresh ? said : { answer: '', trouble: false };
  useEffect(() => {
    if (!siteKey) return;
    let gone = false;
    let id: string | undefined;
    const say = (answer: string, trouble: boolean) => !gone && setSaid({ round: fresh, answer, trouble });
    loadTurnstile().then(
      (t) => {
        if (gone || !box.current) return;
        id = t.render(box.current, {
          sitekey: siteKey,
          action,
          theme: 'auto',
          size: 'flexible',
          'response-field': false,
          callback: (a: string) => say(a, false),
          'expired-callback': () => say('', false),
          'error-callback': () => say('', true),
        });
      },
      () => say('', true),
    );
    return () => {
      gone = true;
      if (id !== undefined) window.turnstile?.remove(id);
    };
  }, [siteKey, action, fresh]);

  const widget = siteKey ? (
    <div className="field">
      <div ref={box} />
      {current.trouble && (
        <p className="notice" role="alert">
          The “are you human” check didn’t load. Please reload the page; if it still doesn’t appear, try another browser or switch off any
          blocker for this site.
        </p>
      )}
      <noscript>
        <p className="notice">This form needs JavaScript switched on for its “are you human” check.</p>
      </noscript>
    </div>
  ) : null;
  return { answer: current.answer, widget };
}

/** The check's answer, sent with a form. */
export function HumanCheckField({ answer, on }: { answer: string; on: boolean }) {
  return on ? <input type="hidden" name="cf-turnstile-response" value={answer} /> : null;
}
