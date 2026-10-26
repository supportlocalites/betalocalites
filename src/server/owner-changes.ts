import { type Address, addressWords } from '@/lib/address';
import { describePrice } from '@/lib/price';
import type { OwnerValues, Price } from './owner-input';

/**
 * What an owner's save changed, in the shape audit_log keeps ({key: {from, to}}), and the
 * team's tools for it (ADR-029). Pure functions, so every rule is tested on its own.
 *
 * Keys: tagline, description, websiteUrl, publicPhone, and per service
 * service:<id>:name | :description | :price ({pricingModel, priceCents}, one unit, so the
 * database's honest-price rule can't break on undo) | :shown. A service added in the
 * save has from = null on every key; :shown is never null otherwise, so that marks it.
 */

export type Change = { from: unknown; to: unknown };
export type ChangeSet = Record<string, Change>;

const VENDOR_KEYS = ['tagline', 'description', 'websiteUrl', 'publicPhone'] as const;

/** Values compare equal when their JSON matches with keys in a fixed order. */
export function same(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): string =>
    JSON.stringify(v ?? null, (_k, x) =>
      x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => p.localeCompare(q))) : x,
    );
  return norm(a) === norm(b);
}

/** The owner-editable values as flat keys. */
export function flatten(v: OwnerValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of VENDOR_KEYS) out[k] = v[k];
  for (const s of v.services) {
    if (!s.id) continue;
    out[`service:${s.id}:name`] = s.name;
    out[`service:${s.id}:description`] = s.description;
    out[`service:${s.id}:price`] = s.price;
    out[`service:${s.id}:shown`] = s.shown;
  }
  return out;
}

export const serviceIdOf = (key: string) => /^service:([0-9a-f-]{36}):/i.exec(key)?.[1] ?? null;

/** The services a save added (not ones it changed: an existing service's empty details are null too). */
export function addedServices(changes: ChangeSet): Set<string> {
  const ids = new Set<string>();
  for (const [key, c] of Object.entries(changes)) {
    const id = serviceIdOf(key);
    if (id && key.endsWith(':shown') && c.from === null) ids.add(id);
  }
  return ids;
}

/**
 * What the owner changed compared with the page they loaded (`base`). Only these are ever
 * written, so a save can't quietly reverse anything the team changed in the meantime.
 * Returns null if the form names a service that wasn't on the page.
 */
export function ownerDiff(base: OwnerValues, submitted: OwnerValues, newId: () => string): { changes: ChangeSet; added: string[] } | null {
  const before = flatten(base);
  const known = new Set(base.services.map((s) => s.id));
  const changes: ChangeSet = {};
  const added: string[] = [];
  for (const k of VENDOR_KEYS) if (!same(before[k], submitted[k])) changes[k] = { from: before[k] ?? null, to: submitted[k] };
  for (const s of submitted.services) {
    if (s.id === null) {
      const id = newId();
      added.push(id);
      changes[`service:${id}:name`] = { from: null, to: s.name };
      if (s.description) changes[`service:${id}:description`] = { from: null, to: s.description };
      changes[`service:${id}:price`] = { from: null, to: s.price };
      changes[`service:${id}:shown`] = { from: null, to: s.shown };
      continue;
    }
    if (!known.has(s.id)) return null;
    const after: Record<string, unknown> = { name: s.name, description: s.description, price: s.price, shown: s.shown };
    for (const [field, to] of Object.entries(after)) {
      const key = `service:${s.id}:${field}`;
      if (!same(before[key], to)) changes[key] = { from: before[key] ?? null, to };
    }
  }
  return { changes, added };
}

/**
 * Fields the owner changed that someone else (the team) changed too since the page was
 * loaded: their current value no longer matches what the owner started from.
 */
export function findClashes(changes: ChangeSet, current: Record<string, unknown>): string[] {
  const added = addedServices(changes);
  return Object.entries(changes)
    .filter(([key]) => !added.has(serviceIdOf(key) ?? ''))
    .filter(([key, c]) => !same(current[key], c.from))
    .map(([key]) => key);
}

const hostOf = (url: unknown) => {
  if (typeof url !== 'string' || !URL.canParse(url)) return null;
  return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
};
const digits = (phone: unknown) => (typeof phone === 'string' ? phone.replace(/\D/g, '') : '');

/** What makes a save worth a "check now" email: a new website (another site), or a new phone number. */
export function riskFlags(changes: ChangeSet): ('website' | 'phone')[] {
  const flags: ('website' | 'phone')[] = [];
  const w = changes.websiteUrl;
  if (w && w.to !== null && hostOf(w.to) !== hostOf(w.from)) flags.push('website');
  const p = changes.publicPhone;
  if (p && p.to !== null && digits(p.to) !== digits(p.from)) flags.push('phone');
  return flags;
}

export type UndoLine = { key: string; restore: unknown; possible: boolean; now: unknown };

/** The parts of a save that can be undone one by one: each change, and each added service as a whole. */
export function undoableKeys(changes: ChangeSet): string[] {
  const added = addedServices(changes);
  return Object.keys(changes).filter((key) => !added.has(serviceIdOf(key) ?? '') || key.endsWith(':shown'));
}

/**
 * How to undo a save. Each changed field goes back to its earlier value, but only if it
 * still holds what the save set (otherwise it was changed again since, and undoing the
 * later change comes first). A service the save added is hidden, never deleted; the rest
 * of its fields stay as they are.
 */
export function planUndo(changes: ChangeSet, current: Record<string, unknown>): UndoLine[] {
  const addedIds = addedServices(changes);
  const lines: UndoLine[] = [];
  for (const key of undoableKeys(changes)) {
    const c = changes[key]!;
    if (addedIds.has(serviceIdOf(key) ?? '')) {
      lines.push({ key, restore: false, possible: current[key] === true, now: current[key] });
      continue;
    }
    // An address saved before 0059 has no unit: as none (it couldn't have had one).
    const to = key === 'address' && c.to && typeof c.to === 'object' ? { unit: null, ...c.to } : c.to;
    lines.push({ key, restore: c.from, possible: same(current[key], to), now: current[key] });
  }
  return lines;
}

// ------------------------------------------------------------------ plain words

const LABEL: Record<string, string> = {
  name: 'Business name',
  tagline: 'Short description',
  description: 'About',
  websiteUrl: 'Website',
  publicPhone: 'Phone',
  address: 'Address',
};

const cut = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const shown = (v: unknown) => {
  if (v === null || v === undefined || v === '') return '(empty)';
  if (typeof v === 'object' && v && 'hidden' in v && 'street' in v) return addressWords(v as Address);
  if (typeof v === 'object' && v && 'pricingModel' in v) {
    const p = v as Price;
    return describePrice(p.pricingModel, p.priceCents) ?? 'no price shown';
  }
  return `“${cut(String(v).replace(/\s+/g, ' '), 80)}”`;
};

/**
 * One line of plain words for a change, e.g. "Website: “a.ca” → “b.ca”". `added` says the
 * save added this service (see addedServices).
 */
export function describeChange(key: string, c: Change, serviceName: (id: string) => string, added = false): string {
  if (key in LABEL) return cut(`${LABEL[key]}: ${shown(c.from)} → ${shown(c.to)}`);
  const id = serviceIdOf(key) ?? '';
  const field = key.split(':')[2];
  const name = `“${cut(serviceName(id), 60)}”`;
  if (added) {
    if (field === 'shown') return cut(`Service added: ${name}${c.to === false ? ' (hidden)' : ''}`);
    if (field === 'price') return cut(`New service ${name} price: ${shown(c.to)}`);
    if (field === 'description') return cut(`New service ${name} details: ${shown(c.to)}`);
    return '';
  }
  if (field === 'shown') return `${c.to ? 'Service shown again' : 'Service hidden'}: ${name}`;
  if (field === 'name') return cut(`Service renamed: ${shown(c.from)} → ${shown(c.to)}`);
  if (field === 'price') return cut(`Service ${name} price: ${shown(c.from)} → ${shown(c.to)}`);
  return cut(`Service ${name} details: ${shown(c.from)} → ${shown(c.to)}`);
}

/** All lines for a save, skipping the parts that belong to an "added" line. */
export function describeChanges(changes: ChangeSet, serviceName: (id: string) => string): string[] {
  const added = addedServices(changes);
  return Object.entries(changes)
    .map(([key, c]) => describeChange(key, c, serviceName, added.has(serviceIdOf(key) ?? '')))
    .filter(Boolean);
}
