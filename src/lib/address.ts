/**
 * A business's address and its place on the map (D-56, D-57, migration 0054). The town is the
 * listing's own; the street, number and unit (0059) are optional; a business can hide its number,
 * and then it (and the unit) is never on Localites and the pin is only near the street
 * ("Approximate location").
 */

export type Address = {
  street: string | null;
  number: string | null;
  /** The unit or suite (0059), like 2B or Suite 200; never kept when the number is hidden. */
  unit: string | null;
  hidden: boolean;
  lat: number | null;
  lng: number | null;
  approximate: boolean;
};

export const NO_ADDRESS: Address = { street: null, number: null, unit: null, hidden: false, lat: null, lng: null, approximate: false };

/** As the database checks them (0054). */
export const STREET = /^[\p{L}\p{N}][\p{L}\p{N} .,'’&/-]{0,119}$/u;
export const STREET_NUMBER = /^[0-9]{1,6}[A-Za-z]?(-[0-9]{1,6}[A-Za-z]?)?$/;
/** As the database checks it (0059). */
export const UNIT = /^[\p{L}\p{N}#][\p{L}\p{N} #.-]{0,29}$/u;

/** "Unit 2B" for a bare number or letter; "Suite 200" or "#4" as typed. */
export function unitWords(unit: string): string {
  return /^[0-9A-Za-z-]+$/.test(unit) && !/^[A-Za-z]{2,}$/.test(unit) ? `Unit ${unit}` : unit;
}

export const APPROXIMATE = 'Approximate location';
export const ON_MAP_NOTE = 'Only businesses that share an address are on the map.';

/** "22 Lakeshore Road, Unit 2B", "Lakeshore Road" (number hidden or not given), or null. */
export function streetLine(a: Pick<Address, 'street' | 'number' | 'hidden'> & { unit?: string | null }): string | null {
  if (!a.street) return null;
  if (a.hidden) return a.street;
  const line = a.number ? `${a.number} ${a.street}` : a.street;
  return a.unit ? `${line}, ${unitWords(a.unit)}` : line;
}

/** For the team's history: what an address was, in plain words. */
export function addressWords(a: Address | null): string {
  if (!a || !a.street) return 'none';
  return `${streetLine(a)}${a.hidden ? ' (number hidden)' : ''}${a.lat === null ? ', not on the map' : a.approximate ? ', approximate pin' : ''}`;
}

/** Directions in the visitor's own maps app: the street and town as they're shown, never more. */
export function directionsUrl(a: Pick<Address, 'street' | 'number' | 'hidden'>, town: string): string {
  // The street and number only: a unit makes the maps search match worse.
  const where = [streetLine({ street: a.street, number: a.number, hidden: a.hidden }), town, 'Ontario'].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(where)}`;
}

export type AddressForm = { street: string | null; number: string | null; unit: string | null; hidden: boolean };

/** The address form (owner's, team's, or Add my business): tidied and checked as the database will. */
export function readAddressForm(form: FormData): { value: AddressForm } | { error: string; field: 'street' | 'number' | 'unit' } {
  const tidy = (v: FormDataEntryValue | null) => String(v ?? '').replace(/\s+/g, ' ').trim();
  const street = tidy(form.get('street'));
  const number = tidy(form.get('number')).toUpperCase().replace(/\s/g, '');
  const unit = tidy(form.get('unit'));
  const hidden = form.get('hideNumber') === 'yes';
  if (!street) {
    if (number) return { error: 'Enter the street as well as the number.', field: 'street' };
    if (unit) return { error: 'Enter the street as well as the unit.', field: 'street' };
    return { value: { street: null, number: null, unit: null, hidden: false } };
  }
  if (!STREET.test(street)) return { error: 'Enter the street’s name only, like Lakeshore Road (up to 120 letters).', field: 'street' };
  if (!hidden && number && !STREET_NUMBER.test(number)) return { error: 'Enter the number as digits, like 22 or 22A.', field: 'number' };
  if (!hidden && unit && !UNIT.test(unit)) return { error: 'Enter the unit as letters and numbers, like 2B or Suite 200 (up to 30).', field: 'unit' };
  // Kept private: neither the number nor the unit is kept.
  return { value: { street, number: hidden || !number ? null : number, unit: hidden || !unit ? null : unit, hidden } };
}
