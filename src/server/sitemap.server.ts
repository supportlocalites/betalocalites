import { sql } from 'drizzle-orm';
import { withDb } from './db.server';
import type { ServerEnv } from './env';

/** Public pages for search engines; business pages are added from the database. */
const PAGES = ['/', '/explore', '/how-it-works', '/for-businesses', '/help', '/suggest'];

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The site map (product owner, 18 October 2026): the public pages and every listed business's
 * page, with when it last changed, so search engines find them. Nothing private is ever listed.
 */
export async function sitemapXml(env: ServerEnv, origin: string): Promise<string> {
  const vendors = await withDb(env, (db) =>
    db.execute<{ slug: string; changed: string }>(sql`
      select slug::text as slug, to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD') as changed
      from vendor where listing_status = 'published' order by slug limit 5000`),
  );
  const urls = [
    ...PAGES.map((p) => `<url><loc>${escape(origin + p)}</loc></url>`),
    ...vendors.map((v) => `<url><loc>${escape(`${origin}/vendors/${v.slug}`)}</loc><lastmod>${v.changed}</lastmod></url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}
