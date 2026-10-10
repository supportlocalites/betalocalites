/** How a service's price is shown. Mirrors vendor_service.pricing_model. */
export type PricingModel = 'fixed' | 'starting_at' | 'hourly' | 'on_request' | 'not_listed';

const dollars = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);

/**
 * The words shown for a price, exactly as the business gave it. Returns null when
 * the business chose not to list a price. Never invents or rounds a figure.
 */
export function describePrice(model: PricingModel, cents: number | null, currency = 'CAD'): string | null {
  switch (model) {
    case 'fixed':
      return cents == null ? null : dollars(cents, currency);
    case 'starting_at':
      return cents == null ? null : `From ${dollars(cents, currency)}`;
    case 'hourly':
      return cents == null ? null : `${dollars(cents, currency)} an hour`;
    case 'on_request':
      return 'Price on request';
    case 'not_listed':
      return null;
  }
}
