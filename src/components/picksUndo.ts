/**
 * What was just taken off My picks, so the bar can offer Undo (the owner, 25 October 2026:
 * "undo for each action even if only one"): one business (the bar's × or a card's tick), a few
 * in a row, or Clear all. Shared by the cards and the bar, which shows the note.
 */
export type Removed = { slugs: string[]; words: string };

let current: Removed | null = null;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((f) => f());

export const picksUndo = {
  get: (): Removed | null => current,
  none: (): Removed | null => null,
  subscribe(f: () => void) {
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  },
  /** One business off; while the note still shows, taken together with the ones before. */
  removed(slug: string, name: string) {
    const slugs = current && current.words !== 'Picks cleared' ? [...current.slugs.filter((s) => s !== slug), slug] : [slug];
    current = { slugs, words: slugs.length === 1 ? `${name} removed` : `${slugs.length} businesses removed` };
    tell();
  },
  cleared(slugs: string[]) {
    current = { slugs, words: 'Picks cleared' };
    tell();
  },
  done() {
    current = null;
    tell();
  },
};
