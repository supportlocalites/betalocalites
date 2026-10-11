# Localites: standing notes for every session

Localites is a local event platform for Orillia, Ontario: consumers find local vendors and
contact them directly (the "digital handshake"). Start with [docs/README.md](docs/README.md);
decisions are in [docs/H-product-owner-action-register.md](docs/H-product-owner-action-register.md)
(D-numbers) and [docs/C-architecture-decision-log.md](docs/C-architecture-decision-log.md) (ADRs).

## The product owner
- Non-technical: explain in plain English, step by step, no jargon.
- Never ask for passwords, keys, codes or other secrets in chat or documents; give them a
  secure way to enter them (Cloudflare, Supabase or GitHub settings). They manage their own
  passwords; don't prescribe a password manager.

## Brand (D-31)
- The wordmark is "Localites" in Playfair Display 700 where **the dot of the "i" is a plain
  black map pin** (round window, no gloss). Always draw the name with `src/components/Wordmark.tsx`
  (Welcome page, header); the pin is also the tab icon (`public/favicon.svg`).
- Design direction G: every colour, font and size lives only in `src/styles/tokens.css`
  (`npm run check:tokens`). See [docs/design-system.md](docs/design-system.md).

## Rules that never bend
- No payments of any kind through Localites (D-16, D-24); no wording that implies them
  (`npm run check:words`).
- $0 running costs apart from the domain (D-20): free plans only; nothing with an ongoing cost
  without the owner's approval.
- Admin rights are enforced on the server, never by hiding buttons. Test
  cross-account and role-escalation attempts explicitly.
- No fake functionality or invented business information; say plainly what was and wasn't tested.
- No destructive production change without an approved migration and recovery plan; never edit
  an applied migration, add a new one.
- The repository is public: no secrets in code, logs or pages.

## Working
- Branch: `claude/event-discovery-architecture-dz0qgf`; Cloudflare builds and deploys it on push.
- Before pushing: `npm run check`, `npm test`, `npm run test:db` (needs TEST_DATABASE_ADMIN_URL),
  `npm run build && npm run size`; for sign-in, claims or admin changes also `npm run test:e2e`,
  against a local Supabase Auth server built by `scripts/e2e/build-auth-server.sh`, set up by
  `scripts/e2e/env.sh`, with the pretend email service `scripts/e2e/mail-server.mjs` (see the CI job).
- The public signs in at `/join` with emailed codes (ADR-028); the team at `/sign-in` with a
  password and an authenticator app. Pages needing an account live under
  `src/app/routes/member/` and pass `memberGate` (`src/server/auth/member.server.ts`).
- Owners edit at `/vendors/<slug>/edit` (ADR-029): ownership is checked in the database on
  every request; only changed fields are written; every save goes to `audit_log` plus
  `owner_change`. The business page is one component (`src/components/VendorPage.tsx`) used
  by the public page, the edit page and the preview.
- Admin pages live under `src/app/routes/admin/`; every request passes `adminGate`
  (`src/server/auth/admin.server.ts`). Every admin change writes `audit_log`.
- React Router 8 on Cloudflare Workers (free plan: 10 ms CPU per request). Database code lives in
  `*.server.ts`; the database is reached through Hyperdrive as the restricted `app_server` role.
