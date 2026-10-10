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

React Router 8 (TypeScript) on Cloudflare Workers via Cloudflare's Vite plugin,
PostgreSQL (Supabase) through Cloudflare Hyperdrive, Drizzle, SQL migrations in
`db/migrations`. Decisions: [docs/C](./docs/C-architecture-decision-log.md).
Look and feel: [docs/design-system.md](./docs/design-system.md); every colour, font and
size lives in `src/styles/tokens.css`. Pages are in `src/app/routes`, the Worker entry
is `workers/app.ts`, and database code lives in `*.server.ts` files, which never reach
the browser.

```bash
npm ci
cp .env.example .env                  # local database only; never commit real values
npm run db:migrate                    # needs DATABASE_ADMIN_URL in the environment
npm run db:seed:test                  # fake "Test Vendor" listings, test/dev databases only
npm run dev                           # runs inside Cloudflare's own runtime (workerd)

npm run check                         # lint, types, design tokens, wording
npm test                              # unit tests
npm run test:db                       # every migration + database rule, on a throwaway DB
npm run test:e2e                      # admin access, against a local sign-in server (scripts/e2e)
npm run build && npm run size         # Cloudflare build and size budget
npm run preview                       # the built Worker, locally
```

`TEST_DATABASE_ADMIN_URL` must point at a disposable PostgreSQL 16 + PostGIS server.
Cloudflare builds and publishes each push to the working branch itself (build command
`npm run build`, deploy command `npx wrangler deploy`). Never put secrets in git;
production secrets live only in Cloudflare and Supabase.
