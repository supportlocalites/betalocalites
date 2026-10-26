/**
 * Sent with every page and API answer (workers/app.ts). Static files get the same list
 * from public/_headers; a unit test keeps the two in step.
 */
export const securityHeaders: ReadonlyArray<readonly [string, string]> = [
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['X-Frame-Options', 'DENY'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)'],
  ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains'],
];

/**
 * Forms that change something (sign in, edit a listing) are only accepted from
 * Localites' own pages. A browser always says which site a form came from; another
 * site trying to submit one on a signed-in person's behalf is refused here.
 */
export function refuseCrossSiteForm(request: Request): Response | null {
  if (request.method === 'GET' || request.method === 'HEAD') return null;
  const origin = request.headers.get('Origin');
  if (origin === null) return null; // not a browser form (and browsers then send no cookies cross-site: SameSite=Lax)
  if (origin === new URL(request.url).origin) return null;
  return new Response('This form can only be sent from Localites itself.', {
    status: 403,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export function withSecurityHeaders(response: Response): Response {
  const secured = new Response(response.body, response);
  for (const [name, value] of securityHeaders) secured.headers.set(name, value);
  return secured;
}
