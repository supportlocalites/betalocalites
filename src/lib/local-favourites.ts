/** Favourites without an account stay in this browser only, as on Base44 (D-59, K15). */
const LOCAL_KEY = 'localites:favourites';
const LOCAL_EVENT = 'localites:favourites';
export const localFavourites = {
  subscribe(onChange: () => void) {
    window.addEventListener('storage', onChange);
    window.addEventListener(LOCAL_EVENT, onChange);
    return () => {
      window.removeEventListener('storage', onChange);
      window.removeEventListener(LOCAL_EVENT, onChange);
    };
  },
  read(): string {
    try {
      return window.localStorage.getItem(LOCAL_KEY) ?? '[]';
    } catch {
      return '[]';
    }
  },
  parse(raw: string): string[] {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  },
  toggle(slug: string) {
    const now = localFavourites.parse(localFavourites.read());
    const next = now.includes(slug) ? now.filter((s) => s !== slug) : [...now, slug];
    try {
      window.localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
    } catch {
      // Storage off: nothing is kept.
    }
    window.dispatchEvent(new Event(LOCAL_EVENT));
  },
};
