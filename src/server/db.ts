import 'server-only';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/generated/schema';
import { normalizeDatabaseUrl, requiresTls } from '@/lib/db-url.mjs';

export type Db = PostgresJsDatabase<typeof schema>;

type Connection = { url: string; ssl: 'require' | false; via: 'hyperdrive' | 'database_url' };

/**
 * Where to connect. On Cloudflare, Hyperdrive (if bound) is preferred: it keeps the
 * encrypted connection to Supabase itself and pools connections. Otherwise the
 * DATABASE_URL secret is used, always encrypted to hosted databases.
 */
export function connection(): Connection {
  try {
    const env = getCloudflareContext().env as { HYPERDRIVE?: { connectionString: string } };
    if (env.HYPERDRIVE?.connectionString) {
      return { url: env.HYPERDRIVE.connectionString, ssl: false, via: 'hyperdrive' };
    }
  } catch {
    // Not running on Cloudflare (local development and tests).
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  const url = normalizeDatabaseUrl(process.env.DATABASE_URL);
  return { url, ssl: requiresTls(url) ? 'require' : false, via: 'database_url' };
}

/**
 * Runs `fn` with a database connection made for this request, then closes it.
 * Cloudflare Workers can't keep connections between requests. The app connects as
 * the restricted app_server role (ADR-004).
 */
export async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const { url, ssl } = connection();
  const client = postgres(url, {
    max: 1,
    prepare: false, // required by Supabase's transaction pooler
    fetch_types: false,
    connect_timeout: 10,
    idle_timeout: 5,
    ssl,
  });
  try {
    return await fn(drizzle(client, { schema }));
  } finally {
    await client.end({ timeout: 1 });
  }
}
