import 'server-only';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/generated/schema';

export type Db = PostgresJsDatabase<typeof schema>;

/**
 * Runs `fn` with a database connection made for this request, then closes it.
 * Cloudflare Workers can't keep connections between requests, so each request
 * opens one connection (through Supabase's pooler in production) and closes it.
 * The app connects as the restricted app_server role (ADR-004).
 */
export async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  const client = postgres(url, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 5 });
  try {
    return await fn(drizzle(client, { schema }));
  } finally {
    await client.end({ timeout: 1 });
  }
}
