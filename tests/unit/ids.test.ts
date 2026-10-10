import { describe, expect, it } from 'vitest';
import { isUuid, SLUG, slugify, uuidv7 } from '@/lib/ids.mjs';

describe('record IDs (UUID v7)', () => {
  it('are valid version-7 IDs that sort by creation time', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(isUuid(a)).toBe(true);
    expect(a[14]).toBe('7');
    expect('89ab').toContain(a[19]);
    expect(a < b).toBe(true);
  });
  it('are different every time', () => {
    expect(uuidv7(5)).not.toBe(uuidv7(5));
  });
});

describe('web addresses from names', () => {
  it.each([
    ['Sweet Treats & Co.', 'sweet-treats-and-co'],
    ['Jillian’s Bakery', 'jillians-bakery'],
    ['Café Crème', 'cafe-creme'],
    ['  --Hello--  ', 'hello'],
    ['Orillia Museum of Art & History (OMAH)', 'orillia-museum-of-art-and-history-omah'],
  ])('%s → %s', (name, slug) => {
    expect(slugify(name)).toBe(slug);
    expect(SLUG.test(slug)).toBe(true);
  });
  it('are never longer than 80 characters and never end with a dash', () => {
    const s = slugify('a'.repeat(79) + ' b');
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s.endsWith('-')).toBe(false);
  });
});
