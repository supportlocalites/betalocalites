import { AuthError } from './gotrue.server';

/** Plain-words messages for sign-in problems. Never repeats what the person typed. */
export function explainAuthError(err: unknown): string {
  if (!(err instanceof AuthError)) return 'Sign-in isn’t working right now. Please try again in a few minutes.';
  switch (err.code) {
    case 'invalid_credentials':
      return 'That email and password don’t match. Check them and try again.';
    case 'email_not_confirmed':
      return 'This email address hasn’t been confirmed yet.';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'Too many tries. Please wait a few minutes, then try again.';
    case 'mfa_verification_failed':
    case 'mfa_challenge_expired':
      return 'That code didn’t work. Codes change every 30 seconds; enter the newest one.';
    case 'user_banned':
      return 'This account has been switched off. Contact supportlocalites@gmail.com.';
    case 'not_configured':
      return 'Sign-in isn’t switched on for this site yet.';
    default:
      return 'Sign-in isn’t working right now. Please try again in a few minutes.';
  }
}

/** Codes that mean "nothing to tell this visitor": answered with the same neutral reply. */
export const NEUTRAL_SEND_CODES = new Set(['signup_disabled', 'otp_disabled', 'over_email_send_rate_limit']);

/**
 * One answer for every code that can't be used (wrong, expired, too many tries, or no
 * account), so the reply never says which.
 */
export const CODE_FAILED = 'That code didn’t work or has expired. Check it, or ask for a new one.';

/** Plain words for the emailed-code sign-in (D-32). Never says whether an address has an account. */
export function explainCodeError(err: unknown): string {
  if (!(err instanceof AuthError)) return 'We couldn’t sign you in just now. Please try again in a few minutes.';
  switch (err.code) {
    case 'otp_expired':
      return CODE_FAILED;
    case 'over_request_rate_limit':
      return 'Too many tries from here. Please wait a few minutes, then try again.';
    case 'validation_failed':
    case 'email_address_invalid':
      return 'Please check the email address.';
    case 'user_banned':
      return 'This account can’t sign in. Please contact supportlocalites@gmail.com.';
    case 'not_configured':
    case 'email_provider_disabled':
    case 'email_address_not_authorized':
      // The last: Supabase's own email service only sends to the team until PO-13 is done.
      return 'Signing in by email isn’t switched on for this site yet.';
    default:
      return 'We couldn’t send or check the code just now. Please try again in a few minutes.';
  }
}
