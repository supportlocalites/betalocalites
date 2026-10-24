import { describe, expect, it } from 'vitest';
import { fold, fuzzyMatch, near } from '@/lib/fuzzy';

const card = 'Cedar Stone Massage Calm, unhurried massage Health & Wellness Massage & Bodywork Downtown Hot stone';

describe('forgiving search (the owner, 24 October 2026)', () => {
  it('ignores capitals, accents, apostrophes and & or and', () => {
    expect(fold('Kids’ Café & Co.')).toBe('kids cafe and co');
    expect(fuzzyMatch('health and wellness', card)).toBe(true);
    expect(fuzzyMatch('CEDAR', card)).toBe(true);
  });
  it('allows a slip or two, by the word’s length', () => {
    expect(fuzzyMatch('cedr stone', card)).toBe(true);
    expect(fuzzyMatch('masage', card)).toBe(true);
    expect(fuzzyMatch('mssaeg', card)).toBe(false);
    expect(fuzzyMatch('bodywrok', card)).toBe(true);
    expect(fuzzyMatch('hit', card)).toBe(false);
    expect(fuzzyMatch('hot', card)).toBe(true);
  });
  it('the start of a word is enough, even with a slip', () => {
    expect(fuzzyMatch('bodyw', card)).toBe(true);
    expect(fuzzyMatch('massa', card)).toBe(true);
    expect(fuzzyMatch('bodywr', card)).toBe(true);
  });
  it('finds words run together, and every word must match', () => {
    expect(fuzzyMatch('cedarstone', card)).toBe(true);
    expect(fuzzyMatch('cedar pizza', card)).toBe(false);
  });
  it('counts a swap of two letters as one slip', () => {
    expect(near('stoen', 'stone', 1)).toBe(true);
    expect(near('abc', 'xyz', 1)).toBe(false);
  });
  it('nothing typed finds everything', () => {
    expect(fuzzyMatch('  ', card)).toBe(true);
  });
});
