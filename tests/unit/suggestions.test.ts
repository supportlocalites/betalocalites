import { afterEach, describe, expect, it, vi } from 'vitest';
import { FROM_ADDRESS, sendEmail, TEAM_ADDRESS } from '@/server/email.server';
import { suggestionInput, teamEmail } from '@/server/suggestion-input';

describe('suggest a business: the three questions', () => {
  it('needs only the name, and tidies spaces', () => {
    const r = suggestionInput.parse({ businessName: '  Sweet   Treats ', website: '', contact: '' });
    expect(r).toEqual({ businessName: 'Sweet Treats', website: null, contact: null, category: null, q: null });
  });
  it('refuses a missing or overlong name', () => {
    expect(suggestionInput.safeParse({ businessName: '   ' }).success).toBe(false);
    expect(suggestionInput.safeParse({ businessName: 'x'.repeat(201) }).success).toBe(false);
  });
  it('keeps where the person was browsing, but only a plain category name', () => {
    expect(suggestionInput.parse({ businessName: 'A', category: 'custom-cakes', q: 'cakes' })).toMatchObject({ category: 'custom-cakes', q: 'cakes' });
    expect(suggestionInput.parse({ businessName: 'A', category: "x' or 1=1" }).category).toBeNull();
  });
});

describe('the team’s email about a suggestion', () => {
  it('has the details, a link to the admin list, and the privacy reminder', () => {
    const e = teamEmail(
      { id: 'abc', businessName: 'Sweet Treats', website: 'sweet.example', contact: '705 555 0100', category: 'sweets', q: null, categoryName: 'Sweets' },
      'https://localites.example',
    );
    expect(e.subject).toBe('Suggested business: Sweet Treats');
    expect(e.text).toContain('Website or social page: sweet.example');
    expect(e.text).toContain('Phone or email: 705 555 0100');
    expect(e.text).toContain('They were looking at: Sweets');
    expect(e.text).toContain('https://localites.example/admin/suggestions#s-abc');
    expect(e.text).toContain('never publish it');
  });
});

describe('sending email', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('waits honestly when email isn’t set up', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await sendEmail({}, { to: TEAM_ADDRESS, subject: 's', text: 't' })).toEqual({ sent: false, reason: expect.stringContaining('PO-12') });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends from Localites to the team through Resend', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"id":"1"}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    expect(await sendEmail({ RESEND_API_KEY: 're_test' }, { to: TEAM_ADDRESS, subject: 's', text: 't' })).toEqual({ sent: true });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer re_test');
    expect(JSON.parse(init.body)).toEqual({ from: FROM_ADDRESS, to: [TEAM_ADDRESS], subject: 's', text: 't' });
  });

  it('reports a failure without the key or the email’s content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"name":"validation_error"}', { status: 422 })));
    const r = await sendEmail({ RESEND_API_KEY: 're_secret' }, { to: TEAM_ADDRESS, subject: 'private subject', text: 'private' });
    expect(r.sent).toBe(false);
    const reason = (r as { reason: string }).reason;
    expect(reason).toContain('422');
    expect(reason).not.toMatch(/re_secret|private/);
  });

  it('passes on the email service’s own explanation, without anything that looks like a key', async () => {
    const answer = { name: 'validation_error', message: 'The localites.ca domain is not verified.\nKey re_abc123 was used.' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(answer), { status: 403 })));
    const r = await sendEmail({ RESEND_API_KEY: 're_abc123' }, { to: TEAM_ADDRESS, subject: 's', text: 't' });
    expect(r).toEqual({
      sent: false,
      reason: 'The email service answered 403 (validation_error): The localites.ca domain is not verified. Key [key] was used.',
    });
  });

  it('never throws when the service can’t be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down re_secret')));
    const r = await sendEmail({ RESEND_API_KEY: 're_secret' }, { to: TEAM_ADDRESS, subject: 's', text: 't' });
    expect(r).toEqual({ sent: false, reason: 'The email service couldn’t be reached.' });
  });
});
