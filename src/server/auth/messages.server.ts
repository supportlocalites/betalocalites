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
