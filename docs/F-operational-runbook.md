# F — Operational Runbook

**Status:** Proposed (Stage 0). No production environment exists yet.
**Last updated:** 2026-10-10 (sign-in codes and claims)

How the application is deployed, monitored, backed up, restored, and recovered — and
who is responsible for each part. Procedures marked *(to be verified)* will be tested
and confirmed before launch; this document will then record when.

---

## 1. Environments

| Environment | What it's for | Data | Who can see it |
|---|---|---|---|
| **Local / session** | Development and automated tests | Throwaway test data, created and destroyed by tests | Engineering |
| **Preview** | Every proposed change gets its own link, for review | The test copy of the database, with clearly fake data only | You and engineering. The links are hard to guess, and because previews only ever hold fake data, nothing real is exposed if one is shared. |
| **Production** | The real site | Real data | Public pages: everyone. Everything else: per [E](./E-security-and-privacy-model.md). |

Production and staging are **separate Supabase projects** with separate credentials,
both on Supabase's free plan (which allows two). A mistake in staging cannot touch
production data. Staging may pause when idle, which is fine for review.

**Running costs: none** (D-20). Hosting is Cloudflare's free plan, database Supabase's
free plan, email Resend's free plan. See [cost-model.md](./cost-model.md).

**Test data rule:** staging and test data is always obviously fake ("Test Vendor 14",
"example.com" addresses). Real business names are never used as test data, so a
screenshot of staging can't be mistaken for a real listing.

## 2. Responsibilities

| Area | Engineering | Product owner |
|---|---|---|
| Writing, testing, and reviewing code | ✅ | — |
| Database migrations | ✅ | — |
| Approving releases to production | Recommends | ✅ Approves (until you delegate this) |
| Owning root accounts (Cloudflare, Supabase, domain, email) | Invited member | ✅ Owner |
| Paying for services | — | ✅ Domain only (~CA$15–25/year) |
| Receiving alerts | ✅ | ✅ (plain-English summary) |
| Responding to incidents | Per D-11 | Per D-11 |
| Monthly restore test | ✅ | Receives confirmation |
| Approving any destructive production change | Proposes, with recovery plan | ✅ Approves |

## 3. How a change reaches production

1. Work happens on a branch. Every push runs the automated checks: type checking,
   linting, unit tests, permission tests, and migration tests against a real
   PostgreSQL database.
2. Cloudflare builds a **preview** from the branch. You get a link.
3. A pull request is opened describing the change in plain English, the migrations it
   includes, and the test results.
4. You (or a delegate) review the preview and approve.
5. On merge to `main`:
   1. Database migrations run first, automatically, against production (via GitHub
      Actions, using a secret held in GitHub's encrypted settings).
   2. Only if migrations succeed does Cloudflare deploy the new application.
6. A post-deploy smoke test loads the home page, a vendor profile, and search. Failure
   alerts engineering and you.
7. The release is recorded in [G](./G-release-and-migration-history.md).

## 4. Database migration rules

Migrations are the main way a release can damage data. These rules exist to make that
very unlikely, and recoverable when it happens.

1. **Every schema change is a numbered SQL file in git.** No changes are made by hand
   in the database console. Ever.
2. **Expand, then contract.** Changes that remove or rename anything are done in two
   releases: first add the new thing and keep the old one working; later, once nothing
   uses the old thing, remove it. This means the previous version of the application
   can always run against the current database, so rolling back the application is
   always safe.
3. **Every migration is tested** against a copy of the current schema before it runs
   in production.
4. **Destructive migrations** (dropping a column or table, deleting rows) require: a
   fresh backup taken immediately before, a written recovery plan in the pull request,
   and your explicit approval.
5. **Large data changes** are done in batches, not one giant transaction that locks
   the site.
6. **Applied migrations are never edited.** `npm run db:migrate` records a checksum of
   each file it applies and refuses to run if an applied file has changed.

### How migrations are applied

- Files live in `db/migrations/` (`0001_stage1_foundation.sql`, `0002_…`). Each runs in
  its own transaction, in order.
- **Tested first, every time:** `npm run test:db` builds a throwaway database, applies
  every migration and runs every check in `db/tests/` (GitHub runs this on every push).
- **Applied to Supabase** with `npm run db:migrate`, using the database's admin
  connection string held in an encrypted secret (a GitHub or Cloudflare secret the
  product owner pastes in), never written in git or chat.
- **Test project:** after every push whose checks pass, GitHub's "Update the test
  database" job migrates `localites-test` and reloads the fake test businesses, using
  the secret `SUPABASE_TEST_ADMIN_URL`. The loader refuses to run on any database that
  holds a real listing.
- **Production** will have its own manual step, with the product owner's approval and
  a fresh backup first (rule 4), set up before launch.
- Hosted databases are always reached over an encrypted (TLS) connection.

### Is the site connected to its database?

Open `/api/health` on the site (for example `https://<site>.workers.dev/api/health`). It
answers in plain words: `"database":"ok"` with the number of published listings, or the
kind of problem (not configured, address unreadable, login refused, encryption failed,
cannot reach) and what to do. It never shows the address or password. Uptime checks
(§8) use the same page.

**On Cloudflare**, the app connects through **Hyperdrive** (Cloudflare's free database
connector: it keeps the encrypted connection to Supabase and pools connections). Test
project: configuration `localites-test-db`, ID `4e3e6b64b1cb4015a679dd85ad7a8daa`
(bound as `HYPERDRIVE` in `wrangler.jsonc`), Supabase **Session pooler** (port 5432),
user `app_server`, SSL mode **Require**, caching **off**. The `DATABASE_URL` secret is
only a fallback. To change the database password: set it in Supabase (step C), then edit
the Hyperdrive configuration's password in Cloudflare.

**Why Hyperdrive (10 October 2026):** direct connections from Cloudflare to Supabase's
pooler were cut off right after the encrypted handshake (logs: `unhandledRejection … read`).
Hyperdrive is Cloudflare's supported route to external Postgres, included in the free
plan.

### The app's own database login (ADR-004)

Migration 0001 creates the restricted role `app_server` **without** a password. The
only console step, because passwords never go in git: once per database, the product
owner sets its password in Supabase's SQL editor with
`alter role app_server login password '<a new letters-and-numbers password>';`, then pastes
the matching connection string into Cloudflare's encrypted secret `DATABASE_URL`. We
guide this live (PO-03 part 3). Changing the password later is the same two steps.

### Team sign-in and admins (D-28)

- **How sign-in works.** The site calls Supabase Auth from the server only (the browser
  never talks to Supabase). The session lives in two cookies page scripts can't read.
  Admin pages pass a gate on every request: a valid Supabase session (checked with
  Supabase, so signing out works at once), a password sign-in within 12 hours, an
  active row in `platform_role`, and the two-step code for this session. Settings:
  Cloudflare secrets `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (PO-10).
- **First admin:** `select grant_first_admin('<email>');` in Supabase's SQL editor
  (migration 0003). It refuses once any admin exists.
- **Add another admin** (until the Users & roles page, X10, exists): create their account
  as in PO-10 B, have them sign in once, then in the SQL editor:
  `insert into platform_role (user_id, role, granted_by) select n.id, 'admin', g.id from app_user n, app_user g where n.email = '<new>' and g.email = '<you>';`
  and record it: `insert into audit_log (actor_user_id, action, subject_type, subject_id, reason) select g.id, 'platform_role.grant', 'app_user', n.id, '<why>' from app_user n, app_user g where n.email = '<new>' and g.email = '<you>';`
- **Remove an admin:** `update platform_role set revoked_at = now() where role = 'admin' and revoked_at is null and user_id = (select id from app_user where email = '<email>');`
  (plus an audit_log row as above, action `platform_role.revoke`). Takes effect on their
  next click.
- **Lost phone (authenticator):** in the SQL editor, `delete from auth.mfa_factors where user_id = (select id from auth.users where email = '<email>');`
  Their next sign-in shows a new square code to scan.
- **Forgotten team password:** the public has no passwords (D-32); for a team account,
  set a new one in the SQL editor:
  `update auth.users set encrypted_password = extensions.crypt('<new password>', extensions.gen_salt('bf')) where email = '<email>';`
  then delete that query from the editor's list, as in PO-03 C.
- **Known limit:** Supabase limits sign-in attempts per internet address, and every
  request comes from Cloudflare's servers, so its limits apply to the whole site at once.
  Our own limits apply per visitor (ADR-028). Revisit if people report "Too many tries
  from here" when only a few are signing in.

### Sign-in codes and claims (D-32 to D-35, ADR-028)

- **Settings:** Supabase sends the codes through Resend (PO-13): custom SMTP, both email
  templates from `emails/sign-in-code.html`, sign-ups on, "Confirm email" on, codes of 6
  digits lasting 900 seconds. If codes stop arriving, check Resend's **Emails** log first,
  then Supabase **Authentication** → **Emails** → **SMTP Settings**.
- **"We've sent a lot of sign-in codes today":** our daily cap of 60 codes was reached. It
  clears itself within a day. If it happens often, the cap (`CODES_PER_DAY` in
  `src/server/auth/code-limits.server.ts`) can rise towards Resend's free 100 a day.
- **Checking a claim (D-33):** on **Claims**, if it says the email matches the business's
  own website, you can approve. Otherwise contact the business at the phone number or
  email **it publishes itself** (shown on the claim), never the details the claimant gave,
  then approve or decline with a reason (the reason is emailed to them). You can't approve
  your own claim; another team member must.
- **Claim emails:** each one to a claimant is recorded in `notification` as `sent` or
  `failed` (with the reason); the Claims page shows the "received" email's status. A failed
  email can be followed up by hand from supportlocalites@gmail.com.
- **Wrong owner approved:** removing an owner isn't on the admin page yet (it comes with
  owner editing, D-34). Ask the developer: it's a recorded change (end the
  `vendor_member` row, set the listing back to `unclaimed`, with `status_change` and
  `audit_log` rows), never a deletion.

## 5. Backups

| Layer | What | Frequency | Retention | Source |
|---|---|---|---|---|
| **Our own backup (the one we rely on)** | Full database export (`pg_dump`), encrypted | Nightly, automatic | 30 days | Stored outside Supabase on free storage, so a provider problem or account issue doesn't take the backups with it |
| Files | Vendor photos, conversation files | Weekly | 30 days | Copied to separate free storage |
| Provider backups | Full database | Whatever Supabase's free plan provides | — | Not relied on (sources disagree on what the free plan includes) |

**What this means in practice:** if the database were damaged, we could restore it to
last night's state. Anything written since (messages, edits) could be lost. Continuous
"restore to any second" recovery is a paid add-on and is not planned (D-20).

**Where the backups live:** a free storage location outside Supabase, chosen and set up
in Stage 1 week 1. While the database is small, our existing free accounts are enough.
If the backups outgrow free storage, we tell you before anything changes.

## 6. Restore procedure *(to be verified before launch)*

**Restore drill:** monthly, engineering restores the latest independent backup into a
scratch database, runs the integrity checks below, and records the result in
[G](./G-release-and-migration-history.md). **A backup that has never been restored is
not a backup.**

Integrity checks after any restore:
- Row counts for key tables are within expected range of the source.
- Every foreign key is valid (the database enforces this on load).
- A sample of 10 vendor profiles render correctly against the restored data.
- The most recent `audit_log` timestamp matches the backup time.

**Production restore** (only after an incident, with your approval):
1. Put the site in maintenance mode (a static "we'll be right back" page).
2. Restore into a **new** database, never over the existing one, so the damaged copy
   is still available for investigation.
3. Run integrity checks.
4. Point the application at the restored database.
5. Leave maintenance mode. Verify with the smoke test.
6. Write the incident up in [G](./G-release-and-migration-history.md), including what
   data, if any, was lost between the backup and the incident.

## 7. Rolling back a bad release

| Situation | Action | Time |
|---|---|---|
| Application bug, no data harm | Cloudflare → roll back to the previous version. Safe because of the expand-then-contract rule. | Minutes |
| Migration failed partway | Migrations run in a transaction; a failure rolls back automatically and the application is not deployed. | Automatic |
| Migration succeeded but damaged data | Restore procedure above, after your approval | Hours |

## 8. Monitoring

**Every alert and every email meant for the Localites team goes to
supportlocalites@gmail.com** (D-11), including inquiries (D-04). It's also the admin
address on every service account (Supabase, Cloudflare, Resend, Sentry, backups).

| What | How | Who's told |
|---|---|---|
| Application errors | Sentry (free tier). Personal data scrubbed before sending. | Engineering; daily digest to you if anything new |
| Site down | A scheduled check every few minutes (free, on Cloudflare) loads the home page and one vendor page and queries the database | Engineering and you, immediately, by email |
| Slow pages | Cloudflare's free built-in analytics (no cookies, no tracking) | Weekly review by engineering |
| Free-plan limits | Database size, file storage, data transfer, emails per day, requests per day | Engineering weekly; **you at 80% of any limit**, with options |
| Database health | Supabase dashboard: storage used, connections, slow queries | Weekly review by engineering |
| Email delivery | Failed and queued counts in the `notification` log; provider's daily-limit warnings | Engineering daily; you if consumers or vendors are missing message notices |
| Reports | New items in the reports queue (messages, conversations, listings, reviews) | Platform team (you, initially), daily |
| Costs | Confirm every account is still on its free plan with no payment method needed | Monthly one-line confirmation to you |
| Unusual admin activity | Weekly `audit_log` review | Engineering, flagged to you |

## 9. Dependency management

- Dependencies (third-party code libraries) are pinned to exact versions, so a build
  today and a build in six months produce the same result.
- Automated tooling proposes updates weekly. Security updates are applied within a
  week; others are batched monthly.
- Adding any new dependency requires a reason in the pull request.

## 10. Incident communication

If something affects users, you get a message within an hour of engineering knowing,
covering: what is affected, whether any data is at risk, what's being done, and when
the next update will come. Afterwards, a short written review: what happened, why,
what we changed so it doesn't recur.
