# Testing Strategy

**Status:** Proposed (Stage 0, revision 6: Suggest a business checks).
**Last updated:** 2026-10-10

## What "done" means

A feature is complete only when **all** of these are true. A finished-looking screen is
not a finished feature.

- [ ] It works end to end, with data saved to the real database schema
- [ ] Inputs are validated on the server, with clear error messages
- [ ] Permissions are enforced on the server, **for the right side** (consumer or
      vendor), with tests that try to break them
- [ ] Loading, empty, error, and success states exist
- [ ] It works on a phone (360px wide), a tablet (768px) and a desktop (1440px), and
      with a keyboard
- [ ] It follows the [design system](./design-system.md): built from the shared
      components, with no colour, font or size set outside the tokens file
- [ ] Automated accessibility checks pass
- [ ] No wording implies Localites handles money or confirms bookings ([A §6](./A-product-blueprint.md#6-language-rules))
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
| **End-to-end tests** | Key journeys in a real browser, at phone size and desktop size | Playwright | Every change |
| **Screen-size checks** | Every page at 390 × 844, 768 × 1024 and 1440 × 900: nothing cut off, overlapping or scrolling sideways; screenshots compared with the last approved version so an unintended change on either size is caught | Playwright | Every change |
| **Design-token check** | No colour, font or size is written anywhere except the one tokens file, so a change to the look always reaches every screen | Scripted (lint rule) | Every change |
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
5a. Activity is counted: a search page records "seen in search" once per vendor shown,
    and a profile view and a website tap each add one to that vendor's daily totals. The
    team's report for one vendor shows only that vendor; a vendor's team and a visitor
    can't read any other business's numbers.
5b. A visitor searches for a magician, finds no match, taps **Suggest a business** and
    answers the three questions. The team email is sent (or the admin list says honestly
    that it wasn't), the suggestion appears in the admin list, and nothing appears
    publicly until an admin adds the business. Twenty quick submissions from one visitor
    are stopped.

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
12. Consumer taps **Inquire** on an unclaimed business: the inquiry is saved and the
    team email is sent (or the screen and the team's inquiries list say honestly that it
    wasn't); when the business claims, the consumer gets a notice.

**Stage 3: feedback & reviews**
13. The morning after the event, the consumer receives "How was it?", leaves 5 stars;
    the team gets an email with a link (not an approve button); an admin signs in and
    approves it; it appears on the profile; the vendor replies once.
14. A consumer who marked a vendor booked but never talked with them on Localites leaves
    a review: it's labelled "Planned outside Localites" and stays hidden until an admin
    approves it. A non-admin who follows the email's link can't approve it.
15. A flagged booking can't be reviewed until resolved.

**Stage 4: guests**
16. Consumer invites three guests; a guest RSVPs on a phone with a plus-one; a revoked
    link shows "no longer valid" and nothing else.
17. Host shares a group link in a group chat and as a QR code; two guests reply by typing
    their names; the host matches them to the list; the attendance view shows the third
    guest as "No reply yet"; the group-link page never shows other guests.

## Current results

| Suite | Result | Date |
|---|---|---|
| Migration checks ([db/tests/0001_stage1.test.sql](../db/tests/0001_stage1.test.sql)): the 29 approved Stage 1 rules plus 22 for launch data, Suggest a business, activity tracking and the app's restricted role | **51 / 51 passed** | 2026-10-10 |
| Consumer–vendor relationship checks ([stage2-3-proposed.test.sql](./schema/stage2-3-proposed.test.sql)), applied on top of the real migrations | **56 / 56 passed**, each rejection confirmed to fail for the intended reason (review rule updated for D-06) | 2026-10-10 |
| Unit tests (price wording) | **3 / 3 passed** | 2026-10-10 |
| Design-token and language checks | **Passed** | 2026-10-10 |
| Screen-size check (manual, first pages): phone 390, tablet 768, desktop 1440 | **No sideways scrolling**; matches design G | 2026-10-10 |
| Hosting size budget | **932 KiB, 30% of 3 MiB** (Next.js); **194 KiB, 6%** (React Router, with sign-in, admin and claiming) | 2026-10-10 |
| First-admin and app-role checks ([db/tests/0003_admin_access.test.sql](../db/tests/0003_admin_access.test.sql)) | **12 / 12 passed** | 2026-10-10 |
| Admin access tests ([tests/e2e/admin-access.mjs](../tests/e2e/admin-access.mjs)) against a local copy of Supabase's sign-in server: signed out, not on the team, no two-step, tampered token, cross-site form, cross-listing edit, status gatekeeper, removed role, cookies after sign-out, outside links; Suggest a business limits, bot trap and team-only actions | **43 / 43 passed**; confirmed to fail with the gate's two-step or team check removed | 2026-10-10 |
| Unit tests (price wording, security headers, sign-in safety including hidden-character addresses, IDs and web addresses, suggestions and email, sign-in codes, claim inputs and emails, email-to-website matching, rate-limit keys, personal details) | **69 / 69 passed** | 2026-10-11 |
| Claims and sign-in-code checks ([db/tests/0004_claims_and_sign_in.test.sql](../db/tests/0004_claims_and_sign_in.test.sql)) | **19 / 19 passed** | 2026-10-10 |
| Personal-details checks ([db/tests/0005_person_profile.test.sql](../db/tests/0005_person_profile.test.sql)) | **13 / 13 passed** | 2026-10-11 |
| Sign-in and claiming tests ([tests/e2e/claiming.mjs](../tests/e2e/claiming.mjs)) against a local copy of Supabase's sign-in server and a pretend email service: replies that never reveal an account, the code email, wrong-guess, per-address, daily and per-internet-address limits, code sign-ins kept out of the team pages, claims needing an account, unpublished listings, people seeing only their own claims, only the team deciding, no approving your own claim, "email matches" only when it does, first approved wins, decline reasons, sign-out | **72 / 72 passed** (with personal details: nothing demanded, own details only; 12 guesses sent at once, and hidden-character addresses); caught a real matching flaw (an address at a website's parent domain), fixed before release. Replies with new accounts closed: checked by hand, identical | 2026-10-11 |
| Environment | PostgreSQL 16 + PostGIS, throwaway database per run (GitHub CI: `postgis/postgis:16-3.4`) | |
| Automated run | Every push, via GitHub Actions ([.github/workflows/ci.yml](../.github/workflows/ci.yml)) | |
