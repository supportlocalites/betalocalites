import { type RefObject, useEffect } from 'react';

/**
 * Tells Localites what a real browser showed (ADR-030): which cards in a list were at
 * least half on screen for a second, and on a business's page, that it was opened, how
 * long it was looked at, whether the services were seen, and taps on Visit website or
 * Call. Each report carries the note the page's server signed. No outside trackers.
 */

const SEEN_MS = 1000;
const FIRST_REPORT_MS = 1500;
const MAX_SECONDS = 1800;

function report(body: Record<string, unknown>) {
  try {
    void fetch('/api/activity', {
      method: 'POST',
      keepalive: true,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => undefined);
  } catch {
    // Counting never gets in a visitor's way.
  }
}

/**
 * The note for this visit to the page (one per history entry): going Back to a page reuses
 * the note it had, so the same visit isn't recorded twice (the server keeps one per note).
 */
function noteFor(historyKey: string, token: string): string {
  try {
    const kept = sessionStorage.getItem(`lc-note:${historyKey}`);
    if (kept && noteStillGood(kept)) return kept;
    sessionStorage.setItem(`lc-note:${historyKey}`, token);
  } catch {
    // Storage off: each visit gets its own note.
  }
  return token;
}

function noteStillGood(token: string): boolean {
  try {
    const body = JSON.parse(atob(token.split('.')[0]!.replace(/-/g, '+').replace(/_/g, '/'))) as { x?: number };
    return typeof body.x === 'number' && body.x > Date.now() / 1000 + 60;
  } catch {
    return false;
  }
}

/** Calls `onSeen` once an element has been at least half on screen for a second. */
function watchSeen(elements: Element[], onSeen: (el: Element) => void): () => void {
  if (typeof IntersectionObserver === 'undefined') return () => undefined;
  const timers = new Map<Element, number>();
  const done = new Set<Element>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (done.has(e.target)) continue;
        if (e.isIntersecting && e.intersectionRatio >= 0.5) {
          if (!timers.has(e.target)) {
            timers.set(
              e.target,
              window.setTimeout(() => {
                timers.delete(e.target);
                if (document.visibilityState !== 'visible') return;
                done.add(e.target);
                observer.unobserve(e.target);
                onSeen(e.target);
              }, SEEN_MS),
            );
          }
        } else {
          window.clearTimeout(timers.get(e.target));
          timers.delete(e.target);
        }
      }
    },
    { threshold: 0.5 },
  );
  for (const el of elements) observer.observe(el);
  // Back on the page after switching away: look again at what's on screen (the observer
  // reports only changes, and a card left on screen wouldn't be noticed otherwise).
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    for (const el of elements) {
      if (done.has(el)) continue;
      observer.unobserve(el);
      observer.observe(el);
    }
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    observer.disconnect();
    document.removeEventListener('visibilitychange', onVisible);
    for (const t of timers.values()) window.clearTimeout(t);
  };
}

/** A list of results (search or category): places marked with data-pos="1", "2", … */
export function useListActivity(pageToken: string | null, list: RefObject<HTMLElement | null>, historyKey: string) {
  useEffect(() => {
    if (!pageToken) return;
    const token = noteFor(historyKey, pageToken);
    const seen: number[] = [];
    let reported = 0;
    let first = true;
    const send = () => {
      if (!first && reported === seen.length) return;
      first = false;
      report({ t: 'list', token, seen: seen.slice(reported) });
      reported = seen.length;
    };
    const stop = watchSeen([...(list.current?.querySelectorAll('[data-pos]') ?? [])], (el) => {
      const pos = Number((el as HTMLElement).dataset.pos);
      if (pos >= 1 && pos <= 30) seen.push(pos);
    });
    // The search itself is recorded once (even one that found nothing), then new places as they're seen.
    const timer = window.setTimeout(send, FIRST_REPORT_MS);
    const onHide = () => {
      if (document.visibilityState === 'hidden') send();
    };
    document.addEventListener('visibilitychange', onHide);
    // Tapping a result: the list goes first, so the page opened from it knows its place.
    const container = list.current;
    container?.addEventListener('click', send, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onHide);
      container?.removeEventListener('click', send, true);
      stop();
      send();
    };
  }, [pageToken, list, historyKey]);
}

/**
 * A business's page: opened (when first visible), time looked at, services seen. `from`:
 * the list place it was opened from, if any. Returns the handler for taps.
 */
export function useVendorActivity(
  pageToken: string | null,
  page: RefObject<HTMLElement | null>,
  from: { pos: number; list: string } | null,
  historyKey: string,
): (e: React.MouseEvent) => void {
  const pos = from?.pos ?? null;
  const listId = from?.list ?? null;
  useEffect(() => {
    if (!pageToken) return;
    const token = noteFor(historyKey, pageToken);
    let opened = false;
    let visibleSince: number | null = null;
    let total = 0;
    let reportedSeconds = 0;
    const open = () => {
      if (opened) return;
      opened = true;
      report({ t: 'view', token, pos, list: pos ? listId : null });
    };
    const timeReport = () => {
      if (visibleSince !== null) {
        total += (performance.now() - visibleSince) / 1000;
        visibleSince = null;
      }
      const seconds = Math.min(MAX_SECONDS, Math.round(total));
      if (seconds >= 1 && seconds !== reportedSeconds) {
        reportedSeconds = seconds;
        report({ t: 'time', token, seconds });
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        open();
        visibleSince = performance.now();
      } else {
        timeReport();
      }
    };
    if (document.visibilityState === 'visible') {
      open();
      visibleSince = performance.now();
    }
    document.addEventListener('visibilitychange', onVisibility);
    const services = page.current?.querySelector('#services')?.closest('section');
    const stop = services ? watchSeen([services], () => report({ t: 'services', token })) : () => undefined;
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
      timeReport();
    };
  }, [pageToken, page, pos, listId, historyKey]);

  return (e: React.MouseEvent) => {
    if (!pageToken) return;
    const token = noteFor(historyKey, pageToken);
    const kind = (e.target as Element).closest('[data-activity]')?.getAttribute('data-activity');
    if (kind === 'website_tap' || kind === 'phone_tap') report({ t: 'tap', token, kind });
  };
}
