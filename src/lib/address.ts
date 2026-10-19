/**
 * A business's address and its place on the map (D-56, D-57, migration 0054). The town is the
 * listing's own; the street and number are optional; a business can hide its number, and then
 * it's never on Localites and the pin is only near the street ("Approximate location").
 */

export type Address = {
  street: string | null;
  number: string | null;
  hidden: boolean;
  lat: number | null;
  lng: number | null;
  approximate: boolean;
};

export const NO_ADDRESS: Address = { street: null, number: null, hidden: false, lat: null, lng: null, approximate: false };

/** As the database checks them (0054). */
export const STREET = /^[\p{L}\p{N}][\p{L}\p{N} .,'’&/-]{0,119}$/u;
export const STREET_NUMBER = /^[0-9]{1,6}[A-Za-z]?(-[0-9]{1,6}[A-Za-z]?)?$/;

export const APPROXIMATE = 'Approximate location';
export const ON_MAP_NOTE = 'Only businesses that share an address are on the map.';

/** "22 Lakeshore Road", "Lakeshore Road" (number hidden or not given), or null. */
export function streetLine(a: Pick<Address, 'street' | 'number' | 'hidden'>): string | null {
  if (!a.street) return null;
  return a.number && !a.hidden ? `${a.number} ${a.street}` : a.street;
}

/** For the team's history: what an address was, in plain words. */
export function addressWords(a: Address | null): string {
  if (!a || !a.street) return 'none';
  return `${streetLine(a)}${a.hidden ? ' (number hidden)' : ''}${a.lat === null ? ', not on the map' : a.approximate ? ', approximate pin' : ''}`;
}

/** Directions in the visitor's own maps app: the street and town as they're shown, never more. */
export function directionsUrl(a: Pick<Address, 'street' | 'number' | 'hidden'>, town: string): string {
  const where = [streetLine(a), town, 'Ontario'].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(where)}`;
}

export type AddressForm = { street: string | null; number: string | null; hidden: boolean };

/** The address form (owner's or team's): tidied and checked as the database will. */
export function readAddressForm(form: FormData): { value: AddressForm } | { error: string } {
  const tidy = (v: FormDataEntryValue | null) => String(v ?? '').replace(/\s+/g, ' ').trim();
  const street = tidy(form.get('street'));
  const number = tidy(form.get('number')).toUpperCase().replace(/\s/g, '');
  const hidden = form.get('hideNumber') === 'yes';
  if (!street) {
    if (number) return { error: 'Enter the street as well as the number.' };
    return { value: { street: null, number: null, hidden: false } };
  }
  if (!STREET.test(street)) return { error: 'Enter the street’s name only, like Lakeshore Road (up to 120 letters).' };
  if (!hidden && number && !STREET_NUMBER.test(number)) return { error: 'Enter the number as digits, like 22 or 22A.' };
  return { value: { street, number: hidden || !number ? null : number, hidden } };
}
