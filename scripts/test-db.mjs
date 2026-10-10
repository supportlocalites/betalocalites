// Database checks. Creates a fresh, throwaway database, applies every migration,
// runs each db/tests/*.test.sql file, prints the results, then drops the database.
// Also re-runs the Stage 2-3 proposal's checks on top of the real migrations, so
// the next stage's design stays compatible with what's built.
//
// Usage: TEST_DATABASE_ADMIN_URL=postgres://postgres@localhost:5432/postgres npm run test:db
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { migrate } from './migrate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
if (!adminUrl) {
  console.error('Set TEST_DATABASE_ADMIN_URL to a Postgres superuser connection for a test server.');
  process.exit(1);
}

const dbName = `localites_test_${randomBytes(4).toString('hex')}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

async function runChecks(file, label) {
  const notices = [];
  const sql = postgres(testUrl, {
    max: 1,
    onnotice: (n) => notices.push(n.message),
    connection: { search_path: 'public, extensions' },
  });
  try {
    await sql.unsafe(await readFile(file, 'utf8'));
  } catch (err) {
    for (const n of notices) console.log(`  ${n}`);
    throw new Error(`${label}: ${err.message}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
  const passes = notices.filter((n) => n.startsWith('PASS'));
  for (const n of passes) console.log(`  ${n}`);
  console.log(`${label}: ${passes.length} of ${passes.length} checks passed\n`);
  return passes.length;
}

let failed = false;
try {
  await admin.unsafe(`create database ${dbName}`);
  await migrate(testUrl, { log: (m) => console.log(m) });
  console.log('');

  const testsDir = path.join(root, 'db', 'tests');
  for (const f of (await readdir(testsDir)).filter((f) => f.endsWith('.test.sql')).sort()) {
    await runChecks(path.join(testsDir, f), f);
  }

  // The Stage 2-3 proposal, applied on top of the real migrations (then discarded).
  const proposal = postgres(testUrl, { max: 1, onnotice: () => {}, connection: { search_path: 'public, extensions' } });
  try {
    await proposal.unsafe(await readFile(path.join(root, 'docs', 'schema', 'stage2-3-proposed.sql'), 'utf8'));
  } finally {
    await proposal.end({ timeout: 5 });
  }
  await runChecks(path.join(root, 'docs', 'schema', 'stage2-3-proposed.test.sql'), 'stage2-3-proposed.test.sql (proposal)');
} catch (err) {
  failed = true;
  console.error(`FAILED: ${err.message}`);
} finally {
  await admin.unsafe(`drop database if exists ${dbName} with (force)`).catch(() => {});
  await admin.end({ timeout: 5 });
}
process.exit(failed ? 1 : 0);
