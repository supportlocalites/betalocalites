import { describe, expect, it } from 'vitest';
import { readClaims } from '@/server/auth/gotrue.server';
import { pagePath, safeNext, sessionCookies } from '@/server/auth/session.server';
import { refuseCrossSiteForm } from '@/server/security-headers';

const req = (url: string, init?: RequestInit) => new Request(url, init);

describe('coming back after sign-in', () => {
  it('only allows addresses on this site', () => {
    expect(safeNext('/admin/listings/1')).toBe('/admin/listings/1');
    expect(safeNext('https://evil.example/x')).toBe('/admin');
    expect(safeNext('//evil.example/x')).toBe('/admin');
    expect(safeNext('/\\evil.example')).toBe('/admin');
    expect(safeNext(null)).toBe('/admin');
  });

  it('returns to the page, not its data address', () => {
    expect(pagePath(req('https://l.test/admin.data?_routes=routes%2Fadmin'))).toBe('/admin');
    expect(pagePath(req('https://l.test/admin/listings/abc.data?q=x&_routes=a'))).toBe('/admin/listings/abc?q=x');
    expect(pagePath(req('https://l.test/_root.data'))).toBe('/');
    expect(pagePath(req('https://l.test/admin?status=draft'))).toBe('/admin?status=draft');
  });
});

describe('session cookies', () => {
  it('are unreadable by page scripts, this-site-only, and not sent by other sites', () => {
    for (const c of sessionCookies({ accessToken: 'a', refreshToken: 'r' })) {
      expect(c).toMatch(/^__Host-/);
      expect(c).toContain('HttpOnly');
      expect(c).toContain('Secure');
      expect(c).toContain('SameSite=Lax');
      expect(c).toContain('Path=/');
      expect(c).not.toContain('Domain=');
    }
  });
});

describe('token claims', () => {
  const token = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
  it('reads the two-step level and password sign-in time', () => {
    expect(readClaims(token({ aal: 'aal2', session_id: 's', amr: [{ method: 'totp', timestamp: 2 }, { method: 'password', timestamp: 1 }] }))).toEqual({
      aal: 'aal2',
      passwordAt: 1,
      sessionId: 's',
    });
  });
  it('treats anything unexpected as the lower level', () => {
    expect(readClaims(token({ aal: 'aal3' })).aal).toBe('aal1');
    expect(readClaims(token({})).passwordAt).toBeNull();
  });
});

describe('forms from other websites', () => {
  it('are refused', () => {
    const r = refuseCrossSiteForm(req('https://l.test/admin', { method: 'POST', headers: { Origin: 'https://evil.example' } }));
    expect(r?.status).toBe(403);
  });
  it('are accepted from Localites itself, and reading pages is never blocked', () => {
    expect(refuseCrossSiteForm(req('https://l.test/admin', { method: 'POST', headers: { Origin: 'https://l.test' } }))).toBeNull();
    expect(refuseCrossSiteForm(req('https://l.test/admin', { headers: { Origin: 'https://evil.example' } }))).toBeNull();
  });
});
