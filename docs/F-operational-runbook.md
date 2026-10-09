# F — Operational Runbook

**Status:** Proposed (Stage 0). No production environment exists yet.
**Last updated:** 2026-10-09

How the application is deployed, monitored, backed up, restored, and recovered — and
who is responsible for each part. Procedures marked *(to be verified)* will be tested
and confirmed before launch; this document will then record when.

---

## 1. Environments

| Environment | What it's for | Data | Who can see it |
|---|---|---|---|
| **Local / session** | Development and automated tests | Throwaway test data, created and destroyed by tests | Engineering |
| **Preview** | Every proposed change gets its own link, for review | A shared staging database with clearly fake test data | You and engineering only (Vercel's built-in deployment protection requires viewers to be signed in as team members; viewer seats are free on Pro) |
| **Production** | The real site | Real data | Public pages: everyone. Everything else: per [E](./E-security-and-privacy-model.md). |

Production and staging are **separate Supabase projects** with separate credentials.
A mistake in staging cannot touch production data. Staging runs on Supabase's free tier
(it pauses when idle, which is fine for review), so it adds no monthly cost.

**Test data rule:** staging and test data is always obviously fake ("Test Vendor 14",
"example.com" addresses). Real business names are never used as test data, so a
screenshot of staging can't be mistaken for a real listing.

## 2. Responsibilities

| Area | Engineering | Product owner |
|---|---|---|
| Writing, testing, and reviewing code | ✅ | — |
| Database migrations | ✅ | — |
| Approving releases to production | Recommends | ✅ Approves (until you delegate this) |
| Owning root accounts (Vercel, Supabase, domain, email) | Invited member | ✅ Owner |
| Paying for services | — | ✅ |
| Receiving alerts | ✅ | ✅ (plain-English summary) |
| Responding to incidents | Per D-11 | Per D-11 |
| Monthly restore test | ✅ | Receives confirmation |
| Approving any destructive production change | Proposes, with recovery plan | ✅ Approves |

## 3. How a change reaches production

1. Work happens on a branch. Every push runs the automated checks: type checking,
   linting, unit tests, permission tests, and migration tests against a real
   PostgreSQL database.
2. Vercel builds a **preview** from the branch. You get a link.
3. A pull request is opened describing the change in plain English, the migrations it
   includes, and the test results.
4. You (or a delegate) review the preview and approve.
5. On merge to `main`:
   1. Database migrations run first, automatically, against production (via GitHub
      Actions, using a secret held in GitHub's encrypted settings).
   2. Only if migrations succeed does Vercel deploy the new application.
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

## 5. Backups

| Layer | What | Frequency | Retention | Source |
|---|---|---|---|---|
| Provider backups | Full database | Daily, automatic | Per plan (~7 days on Supabase Pro; confirm at signup) | Supabase |
| Point-in-time recovery | Restore to any second | Continuous | Per add-on | Supabase add-on, **not included initially**. Worth considering once consumers and vendors depend on conversations (Stage 2): a daily backup could lose up to a day of messages. Will be costed and brought to you for approval before Stage 2 launch. |
| Independent backup | Full database export (`pg_dump`), encrypted | Daily, scheduled job | 30 days | Stored outside Supabase, so a provider problem or account issue doesn't take the backups with it |
| File storage | Vendor images, documents | Daily sync | 30 days | Copied to separate storage |

**Why the independent backup:** provider backups protect against hardware failure. They
don't protect against losing access to the provider account, or a mistake that goes
unnoticed for longer than the provider's retention window. The independent backup's
storage location and cost will be proposed at Stage 1 (expected to be a few dollars a
month or less).

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
| Application bug, no data harm | Vercel → "Instant Rollback" to the previous deployment. Safe because of the expand-then-contract rule. | Minutes |
| Migration failed partway | Migrations run in a transaction; a failure rolls back automatically and the application is not deployed. | Automatic |
| Migration succeeded but damaged data | Restore procedure above, after your approval | Hours |

## 8. Monitoring

| What | How | Who's told |
|---|---|---|
| Application errors | Sentry (free tier). Personal data scrubbed before sending. | Engineering; daily digest to you if anything new |
| Site down | Uptime check every few minutes on the home page and one vendor page | Engineering and you, immediately |
| Slow pages | Vercel analytics on page load time | Weekly review by engineering |
| Database health | Supabase dashboard: storage used, connections, slow queries | Weekly review by engineering |
| Email delivery | Failed and queued counts in the `notification` log; provider's daily-limit warnings | Engineering daily; you if consumers or vendors are missing message notices |
| Reports | New items in the reports queue (messages, conversations, listings, reviews) | Platform team (you, initially), daily |
| Costs | Each provider's billing page; spending caps where available | Monthly summary to you |
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
