# G — Release & Migration History

Every release and every database migration, in order. Appended before each deploy.

---

## Template

```
### Release YYYY-MM-DD — <short name>
**Stage:** <n>
**What changed (plain English):**
**Migrations applied:** <files, or "none">
**Destructive?** yes/no — if yes, link to approval and recovery plan
**Tests run:** <suite: passed/failed counts>
**Security tests:** <cross-account / cross-event / invitation: passed/failed>
**Existing functionality affected:** <none / what>
**How to roll back:**
**Approved by:**
```

---

## Restore drills

| Date | Backup restored | Integrity checks | Result |
|---|---|---|---|
| — | — | — | No production environment yet |

---

## Releases

### 2026-10-10 — Stage 0 documentation, revision 4: renamed to Localites

**Stage:** 0
**What changed (plain English):** The product owner renamed the product from its working
name, Tallo, to **Localites** (D-01, name part). Every document now says Localites, as do
the proposed schemas (comments and two error messages), the blueprint page and the design
mockups. Example web addresses now read `localites.ca`; the web address itself is still
to be chosen (D-01), after checking the domain is free and the name is clear to use. The
GitHub repository keeps its current name, `Tallo`; that name isn't shown to anyone using
the product.
**Documents:** README, A–H, roles and relationships, roadmap, screen inventory, cost
model, API and testing strategies, both proposed schemas and their checks.
**Migrations applied:** None. Text only; no tables, columns or rules changed.
**Destructive?** No.
**Tests run:** Both proposed schemas re-applied to a scratch database and checked:
Stage 1, 29 of 29 passed; Stage 2–3, 53 of 53 passed.
**Approved by:** Product owner (the name), 10 October 2026.

### 2026-10-09 — Stage 0 documentation, revision 3: no running costs

**Stage:** 0
**What changed (plain English):** The product owner directed that Localites should have no
running costs (D-20). Every service moves to a free plan: Supabase (database, sign-in,
files), Resend (email), Sentry (error alerts), free storage for nightly backups.
Hosting moves from Vercel to Cloudflare's free plan, because Vercel's free plan doesn't
allow business use. The only recommended cost is the web address (~CA$15–25/year), which
email requires (D-07). A one-day fit test in Stage 1 confirms the app fits Cloudflare's
free limits (ADR-005). The on-call recommendation changes to alerts by email to the
product owner (D-11).
**Documents:** cost-model rewritten; C (ADR-003, 005, 007, 013, 014), F, H, A, E,
roadmap, API strategy updated.
**Migrations applied:** None. Data model and schemas unchanged.
**Destructive?** No.
**Tests run:** None needed; no schema change.
**Approved by:** Pending (D-00).

### 2026-10-09 — Stage 0 documentation, revision 2: consumer–vendor handshake

**Stage:** 0
**What changed (plain English):** Reworked the plan around the product owner's
clarification. Two users (consumer and vendor) and the relationship between them are
now the centre. Localites is the digital handshake: direct messaging with file sharing.
No payments of any kind. "Add to event" and "Booked" are the consumer's own records,
and post-event feedback becomes reviews. Removed quotes, vendor-confirmed bookings,
agreements, inquiries and the concierge relay. New stage order proposed: handshake
(2), reviews (3), RSVPs (4).
**Documents:** new [roles-and-relationships.md](./roles-and-relationships.md); A, B, C,
D, E, H, roadmap, screens, costs, API, testing rewritten or updated.
**Migrations applied:** None. New proposal
[schema/stage2-3-proposed.sql](./schema/stage2-3-proposed.sql); Stage 1 proposal
adjusted (removed inquiry preference and concierge role). Neither applied anywhere.
**Destructive?** No.
**Tests run:** Both proposed schemas applied to a scratch PostgreSQL 16.15 + PostGIS
database. Stage 1 checks: 29/29 passed. Consumer–vendor relationship checks
([schema/stage2-3-proposed.test.sql](./schema/stage2-3-proposed.test.sql)): 53/53
passed, each rejection confirmed to fail for the intended reason. Scratch database
discarded.
**Existing functionality affected:** None (no application code exists).
**Approved by:** Pending (D-00).

### 2026-10-09 — Stage 0 documentation

**Stage:** 0
**What changed:** Initial architecture and product documentation proposed for review.
**Migrations applied:** None. The Stage 1 schema in
[schema/stage1-proposed.sql](./schema/stage1-proposed.sql) is a proposal and has not
been applied to any database.
**Destructive?** No.
**Tests run:** Proposed schema applied to a scratch PostgreSQL 16.15 + PostGIS
database and checked with
[schema/stage1-proposed.test.sql](./schema/stage1-proposed.test.sql): 29/29 checks
passed (honest pricing, honest statuses, typed attributes, audit log append-only,
browser-facing roles read nothing). Scratch database discarded. No application code
exists yet.
**Existing functionality affected:** None.
**Approved by:** Pending (D-00).
