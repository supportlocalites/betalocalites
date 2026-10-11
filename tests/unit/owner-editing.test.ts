import { describe, expect, it } from 'vitest';
import { describeChanges, findClashes, flatten, ownerDiff, planUndo, riskFlags } from '@/server/owner-changes';
import { type OwnerValues, parseOwnerForm } from '@/server/owner-input';

const S1 = '01900000-0000-7000-8000-000000000001';
const S2 = '01900000-0000-7000-8000-000000000002';
const NEW = '01900000-0000-7000-8000-0000000000aa';

const base: OwnerValues = {
  tagline: 'Cakes',
  description: null,
  websiteUrl: 'https://sweettreats.ca/',
  publicPhone: '705 555 0100',
  services: [
    { id: S1, name: 'Wedding cake', description: null, price: { pricingModel: 'starting_at', priceCents: 35000 }, shown: true },
    { id: S2, name: 'Cupcakes', description: 'A dozen', price: { pricingModel: 'fixed', priceCents: 3600 }, shown: true },
  ],
};
const form = (extra: Record<string, string> = {}) => ({
  tagline: 'Cakes',
  description: '',
  websiteUrl: 'sweettreats.ca/',
  publicPhone: '705 555 0100',
  'service.0.id': S1,
  'service.0.name': 'Wedding cake',
  'service.0.description': '',
  'service.0.pricingModel': 'starting_at',
  'service.0.price': '350',
  'service.0.shown': 'yes',
  ...extra,
});

describe('what an owner can type (D-34)', () => {
  it('completes a website and keeps only what owners may change', () => {
    const r = parseOwnerForm({ ...form(), name: 'Evil Bakery', slug: 'evil', municipalityId: 'x', publicEmail: 'a@b.ca' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values.websiteUrl).toBe('https://sweettreats.ca/');
    expect(Object.keys(r.values).sort()).toEqual(['description', 'publicPhone', 'services', 'tagline', 'websiteUrl']);
  });

  it('refuses tricky websites', () => {
    for (const [site, words] of [
      ['javascript:alert(1)', 'website'],
      ['http://192.168.0.1/login', 'website’s name'],
      ['bit.ly/abc', 'shortened link'],
      ['https://www.tinyurl.com/x', 'shortened link'],
    ] as const) {
      const r = parseOwnerForm(form({ websiteUrl: site }));
      expect(r.ok, site).toBe(false);
      if (!r.ok) expect(r.errors.websiteUrl, site).toContain(words);
    }
  });

  it('keeps web and email addresses out of descriptions, and removes invisible characters', () => {
    for (const text of ['Visit https://evil.example', 'Order at www.cakes.example', 'Email jane@cakes.ca', 'See cheap-cakes.com now']) {
      const r = parseOwnerForm(form({ description: text }));
      expect(r.ok, text).toBe(false);
      if (!r.ok) expect(r.errors.description).toContain('Website box');
    }
    const r = parseOwnerForm(form({ tagline: 'Ca​kes‮', description: 'Line one\r\n\r\n\r\n  Line   two ' }));
    expect(r.ok && r.values.tagline).toBe('Cakes');
    expect(r.ok && r.values.description).toBe('Line one\n\nLine two');
  });

  it('reads services by row: prices, a blank new row ignored, a nameless row refused', () => {
    const r = parseOwnerForm(form({ 'service.1.id': '', 'service.1.name': '', 'service.1.price': '', 'service.1.pricingModel': 'fixed' }));
    expect(r.ok && r.values.services).toEqual([
      { id: S1, name: 'Wedding cake', description: null, price: { pricingModel: 'starting_at', priceCents: 35000 }, shown: true },
    ]);
    const priced = parseOwnerForm(form({ 'service.0.price': 'lots' }));
    expect(!priced.ok && priced.errors['service.0.price']).toContain('dollars');
    const nameless = parseOwnerForm(form({ 'service.0.name': '  ' }));
    expect(!nameless.ok && nameless.errors['service.0.name']).toContain('name');
    const free = parseOwnerForm(form({ 'service.0.pricingModel': 'on_request', 'service.0.price': '999' }));
    expect(free.ok && free.values.services[0]!.price).toEqual({ pricingModel: 'on_request', priceCents: null });
  });
});

describe('what a save changed', () => {
  const submitted = (patch: Partial<OwnerValues>): OwnerValues => ({ ...base, ...patch });

  it('lists only what the owner changed, with the price as one unit', () => {
    const services = [{ ...base.services[0]!, price: { pricingModel: 'fixed' as const, priceCents: 40000 } }, base.services[1]!];
    const r = ownerDiff(base, submitted({ tagline: 'Custom cakes', services }), () => NEW)!;
    expect(r.changes).toEqual({
      tagline: { from: 'Cakes', to: 'Custom cakes' },
      [`service:${S1}:price`]: { from: { pricingModel: 'starting_at', priceCents: 35000 }, to: { pricingModel: 'fixed', priceCents: 40000 } },
    });
  });

  it('records a new service with every key starting from nothing', () => {
    const added = { id: null, name: 'Pies', description: null, price: { pricingModel: 'on_request' as const, priceCents: null }, shown: true };
    const r = ownerDiff(base, submitted({ services: [...base.services, added] }), () => NEW)!;
    expect(r.added).toEqual([NEW]);
    expect(r.changes[`service:${NEW}:shown`]).toEqual({ from: null, to: true });
    expect(r.changes[`service:${NEW}:description`]).toBeUndefined();
  });

  it('refuses a service that wasn’t on the page (another business’s)', () => {
    const stranger = { ...base.services[0]!, id: '01900000-0000-7000-8000-0000000000ff' };
    expect(ownerDiff(base, submitted({ services: [stranger] }), () => NEW)).toBeNull();
  });

  it('finds clashes only where the team changed what the owner also changed', () => {
    const r = ownerDiff(base, submitted({ tagline: 'Custom cakes', websiteUrl: 'https://new.ca/' }), () => NEW)!;
    const current = { ...flatten(base), websiteUrl: 'https://team-fixed.ca/' };
    expect(findClashes(r.changes, current)).toEqual(['websiteUrl']);
    expect(findClashes(r.changes, flatten(base))).toEqual([]);
  });

  it('flags a new website on another site, or a new phone number, but not a tidier one', () => {
    expect(riskFlags({ websiteUrl: { from: 'https://a.ca/', to: 'https://b.ca/' } })).toEqual(['website']);
    expect(riskFlags({ websiteUrl: { from: null, to: 'https://a.ca/' } })).toEqual(['website']);
    expect(riskFlags({ websiteUrl: { from: 'https://a.ca/', to: 'https://www.a.ca/cakes' } })).toEqual([]);
    expect(riskFlags({ websiteUrl: { from: 'https://a.ca/', to: null } })).toEqual([]);
    expect(riskFlags({ publicPhone: { from: '705 555 0100', to: '(705) 555-0100' } })).toEqual([]);
    expect(riskFlags({ publicPhone: { from: '705 555 0100', to: '705 555 0199' } })).toEqual(['phone']);
  });
});

describe('undoing a save', () => {
  it('restores each field still as the save left it, and not one changed again since', () => {
    const changes = { tagline: { from: 'Cakes', to: 'Custom cakes' }, websiteUrl: { from: 'https://a.ca/', to: 'https://b.ca/' } };
    const lines = planUndo(changes, { tagline: 'Custom cakes', websiteUrl: 'https://c.ca/' });
    expect(lines).toEqual([
      { key: 'tagline', restore: 'Cakes', possible: true, now: 'Custom cakes' },
      { key: 'websiteUrl', restore: 'https://a.ca/', possible: false, now: 'https://c.ca/' },
    ]);
  });

  it('hides a service the save added, rather than deleting it', () => {
    const changes = {
      [`service:${NEW}:name`]: { from: null, to: 'Pies' },
      [`service:${NEW}:shown`]: { from: null, to: true },
    };
    expect(planUndo(changes, { [`service:${NEW}:shown`]: true })).toEqual([{ key: `service:${NEW}:shown`, restore: false, possible: true, now: true }]);
    expect(planUndo(changes, { [`service:${NEW}:shown`]: false })[0]!.possible).toBe(false);
  });

  it('shows a hidden service again, and restores a price as one unit', () => {
    const price = { from: { pricingModel: 'fixed', priceCents: 100 }, to: { pricingModel: 'on_request', priceCents: null } };
    const lines = planUndo({ [`service:${S2}:shown`]: { from: true, to: false }, [`service:${S2}:price`]: price }, {
      [`service:${S2}:shown`]: false,
      [`service:${S2}:price`]: { priceCents: null, pricingModel: 'on_request' },
    });
    expect(lines.map((l) => [l.restore, l.possible])).toEqual([
      [true, true],
      [{ pricingModel: 'fixed', priceCents: 100 }, true],
    ]);
  });
});

describe('the plain words for the team', () => {
  it('reads like a sentence, cut short when long', () => {
    const names = (id: string) => (id === NEW ? 'Pies' : 'Cupcakes');
    const lines = describeChanges(
      {
        websiteUrl: { from: 'https://a.ca/', to: 'https://b.ca/' },
        description: { from: null, to: 'x'.repeat(300) },
        [`service:${NEW}:name`]: { from: null, to: 'Pies' },
        [`service:${NEW}:shown`]: { from: null, to: true },
        [`service:${S2}:shown`]: { from: true, to: false },
        [`service:${S2}:price`]: { from: { pricingModel: 'fixed', priceCents: 3600 }, to: { pricingModel: 'starting_at', priceCents: 3000 } },
      },
      names,
    );
    expect(lines).toEqual([
      'Website: “https://a.ca/” → “https://b.ca/”',
      `About: (empty) → “${'x'.repeat(79)}…”`,
      'Service added: “Pies”',
      'Service hidden: “Cupcakes”',
      'Service “Cupcakes” price: $36 → From $30',
    ]);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(120);
  });
});
