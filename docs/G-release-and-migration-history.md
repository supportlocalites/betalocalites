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
