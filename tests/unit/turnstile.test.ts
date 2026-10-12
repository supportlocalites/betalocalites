import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkHuman, humanCheckSiteKey, humanCheckState } from '@/server/turnstile.server';

const on = { TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'secret' };
const request = new Request('https://localites.ca/join', { method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.9' } });
const answering = (status: number, body: unknown) =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

afterEach(() => vi.restoreAllMocks());

describe('the “are you human” check', () => {
  it('is on only when both keys are set', () => {
    expect(humanCheckState({})).toBe('off');
    expect(humanCheckState({ TURNSTILE_SITE_KEY: 'site' })).toBe('half');
    expect(humanCheckState({ TURNSTILE_SECRET_KEY: ' ', TURNSTILE_SITE_KEY: 'site' })).toBe('half');
    expect(humanCheckState(on)).toBe('on');
    expect(humanCheckSiteKey({ TURNSTILE_SITE_KEY: 'site' })).toBeNull();
    expect(humanCheckSiteKey(on)).toBe('site');
  });

  it('lets everything through while off, without asking anyone', async () => {
    const f = vi.spyOn(globalThis, 'fetch');
    expect(await checkHuman({}, request, null, 'join')).toBe('passed');
    expect(f).not.toHaveBeenCalled();
  });

  it('passes only a real pass for this form on this site', async () => {
    const f = answering(200, { success: true, action: 'join', hostname: 'localites.ca' });
    expect(await checkHuman(on, request, 'answer', 'join')).toBe('passed');
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(JSON.parse(String(init?.body))).toEqual({ secret: 'secret', response: 'answer', remoteip: '203.0.113.9' });
    answering(200, { success: true, action: 'suggest', hostname: 'localites.ca' });
    expect(await checkHuman(on, request, 'answer', 'join')).toBe('failed');
    answering(200, { success: true, action: 'join', hostname: 'evil.example' });
    expect(await checkHuman(on, request, 'answer', 'join')).toBe('failed');
    answering(200, { success: false, 'error-codes': ['timeout-or-duplicate'] });
    expect(await checkHuman(on, request, 'answer', 'join')).toBe('failed');
  });

  it('refuses a missing or oversized answer without asking', async () => {
    const f = vi.spyOn(globalThis, 'fetch');
    expect(await checkHuman(on, request, null, 'join')).toBe('failed');
    expect(await checkHuman(on, request, '', 'join')).toBe('failed');
    expect(await checkHuman(on, request, 'x'.repeat(2049), 'join')).toBe('failed');
    expect(f).not.toHaveBeenCalled();
  });

  it('never lets through when Cloudflare can’t be asked or refuses our key', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await checkHuman(on, request, 'answer', 'join')).toBe('unavailable');
    answering(500, {});
    expect(await checkHuman(on, request, 'answer', 'join')).toBe('unavailable');
    answering(200, { success: false, 'error-codes': ['invalid-input-secret'] });
    expect(await checkHuman(on, request, 'answer', 'join')).toBe('unavailable');
  });

  it('uses a pretend checker only when it is on this computer', async () => {
    const f = answering(200, { success: true, action: 'join', hostname: 'localites.ca' });
    await checkHuman({ ...on, TURNSTILE_VERIFY_URL: 'http://127.0.0.1:8787/v' }, request, 'a', 'join');
    expect(f.mock.calls[0]![0]).toBe('http://127.0.0.1:8787/v');
    await checkHuman({ ...on, TURNSTILE_VERIFY_URL: 'https://evil.example/v' }, request, 'a', 'join');
    expect(f.mock.calls[1]![0]).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
  });
});
