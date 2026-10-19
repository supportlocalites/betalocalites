import { describe, expect, it } from 'vitest';
import { safeBack, themeFrom } from '@/lib/theme';

describe('the light and dark look (D-57)', () => {
  it('reads only "light" or "dark" from the cookie', () => {
    expect(themeFrom('lc_theme=dark')).toBe('dark');
    expect(themeFrom('a=1; lc_theme=light; b=2')).toBe('light');
    expect(themeFrom('lc_theme=purple')).toBeNull();
    expect(themeFrom('xlc_theme=dark')).toBeNull();
    expect(themeFrom(null)).toBeNull();
  });

  it('goes back only to a page on this site', () => {
    expect(safeBack('/explore?q=cakes')).toBe('/explore?q=cakes');
    expect(safeBack('//evil.example')).toBe('/');
    expect(safeBack('/\\evil.example')).toBe('/');
    expect(safeBack('https://evil.example')).toBe('/');
  });
});
