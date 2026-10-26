import { describe, expect, it } from 'vitest';
import { readAddressForm, streetLine, unitWords } from '@/lib/address';

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe('a business address with a unit (0059, D-63)', () => {
  it('shows the unit after the street', () => {
    expect(streetLine({ street: 'Lakeshore Road', number: '22', unit: '2B', hidden: false })).toBe('22 Lakeshore Road, Unit 2B');
    expect(streetLine({ street: 'Lakeshore Road', number: '22', unit: 'Suite 200', hidden: false })).toBe('22 Lakeshore Road, Suite 200');
    expect(streetLine({ street: 'Lakeshore Road', number: null, unit: null, hidden: false })).toBe('Lakeshore Road');
  });
  it('never shows a unit or number the business keeps private', () => {
    expect(streetLine({ street: 'Lakeshore Road', number: '22', unit: '2B', hidden: true })).toBe('Lakeshore Road');
  });
  it('says "Unit" only for a bare number or letter', () => {
    expect(unitWords('4')).toBe('Unit 4');
    expect(unitWords('PH')).toBe('PH');
    expect(unitWords('#4')).toBe('#4');
  });
  it('reads the form: a unit needs a street, and private means not kept', () => {
    expect(readAddressForm(form({ street: '', unit: '4' }))).toEqual({ error: 'Enter the street as well as the unit.', field: 'street' });
    expect(readAddressForm(form({ street: 'Main Street', number: '9', unit: ' 4 ' }))).toEqual({
      value: { street: 'Main Street', number: '9', unit: '4', hidden: false },
    });
    expect(readAddressForm(form({ street: 'Main Street', number: '9', unit: '4', hideNumber: 'yes' }))).toEqual({
      value: { street: 'Main Street', number: null, unit: null, hidden: true },
    });
    expect('error' in readAddressForm(form({ street: 'Main Street', unit: '<b>' }))).toBe(true);
  });
});
