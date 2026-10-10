/**
 * Sent with every page and API answer (workers/app.ts). Static files get the same list
 * from public/_headers; a unit test keeps the two in step.
 */
export const securityHeaders: ReadonlyArray<readonly [string, string]> = [
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['X-Frame-Options', 'DENY'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
  ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains'],
];

export function withSecurityHeaders(response: Response): Response {
  const secured = new Response(response.body, response);
  for (const [name, value] of securityHeaders) secured.headers.set(name, value);
  return secured;
}
