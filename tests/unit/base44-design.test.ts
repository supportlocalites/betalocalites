import { describe, expect, it } from 'vitest';
import { ratingLabel, replyLabel } from '@/components/Directory';
import { readProfileDetails } from '@/lib/profile-details';
import { bestRatedIds, kmBetween } from '@/server/browse.server';
import { CENTRE } from '@/lib/centre';

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe('the Base44 cards (D-59)', () => {
  it('says reply times as Base44 does', () => {
    expect(replyLabel(null)).toBe('—');
    expect(replyLabel(20)).toBe('~1 hrs');
    expect(replyLabel(120)).toBe('~2 hrs');
    expect(replyLabel(60 * 20)).toBe('~1 day');
    expect(replyLabel(60 * 72)).toBe('~3 days');
  });
  it('says "New" until a business has a rating', () => {
    expect(ratingLabel(null)).toBe('New');
    expect(ratingLabel(4.75)).toBe('4.8');
  });
  it('measures from downtown Orillia', () => {
    expect(kmBetween(CENTRE, CENTRE)).toBe(0);
    // Washago is about 17 km north.
    const washago = kmBetween(CENTRE, { lat: 44.7504, lng: -79.3329 });
    expect(washago).toBeGreaterThan(15);
    expect(washago).toBeLessThan(19);
  });
});

describe('Best rated (D-59, K6)', () => {
  it('needs 10 reviews', () => {
    expect(bestRatedIds([{ id: 'a', reviews: 9, rating: 5 }]).size).toBe(0);
    expect([...bestRatedIds([{ id: 'a', reviews: 10, rating: 4.1 }])]).toEqual(['a']);
  });
  it('goes to the top 5% of those with 10, and to a tie', () => {
    const cards = Array.from({ length: 40 }, (_, i) => ({ id: `v${i}`, reviews: 12, rating: 3 + i / 20 }));
    expect([...bestRatedIds(cards)].sort()).toEqual(['v38', 'v39']);
    cards.push({ id: 'tie', reviews: 30, rating: cards[39]!.rating });
    expect(bestRatedIds(cards).has('tie')).toBe(true);
  });
  it('ignores a business with no rating yet', () => {
    expect(bestRatedIds([{ id: 'a', reviews: 12, rating: null }]).size).toBe(0);
  });
});

describe("the team's profile details (0056)", () => {
  it('reads tags typed with commas, tidied', () => {
    const r = readProfileDetails(form({ neighbourhood: '  West  Ridge ', tags: 'Seats 80, Nut-free kitchen ,, Comes to you', curatorNote: ' Book early. ' }));
    expect(r).toEqual({ value: { neighbourhood: 'West Ridge', tags: ['Seats 80', 'Nut-free kitchen', 'Comes to you'], curatorNote: 'Book early.' } });
  });
  it('empties become nothing', () => {
    expect(readProfileDetails(form({ neighbourhood: ' ', tags: '', curatorNote: '' }))).toEqual({
      value: { neighbourhood: null, tags: [], curatorNote: null },
    });
  });
  it('refuses what the database would', () => {
    expect(readProfileDetails(form({ tags: 'a,b,c,d,e,f,g' }))).toHaveProperty('error');
    expect(readProfileDetails(form({ tags: 'x'.repeat(25) }))).toHaveProperty('error');
    expect(readProfileDetails(form({ tags: 'Garden, garden' }))).toHaveProperty('error');
    expect(readProfileDetails(form({ curatorNote: 'n'.repeat(281) }))).toHaveProperty('error');
    expect(readProfileDetails(form({ neighbourhood: 'n'.repeat(61) }))).toHaveProperty('error');
  });
  it('drops invisible characters', () => {
    expect(readProfileDetails(form({ tags: 'Se​ats 80' }))).toEqual({ value: { neighbourhood: null, tags: ['Seats 80'], curatorNote: null } });
  });
});
