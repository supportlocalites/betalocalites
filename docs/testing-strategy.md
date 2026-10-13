# Testing Strategy

**Status:** Proposed (Stage 0, revision 7: planning an event, slice 2A).
**Last updated:** 2026-10-13

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
- [ ] Automated accessibility and screen-size checks pass (`tests/e2e/look.mjs`; add any new page to its list)
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
| **Screen-size checks** | **Built (13 October 2026, `tests/e2e/look.mjs`):** 30 pages and states (signed out, as a person, as an owner, as the team; the photo viewer and the framing screen open) at phone size (360 × 740) and computer size (1280 × 900): nothing wider than the screen, no errors in the page; a failing page's screenshot is kept. **Not yet:** a tablet size, and comparing screenshots with the last approved version (an unintended change of look that breaks no rule still needs a person's eye) | Playwright | Every change |
| **Design-token check** | No colour, font or size is written anywhere except the one tokens file, so a change to the look always reaches every screen | Scripted (lint rule) | Every change |
| **Language check** | Banned words don't appear in screens or email templates | Scripted | Every change |
| **Accessibility** | **Built:** the same 30 pages and states, both sizes, checked against WCAG 2.2 A and AA with axe-core (including colour contrast, tap-target size, labels, headings, keyboard reach of scrolling areas); any problem fails the change. Not covered by tools: whether the wording and order make sense with a screen reader | axe-core in Playwright | Every change |
| **Restore drill** | Backups can actually be restored (`scripts/backup/check-restore.sh`, runbook F §6) | Scripted | **Every night**, with the backup |
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
   can flag it. The vendor never saw the "considering" step. **Automated** in
   [tests/e2e/event-plans.mjs](../tests/e2e/event-plans.mjs) (2A), with the flag telling the
   team and the person (D-41) and the business never seeing the event's name or kind (D-40).
9a. The team adds a kind of event, its suggested kinds of business and a featured business
   (each recorded); a person planning that kind of event sees "Featured" with the line saying
   the team promotes it, never the team's note; ended, expired and unpublished placements
   don't show; without a kind of event they see the quiet line (D-43). The team's planning
   counts appear only on the team's pages (D-42). **Automated** in the same file.
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
| …the same proposal, trimmed now that events are built (applied on top of 0001–0012; its 7 event-plan checks moved into 0012) | **49 / 49 passed** | 2026-10-13 |
| Unit tests (price wording) | **3 / 3 passed** | 2026-10-10 |
| Design-token and language checks | **Passed** | 2026-10-10 |
| Screen-size check (manual, first pages): phone 390, tablet 768, desktop 1440 | **No sideways scrolling**; matches design G | 2026-10-10 |
| Hosting size budget | **932 KiB, 30% of 3 MiB** (Next.js); **194 KiB, 6%** (React Router, with sign-in, admin and claiming); **255 KiB, 8%** (with activity counting and planning an event) | 2026-10-13 |
| First-admin and app-role checks ([db/tests/0003_admin_access.test.sql](../db/tests/0003_admin_access.test.sql)) | **12 / 12 passed** | 2026-10-10 |
| Admin access tests ([tests/e2e/admin-access.mjs](../tests/e2e/admin-access.mjs)) against a local copy of Supabase's sign-in server: signed out, not on the team, no two-step, tampered token, cross-site form, cross-listing edit, status gatekeeper, removed role, cookies after sign-out, outside links; Suggest a business limits, bot trap and team-only actions | **43 / 43 passed**; confirmed to fail with the gate's two-step or team check removed | 2026-10-10 |
| Unit tests (price wording, security headers, sign-in safety including hidden-character addresses, IDs and web addresses, suggestions and email, sign-in codes, claim inputs and emails, email-to-website matching, rate-limit keys, personal details, owner editing rules, including boxes left as they were, what looks like an address, and the daily note's words) | **92 / 92 passed** | 2026-10-12 |
| Claims and sign-in-code checks ([db/tests/0004_claims_and_sign_in.test.sql](../db/tests/0004_claims_and_sign_in.test.sql)) | **19 / 19 passed** | 2026-10-10 |
| Personal-details checks ([db/tests/0005_person_profile.test.sql](../db/tests/0005_person_profile.test.sql)) | **13 / 13 passed** | 2026-10-11 |
| First-and-last-name checks ([db/tests/0006_person_names.test.sql](../db/tests/0006_person_names.test.sql)) | **5 / 5 passed** | 2026-10-11 |
| Owner-editing checks ([db/tests/0007_owner_editing.test.sql](../db/tests/0007_owner_editing.test.sql), [0008](../db/tests/0008_owner_alert_sending.test.sql)) | **22 / 22 and 4 / 4 passed** | 2026-10-12 |
| "Are you human" tests ([tests/e2e/human-check.mjs](../tests/e2e/human-check.mjs)) against a pretend Cloudflare checker: no code sent and no guess counted without a pass; passes for another form or another site refused; a pass used twice refused; the checker unreachable refuses (never lets through); the visitor's address passed on; the secret key never in the page | **20 / 20 passed**; unit tests 6 / 6; real-browser check 10 / 10 with a stand-in for Cloudflare's script (Cloudflare's own widget not reachable from the build workspace: check on the test site if it is ever switched on; parked by D-38) | 2026-10-12 |
| Owner-editing tests ([tests/e2e/owner-editing.mjs](../tests/e2e/owner-editing.mjs)): only the owner of that business; fields owners can't change ignored; another business's service refused; live at once; recorded and flagged; clashes with team changes (both ways); team text never blocking a save; renamed web address; undo, partial undo and its errors; daily note; Remove owner; a past owner's website refused as claim evidence; a new owner starting clean | **55 / 55 passed**; browser checks at phone size 13 / 13 (Back from the preview, leave warnings, focus) | 2026-10-12 |
| Sign-in and claiming tests ([tests/e2e/claiming.mjs](../tests/e2e/claiming.mjs)) against a local copy of Supabase's sign-in server and a pretend email service: replies that never reveal an account, the code email, wrong-guess, per-address, daily and per-internet-address limits, code sign-ins kept out of the team pages, claims needing an account, unpublished listings, people seeing only their own claims, only the team deciding, no approving your own claim, "email matches" only when it does, first approved wins, decline reasons, sign-out | **73 / 73 passed** (with first and last name both needed; personal details: nothing demanded, own details only; 12 guesses sent at once, and hidden-character addresses); caught a real matching flaw (an address at a website's parent domain), fixed before release. Replies with new accounts closed: checked by hand, identical | 2026-10-11 |
| Activity checks ([db/tests/0009_activity_tracking.test.sql](../db/tests/0009_activity_tracking.test.sql)): what can be stored; the app can't rewrite or delete actions or totals; a list counted once per place, archived businesses and the owner's and team's browsers left out; taps and time once per page; the nightly count (3 a day per browser, the Toronto day, counted twice gives the same totals, distinct and returning visitors, search demand); unlinking a person; browser-facing roles see none of it | **51 / 51 passed**; limits ([0010](../db/tests/0010_activity_limits.test.sql)) **9 / 9**; per-browser caps ([0011](../db/tests/0011_activity_fair_limits.test.sql)) **5 / 5** | 2026-10-12 |
| Planning checks ([db/tests/0012_event_plans.test.sql](../db/tests/0012_event_plans.test.sql)): who is acting; each side sees only its own rows; nobody but the host reads the event's private details; a business reads only bookings of it and flags once; the database sets the times and writes the history; the 60-days-back to 3-years-ahead window; kinds of event and towns on offer; your own business refused; only the team writes event types, suggestions and featured placements; people see featured businesses only through the function, never the note; ended, expired and unpublished placements not returned; no money columns; the team's counts refuse every other side; browser-facing roles see nothing | **164 / 164 passed** | 2026-10-13 |
| Unit tests, all (including 25 for planning: form inputs and the date window, Toronto dates, wording, refusal codes, emails never carrying private values, "who is acting" set in one statement, the local-only email setting) | **136 / 136 passed** | 2026-10-13 |
| Planning tests ([tests/e2e/event-plans.mjs](../tests/e2e/event-plans.mjs)) against the local sign-in server and a pretend email service: signed-out gates; the team's Event types, suggestions and featured businesses (recorded; no money columns); creating events (name, date and town needed; kind optional); ideas and Featured with its label line; Add to event and Save, telling no one; your own business refused; Mark as booked and its emails (who, date, town, guests, and nothing private); repeats held back; unclaimed businesses not told; another person, another business, staff and non-members get "not found" and change nothing; Bookings marked showing only the limited summary; the switch; the flag telling the team and the person, never the note; hidden kinds of event; date changes and cancelling emailed; limits (11th event a day, too many changes a minute); the team-only counts not on the owner's Analytics page; no wording suggesting payment or a confirmed booking anywhere | **120 / 120 passed**; real-browser hand check at 360 px and 1280 px as a person, an owner and the team: 91 / 91, 56 screenshots, no sideways scrolling | 2026-10-13 |
| Whole end-to-end chain (`npm run test:e2e`), run together | admin access 43/43, sign-in and claiming 73/73, are-you-human 20/20, owner editing 55/55, activity and analytics 51/51, event planning 120/120 | 2026-10-13 |
| Activity and Analytics tests ([tests/e2e/analytics.mjs](../tests/e2e/analytics.mjs)): signed notes; reports from other sites, plain forms, changed notes and bots refused; repeats ignored; source read on the server; owner's and team's visits marked; the preview counts nothing; the nightly count; the owner's page only for its owner with the switch on (not another owner, someone without a business, a team admin, an archived or removed owner); owners can't switch it on; the team's pages refused to non-team; notes tied to one browser and the new-browser limit; each look at the detail recorded once | **51 / 51 passed**; unit tests for the rules 13 / 13; real-browser check 6 / 6 (seen in a list, opened from it, Back not counted again, tap, time) | 2026-10-12 |
| Environment | PostgreSQL 16 + PostGIS, throwaway database per run (GitHub CI: `postgis/postgis:16-3.4`) | |
| Local-only test settings | The end-to-end tests point the site at pretend services on the same computer: `TURNSTILE_VERIFY_URL` (the "are you human" checker) and, since 2A, `EMAIL_API_URL` (a pretend Resend in `scripts/e2e/mail-server.mjs`, with the test key `e2e-email-key-local-only`), so tests can read each email the site sends. Both are used **only** when they point at `localhost` or `127.0.0.1`; anywhere else they are ignored. Never set them in Cloudflare. | |
| Automated run | Every push, via GitHub Actions ([.github/workflows/ci.yml](../.github/workflows/ci.yml)) | |
