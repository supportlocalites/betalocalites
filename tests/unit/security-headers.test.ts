import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { securityHeaders, withSecurityHeaders } from '@/server/security-headers';

describe('security headers', () => {
  it('are the same for static files (public/_headers) as for pages', () => {
    const file = readFileSync(path.resolve(import.meta.dirname, '../../public/_headers'), 'utf8');
    const listed = file
      .split('\n')
      .filter((line) => /^\s+\S+:/.test(line))
      .map((line) => {
        const [name, ...rest] = line.trim().split(':');
        return [name, rest.join(':').trim()];
      });
    expect(file.startsWith('/*\n')).toBe(true);
    expect(listed).toEqual(securityHeaders.map(([name, value]) => [name, value]));
  });

  it('are added to a response without losing its status or own headers', async () => {
    const original = new Response('{"ok":true}', { status: 503, headers: { 'Cache-Control': 'no-store' } });
    const secured = withSecurityHeaders(original);
    expect(secured.status).toBe(503);
    expect(secured.headers.get('Cache-Control')).toBe('no-store');
    expect(secured.headers.get('X-Frame-Options')).toBe('DENY');
    expect(await secured.text()).toBe('{"ok":true}');
  });
});
