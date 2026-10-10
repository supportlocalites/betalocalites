import { describe, expect, it } from 'vitest';
import { normalizeDatabaseUrl, requiresTls } from '@/lib/db-url.mjs';

const host = 'aws-0-ca-central-1.pooler.supabase.com:5432';

describe('normalizeDatabaseUrl', () => {
  it('keeps a clean address working', () => {
    const url = `postgresql://postgres.abc123:Pass1234@${host}/postgres`;
    expect(normalizeDatabaseUrl(url)).toBe(url);
    expect(new URL(normalizeDatabaseUrl(url)).password).toBe('Pass1234');
  });

  it('encodes passwords with symbols so the address can be read', () => {
    for (const pw of ['a#b?c/d', 'p@ss:word', 'x%y[z]', "it's"]) {
      const url = normalizeDatabaseUrl(`postgresql://postgres.abc123:${pw}@${host}/postgres`);
      expect(decodeURIComponent(new URL(url).password)).toBe(pw);
      expect(new URL(url).host).toBe(host);
    }
  });

  it('accepts a local address with no password', () => {
    expect(normalizeDatabaseUrl('postgres://postgres@localhost:5434/postgres')).toBe('postgres://postgres@localhost:5434/postgres');
  });

  it('removes brackets left from [YOUR-PASSWORD], spaces and quotes', () => {
    const url = normalizeDatabaseUrl(`  "postgresql://postgres.abc123:[Secret99]@${host}/postgres"\n`);
    expect(new URL(url).password).toBe('Secret99');
  });

  it('finds the address inside extra pasted text', () => {
    const pasted = `DATABASE_URL="postgresql://postgres.abc123:Pass1234@${host}/postgres"\nDIRECT_URL="postgresql://other"`;
    expect(new URL(normalizeDatabaseUrl(pasted)).password).toBe('Pass1234');
  });

  it('explains common mistakes without showing the address', () => {
    expect(() => normalizeDatabaseUrl(`postgresql://postgres.abc:[YOUR-PASSWORD]@${host}/postgres`)).toThrow(/still contains/);
    expect(() => normalizeDatabaseUrl('psql -h somewhere')).toThrow(/not a database address/);
    expect(() => normalizeDatabaseUrl('JustAPassword123')).toThrow(/1 line, no "\:\/\/"/);
    expect(() => normalizeDatabaseUrl('')).toThrow(/empty/);
    for (const bad of ['postgresql://u:topsecret@ bad host/db', 'topsecret', 'user=u password=topsecret']) {
      try {
        normalizeDatabaseUrl(bad);
      } catch (err) {
        expect(String(err)).not.toContain('topsecret');
      }
    }
  });
});

describe('requiresTls', () => {
  it('uses encryption for hosted databases only', () => {
    expect(requiresTls(`postgresql://u:p@${host}/postgres`)).toBe(true);
    expect(requiresTls('postgres://u:p@localhost:5434/x')).toBe(false);
  });
});
