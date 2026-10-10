# Localites

A local event platform connecting two users: **consumers** planning an event and the
local **vendors** who serve it. Consumers find vendors, talk to them directly, share
files, and keep track of who they've booked; after the event, their feedback becomes
reviews. Localites is the digital handshake and never handles payments. First market:
Orillia, Ontario.

**Current stage:** Stage 1 (approved 10 October 2026), in progress: foundations and the
hosting fit test.

**Start here:** [docs/README.md](./docs/README.md)

## For developers

Next.js 16 (TypeScript) on Cloudflare Workers via OpenNext, PostgreSQL (Supabase) via
Drizzle, SQL migrations in `db/migrations`. Decisions: [docs/C](./docs/C-architecture-decision-log.md).
Look and feel: [docs/design-system.md](./docs/design-system.md); every colour, font and
size lives in `src/styles/tokens.css`.

```bash
npm ci
cp .env.example .env.local            # local database only; never commit real values
npm run db:migrate                    # needs DATABASE_ADMIN_URL in the environment
npm run db:seed:test                  # fake "Test Vendor" listings, test/dev databases only
npm run dev

npm run check                         # lint, types, design tokens, wording
npm test                              # unit tests
npm run test:db                       # every migration + database rule, on a throwaway DB
npm run cf:build && npm run cf:size   # Cloudflare build and size budget
```

`TEST_DATABASE_ADMIN_URL` must point at a disposable PostgreSQL 16 + PostGIS server.
Never put secrets in git; production secrets live only in Cloudflare and Supabase.
