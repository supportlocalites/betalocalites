import { describe, expect, it } from 'vitest';
import { cleanText, hasVisible } from '@/lib/clean-text';
import { personalDetails } from '@/server/moderation.server';

describe('cleaning typed words (scenario tests)', () => {
  it('drops invisible and direction-changing characters, keeping ordinary words, emoji and line breaks', () => {
    expect(cleanText('Sa​m‮ pa⁦rty﻿')).toBe('Sam party');
    expect(cleanText('Line one\nLine two\tend')).toBe('Line one\nLine two\tend');
    expect(cleanText('\u{1F1E8}\u{1F1E6} \u{1F44D}\u{1F3FD} \u{1F468}‍\u{1F469}')).toBe('\u{1F1E8}\u{1F1E6} \u{1F44D}\u{1F3FD} \u{1F468}‍\u{1F469}');
  });
  it('puts accents in one standard form', () => {
    expect(cleanText('élan')).toBe('élan');
  });
  it('knows a name with nothing visible in it', () => {
    expect(hasVisible('　 ')).toBe(false);
    expect(hasVisible('\u3164\u2800')).toBe(false);
    expect(hasVisible('Zoë')).toBe(true);
    expect(hasVisible('李')).toBe(true);
  });
});

describe('personal details in reviews and replies', () => {
  it('spots a phone number, an email address and a street address', () => {
    expect(personalDetails(['Call me on 705-555-0123'])).toEqual(['a phone number']);
    expect(personalDetails(['write to sam@example.com'])).toEqual(['an email address']);
    expect(personalDetails(['She lives at 12 Mississaga Street'])).toEqual(['a street address']);
  });
  it('leaves ordinary words alone', () => {
    expect(personalDetails(['Lovely cake for 30 guests, 5 stars'])).toEqual([]);
    expect(personalDetails(['Took 2 kids to the dr after', '5 stars on the way home'])).toEqual([]);
    expect(personalDetails(['Come to 4 Oak cres'])).toEqual(['a street address']);
  });
});
