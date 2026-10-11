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

### 2026-10-11 — Sign-in and claiming: fixes from an independent review (Stage 1, not public)

**Stage:** 1 (ADR-028, update of 11 October)
**What changed (plain English):** An independent review of yesterday's sign-in and claiming
work found real problems, now fixed:
- A sign-in link could hide another website's address (with an invisible tab character)
  and send people there after they signed in. Now any such address goes to the account
  page.
- Many guesses at a code sent at the same moment could get past the limit of 5. Guesses
  are now counted one by one before they're checked.
- While new accounts are closed (until PO-13), a fourth request in an hour, or Supabase's
  replies, could show whether an address has an account. Now every reply is the same.
- Two team members acting on the same business at the same moment could get an error
  page. Now they simply take turns.
- The approval reason could be set to junk by editing the form. Now only the three listed
  reasons are accepted.
- Names can't contain bare web addresses (e.g. "evil-site.com"), which email apps would
  turn into links.
- Wording: the approval email and claim page no longer suggest owners can edit their
  listing yet (they reply to the email with changes until D-34 is built); the account page
  names the right button; sign-in errors are tied to their boxes for screen readers.
- PO-13 step 9 now says to *decline* the test claim, since an approval can't be undone from
  the admin page yet.
**Migrations applied:** none.
**Destructive?** No.
**Tests run:** unit tests 63/63 (new: hidden-character addresses, IPv6 limit keys, bare web
addresses in names); database checks 51/51, 12/12, 19/19, 56/56; end-to-end 43/43 and
65/65 (new: hidden-character "next" addresses; 12 guesses sent at once, of which only 5 are
tried). Checked by hand against the local sign-in server with new accounts closed: an
address with an account and one without get identical replies on all 4 requests.
**Known limits (written into ADR-028):** anyone can use up the site's 60 codes a day, or one
person's 3 codes an hour; the remedy is Cloudflare's free "are you human" check
(Turnstile), recommended before the public launch.
**How to roll back:** Cloudflare → localites → Deployments → previous version → Deploy.
**Approved by:** Product owner (D-32, D-33, D-35).

### 2026-10-10 — Sign in with an emailed code; claiming a business (Stage 1, not public)

**Stage:** 1 (D-27, D-29, D-32, D-33, D-35; ADR-028)
**What changed (plain English):** A **Sign in** link in the header opens *"Sign in or
create an account"*: type your email, enter the 6-digit code we email you, and (first time
only) your name. No passwords. Every unclaimed business page now asks *"Is this your
business?"* with **Claim this business** and a way to ask us to remove it. A claim says how
the person is connected to the business, with an optional note, and needs them to confirm
they're allowed to manage the listing. **Your account** shows your name and email, the
businesses you manage and your claims (waiting, approved, or not approved with the
reason). The team's new **Claims** page shows each claim's evidence (whether the email is
at the business's own website) and the business's own published phone and email; the team
approves (saying how it was confirmed) or declines with a reason. The first approved claim
wins: the person becomes the owner and any other claims are declined automatically. The
claimant and the team are emailed at each step (once PO-12 and PO-13 are done), and every
email is recorded as sent or failed. The team's own sign-in is now labelled **Team
sign-in**; an emailed-code sign-in never opens the team pages.
**Migrations applied:** `0004_claims_and_sign_in.sql`: how a claimant is connected to the
business; a declined claim must have a reason; one active owner per business; the
`notification` table (moved forward from the Stage 2 proposal); `sign_in_code_event` for our
code limits. Applied to the test database by GitHub after the checks pass.
**Destructive?** No: new columns, constraints on rows that don't exist yet, new tables.
**Tests run:** unit tests 60/60 (new: Supabase error codes, the inputs for joining and
claiming, claim emails, email-to-website matching); database checks 51/51, 12/12, 19/19
(new: migration 0004) and 56/56; end-to-end 43/43 admin access and 63/63 sign-in and
claiming (new, against a local copy of Supabase's sign-in server and a pretend email
service); phone-size screenshots of every new screen and the code email; Worker size 194
KiB (6% of the free limit).
**Security tests:** replies never say whether an address has an account; 5 wrong guesses per
code; per-address, daily and per-internet-address limits; code sign-ins refused by the
admin gate even for an admin; claims need an account; unpublished listings can't be
claimed; people see only their own claims; non-team and claimants can't decide claims; a
team member can't approve their own claim; "email matches" refused when it doesn't; first
approved wins with one owner; cross-site forms refused. All passed.
**Found by the tests and fixed before release:** an email address at the domain a website
sits under (e.g. anyone@someisp.ca for bakery.someisp.ca) counted as matching; now only the
website's own domain or its subdomains count.
**Not yet live:** codes reach any address only after PO-13 (Supabase's own email service
sends only to the team); emails from Localites wait for PO-12. Owners editing their own
listing comes next (D-34).
**How to roll back:** Cloudflare → localites → Deployments → previous version → Deploy. The
migration can stay: the previous version ignores the new tables and column.
**Approved by:** Product owner (D-32, D-33, D-35; D-23).

### 2026-10-10 — Suggest a business (Stage 1, not public)

**Stage:** 1 (D-25, ADR-027)
**What changed (plain English):** Under every search and category page: *"Don't see who
you're looking for? Suggest a business."* Anyone can answer three questions (name;
website or social page; phone or email), no account needed, and sees *"Thanks. Our team
will look into this business and add it if it's a fit."* The team gets an email (once
PO-12 is done) and a **Suggestions** list in the admin page, with the count of new ones in
the menu: add it as a draft listing (linked to the suggestion), mark it as already listed,
or decline it with a reason. Everything is recorded. Spam protection: a hidden field
only bots fill in, 3 suggestions a minute per internet address (kept by Cloudflare,
never stored), 5 an hour per visitor, 100 a day in total. A visitor cookie
(`__Host-lc_vid`, Localites' own, random) is set when someone sends a suggestion.
**Migrations applied:** none.
**Destructive?** No.
**Tests run:** unit tests 35/35 (new: the three questions, the team email, sending and
its failures); admin access and suggestion tests 43/43 (16 new: limits, bot trap,
cross-site form, team-only list and actions, add-as-draft link, no deciding twice, audit
log); browser run-through at phone and desktop sizes.
**Not yet live:** the team email waits for PO-12; suggestions are saved and listed
meanwhile, honestly marked "waiting".
**How to roll back:** Cloudflare → localites → Deployments → previous version → Deploy.
**Approved by:** Product owner (D-25, D-23).

### 2026-10-10 — The 28 test businesses, as drafts (Stage 1, not public)

**Stage:** 1 (PO-08)
**What changed (plain English):** The 28 researched test businesses are loaded into the
test project as drafts: name, town, category and, only where the research found it, the
business's own website. Nothing about them is public until the team checks each one and
publishes it (PO-11). Each listing's history holds the research link and what to check.
Loaded once by GitHub (`scripts/import-test-businesses.mjs`); later runs do nothing, so
the team's edits are never overwritten.
**Migrations applied:** none (data only, test project only).
**Destructive?** No.
**Tests run:** loaded twice into a local database: 28 drafts, then nothing on the second
run; the public site still showed only published listings; the admin page listed the
drafts with their research notes. Unit tests 27/27 (new: record IDs and web addresses).
**How to roll back:** archive the drafts from the admin page.
**Approved by:** Product owner (PO-08 test set; D-23).

### 2026-10-10 — Team sign-in and the admin page (Stage 1, not public)

**Stage:** 1 (D-28)
**What changed (plain English):** The Localites team can sign in (email and password,
then a code from an authenticator app) and use the admin page: list every listing, add a
business as a draft, edit its details, categories and services with honest prices,
publish, hide or archive it, and see its history. Every change is recorded with who made
it. Renamed listings keep their old web address working. Nobody else can sign up yet.
**Migrations applied:** `0003_admin_access.sql` (lets the app untick categories and other
link rows; adds the one-time first-admin command). Not destructive. Applied to the test
project by GitHub after this push.
**Destructive?** No.
**Tests run:** database checks 51/51, 12/12 (new) and 56/56; unit tests 19/19; admin access
tests 27/27 against a local copy of Supabase's sign-in server (new, now on every push);
each was shown to fail when the gate was deliberately broken. Browser run-through at
phone and desktop sizes: sign-in, two-step set-up, add, edit, publish, hide, history.
**Security tests:** signed out, not on the team (with and without two-step), admin
without two-step, tampered token, form from another website, editing one listing's
service through another, forbidden status change, removed admin role, reused cookies
after sign-out, sign-in link to another website: all refused.
**Live:** 10 October 2026, after PO-10 (Supabase settings, first admin, two Cloudflare
secrets); the product owner signed in with a two-step code and reached the Listings page.
**How to roll back:** Cloudflare → localites → Deployments → previous version → Deploy.
The migration can stay (it only adds).
**Approved by:** Product owner (D-28, "go ahead"), 10 October 2026.

### 2026-10-10 — Speed improvements (Stage 1, not public)

**Stage:** 1
**What changed (plain English):** No visible change. With React Router the site used
8 ms of processing per request against the free plan's 10 ms, so three changes give it
headroom: the page code loads when the Worker starts instead of during a visitor's
request, the database library skips a step it repeated on every request, and the server
code is compressed tighter (144 KiB, 5% of the size limit, down from 223 KiB).
**Migrations applied:** none.
**Destructive?** No.
**Tests run:** lint, types, design tokens, wording; unit tests 12/12; every page checked
in Cloudflare's runtime locally against PostgreSQL through Hyperdrive's local stand-in
(welcome, Explore, category, search with a typo, profile, 404s, `/api/health`) and
clicked through in a browser at 390, 768 and 1440 wide: no errors.
**How to roll back:** Cloudflare → localites → Deployments → previous version → Deploy.
**Approved by:** Product owner ("can you run the speed improvements?"), 10 October 2026.

### 2026-10-10 — Switch to React Router (Stage 1, not public)

**Stage:** 1
**What changed (plain English):** The fit test showed Next.js used a median of 22.88 ms
of processing per page (P99 251 ms) against the free plan's 10 ms, so the website now
runs on React Router, the planned fallback (ADR-005, revision 4). Visitors see the same
pages and design; the database, its rules and the security model are unchanged. The
website is now about a fifth of the size, and moving between pages no longer reloads
the whole page. Cloudflare's build and deploy commands change to `npm run build` and
`npx wrangler deploy` (H, PO-03 step D).
**Migrations applied:** none.
**Destructive?** No.
**Tests run:** lint, types, design tokens, wording; unit tests 12/12 (new: security
headers are the same on pages and static files); migration checks 51/51 and Stage 2–3
proposal checks 56/56; every page checked in Cloudflare's runtime locally (welcome,
Explore, category, search with a typo, profile, 404s, `/api/health`) and in a browser at
390, 768 and 1440 wide: no errors, no sideways scrolling.
**Fit test:** size 223 KiB compressed (7% of 3 MiB). Live CPU time to be read from
Cloudflare after a day of use (ADR-005).
**Live:** deployed 10 October 2026 after the product owner changed Cloudflare's build
commands (PO-03 G); `/api/health`: database ok via Hyperdrive, 6 published test
listings, build `4df99e0`.
**How to roll back:** Cloudflare → localites → Deployments → previous version → Deploy
(the Next.js version stays there), then restore Cloudflare's old build commands.
**Approved by:** Product owner ("let's switch"), 10 October 2026.

### 2026-10-10 — First live test site (Stage 1, not public)

**Stage:** 1
**What changed (plain English):** The Stage 1 foundations went live on Cloudflare's free
plan at https://localites.supportlocalites.workers.dev, built automatically from GitHub
on every change. It reads the Supabase test project (`localites-test`, Canada) through
Cloudflare Hyperdrive, with only the six fake test businesses. Getting there found and
fixed three issues: the database library's Node build is rejected by Cloudflare's runtime
(now its Cloudflare build), direct encrypted connections to Supabase's pooler were cut
off (now Hyperdrive), and Cloudflare's publish step needs a placeholder local address for
Hyperdrive. `/api/health` reports the connection in plain words without revealing any
secret.
**Migrations applied:** none new (0001 and 0002 were already on `localites-test`).
**Destructive?** No.
**Tests run:** GitHub checks green on every change; `/api/health` live: database ok via
Hyperdrive, 6 published test listings.
**Fit test:** size 1,085 KiB (35% of 3 MiB). CPU time first reading 20 ms against a
10 ms limit; percentiles pending (ADR-005).
**How to roll back:** Cloudflare → localites → Deployments → previous version → Deploy.
**Approved by:** Product owner (PO-03), 10 October 2026.

### 2026-10-10 — Stage 1, week 1: foundations and local fit test (not deployed)

**Stage:** 1 (approved D-23)
**What changed (plain English):** The first application code. A Next.js website in
design G: Welcome, Explore (search and the six categories), search results with typo
tolerance, and a business profile with honest price wording, all reading from the
database as the restricted app role. One tokens file holds every colour, font and size,
with a check that rejects any outside it, and a check for banned wording. GitHub now
runs every check on every push. Nothing is deployed and no real business is loaded:
pages were tested with six obviously fake "Test Vendor" listings in a local database.
**Migrations applied:** `0001_stage1_foundation.sql` and
`0002_launch_places_and_categories.sql`, to local throwaway databases first. **Then
applied to the Supabase test project `localites-test`** (Canada) on 10 October 2026 by
GitHub's "Update the test database" job (CI run 38019493681), with the six fake test
businesses. Not applied to any production database (none exists yet).
**Destructive?** No.
**Tests run:** migration checks 51/51; Stage 2–3 proposal checks on top of the real
migrations 56/56; unit tests 3/3; token, wording, lint and type checks passed; pages
checked at 390, 768 and 1440 wide with no sideways scrolling.
**Security tests:** the browser-facing roles read nothing (including suggestions and
activity); the app role can't edit the audit log, delete rows or change the structure.
**Fit test:** 932 KiB compressed (30% of Cloudflare's free 3 MiB); runs in Cloudflare's
runtime locally. Time per request still to be measured on Cloudflare (ADR-005).
**Dependencies:** pinned exactly. No known vulnerabilities in anything that ships;
remaining advisories are in build and lint tools only (none critical), tracked for the
next update.
**How to roll back:** nothing is deployed.
**Approved by:** Product owner (D-23), 10 October 2026.

### 2026-10-10 — Stage 0 documentation, revision 9: Suggest a business

**Stage:** 0
**What changed (plain English):** The product owner added a feature (D-25): anyone who
doesn't see a business they want can suggest it with three questions (name, website,
phone or email). It's emailed to supportlocalites@gmail.com, and the team vets and adds
it. Planned for Stage 1 with spam protection; signed-in suggestions get a "now on
Localites" email from Stage 2 (ADR-027). Two new screens (P11, X19). Stage 1 gains about a
quarter of a week. The product owner also set the launch test set (PO-08): the 28
suggested businesses, up to 5 per category, used to test the app before launch; the
vendor list will be refreshed later. Five isn't a limit in the app. Approving Stage 1 is
now the open decision (D-23).
**Documents:** H, A, B, C, D, E, roadmap, screen inventory, testing strategy, design
system, launch research.
**Migrations applied:** None.
**Destructive?** No.
**Tests run:** None needed; no schema change.
**Approved by:** Product owner (D-25, PO-08 clarification), 10 October 2026.

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
