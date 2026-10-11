import { describe, expect, it } from 'vitest';
import { authErrorFrom } from '@/server/auth/gotrue.server';
import { CODE_FAILED, explainCodeError } from '@/server/auth/messages.server';
import { claimInput, codeInput, emailInput, isEmptyProfile, nameInput, profileInput } from '@/server/member-input';
import { isUniqueViolation } from '@/server/db.server';
import { renderEmail } from '@/server/email-templates.server';
import { addressKey } from '@/server/visitor.server';

const response = (status: number, headers: Record<string, string> = {}) => ({ status, headers: new Headers(headers) });

describe('Supabase error codes (never read from message text)', () => {
  it('reads the versioned API’s code, the older shapes, and the header', () => {
    expect(authErrorFrom(response(403), { code: 'otp_expired', message: 'Token has expired or is invalid' }).code).toBe('otp_expired');
    expect(authErrorFrom(response(400), { code: 400, error_code: 'validation_failed', msg: 'x' }).code).toBe('validation_failed');
    expect(authErrorFrom(response(400), { error: 'invalid_grant' }).code).toBe('invalid_grant');
    expect(authErrorFrom(response(429, { 'X-Sb-Error-Code': 'over_email_send_rate_limit' }), null).code).toBe('over_email_send_rate_limit');
    expect(authErrorFrom(response(429), null).code).toBe('over_request_rate_limit');
    expect(authErrorFrom(response(500), null).code).toBe('unknown');
  });

  it('gives one answer for a wrong, expired or unusable code', () => {
    expect(explainCodeError(authErrorFrom(response(403), { code: 'otp_expired' }))).toBe(CODE_FAILED);
  });
});

describe('what people type to join and claim', () => {
  it('accepts a plain name and refuses addresses and markup', () => {
    expect(nameInput.parse('  Jane   Smith ')).toBe('Jane Smith');
    for (const ok of ['J.R. Smith', 'Mary-Jane O’Neil', 'St. Clair Catering', 'Dr. Ann Lee']) expect(nameInput.parse(ok)).toBe(ok);
    for (const bad of ['', '   ', 'x'.repeat(81), 'Visit https://evil.example', 'www.evil.example', 'jane@evil.example', '<b>Jane</b>', 'Jane evil-site.com/login', 'bit.ly/x']) {
      expect(nameInput.safeParse(bad).success).toBe(false);
    }
  });

  it('normalises email addresses and codes', () => {
    expect(emailInput.parse(' Jane@Example.CA ')).toBe('jane@example.ca');
    expect(emailInput.safeParse('not-an-address').success).toBe(false);
    expect(codeInput.parse('123 456')).toBe('123456');
    expect(codeInput.safeParse('12345').success).toBe(false);
    expect(codeInput.safeParse('12345a').success).toBe(false);
  });

  it('needs a connection to the business and the person’s confirmation', () => {
    expect(claimInput.parse({ relationship: 'owner', note: '  ', authorised: 'yes' })).toEqual({ relationship: 'owner', note: null, authorised: 'yes' });
    expect(claimInput.safeParse({ relationship: 'boss', authorised: 'yes' }).success).toBe(false);
    expect(claimInput.safeParse({ relationship: 'owner' }).success).toBe(false);
    expect(claimInput.safeParse({ relationship: 'owner', authorised: 'yes', note: 'x'.repeat(1001) }).success).toBe(false);
  });
});

describe('claim emails', () => {
  it('fill in the template and keep typed values on one line', () => {
    const email = renderEmail('declined', { name: 'Jane', business: 'Sweet\r\nBcc: x@evil.example', reason: 'Not the owner.' });
    expect(email.subject).toBe('About your claim for Sweet Bcc: x@evil.example');
    expect(email.text).toContain('Hi Jane,');
    expect(email.text).toContain('Our reason: Not the owner.');
    expect(email.text).not.toMatch(/\{\{/);
  });

  it('never leave a placeholder showing', () => {
    for (const name of ['approved', 'declined', 'received', 'team'] as const) {
      expect(renderEmail(name, {}).text).not.toMatch(/\{\{/);
    }
  });
});

describe('duplicate detection', () => {
  it('finds Postgres’s unique-violation code however it is wrapped', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation(new Error('wrapped', { cause: { code: '23505' } }))).toBe(true);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe('rate-limit keys', () => {
  const key = (ip?: string) => addressKey(new Request('https://l.test/', { headers: ip ? { 'CF-Connecting-IP': ip } : {} }));
  it('keep IPv4 addresses whole', () => {
    expect(key('203.0.113.7')).toBe('203.0.113.7');
    expect(key()).toBe('local');
  });
  it('count an IPv6 address by its /64 block, however it is written', () => {
    expect(key('2001:db8:85a3:12:8a2e:370:7334:1')).toBe('2001:db8:85a3:12::/64');
    expect(key('2001:0DB8:85a3:0012::1')).toBe('2001:db8:85a3:12::/64');
    expect(key('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(key('2001:db8::ffff:1')).toBe(key('2001:db8::2'));
  });
});

describe('personal details (D-36): none required, tidied, nothing kept when blank', () => {
  const blank = { gender: '', genderOther: '', dateOfBirth: '', streetAddress: '', unit: '', town: '', province: 'ON', postalCode: '' };
  it('keeps nothing when every box is left as it starts', () => {
    const p = profileInput.parse(blank);
    expect(isEmptyProfile(p)).toBe(true);
    expect(p.province).toBeNull();
  });
  it('tidies what was typed', () => {
    const p = profileInput.parse({ ...blank, gender: 'woman', dateOfBirth: '1988-04-12', streetAddress: ' 1  Example  St ', town: 'Orillia', postalCode: 'l3v1a1' });
    expect(p).toEqual({
      gender: 'woman',
      genderSelfDescribed: null,
      dateOfBirth: '1988-04-12',
      streetAddress: '1 Example St',
      unit: null,
      town: 'Orillia',
      province: 'ON',
      postalCode: 'L3V 1A1',
    });
  });
  it('keeps their own words only when they chose to describe it themselves', () => {
    expect(profileInput.parse({ ...blank, gender: 'self_described', genderOther: 'Two-spirit' })).toMatchObject({ gender: 'self_described', genderSelfDescribed: 'Two-spirit' });
    expect(profileInput.parse({ ...blank, gender: 'self_described', genderOther: '' }).gender).toBeNull();
    expect(profileInput.parse({ ...blank, gender: 'man', genderOther: 'ignored' }).genderSelfDescribed).toBeNull();
  });
  it('ignores choices that aren’t on the list', () => {
    expect(profileInput.parse({ ...blank, gender: 'toString', province: 'constructor', town: 'Orillia' })).toMatchObject({ gender: null, province: 'ON' });
  });
  it('refuses impossible dates and malformed postal codes', () => {
    for (const dateOfBirth of ['1988-02-30', '1899-12-31', '2999-01-01', '12/04/1988']) {
      expect(profileInput.safeParse({ ...blank, dateOfBirth }).success).toBe(false);
    }
    for (const postalCode of ['L3V', '12345', 'LLL 111']) expect(profileInput.safeParse({ ...blank, postalCode }).success).toBe(false);
  });
});
