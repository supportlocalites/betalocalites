# Testing Strategy

**Status:** Proposed (Stage 0).
**Last updated:** 2026-10-09

## What "done" means

A feature is complete only when **all** of these are true. A finished-looking screen is
not a finished feature.

- [ ] It works end to end, with data saved to the real database schema
- [ ] Inputs are validated on the server, with clear error messages
- [ ] Permissions are enforced on the server, with tests that try to break them
- [ ] Loading, empty, error, and success states exist
- [ ] It works on a 360px-wide phone screen and with a keyboard
- [ ] Automated accessibility checks pass
- [ ] Acceptance tests for the stage pass
- [ ] Docs B, D, E, and G are updated

## Layers

| Layer | What it proves | Tool | Runs |
|---|---|---|---|
| **Database checks** | The database itself rejects dishonest or inconsistent data | SQL test scripts against real PostgreSQL | Every change |
| **Unit tests** | Individual rules: state machines, validation, pricing display, slug rules | Vitest | Every change |
| **Permission tests** | Every cell of the permission matrix in [E §4](./E-security-and-privacy-model.md#4-permission-matrix), including cross-account, cross-event, cross-vendor, role escalation | Vitest against a real PostgreSQL | Every change |
| **Integration tests** | Module functions work together with the real database | Vitest against a real PostgreSQL | Every change |
| **Migration tests** | Every migration applies cleanly to the current schema and to a copy of the previous release | Scripted | Every change touching migrations |
| **End-to-end tests** | Key journeys work in a real browser at phone size | Playwright | Every change |
| **Accessibility** | Automated checks on every page | axe-core in Playwright | Every change |
| **Restore drill** | Backups can actually be restored | Scripted | Monthly |
| **Manual review** | It feels right | You, via preview links | Every release |

**Real database, not mocks.** Permission and integration tests run against a real
PostgreSQL with the real schema. Mocked databases are where permission bugs hide.

**Test data** is obviously fake ("Test Vendor 3", `@example.com`) and created fresh
for each test run.

## Key end-to-end journeys

**Stage 1**
1. Visitor on a phone: home → category → filter by town → profile → tap "Visit website".
2. Visitor searches with a typo and finds the right vendor.
3. Admin creates a listing, publishes it, and finds it in public search.
4. Vendor signs up, claims a listing, admin approves, vendor edits, change goes to review.
5. Unclaimed listing → "Is this your business?" → removal request lands in admin queue.

**Stage 2**
6. Organizer creates an event, shortlists a vendor from search, invites three guests.
7. Guest opens link on a phone, RSVPs with a plus-one, changes their answer.
8. Host revokes a link; the guest sees "link no longer valid" and nothing else.

**Stage 3**
9. Organizer sends inquiry to an unclaimed vendor; concierge logs delivery and the
   vendor's reply; organizer sees each status change at the right moment and not before.

## Current results

| Suite | Result | Date |
|---|---|---|
| Proposed schema checks ([schema/stage1-proposed.test.sql](./schema/stage1-proposed.test.sql)) | **29 / 29 passed** on PostgreSQL 16.15 + PostGIS | 2026-10-09 |
| Everything else | Not yet applicable — no application code | — |
