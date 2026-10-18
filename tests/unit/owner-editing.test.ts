import { describe, expect, it } from 'vitest';
import { addressProblem } from '@/lib/owner-text';
import { noteText } from '@/server/daily-note.server';
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

describe('a box left as it was (review of D-34)', () => {
  // What the team typed: two spaces, Windows line breaks, a web address, a shortened link.
  const teamBase: OwnerValues = {
    ...base,
    tagline: 'Cakes  for every party ',
    description: 'We bake.  Order at sweettreats.ca\r\n\r\n\r\nOpen daily.',
    websiteUrl: 'https://bit.ly/cakes',
    services: [{ ...base.services[0]!, description: 'See jane@sweettreats.ca  for quotes' }, base.services[1]!],
  };
  const teamForm = (extra: Record<string, string> = {}) =>
    form({
      tagline: 'Cakes for every party',
      description: 'We bake. Order at sweettreats.ca\n\nOpen daily.',
      websiteUrl: 'https://bit.ly/cakes',
      'service.0.description': 'See jane@sweettreats.ca for quotes',
      ...extra,
    });

  it('keeps the team’s text exactly, never blocks the save, and isn’t a change', () => {
    const r = parseOwnerForm(teamForm({ publicPhone: '705 555 0199' }), teamBase);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values.tagline).toBe(teamBase.tagline);
    expect(r.values.description).toBe(teamBase.description);
    expect(r.values.websiteUrl).toBe('https://bit.ly/cakes');
    expect(r.values.services[0]!.description).toBe(teamBase.services[0]!.description);
    const diff = ownerDiff(teamBase, { ...r.values, services: [...r.values.services, teamBase.services[1]!] }, () => NEW)!;
    expect(Object.keys(diff.changes)).toEqual(['publicPhone']);
  });

  it('checks a box the owner did change, naming the words that look like an address', () => {
    const r = parseOwnerForm(teamForm({ description: 'We bake. Order at sweettreats.ca today.' }), teamBase);
    expect(!r.ok && r.errors.description).toContain('“sweettreats.ca”');
  });

  it('nothing changed is nothing to save', () => {
    const r = parseOwnerForm(teamForm(), teamBase);
    const diff = r.ok && ownerDiff(teamBase, { ...r.values, services: [...r.values.services, teamBase.services[1]!] }, () => NEW);
    expect(diff && diff.changes).toEqual({});
  });

  it('a listing the team gave more than 30 shown services can still be saved, but not grow', () => {
    const many = Array.from({ length: 31 }, (_, i) => ({
      id: `01900000-0000-7000-8000-${String(i).padStart(12, '0')}`,
      name: `Cake ${i}`,
      description: null,
      price: { pricingModel: 'on_request' as const, priceCents: null },
      shown: true,
    }));
    const rows = (shownNew: boolean) =>
      Object.fromEntries([
        ...many.flatMap((m, i) => [
          [`service.${i}.id`, m.id],
          [`service.${i}.name`, m.name],
          [`service.${i}.pricingModel`, 'on_request'],
          [`service.${i}.shown`, 'yes'],
        ]),
        ...(shownNew ? [['service.31.name', 'Pies'], ['service.31.pricingModel', 'on_request'], ['service.31.shown', 'yes']] : []),
      ]);
    const big = { ...base, services: many };
    expect(parseOwnerForm({ ...form(), ...rows(false) }, big).ok).toBe(true);
    const grown = parseOwnerForm({ ...form(), ...rows(true) }, big);
    expect(!grown.ok && grown.errors.services).toContain('up to 30');
  });

  it('a row number past the page’s limit is refused, not dropped quietly', () => {
    const r = parseOwnerForm(form({ 'service.500.name': 'Pies', 'service.500.pricingModel': 'on_request' }), base);
    expect(!r.ok && r.errors.form).toContain('out of date');
  });
});

describe('what looks like an address (review of D-34)', () => {
  it('a missed space after a full stop is not one', () => {
    for (const text of ['We serve Orillia and area.To book, call us', 'Gift cards available.Shop local!', 'Family run since 1999.Co-owned by Jane', 'Serving Simcoe County.Us and our team']) {
      expect(addressProblem(text), text).toBeNull();
    }
  });
  it('a real one is, and the message names it', () => {
    expect(addressProblem('Order at sweettreats.ca today')).toContain('“sweettreats.ca”');
    expect(addressProblem('Order at Sweettreats.ca.')).toContain('Sweettreats.ca');
    expect(addressProblem('Email jane@cakes.ca')).toContain('jane@cakes.ca');
    expect(addressProblem('See www.cakes.example/menu')).toContain('www.cakes.example/menu');
    expect(addressProblem('Visit https://evil.example')).toContain('https://evil.example');
  });
  it('a website hiding another site behind an @ is refused', () => {
    const r = parseOwnerForm(form({ websiteUrl: 'https://sweettreats.ca@bookings.example' }), base);
    expect(!r.ok && r.errors.websiteUrl).toContain('@');
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

describe('details added to an existing service (review of D-34)', () => {
  it('can be undone, and isn’t called a new service', () => {
    const r = ownerDiff(base, { ...base, services: [{ ...base.services[0]!, description: 'Serves 100' }, base.services[1]!] }, () => NEW)!;
    const key = `service:${S1}:description`;
    expect(r.changes).toEqual({ [key]: { from: null, to: 'Serves 100' } });
    expect(planUndo(r.changes, { ...flatten(base), [key]: 'Serves 100' })).toEqual([{ key, restore: null, possible: true, now: 'Serves 100' }]);
    expect(describeChanges(r.changes, () => 'Wedding cake')).toEqual(['Service “Wedding cake” details: (empty) → “Serves 100”']);
    // And the undo's own record, as the owner is told: details went back to empty.
    expect(describeChanges({ [key]: { from: 'Serves 100', to: null } }, () => 'Wedding cake')).toEqual([
      'Service “Wedding cake” details: “Serves 100” → (empty)',
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

describe('the team’s daily note (review of D-34)', () => {
  const save = {
    auditId: NEW,
    vendorId: S1,
    business: 'Sweet Treats',
    owner: 'Jane',
    at: '2026-10-11T14:00:00Z',
    flags: ['website'],
    changes: { tagline: { from: 'Cakes', to: 'Pies' }, websiteUrl: { from: 'https://a.ca/', to: 'https://b.ca/' } },
    names: {},
  };
  it('says whether the team undid all of a save or only part of it', () => {
    const all = noteText([{ ...save, undoneBy: 'Sam', undoChanges: { tagline: { from: 'Pies', to: 'Cakes' }, websiteUrl: { from: 'https://b.ca/', to: 'https://a.ca/' } } }], 0, 'https://x');
    const part = noteText([{ ...save, undoneBy: 'Sam', undoChanges: { tagline: { from: 'Pies', to: 'Cakes' } } }], 2, 'https://x');
    expect(all.text).toContain('(already undone by Sam)');
    expect(part.text).toContain('(partly undone by Sam)');
    expect(part.text).toContain('…and 2 more');
    expect(part.subject).toBe('Owner changes on Localites: 1 business, 3 saves');
  });
  it('reminds the team of deleted accounts still to finish, with the oldest one’s due date', () => {
    const todo = { waiting: 2, oldest: '2026-10-01T15:00:00Z' };
    const withSaves = noteText([{ ...save, undoneBy: null, undoChanges: null }], 0, 'https://x', todo);
    expect(withSaves.text.split('\n')[0]).toBe(
      '2 deleted accounts still need their sign-in records removed in Supabase (the oldest by October 31): https://x/admin/account-deletions',
    );
    const alone = noteText([], 0, 'https://x', { waiting: 1, oldest: '2026-10-01T15:00:00Z' });
    expect(alone.subject).toBe('Localites: 1 deleted account to finish');
    expect(alone.text).toContain('1 deleted account still needs its sign-in record removed');
    expect(alone.text).toContain('No owner changed a listing since the last note.');
    expect(noteText([{ ...save, undoneBy: null, undoChanges: null }], 0, 'https://x').text).not.toContain('deleted account');
  });
});
