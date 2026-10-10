import { sql } from 'drizzle-orm';
import { connection, withDb } from '@/server/db';

export const dynamic = 'force-dynamic';

/**
 * Plain-words health check for the team and for uptime monitoring (runbook §8).
 * Never returns the database address or password: only what kind of problem it is.
 */
function explain(err: unknown): { database: string; detail: string } {
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const text = `${e?.message ?? ''} ${e?.cause?.message ?? ''}`;
  // Drizzle wraps the database's own error; its code sits on the cause.
  const code = e?.cause?.code ?? e?.code;
  if (/tenant or user not found/i.test(text))
    return { database: 'login refused', detail: 'Supabase does not recognise the user name. It should be app_server. followed by the project code.' };
  if (code === '28P01')
    return { database: 'login refused', detail: 'Wrong password for app_server. It must match the one set in Supabase (step C).' };
  if (code === '28000')
    return { database: 'login refused', detail: 'app_server is not allowed to sign in yet. Run step C again.' };
  if (code === '42P01') return { database: 'tables missing', detail: 'The database has not been set up yet (step B).' };
  if (/network connection lost|tls|certificate|handshake/i.test(text))
    return { database: 'encryption failed', detail: 'The encrypted connection to Supabase was refused. Use Cloudflare Hyperdrive (see PO-03).' };
  if (/ENOTFOUND|EAI_AGAIN/.test(text) || code === 'ENOTFOUND')
    return { database: 'cannot reach', detail: 'The database server name in the address was not found.' };
  if (/CONNECT_TIMEOUT|ETIMEDOUT|ECONNREFUSED/.test(`${text} ${code ?? ''}`))
    return { database: 'cannot reach', detail: 'The database did not answer. Check the address is the Supabase pooler one.' };
  if (/DATABASE_URL is not set/.test(text))
    return { database: 'not configured', detail: 'The DATABASE_URL secret is not set in Cloudflare (step E).' };
  if (/database address/.test(text)) return { database: 'address unreadable', detail: String(e?.message) };
  return { database: 'error', detail: code ? `Database error code ${code}.` : 'Unexpected error; see the Cloudflare logs.' };
}

export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  let via = 'none';
  try {
    via = connection().via;
    const rows = await withDb((db) =>
      db.execute<{ n: number }>(sql`select count(*)::int as n from vendor where listing_status = 'published'`),
    );
    return Response.json({ website: 'ok', database: 'ok', via, publishedListings: rows[0]?.n ?? 0 }, { headers });
  } catch (err) {
    return Response.json({ website: 'ok', via, ...explain(err) }, { status: 503, headers });
  }
}
