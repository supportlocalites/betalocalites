/** The light or dark look (D-57), as the visitor chose it with the moon or sun; none means "as the device is set". */
export type Theme = 'light' | 'dark';

export const THEME_COOKIE = 'lc_theme';

/** The visitor's choice from the request's cookies, or null. */
export function themeFrom(cookieHeader: string | null): Theme | null {
  const m = /(?:^|;\s*)lc_theme=(light|dark)(?:;|$)/.exec(cookieHeader ?? '');
  return m ? (m[1] as Theme) : null;
}

/** Only a page on this site to go back to: a path, never another site's address. */
export function safeBack(back: string): string {
  return back.startsWith('/') && !back.startsWith('//') && !back.startsWith('/\\') ? back : '/';
}
