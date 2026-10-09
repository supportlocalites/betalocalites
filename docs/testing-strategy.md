# Testing Strategy

**Status:** Proposed (Stage 0, revision 2).
**Last updated:** 2026-10-09

## What "done" means

A feature is complete only when **all** of these are true. A finished-looking screen is
not a finished feature.

- [ ] It works end to end, with data saved to the real database schema
- [ ] Inputs are validated on the server, with clear error messages
- [ ] Permissions are enforced on the server, **for the right side** (consumer or
      vendor), with tests that try to break them
- [ ] Loading, empty, error, and success states exist
- [ ] It works on a 360px-wide phone and with a keyboard
- [ ] Automated accessibility checks pass
- [ ] No wording implies Tallo handles money or confirms bookings ([A §6](./A-product-blueprint.md#6-language-rules))
- [ ] The stage's acceptance tests pass
- [ ] Docs B, D, E and G are updated

## Layers

| Layer | What it proves | Tool | Runs |
|---|---|---|---|
| **Database checks** | The database itself rejects dishonest or out-of-bounds data: fake prices, unverified badges, vendor-started conversations, outsiders posting, reviews without a real booking | SQL scripts against real PostgreSQL | Every change |
| **Unit tests** | Rules: state machines, validation, batching of email notices, language rules | Vitest | Every change |
| **Permission tests** | Every cell of [E §4](./E-security-and-privacy-model.md#4-permission-matrix): cross-account, cross-conversation, cross-vendor, side impersonation, role escalation | Vitest against real PostgreSQL | Every change |
| **Integration tests** | Modules work together with the real database | Vitest against real PostgreSQL | Every change |
| **Migration tests** | Each migration applies cleanly to the current and previous schema | Scripted | Changes touching migrations |
| **End-to-end tests** | Key journeys in a real browser at phone size | Playwright | Every change |
| **Language check** | Banned words don't appear in screens or email templates | Scripted | Every change |
| **Accessibility** | Automated checks on every page | axe-core in Playwright | Every change |
| **Restore drill** | Backups can actually be restored | Scripted | Monthly |
| **Manual review** | It feels right | You, via preview links | Every release |

**Real database, not mocks.** Permission and integration tests run against real
PostgreSQL. Mocked databases are where permission bugs hide.

**Test data** is obviously fake ("Test Vendor 3", `@example.com`).

## Key end-to-end journeys

**Stage 1**
1. Visitor on a phone: home → category → filter by town → profile → "Visit website".
2. Visitor searches with a typo and finds the right vendor.
3. Admin creates and publishes a listing; finds it in search.
4. A business claims its listing; admin approves; the business edits it.
5. Unclaimed listing → "Is this your business?" → removal request reaches the admin queue.

**Stage 2: the handshake**
6. Consumer finds a vendor, taps **Message**, shares their event (seeing exactly what the
   vendor will see), sends a message.
7. Vendor staff get an email notice, open the conversation on a phone, reply, and attach
   a PDF.
8. Consumer opens the PDF. A second consumer, given the file's link, cannot.
9. Consumer adds the vendor to the event, marks them **booked**; the vendor sees it and
   can flag it. The vendor never saw the "considering" step.
10. A vendor tries to message a consumer first; it's refused.
11. Consumer blocks a vendor; neither can send further messages; a report reaches the
    queue.
12. Consumer taps **Message** on an unclaimed business, sees its own contact details,
    taps "Let them know you're interested"; when the business claims, the consumer gets
    a notice.

**Stage 3: feedback & reviews**
13. The morning after the event, the consumer receives "How was it?", leaves 5 stars;
    the platform team publishes it; the vendor replies once.
14. A consumer who marked a vendor booked but never talked with them on Tallo can't
    review them (if D-06 option A).
15. A flagged booking can't be reviewed until resolved.

**Stage 4: guests**
16. Consumer invites three guests; a guest RSVPs on a phone with a plus-one; a revoked
    link shows "no longer valid" and nothing else.

## Current results

| Suite | Result | Date |
|---|---|---|
| Stage 1 schema checks ([stage1-proposed.test.sql](./schema/stage1-proposed.test.sql)) | **29 / 29 passed** | 2026-10-09 |
| Consumer–vendor relationship checks ([stage2-3-proposed.test.sql](./schema/stage2-3-proposed.test.sql)) | **53 / 53 passed**, each rejection confirmed to fail for the intended reason | 2026-10-09 |
| Environment | PostgreSQL 16.15 + PostGIS, scratch database, discarded after | |
| Everything else | Not yet applicable: no application code | — |
