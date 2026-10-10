import { describe, expect, it } from 'vitest';
import { describePrice } from '@/lib/price';

describe('describePrice', () => {
  it('shows a fixed price as the business gave it', () => {
    expect(describePrice('fixed', 15000)).toBe('$150');
    expect(describePrice('fixed', 15050)).toBe('$150.50');
  });
  it('labels starting prices and hourly rates', () => {
    expect(describePrice('starting_at', 15000)).toBe('From $150');
    expect(describePrice('hourly', 6000)).toBe('$60 an hour');
  });
  it('never invents a price', () => {
    expect(describePrice('on_request', null)).toBe('Price on request');
    expect(describePrice('not_listed', null)).toBeNull();
    expect(describePrice('fixed', null)).toBeNull();
  });
});
