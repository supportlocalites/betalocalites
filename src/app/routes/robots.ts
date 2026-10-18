import type { Route } from './+types/robots';

/**
 * /robots.txt: keeps search engines out of invitations and private pages, and points them to the
 * site map. Written per request because the site map needs the site's full address.
 */
export function loader({ request }: Route.LoaderArgs) {
  const origin = new URL(request.url).origin;
  const text = [
    'User-agent: *',
    'Disallow: /i/',
    'Disallow: /invite',
    'Disallow: /g/',
    'Disallow: /group-invite',
    'Disallow: /admin',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}
