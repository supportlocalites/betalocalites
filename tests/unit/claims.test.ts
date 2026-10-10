import { describe, expect, it } from 'vitest';
import { authErrorFrom } from '@/server/auth/gotrue.server';
import { CODE_FAILED, explainCodeError } from '@/server/auth/messages.server';
import { claimInput, codeInput, emailInput, nameInput } from '@/server/member-input';
import { isUniqueViolation } from '@/server/db.server';
import { renderEmail } from '@/server/email-templates.server';

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
    for (const bad of ['', '   ', 'x'.repeat(81), 'Visit https://evil.example', 'www.evil.example', 'jane@evil.example', '<b>Jane</b>']) {
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
