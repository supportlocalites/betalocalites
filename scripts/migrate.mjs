// Applies the numbered SQL files in db/migrations, in order, each in its own
// transaction. Records each file's checksum and refuses to run if an applied
// file has since been edited (applied migrations are never changed; add a new one).
//
// Usage: DATABASE_ADMIN_URL=postgres://... npm run db:migrate
// The admin connection string is set in the environment, never written to git.
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.join(here, '..', 'db', 'migrations');

/** Hosted databases are always reached over an encrypted connection. */
export const requiresTls = (url) => !/@(localhost|127\.0\.0\.1)[:/]/.test(url);

export async function migrate(url, { log = console.log } = {}) {
  const sql = postgres(url, { max: 1, onnotice: () => {}, ssl: requiresTls(url) ? 'require' : undefined });
  try {
    await sql`
      create table if not exists schema_migrations (
        filename    text primary key,
        checksum    text not null,
        applied_at  timestamptz not null default now()
      )`;
    const applied = new Map(
      (await sql`select filename, checksum from schema_migrations`).map((r) => [r.filename, r.checksum]),
    );
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
    let ran = 0;
    for (const file of files) {
      const body = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      const checksum = createHash('sha256').update(body).digest('hex');
      if (applied.has(file)) {
        if (applied.get(file) !== checksum) {
          throw new Error(`${file} was changed after it was applied. Add a new migration instead.`);
        }
        continue;
      }
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into schema_migrations (filename, checksum) values (${file}, ${checksum})`;
      });
      log(`applied ${file}`);
      ran++;
    }
    log(ran ? `${ran} migration(s) applied.` : 'Database is up to date.');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) {
    console.error('Set DATABASE_ADMIN_URL to the database admin connection string.');
    process.exit(1);
  }
  migrate(url).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
