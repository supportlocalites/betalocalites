import { useSyncExternalStore } from 'react';
import { Form, useLocation, useRouteLoaderData } from 'react-router';
import type { Theme } from '@/lib/theme';
import styles from './ThemeToggle.module.css';

const DARK = '(prefers-color-scheme: dark)';
const watchDevice = (onChange: () => void) => {
  const q = window.matchMedia(DARK);
  q.addEventListener('change', onChange);
  return () => q.removeEventListener('change', onChange);
};

/**
 * The moon (to the dark look) or the sun (back to light), D-57. A plain form, so it works
 * without scripts too; the choice is kept in a cookie (routes/theme.ts). With no choice yet,
 * the page follows the device, and the button offers the other look.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const chosen = useRouteLoaderData<{ theme: Theme | null }>('root')?.theme ?? null;
  const deviceDark = useSyncExternalStore(watchDevice, () => window.matchMedia(DARK).matches, () => false);
  const dark = chosen ? chosen === 'dark' : deviceDark;
  const location = useLocation();
  const label = dark ? 'Switch to the light look' : 'Switch to the dark look';
  return (
    <Form method="post" action="/theme" preventScrollReset className={className}>
      <input type="hidden" name="to" value={dark ? 'light' : 'dark'} />
      <input type="hidden" name="back" value={location.pathname + location.search + location.hash} />
      <button type="submit" className={styles.button} aria-label={label} title={label}>
        {dark ? (
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={styles.icon}>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={styles.icon}>
            <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
          </svg>
        )}
      </button>
    </Form>
  );
}
