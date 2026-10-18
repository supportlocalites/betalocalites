import { cloudflareContext } from '@/app/context';
import { sitemapXml } from '@/server/sitemap.server';
import type { Route } from './+types/sitemap';

/** /sitemap.xml: the public pages and listed businesses, for search engines (sitemap.server.ts). */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  return new Response(await sitemapXml(env, new URL(request.url).origin), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
