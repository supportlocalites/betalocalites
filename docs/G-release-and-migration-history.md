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

### 2026-10-10 — Stage 0 documentation, revision 8: no payments of any kind; pilot size

**Stage:** 0
**What changed (plain English):** The product owner decided:
- **D-24:** no payment of any kind goes through Localites. Vendors paying Localites for a
  paid plan or a featured spot pay outside the site, like everything else. ADR-018 is
  extended to say so; ADR-025 is accepted (Localites stores only a vendor's plan and its
  dates).
- **D-12:** the business is named Localites in the privacy policy and terms; the mailing
  address is left blank and must be added before launch.
- **PO-08:** the launch is a pilot with at most 5 businesses per category. 28 suggestions
  are marked in the research record and on the shortlist page for the product owner to
  confirm or swap.
**Documents:** H, A, B, C, roles and relationships, roadmap, launch research.
**Migrations applied:** None.
**Destructive?** No.
**Tests run:** None needed; no schema change.
**Approved by:** Product owner (D-12, D-24, PO-08 pilot size), 10 October 2026.

### 2026-10-10 — Stage 0 documentation, revision 7: remaining Stage 0 decisions

**Stage:** 0
**What changed (plain English):** The product owner answered the open questions:
- **PO-05:** launch categories are Venue, Food & Beverage, Sweets, Rentals & Decor,
  Activities (which includes entertainers) and Photography. Vendor research started.
- **D-13:** the consumer–vendor rules R1–R8 are approved; ADR-022 accepted.
- **D-06:** reviews use option B. Any real booking can be reviewed after the event, and
  an admin approves every review before it's published. The team is emailed each new
  review, with a link to the admin area rather than an approve button (ADR-026).
- **D-14:** reviews before guest RSVPs.
- **D-22 amended:** a vendor dashboard for vendors on a paid plan (anonymous counts only);
  admins see the full detail; detailed records are kept with no deletion date, for
  year-over-year numbers. How vendors pay is a new question, D-24 (ADR-025, proposed).
- **D-10:** data-keeping rules approved, with events kept for as long as the host's
  account exists.
- **D-08:** invitations shared from the host's phone by text, WhatsApp, social media,
  email or QR code, using personal links and a group link with name matching.
- **D-12 (part):** the privacy contact is supportlocalites@gmail.com.
**Documents:** H, A, B, C, D, E, roles and relationships, roadmap, screen inventory,
testing strategy.
**Migrations applied:** None. The proposed Stage 2–3 schema changes the review rule:
a Localites conversation is no longer required; instead the database records
`review.planned_on_localites` itself and refuses any change to it.
**Destructive?** No (proposal only; no database exists).
**Tests run:** Both proposed schemas applied to a scratch PostgreSQL 16.15 + PostGIS
database: Stage 1, 29 of 29 passed; consumer–vendor checks, 56 of 56 passed (three new
checks for the review rule). Scratch database discarded.
**Approved by:** Product owner (PO-05, D-06, D-08, D-10, D-12 in part, D-13, D-14, D-22
amendments), 10 October 2026.
**Repository:** the product owner moved the code from `igbarker/Tallo` to
`supportlocalites/localites` the same day. Links in the documents now point there.

### 2026-10-10 — Stage 0 documentation, revision 6: launch list, Inquire, activity tracking

**Stage:** 0
**What changed (plain English):** The product owner decided:
- **D-03:** Localites launches with a curated list. We research Orillia-area businesses
  in the chosen categories (PO-05); the product owner picks which to add. Public ratings
  of 4 stars or more are only our private filter and are never copied or shown.
- **D-04:** the stages stay as planned. Stage 1 profiles show the business's own website
  and phone. When messaging arrives in Stage 2, unclaimed or unverified businesses show
  **Inquire**, which is saved and emailed to the Localites team (ADR-024). This settles
  D-05.
- **D-09:** the launch area is Orillia, Severn, Oro-Medonte and Ramara.
- **D-11:** supportlocalites@gmail.com is the admin address for every service account,
  and all alerts and team emails go to it.
- **D-22 (new):** activity tracking so vendor reports can support sales and renewals
  (ADR-023). Stage 1 counts "seen in search", profile views and website and phone taps;
  Stage 2 adds saves, inquiries and messages. Detail is kept 90 days, daily totals after.

A draft that moved messaging into Stage 1 was withdrawn at the product owner's request
before it was saved; the stages and estimates are as before, with about half a week
added to Stage 1 for the fuller tracking.
**Documents:** H, A, B, C (ADR-015 extended; ADR-023 and ADR-024 new), D, E (new §7a,
activity tracking), F, roadmap, roles and relationships, screen inventory (X18 added),
testing strategy, design system.
**Migrations applied:** None. The proposed Stage 1 schema still shows the older
`analytics_event` table; it will be replaced by the two tracking tables, and checked,
before any Stage 1 code is written.
**Destructive?** No.
**Tests run:** None needed; no schema change.
**Approved by:** Product owner (D-03, D-04, D-09, D-11, D-22), 10 October 2026.

### 2026-10-10 — Architecture approved (D-00)

**Stage:** 0
**What changed (plain English):** The product owner approved the architecture: one
application, one PostgreSQL database, the consumer–vendor data model, the security model
and the staged roadmap. Stage 0 documents are marked approved and the technical decisions
in C are accepted, except ADR-022, which waits for the consumer–vendor rules (D-13).
Stage 1 still needs its own approval; nothing has been built or spent beyond the domain.
**Migrations applied:** None.
**Destructive?** No.
**Tests run:** None needed; no schema change.
**Approved by:** Product owner (D-00), 10 October 2026.

### 2026-10-10 — Stage 0 documentation, revision 5: design G chosen; localites.ca bought

**Stage:** 0
**What changed (plain English):** The product owner chose mockup G as the app's design
(D-21) and bought the web address `localites.ca` (D-01, D-07; PO-04 done). New
[Design System](./design-system.md): one website that adapts to phones, tablets and
computers, with G's colours, type, building blocks, navigation and screen-by-screen
phone and desktop arrangements, so every change reaches every screen size. Every design
explored (A to H, plus G's desktop pages) is saved in [design/](./design/README.md).
Testing strategy adds checks at phone, tablet and desktop sizes, and a check that the
look is only ever set in one place.
**Documents:** design-system (new), design archive (new), H, A, README, cost model,
testing strategy.
**Migrations applied:** None. Data model and schemas unchanged.
**Destructive?** No.
**Tests run:** None needed; no schema change.
**Approved by:** Product owner (design and domain), 10 October 2026.

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
**Approved by:** Product owner (D-00), 10 October 2026.

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
**Approved by:** Product owner (D-00), 10 October 2026.

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
**Approved by:** Product owner (D-00), 10 October 2026.
