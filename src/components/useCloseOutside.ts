import { type RefObject, useEffect } from 'react';

/**
 * A pop-up made with <details> (the profile menu, Show, Within) closes when someone clicks or
 * taps anywhere outside it, or presses Esc (the owner, 25 October 2026).
 */
export function useCloseOutside(ref: RefObject<HTMLDetailsElement | null>) {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = ref.current;
      if (el?.open && !el.contains(e.target as Node)) el.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      const el = ref.current;
      if (e.key === 'Escape' && el?.open) el.open = false;
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref]);
}
