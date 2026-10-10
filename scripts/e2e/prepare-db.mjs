// Prepares a throwaway database for the admin access tests: our migrations, the fake
// test businesses, a schema for the sign-in server, and a local-only app password.
// Usage: E2E_DATABASE_ADMIN_URL=postgres://postgres:...@localhost:5432/localites_e2e_test node scripts/e2e/prepare-db.mjs
import { execFileSync } from 'node:child_process';
import postgres from 'postgres';
import { migrate } from '../migrate.mjs';

const url = process.env.E2E_DATABASE_ADMIN_URL;
if (!url || !/@(localhost|127\.0\.0\.1)[:/]/.test(url) || !/test/.test(new URL(url).pathname)) {
  console.error('E2E_DATABASE_ADMIN_URL must be a local database whose name contains "test".');
  process.exit(1);
}
const server = new URL(url);
const name = server.pathname.slice(1);
server.pathname = '/postgres';
const admin = postgres(server.toString(), { max: 1, onnotice: () => {} });
await admin.unsafe(`drop database if exists ${name} with (force)`);
await admin.unsafe(`create database ${name}`);
await admin.end();

await migrate(url, { log: (m) => console.log(m) });
const sql = postgres(url, { max: 1, onnotice: () => {} });
await sql.unsafe(`create schema if not exists auth`);
await sql.unsafe(`alter role app_server login password '${process.env.E2E_APP_PASSWORD ?? 'e2e-local-only'}'`);
await sql.end();
execFileSync('node', ['scripts/seed-test-data.mjs'], { stdio: 'inherit', env: { ...process.env, DATABASE_ADMIN_URL: url } });
console.log('Test database ready.');
