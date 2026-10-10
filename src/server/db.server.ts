import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { normalizeDatabaseUrl, requiresTls } from '@/lib/db-url.mjs';
import type { ServerEnv } from './env';

export type Db = PostgresJsDatabase;

type Connection = { url: string; ssl: 'require' | false; via: 'hyperdrive' | 'database_url' };

/**
 * Where to connect. Hyperdrive (if bound) is preferred: it keeps the encrypted
 * connection to Supabase itself and pools connections. Otherwise the DATABASE_URL
 * secret is used, always encrypted to hosted databases.
 */
export function connection(env: ServerEnv): Connection {
  if (env.HYPERDRIVE?.connectionString) {
    return { url: env.HYPERDRIVE.connectionString, ssl: false, via: 'hyperdrive' };
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  const url = normalizeDatabaseUrl(env.DATABASE_URL);
  return { url, ssl: requiresTls(url) ? 'require' : false, via: 'database_url' };
}

/**
 * Runs `fn` with a database connection made for this request, then closes it.
 * Cloudflare Workers can't keep connections between requests. The app connects as
 * the restricted app_server role (ADR-004).
 */
export async function withDb<T>(env: ServerEnv, fn: (db: Db) => Promise<T>): Promise<T> {
  const { url, ssl } = connection(env);
  const client = postgres(url, {
    max: 1,
    prepare: false, // required by Supabase's transaction pooler
    fetch_types: false,
    connect_timeout: 10,
    idle_timeout: 5,
    ssl,
  });
  try {
    // No schema map: building one costs processing on every request, and queries name
    // their tables directly.
    return await fn(drizzle(client));
  } finally {
    await client.end({ timeout: 1 });
  }
}

/** True for "that would duplicate a unique value" (Postgres 23505), however the driver wraps it. */
export function isUniqueViolation(err: unknown): boolean {
  for (let e = err; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === '23505') return true;
  }
  return false;
}
