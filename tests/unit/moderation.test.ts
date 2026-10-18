import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerEnv } from '@/server/env';
import { checkLanguage, listMatches, readVerdict } from '@/server/moderation.server';

describe('the word list (D-50)', () => {
  it('finds whole words, any case, accents or look-alikes', () => {
    expect(listMatches(['What a SHIT day'])).toEqual(['shit']);
    expect(listMatches(['sh1t and a$$hole'])).toEqual(['shit', 'asshole']);
    expect(listMatches(['f*ck this'])).toEqual(['fuck']);
    expect(listMatches(['Bullshit!'])).toEqual(['bullshit']);
  });
  it('leaves innocent words alone', () => {
    expect(listMatches(['Scunthorpe assessment, shiitake and shitake mushrooms, a class act, hello'])).toEqual([]);
    expect(listMatches(['Great cakes! Call 705-555-0100, $45 each.'])).toEqual([]);
    expect(listMatches(['Cock-a-doodle farm visits with a pussy cat'])).toEqual([]);
  });
  it('doesn’t take star ratings or dividers for a word', () => {
    expect(listMatches(['***** would recommend', '5/5 ***', '* * *'])).toEqual([]);
  });
  it('leaves out words with everyday meanings in business text', () => {
    expect(
      listMatches(['Spic and span cleaning, Maine Coon kittens, garlic redskin potatoes, Van Dyke Landscaping, gypsy jazz, prick the dough']),
    ).toEqual([]);
  });
  it('names each match once', () => {
    expect(listMatches(['shit shit', 'SHIT'])).toEqual(['shit']);
  });
});

describe('reading the AI checker', () => {
  it('reads either answer shape', () => {
    expect(readVerdict({ response: { safe: true } })).toEqual({ safe: true, categories: [] });
    expect(readVerdict({ response: { safe: false, categories: ['S10'] } })).toEqual({ safe: false, categories: ['S10'] });
    expect(readVerdict({ response: 'unsafe\nS1,S12' })).toEqual({ safe: false, categories: ['S1', 'S12'] });
    expect(readVerdict({ response: 'safe' })).toEqual({ safe: true, categories: [] });
    expect(readVerdict({ nothing: 1 })).toBeNull();
  });
});

describe('checkLanguage', () => {
  afterEach(() => vi.restoreAllMocks());
  const env = (run: (model: string, input: unknown) => Promise<unknown>) => ({ AI: { run } }) as ServerEnv;

  it('passes clean words, flags the list and the AI checker, with plain reasons', async () => {
    expect(await checkLanguage(env(async () => ({ response: { safe: true } })), ['Lovely cakes', null, ''])).toEqual({ flagged: false });
    expect(await checkLanguage(env(async () => ({ response: { safe: true } })), ['shit cakes'])).toEqual({
      flagged: true,
      reason: 'Word list: shit',
    });
    expect(await checkLanguage(env(async () => ({ response: { safe: false, categories: ['S10', 'S7'] } })), ['some words'])).toEqual({
      flagged: true,
      reason: 'AI checker: hate',
    });
  });
  it('ignores categories that aren’t for this check (a phone number tripping privacy)', async () => {
    expect(await checkLanguage(env(async () => ({ response: { safe: false, categories: ['S7'] } })), ['Call 705 555 0100'])).toEqual({
      flagged: false,
    });
  });
  it('falls back to the word list when the AI checker fails, or is missing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = env(async () => {
      throw new Error('daily allowance used up');
    });
    expect(await checkLanguage(broken, ['Lovely cakes'])).toEqual({ flagged: false });
    expect(await checkLanguage(broken, ['fucking cakes'])).toEqual({ flagged: true, reason: 'Word list: fucking' });
    expect(await checkLanguage({} as ServerEnv, ['twat'])).toEqual({ flagged: true, reason: 'Word list: twat' });
  });
  it('doesn’t wait for the AI checker for ever', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const slow = checkLanguage(env(() => new Promise(() => {})), ['Lovely cakes']);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await slow).toEqual({ flagged: false });
    vi.useRealTimers();
  });
});
