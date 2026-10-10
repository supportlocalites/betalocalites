// Drizzle reads the database to generate TypeScript types (`npx drizzle-kit pull`).
// The SQL files in db/migrations are the only source of truth for the structure;
// src/db/schema.ts is generated from a database they were applied to, never edited by hand.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  out: './src/db/generated',
  schemaFilter: ['public'],
  tablesFilter: ['!schema_migrations', '!spatial_ref_sys'],
  dbCredentials: { url: process.env.DATABASE_ADMIN_URL ?? '' },
});
