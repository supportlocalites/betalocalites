# C — Architecture Decision Log

**Status:** Accepted (D-00, 10 October 2026). ADR-022 accepted with D-13; ADR-025 accepted
with D-24.
**Last updated:** 2026-10-19 (revision 12: ADR-029 changed by D-54, owners change their business's name; revision 11: ADR-031)

Each entry records a significant technical decision: what we chose, why, what we
rejected, what it costs, and what would make us reconsider. Once approved, entries are
never edited; a new entry supersedes an old one and both stay.

**Who decides.** Each entry is labelled:
- **Team decision** — routine technical choice. We make it and explain it. You can
  overrule, but you don't need to act.
- **Needs your approval** — it costs money, creates a commitment, or changes what users
  experience.

**Revision 2 changes:** ADR-001, 004, 013, 015 and 017 updated for the consumer–vendor
handshake. ADR-018 to ADR-022 added.

**Revision 4 changes (10 October 2026):** ADR-023 (activity tracking for vendor reports,
D-22) and ADR-024 (Inquire for unclaimed or unverified vendors, Stage 2, D-04 and D-05)
added. ADR-015 is extended by ADR-023. Stages are unchanged.

**Revision 5 changes (10 October 2026):** ADR-022 accepted (D-13). ADR-023 now keeps
detailed records with no deletion date, for year-over-year reports (D-22, amended).
ADR-025 (paid vendor plans, recorded but not charged in the app; proposed, D-24) and
ADR-026 (every review approved by an admin, with an email notice; D-06) added.

**Revision 6 changes (10 October 2026):** ADR-018 extended by D-24: no payments of any kind
go through Localites, including vendors paying Localites. ADR-025 accepted. ADR-027
(Suggest a business, D-25) added.

**Revision 11 changes (13 October 2026):** ADR-031 (who is acting, in the database: the
per-person rules for planning an event, featured placements per kind of event and the team's
planning counts; D-13, D-39 to D-43) added and accepted. Notes added to ADR-004 (per-person
rules built for events, plans and saves), ADR-017 (the gatekeeper for plans), ADR-021 (what
the business is told, D-40, D-41) and ADR-025 (featured placements, D-43).

**Revision 10 changes (12 October 2026):** ADR-028 updated: Cloudflare's free "are you
human" check (Turnstile) on signing in with an emailed code built, then **parked** by D-38
(switched off; signing in stays the emailed code alone).

**Revision 9 changes (12 October 2026):** ADR-030 (counting only what a real browser
confirms, with signed notes; the nightly count; the team's activity pages and the owner's
Analytics page, switched on per business; D-22, D-30, D-37) added and accepted. Extends
ADR-023.

**Revision 8 changes (11 October 2026):** ADR-029 (owners edit their own listing, live at
once; the team's daily note, undo and Remove owner; D-34) added and accepted.

**Revision 7 changes (10 October 2026):** ADR-028 (signing in with an emailed code, and
claiming a business; D-32, D-33 and D-35) added and accepted.

**Revision 3 changes (product owner: no running costs):** ADR-003 and ADR-013 move to
free plans. ADR-007 replaces Vercel with Cloudflare's free plan, because Vercel's free
plan doesn't allow business use. ADR-005 adds a fit test for Cloudflare's free limits.
ADR-014 caveat updated. Nothing in the data model or security model changes.

---

## Summary

| # | Decision | Who decides | Status |
|---|---|---|---|
| ADR-001 | One application (modular monolith), not microservices | Team | Accepted |
| ADR-002 | PostgreSQL is the single source of truth | Team | Accepted |
| ADR-003 | Supabase (free plan) for database, sign-in, and file storage | Team ($0) | Accepted |
| ADR-004 | The browser never talks to the database directly | Team | Accepted |
| ADR-005 | React Router + TypeScript (replaced Next.js after the fit test on the free host) | Team | Accepted (rev. 4) |
| ADR-006 | Drizzle for database access, with SQL migrations in git | Team | Accepted |
| ADR-007 | Cloudflare (free plan) for hosting | Team ($0) | Accepted (rev. 3) |
| ADR-008 | Postgres full-text search for Stage 1; no search service | Team | Accepted |
| ADR-009 | UUID v7 identifiers plus human-readable slugs | Team | Accepted |
| ADR-010 | Invitation links: random, hashed, revocable, expiring | Team | Accepted |
| ADR-011 | Three-tier metadata (columns, typed attributes, display extras) | Team | Accepted |
| ADR-012 | One `vendor` table with team membership; no `organization` yet | Team | Accepted |
| ADR-013 | Email via Resend (free plan): sign-in, message notices, feedback requests | Team ($0) | Accepted |
| ADR-014 | Data stored in Canada | **Needs approval** (trust/legal) | Accepted |
| ADR-015 | First-party counts in our own database; no third-party trackers (extended by ADR-023) | Team | Accepted |
| ADR-016 | Sentry for error monitoring, free tier | Team | Accepted |
| ADR-017 | One gatekeeper for every status change | Team | Accepted |
| ADR-018 | **Localites never handles money**, and nothing in the system prepares for it | **Needs approval** (product commitment) | Accepted (D-16; extended by D-24) |
| ADR-019 | Messaging: stored conversations, polled updates, batched email notices | Team | Accepted |
| ADR-020 | Files in conversations: private, participants only, limited types | Team | Accepted |
| ADR-021 | "Booked" is the consumer's own record, labelled as such | **Needs approval** (user experience) | Accepted (D-18) |
| ADR-022 | One account per person; acting as a vendor comes from team membership | **Needs approval** (user experience; D-13) | Accepted (D-13) |
| ADR-023 | Activity tracking for vendor reports: detailed records kept for year-over-year reports, plus daily totals | **Needs approval** (privacy; D-22) | Accepted (D-22) |
| ADR-024 | Unclaimed or unverified vendors get **Inquire**, which reaches the Localites team by email | **Needs approval** (user experience; D-04) | Accepted (D-04) |
| ADR-025 | Paid vendor plans are recorded (which plan, until when) but paid for outside Localites | **Needs approval** (business model; D-24) | Accepted (D-24) |
| ADR-026 | Every review is approved by an admin in the admin area; the team is emailed each new review | **Needs approval** (D-06) | Accepted (D-06) |
| ADR-027 | Suggest a business: a three-question form, open to everyone, emailed to the team to vet | **Needs approval** (user experience; D-25) | Accepted (D-25) |
| ADR-028 | The public signs in with an emailed 6-digit code; businesses claim listings, checked by the team, first approved wins | **Needs approval** (user experience; D-32, D-33, D-35) | Accepted (D-32, D-33, D-35) |
| ADR-029 | Owners edit their own listing on a page laid out like it; live at once; the team gets a daily note, can undo any save, and can remove an owner | **Needs approval** (user experience; D-34) | Accepted (D-34) |
| ADR-030 | Activity is counted only when a real browser confirms it, against a note the page's server signed; totals each night; owners see theirs on an Analytics page the team switches on | Engineering, within D-22, D-30 and D-37 | Accepted |
| ADR-031 | Who is acting, in the database: every planning request tells the database which person and which side (person, business or team) it is for, and the database's own rules decide what that side may see and change; featured placements are team-run, labelled and money-free | Engineering, within D-13 and D-39 to D-43 | Accepted |

---

## ADR-001 — One application (modular monolith)

**Decision.** Build a single web application, internally divided into modules with
clear boundaries: discovery, vendors, events, messaging, reviews, guests, platform
admin. One codebase, one deployment, one database.

**Plain English.** One well-organised building with separate rooms, not a campus of
separate buildings connected by walkways.

**Why.** The brief asks for an architecture the team can reliably operate. A small team
running microservices spends its time on the walkways: network failures between
services, keeping data consistent across databases, deploying many things in the right
order. None of that helps a parent in Orillia.

**Alternatives rejected.** *Microservices*, because the operational cost far exceeds
the benefit at our scale. *A separate backend API plus a separate frontend*, because it
doubles deployment and maintenance with no user benefit yet. The internal module
boundaries keep that option open if a native app is ever approved.

**Revisit when.** A module needs to scale or deploy independently for a measured
reason, or the team grows past ~8 engineers.

---

## ADR-002 — PostgreSQL is the single source of truth

**Decision.** All product data lives in one PostgreSQL database. Anything else (a search
index, a cache, an export) is derived from it and can be rebuilt from it.

**Why.** Our data is deeply relational: consumers, events, vendors, conversations, and
reviews all point at each other. PostgreSQL enforces those relationships so bad data
can't be saved, and supports full-text search and geography natively. It is open source
and not tied to one vendor.

**Alternatives rejected.** *Document databases (Firebase, MongoDB)*, because they make
relationships the application's problem. That's how duplicate sources of truth start.

---

## ADR-003 — Supabase (free plan) for database, sign-in, and file storage

**Team decision. $0** (see [cost-model.md](./cost-model.md)).

**Decision.** Use Supabase's **free plan** as the managed provider for PostgreSQL,
sign-in, and file storage (vendor photos and files shared in conversations). Two free
projects: the live site and a test copy.

**Plain English.** Supabase runs the database for us, including backups, security
patches and uptime. It also handles sign-in and stores files, so we don't need three
separate providers.

**Why.** It's standard PostgreSQL, so we can leave with our data using standard tools.
It offers a Canadian region (ADR-014) and daily backups on the paid plan, with one bill
and one set of credentials.

**Free-plan limits** (from supabase.com): 500 MB database, 1 GB file storage, two
active projects. A project pauses only after a week without database activity; a live
site with daily visitors keeps it active, and Supabase emails a week before any pause.
The product owner has run projects on this plan without issue. We don't rely on the
free plan's backups; we keep our own nightly copy (F §5).

**Alternatives.** *Neon + Auth.js + S3* — equally sound, more pieces to operate.
*AWS directly* — highest operational burden. *Firebase* — not relational (ADR-002).

**Revisit when.** A free-plan limit reaches 80% (we tell you with options), or
reliability falls short two months running. Moving to a paid plan would be your
decision.

---

## ADR-004 — The browser never talks to the database directly

**Decision.** Every read and write goes through our server code, which checks who you
are and whether you're allowed. The database adds a second layer.

**Plain English.** Two locks. The application checks permissions on every request.
The database itself refuses access that doesn't come through the proper door.

**What the second lock covers, exactly.**
- **All tables, from Stage 1:** row-level security is on, with no access for
  Supabase's public browser-facing roles. A leaked public key could read nothing.
  (Tested: [schema checks](./schema/).)
- **All tables, from Stage 1:** the server connects as a restricted database role that
  can't change the database structure or edit audit history.
- **Events, conversations, messages and files, from Stage 2** (guests and RSVPs when
  built): the server tells the database which person each request is for, and the
  database only returns that person's rows. For the most private data, a bug in the
  application's permission check still would not expose someone else's conversations.
- **Relationship rules, from Stage 2:** the database itself refuses a message from
  someone who isn't in the conversation, a conversation started by a vendor, and a
  review that doesn't trace to a real booking.

**Built for events, plans and saves (migration 0012, 13 October 2026):** the per-person
rules above now exist for events, their private details, event plans and saved businesses.
How they work is in ADR-031. Conversations, messages and files get theirs when they're built.

**Why not let the browser query the database directly?** Supabase supports that, with
the database rules as the only protection. It puts the whole security model in one
layer that's easy to get subtly wrong. Server-side checks are easier to test and
explain.

---

## ADR-005 — React Router + TypeScript

**Decision.** Build the application with React Router 8 (framework mode; React) in
TypeScript, built for Cloudflare with Cloudflare's own Vite plugin. *(Revision 4,
10 October 2026: replaces Next.js, which failed the fit test below. The product owner
chose this planned fallback over Cloudflare's paid plan, keeping D-20's $0.)*

**Why.** Pages render on the server, so vendor profiles load fast on phones and can be
found through Google, which is central to a local directory. Server code and screens
share one project and one set of types. React Router is built to run on Cloudflare:
small, and light on processing per request. It is the same React, so screens carried
over unchanged. *(Originally Next.js, chosen because it's the most widely used
framework of its kind; it needed more processing per page than the free plan allows.)*

**Alternatives.** *Remix / SvelteKit* — good, smaller talent pool. *Rails / Django* —
excellent for this; rejected only to keep the codebase to one language.

**Fit test (revision 3).** Cloudflare's free plan (ADR-007) allows 10 ms of processing
per request and a 3 MiB application size. In Stage 1 week 1, before real building
starts, we deploy one vendor profile page, one search, and one signed-in page to the
free plan and measure them. If Next.js doesn't fit comfortably, we use **React Router**
(formerly Remix) instead: same language, same React components, and built to run on
Cloudflare. Either way the data model, database, and security model are unchanged.
The result is recorded here.

**Fit test, part 1 (10 October 2026, local).** Built with Next.js 16.3.8 and the
OpenNext Cloudflare adapter 1.20.10. Size: **932 KiB compressed, 30% of the 3 MiB
limit**; `npm run cf:size` fails the build above 80%. The same build ran in Cloudflare's
own runtime (workerd, locally) against PostgreSQL as the restricted `app_server` role:
the welcome page, Explore, search (including typos) and a business profile all worked.
Next.js 16.4.0 was tried first and failed in that runtime (the adapter doesn't yet
support a file 16.4 added), so we stay on 16.3.8 until the adapter catches up.
**Finding (10 October 2026):** the database library must run as its Cloudflare build
(`serverExternalPackages: ['postgres']` in `next.config.ts`); bundled as the Node build,
Cloudflare's runtime rejects its encryption settings and every database page fails.
Cloudflare also verifies database certificates, so if it doesn't trust Supabase's, the
app connects through **Cloudflare Hyperdrive** (free plan; encrypts to Supabase and pools
connections). The code supports both; `/api/health` reports which is in use.
**Part 2, on Cloudflare (10 October 2026, in progress):** the site runs live at
`localites.supportlocalites.workers.dev`, reaching Supabase through Hyperdrive. First
reading from Cloudflare's metrics: **CPU time 20 ms** (percentile not yet known) against
the free plan's 10 ms. Next: median and P99, and whether any "Exceeded CPU" errors occur.
If typical requests exceed the limit, the fallback above (React Router) applies; the
paid plan (about US$5 a month) would break D-20 and needs the product owner's approval.

**Part 2 result (10 October 2026).** Cloudflare's metrics for the Next.js site over 95
requests: **median CPU 22.88 ms, P99 251 ms**, against the free plan's 10 ms. A typical
page used more than twice the limit with almost nothing built, so Next.js does not fit.
The free plan's limit is per request, not per day (it allows 100,000 requests a day),
so it is about how heavy each page is, not how many visitors there are. The product
owner chose to switch to React Router (free) rather than pay for the larger limit.

**Part 3: React Router (10 October 2026, local).** Same pages, look, database code and
security headers. Size: **223 KiB compressed, 7% of the limit** (Next.js: about 1 MiB);
`npm run size` still fails the build above 80%. Run in Cloudflare's runtime locally
against PostgreSQL through Hyperdrive's local stand-in: welcome, Explore, search
(including typos), a business profile, unknown addresses (404) and `/api/health` all
worked, and pages move without full reloads.
**Live result (10 October 2026):** Cloudflare's CPU time fell to **8 ms** with React
Router, under the free plan's 10 ms: **the fit test passes**. For headroom (sign-in and
activity counting will add work), three speed improvements followed: the page code now
loads when the Worker starts rather than during a visitor's request, the database
library no longer rebuilds its table map on every request, and the server code is
minified (144 KiB compressed, 5% of the limit). The signed-in page is measured when
sign-in is built.

---

## ADR-006 — Drizzle for database access, SQL migrations in git

**Decision.** Use Drizzle ORM. Every database change is a numbered SQL migration file in
git, reviewed like code.

**Why.** Drizzle stays close to plain SQL, which matters because we rely on PostgreSQL
features (full-text search, row-level security, triggers, check constraints) that
heavier tools hide. Anyone reviewing a migration can see exactly what it does.

**Alternative.** *Prisma* — more popular, weaker on those features. A close call.

**Revisit when.** Before Stage 1 code exists, if the team strongly prefers Prisma.

---

## ADR-007 — Cloudflare (free plan) for hosting

**Team decision. $0.** *(Revision 3: replaces "Vercel on the Pro plan", following the
product owner's direction that Localites should have no running costs.)*

**Plain English.** Supabase is the filing cabinet. The host is the shopfront: the
computer that runs the website and sends each page to a visitor's phone. Something has
to do this job, and Supabase doesn't.

**Decision.** Host on Cloudflare's free plan.
- **Public pages** (home, categories, vendor profiles) are pre-built and served as
  files. Cloudflare serves these free and without limit, and fast in Canada.
- **Signed-in pages** (messages, event plans) are built on request: up to 100,000 a
  day on the free plan, far beyond what a local launch will use.
- Code goes to GitHub; Cloudflare builds and deploys it automatically, and every
  proposed change gets its own preview link for you to review on your phone. Previews
  only ever use the test copy of the database, with fake data.

**Why not Vercel.** Vercel's free plan is restricted to personal, non-commercial use, so
a business would need its US$20/month plan.

**To confirm before we commit:** Cloudflare's published limits contain no
business-use restriction, but we couldn't open their full terms of service from the
development environment. We'll read them at signup (PO-03). If they don't allow
Localites, we come back to you with options before anything costs money.

**Limits that shape the build:** 10 ms of processing per request and a 3 MiB
application size on the free plan, hence the fit test in ADR-005.

**Alternatives.** *Netlify free plan* (a monthly allowance; sites pause when it runs
out). *Vercel* (business use needs $20/month). *A self-managed server* (free tiers
exist, but someone has to maintain and secure it).

**Revisit when.** The fit test fails, the terms don't allow us, or traffic approaches
80% of the free daily allowance.

---

## ADR-008 — Postgres full-text search for Stage 1

**Decision.** Vendor search uses PostgreSQL's built-in full-text search plus typo
matching. No separate search service.

**Why.** Dozens to hundreds of vendors in year one is comfortable for PostgreSQL, at no
extra cost and with nothing to keep in sync. The search module sits behind an interface
so a service can be added later without rewriting screens.

**Revisit when.** Search exceeds 300 ms for 1 in 20 searches, or we pass ~20,000 listings.

---

## ADR-009 — UUID v7 identifiers plus slugs

**Decision.** Permanent IDs are UUID v7 (long, random-looking, time-sortable). Vendors
also get a readable slug for their web address; old slugs redirect.

**Why.** Sequential IDs (`/vendor/41`) let anyone count records and try `/vendor/42`.
UUIDs remove that easy target. They don't replace permission checks.

---

## ADR-010 — Invitation link security

**Decision.** Invitation links (Stage 4) carry a 256-bit random token. Only a hash is
stored. Links are revocable and expire (default 30 days after the event). A link opens
one invitation and one RSVP form, never the host's workspace or other guests. "Opened"
is recorded separately from "responded". RSVP is rate-limited.

**Why.** Even a leaked link exposes only what the host chose to share with that guest.

---

## ADR-011 — Three-tier metadata

**Decision.** Real columns for core fields; an admin-managed typed attribute registry
for filterable attributes; a small display-only JSON field. See
[B §5](./B-domain-and-data-model.md#5-metadata-strategy).

**Why.** New filters without a developer, and no unvalidated catch-all blob.

---

## ADR-012 — One `vendor` table with team membership

**Decision.** The business and its listing are one record (`vendor`). People manage it
through `vendor_member` (owner, manager, staff). No separate `organization` layer yet.

**Why.** Locally, one business has one listing. The migration path if that changes is
documented in [B §7](./B-domain-and-data-model.md#7-future-changes-we-already-know-about)
and changes no vendor IDs.

---

## ADR-013 — Email via Resend (free plan)

**Team decision. $0.** Requires the domain (D-07): Resend only emails other people
from a domain you own and have verified.

**Decision.** Use Resend for the emails Localites must send:
- Stage 1: sign-in links, password resets, claim decisions.
- Stage 2: **new-message notices**, "marked you as booked" notices to vendors, "now on
  Localites" notices when a business a consumer was interested in joins.
- Stage 3: **"How was it?" feedback requests** and one reminder; review published or
  replied-to notices.

No marketing email.

**Privacy.** Notices say who wrote and link to the conversation; they never include
the message text, so private conversations don't sit in inboxes or provider logs.

**Batching.** When a message arrives and the recipient hasn't seen the conversation,
they get one email. They get no further email for that conversation until they've
opened it or an hour has passed. This keeps inboxes calm and volume low.

**Free plan.** 3,000 emails a month, **100 a day** (resend.com). Batching keeps a
local launch well inside this. If we approach the daily cap: sign-in emails always go
first, message notices are batched more tightly, and a second free service (Brevo, 300 a
day) takes overflow. Paying would only ever be your decision.

**Confirmed by D-26 (10 October 2026):** email is the only notice channel. People sign
in with their email address, and there is no mobile app or phone notifications.

**Not decided here:** Localites sending guest invitations itself (D-08); text messages.

**Alternative.** Postmark, with a stronger delivery reputation and a smaller free tier.

---

## ADR-014 — Data stored in Canada

**Needs your approval** (trust and legal positioning; no extra cost expected).

**Decision.** Create the Supabase project in its Canada (Central) region, so the
database, conversations, and shared files are stored in Canada. At signup we'll confirm
the Canada region is offered on the free plan; if it isn't, we'll bring you the
options rather than choose for you.

**Why.** Canadian privacy law (PIPEDA) doesn't strictly require it, but "your messages
and files are stored in Canada" is a simple, reassuring answer. It's free to choose now
and disruptive to change later.

**Caveat.** Cloudflare runs the website in the data centre nearest each visitor (for
local visitors, usually in Canada), so requests may pass through servers elsewhere
when visitors are elsewhere. Stored data stays in Canada. We'll disclose this in the
privacy policy. **A lawyer should review the
privacy policy before launch** (PO-07).

---

## ADR-015 — First-party counts; no third-party trackers

**Decision.** Count what we need (profile visits, website clicks from Stage 1;
conversation and booking counts later) as anonymous rows in our own database. No
Google Analytics, Meta Pixel, or similar.

**Why.** No cost, no cookie banner, no third party profiling parents. The numbers sit
next to the data they describe, so vendor insights can be built directly.

**Extended by ADR-023** (10 October 2026): tracking now covers every vendor interaction,
with detail kept for year-over-year reports (D-22).

---

## ADR-016 — Sentry for error monitoring

**Decision.** Sentry's free tier alerts us when something breaks. Personal data,
**including message text and file names**, is scrubbed before reports leave our
servers.

---

## ADR-017 — One gatekeeper for every status change

**Decision.** Every status change on `vendor`, `event_vendor`, `conversation`,
`review_request`, `review`, and (Stage 4) `invitation` goes through one function per
record type that (1) checks the transition is allowed by the state machines in
[B §4](./B-domain-and-data-model.md#4-lifecycle-states-and-what-they-do-not-mean),
(2) checks **the right side** is making it (only a consumer marks booked; only a vendor
flags), and (3) writes the change and a history row in one transaction.

**Why.** If any screen could set any status, eventually one would say "booked" when
nothing was. One gatekeeper makes honest states enforceable.

**Built for event plans (migration 0012):** the gatekeeper is `changePlan` in the server
(`src/server/events.server.ts`) together with the database's own rule
`enforce_event_vendor_rules`, which refuses any other change. The database writes the history
row itself (`record_plan_change`), so no screen can skip it (ADR-031).

---

## ADR-018 — Localites never handles money

**Needs your approval** (a product commitment).

**Decision.** Localites has no payment, deposit, checkout, invoicing, billing, balance, or
payout capability, and **nothing in the data model prepares for one**. No transaction
tables, no "amount owed" fields, no payment provider. A vendor's *published* prices
("from $150") are listing information, shown as the vendor gave them.

The interface never implies otherwise. Banned words and their replacements are in
[A §6](./A-product-blueprint.md#6-language-rules). The terms of use will state that
Localites is not a party to any arrangement between a consumer and a vendor.

**Plain English.** We introduce people. What they agree and how they pay is between them.

**Why.** Handling money brings regulation, fraud, disputes, refunds, tax and liability.
It changes what Localites is. Not building toward it also keeps the product simpler.

**Consequence.** Files shared in conversations may include invoices. Localites stores and
delivers them like any other file and never reads, totals, or acts on them.

**Revisit when.** Only by a new, explicit product decision. It would mean a new domain,
new legal review, and new terms.

**Extended by D-24 (10 October 2026).** This covers every payment, including vendors
paying Localites for a paid plan or a featured spot. Those are arranged and paid outside
the site; Localites records only which plan a vendor has and its dates (ADR-025).

---

## ADR-019 — Messaging design

**Decision.**
- A **conversation** belongs to exactly one consumer and one vendor (any member of the
  vendor's team can read and reply). It can optionally be about one of the consumer's
  events. At most one general conversation per pair, plus one per event.
- Messages are **stored permanently** (subject to retention rules) and can be removed
  by their author but **never edited**, so a conversation is a reliable record for both
  sides.
- While a conversation is open on screen, new messages appear within about **15
  seconds** (the page checks the server). When you're away, you get a batched email
  (ADR-013).
- **Unread counts** are private to each person. There are **no read receipts, typing
  indicators, or online status**, as your brief asks.
- Only consumers start conversations; vendors reply (enforced in the database).

**Why polling, not a live connection?** A live connection (websockets) would mean the
browser connects to a real-time service directly, a second security surface (ADR-004).
Checking every 15 seconds through our own server reuses the same permission checks,
costs nothing extra, and is plenty fast for planning a party.

**Alternatives.** *Supabase Realtime* (instant delivery; adds browser-to-database
connections). *A third-party chat service* (Stream, Sendbird), with recurring cost and
messages held outside our database and outside Canada.

**Revisit when.** People tell us they want faster replies while actively chatting. The
switch to Realtime is contained in the messaging module.

---

## ADR-020 — Files in conversations

**Decision.**
- Allowed: JPEG, PNG, WebP images and PDFs. Up to 10 MB each, 5 per message.
- Stored in **private** storage (Canada). Opened only through short-lived links
  (minutes) issued after checking that the person is in the conversation.
- PDFs download rather than open inside Localites; images display. Image location data
  (GPS) is stripped on upload.
- File type is checked from the file's contents, not just its name.
- Localites doesn't read, scan the text of, or interpret files.

**Known gap: malware scanning.** We're not proposing automatic virus scanning at
launch: it needs a paid service, and restricting to images and PDFs removes most of the
risk. A short note in the conversation reminds people to open files only from people
they're working with. We'll propose scanning if reports show it's needed.

---

## ADR-021 — "Booked" is the consumer's own record

**Needs your approval** (how the product describes bookings).

**Decision.** `event_vendor.status = booked` is set **only by the consumer**, through
"Mark as booked" on their event. It's shown as *"You marked this booked"* to the
consumer and *"[Name] marked you as booked for Sat 14 Nov"* to the vendor (D-13, R3).
It is never described as confirmed. The vendor can flag it as not real; a flagged
booking can't lead to a review until the platform team resolves it.

**Why.** It gives consumers a simple planning tool and gives Localites a truthful signal to
ask for feedback, without pretending to be a booking system.

**Built (13 October 2026, D-40, D-41):** the business sees "{Name} marked you as booked" with
the date, the town and about how many guests; never the kind of event (D-40). When it flags a
booking, the team and the person are both told (D-41). Resolving flags is Stage 3.

---

## ADR-022 — One account per person; vendor capability through team membership

**Needs your approval** (sign-up experience; part of D-13). **Accepted: D-13, 10 October 2026.**

**Decision.** Everyone signs up the same way. Every account can act as a consumer. A
person acts **as a vendor** only through membership of a vendor's team. Someone who is
both switches between "My events" and "My business".

**Why.** A local face painter is also a local parent. Two logins would be confusing, and
two separate account systems would duplicate people, which the brief forbids. The
screens keep the two sides clearly separate.

**Confirmed by D-29 (10 October 2026):** personal and business are joined in one login;
a vendor switches between them from the menu without signing out.

**Alternative.** Separate consumer and vendor sign-ups. Simpler to explain on day one;
creates duplicate identities later.

---

## ADR-023 — Activity tracking for vendor reports

**Needs your approval** (privacy). **Accepted: D-22, 10 October 2026.**

**Decision.** Record how people interact with each vendor in our own database:
- **Meaningful actions** (from Stage 1: profile view with its source, website or phone
  tap; from Stage 2: save, inquiry, conversation started, message sent, reply time, added
  to an event, marked booked) are stored as individual records with the time, the vendor
  and the person: their account if signed in, otherwise a random visitor ID kept in our
  own cookie. Kept with no deletion date, so year-over-year reports can use them
  (D-22). When someone deletes their account, their records stay but the link to them
  is removed.
- **"Seen in search"** is counted when a vendor's card is at least half on screen for a
  moment, once per visit per page. The browser sends these in one batch per page, not one
  request per card, and they're stored straight away as **daily totals** per vendor,
  placement (search, category, collection, Featured) and town, never as individual rows.
- Each night, the detailed records are added into the same **daily totals**, which are
  kept. Reports read only the totals.
- Vendors and anyone outside the team see totals only. The Localites team can look at the
  detail; every look is recorded in the audit log.
- If the database nears its free limit, older detailed records move to archive storage
  (the free storage that holds backups). They're still kept and still usable for reports;
  they just leave the live database.

**Why.** Vendor reports are central to selling featured placements and renewals (D-22).
Keeping it in our own database costs nothing, involves no third party, and puts the
numbers beside the data they describe. Storing "seen in search" as totals keeps us inside
the free database: at 1,000 visitors a day seeing about 30 cards each, individual rows
would add about 900,000 a month; daily totals add a few thousand. Detailed records of
actions are far fewer: at 1,000 visitors a day making about 4 tracked actions each, they
grow by roughly 200 MB a year, which is why older detail moves to archive storage rather
than being deleted.

**Extended by D-30 (10 October 2026): "the more the better".** Also recorded, built in
Stage 1 step 5: position in search and category lists; returning visitors; time on the
profile, photos opened and services viewed; email, directions, social and share taps;
where visitors came from (Google, shared link, Localites search, category); phone or
computer; approximate town (city level, from Cloudflare, no third party); comparisons
with the category average and rank in category; Suggest-a-business requests that named
the business; and search demand per category, including searches that found nothing.
**Search words are tracked like everything else**, linked to the visitor ID or account,
because the product owner wants every action available to improve the app; the privacy
policy says so in plain words. As with all detail, only the Localites team can see it,
every look is logged, and vendors see totals only. A search can contain anything (even
someone's name or number), so it is never shown to vendors word for word with who typed
it.

**Rejected.** Google Analytics or similar (third-party profiling, consent banners, and no
reliable link to individual vendors). Storing every impression (outgrows the free
database within months).

**Revisit if** the database approaches 80% of its free limit (move older detail to the
archive), or vendors need same-day numbers.

**Privacy note.** Canadian privacy law expects personal information to be kept only as
long as it's needed for a stated purpose. The privacy policy will name year-over-year
vendor reporting as that purpose, and the legal review (PO-07) checks it. If the lawyer
advises a limit, detail older than that limit can have the link to the person removed,
which keeps every count intact.

---

## ADR-024 — Inquire, for unclaimed or unverified vendors

**Needs your approval** (user experience). **Accepted: D-04 and D-05, 10 October 2026.**
Built in Stage 2, with messaging.

**Decision.** A vendor that hasn't claimed its listing, or isn't verified, shows
**Inquire** instead of **Message**. A signed-in person taps it and can add a note and
choose one of their events to mention. We save the inquiry (`vendor_interest`), count it (ADR-023), and email
the Localites team at supportlocalites@gmail.com with the vendor, the person's name and email,
and anything they chose to share. The person sees: *"This business isn't on Localites yet.
We've passed your interest to our team, who'll get in touch with them. We'll let you know
if they join."* Nothing says or suggests that the vendor received a message.

**Why.** Every contact is recorded and counted. Interest becomes a warm, truthful
invitation for the business to join. Nobody is misled about delivery.

**Not planned.** Relaying messages by hand (D-05). Once a business joins, conversations
happen directly on Localites (D-17).

**Cost.** Inquiry emails count toward the free plan's 100 a day. If they become frequent,
they're bundled into a few summary emails a day.

---

## ADR-025 — Paid vendor plans: recorded in Localites, paid for outside it

**Needs your approval** (business model). **Accepted: D-24, 10 October 2026.**

**Decision.** Some features are for vendors on a paid plan, starting with the vendor
dashboard (D-22). Localites records only **which plan a vendor has and its start and end
dates**, set by an admin and written to the audit log. The vendor pays the Localites team
outside the app (for example, an invoice paid by Interac e-Transfer). No prices, card
details, payment status or invoices are stored. Featured placements are sold the same
way.

**Why.** The original brief rules out payment processing, billing and card storage
until explicitly approved, and ADR-018 keeps money out of the system. Recording a plan's
dates is enough to switch features on and off, costs nothing, and needs no payment
company.

**Not planned.** Online payments of any kind (D-24). Changing that would need a new
product decision, a payment company, a security review and new terms.

**Featured placements built for plans (D-43, 13 October 2026):** `featured_placement` records
only the business, the kind of event, the first and last day, an optional team note, and who
added or ended it. No price or payment column exists. See ADR-031.

---

## ADR-026 — Every review is approved by an admin

**Needs your approval** (trust). **Accepted: D-06, 10 October 2026.**

**Decision.** Every new review starts as pending and is invisible to everyone except its
author and the platform team (already enforced by the database). Localites emails the
team at supportlocalites@gmail.com for each new review, with the business, the star
rating and a link to that review in the admin area. An admin signs in and taps **Approve**
(publish) or **Decline** (with a reason). Admin rights are checked on the server.

**Why not approve straight from the email.** A one-tap approve link in an email can be
forwarded, and email security scanners open links automatically, which could publish a
review nobody read. Signing in keeps every approval tied to a named admin in the audit
log.

**Cost.** Review emails count toward the free plan's 100 a day. If they become frequent,
they're bundled into a daily summary.

---

## ADR-027 — Suggest a business

**Needs your approval** (user experience). **Accepted: D-25, 10 October 2026.** Stage 1.

**Decision.** Search results, category pages and empty results carry the line *"Don't see
who you're looking for? **Suggest a business**."* It opens a short form with three
questions: the business's name (required), its website or social page (optional), and a
phone number or email for it (optional). We save the suggestion (`vendor_suggestion`)
with the category or search the person was on, count it (ADR-023), and email the team at
supportlocalites@gmail.com. The person sees: *"Thanks. Our team will look into this
business and add it if it's a fit."*

- **Open to everyone, no account needed.** Spam protection: a hidden field that only
  bots fill in, and a limit of a few suggestions per visitor per hour (IP addresses used
  briefly for this and never stored, as in E §7). If spam still gets through, we add
  Cloudflare's free Turnstile check.
- **From Stage 2**, a signed-in person's suggestion is linked to their account, and they
  get an email when the business is added.
- **The team vets every suggestion** in the admin list, which shows likely duplicates of
  businesses already on Localites. A business goes live only from its own public
  information, marked unclaimed (D-03). Details the person typed are used only to find
  and contact the business, never published, because a phone number or email someone
  else gives may be personal.

**Why.** The directory grows from what local people actually want, and each suggestion is
a warm lead for the team, at no cost.

**Cost.** Suggestion emails count toward the free plan's 100 a day; if they become
frequent, they're bundled into a daily summary.

---

## ADR-028 — Signing in with an emailed code, and claiming a business

**Needs your approval** (user experience). **Accepted: D-32, D-33 and D-35, 10 October
2026.** Stage 1.

**Decision.** Everyone except the team signs in at **/join** ("Sign in or create an
account", D-27) with a 6-digit code emailed to them: no passwords for the public. A
signed-in person can claim a published business; the team checks each claim and approves
or declines it on the **Claims** page. The team keeps its own sign-in (password, then an
authenticator app, E §2).

*Signing in (D-32).*
- One screen for new and returning people: email address → code → (new people only) their
  name. Supabase sends the code (its "Magic link or OTP" and "Confirm sign up" emails,
  using our template `emails/sign-in-code.html`: the code only, no link, no name).
- **Replies never say whether an address has an account.** Every outcome of "send me a
  code" gets the same answer, and every unusable code (wrong, expired, too many tries, no
  account) gets the same words.
- **Our own limits**, because Supabase has no limit on wrong guesses for one code: 5 wrong
  guesses per code; 3 codes per address per hour; 60 codes a day across the site (leaving
  room in Resend's 100 a day); 10 tries a minute per internet address (Cloudflare's rate
  limiter, never stored). Addresses are stored only as a SHA-256 fingerprint, for two days.
  Codes last 15 minutes.
- **We add a person to Localites (`app_user`) only after they've proved the address and
  typed their name.** The name is never taken from Supabase, because Supabase keeps
  whatever was sent with the first code request for an address, by anyone.
- **A code sign-in never opens the team pages**, even for an admin: the admin gate requires
  a password sign-in, so it signs the person out and sends them to the team sign-in.

*Claiming (D-29, D-33, D-35).*
- Only published listings can be claimed. The claimant says how they're connected (owner,
  manager, employee, something else), may add a note for the team, and confirms they're
  allowed to manage the listing. One person may have 3 claims waiting at a time.
- **The team decides, on evidence (D-33).** The Claims page shows whether the claimant's
  email address is at the business's own website (`src/lib/domain-match.ts`: the same
  domain or a subdomain of it; personal email services and website platforms such as
  Facebook or Wix never count). If it isn't, the team contacts the business at the phone
  number or email **the business publishes itself**, never the details in the claim.
  Approving asks how it was confirmed, and "their email matches" is refused when it
  doesn't. A team member can't approve their own claim.
- **First approved wins (D-35).** Approving, in one database transaction: the claim is
  approved; the listing becomes claimed; the claimant becomes its owner; every other open
  claim for it is declined with "Another claim for this business was approved."; the
  status history and audit log record it all. The database allows only one active owner
  per business. A claimed listing shows "This business manages its own listing" and can't
  be claimed again.
- **Declining needs a reason, which is emailed to the claimant.** If no other claims are
  waiting, the listing goes back to unclaimed.
- Approving a claim doesn't make a business verified: verification is a separate check with
  recorded evidence (`verification_record`, B §3).
- Emails (Resend, ADR-013): "we've received your claim" to the claimant, a note to the team
  linking to the Claims page, and the decision. Each email to a person is recorded in
  `notification` as sent or failed, with the reason; replies go to the team's address.

**Why.** Codes avoid passwords people forget or reuse, and need nothing but the email
address we'd use for notices anyway (D-26). A claim is the moment someone gets control of
a business's listing, so a person on the team checks every one, with evidence the
claimant can't fake.

**Alternatives.** *Sign-in links* — a link in an email signs in whoever opens it, on
whatever device, and is easily forwarded; a code is typed on the device being signed in.
*Passwords* — more to forget, reset and protect. *Automatic approval when the email
matches* — rejected for now; the team still decides (D-33).

**Known limits.** Supabase sees every request as coming from Cloudflare, so its own
per-internet-address limits apply to the whole site at once (ours apply per visitor).
**Update (12 October 2026): the "are you human" check is built and parked.** The product
owner prefers signing in with the 6-digit emailed code alone (D-38), so the check stays
switched off; its code is kept so it can be switched on later by adding two keys in
Cloudflare (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`). While parked, the two known
limits below still apply. When switched on (Cloudflare's free Turnstile): "Email me a code", "Send a new code" and checking a code each need a fresh
pass, made for this form on this site, which Cloudflare confirms to our server before any
code is sent or any guess is counted; each pass works once. If Cloudflare can't be asked,
the form is refused with "try again in a minute", never let through. It is on exactly
when both its keys are in Cloudflare. Switched on, it answers the two known limits below:
using up the day's codes or one person's codes and guesses would need a person for every
try. The page needs JavaScript
for the check. Suggest a business keeps its own protections (ADR-027).
An address that asks for a code but never finishes leaves an unconfirmed Supabase
account; a clean-up comes later. Supabase gives the same answer for "a code went to this
address under a minute ago" and "the site has sent too many emails"; we tell them apart
by our own records. Owners can't edit their listing yet: that comes next (D-34).

**Cost.** $0: Supabase's sign-in and Resend's free plan (sign-in emails go through Resend
once PO-13 is done).

**Revisit when.** Sign-in emails approach Resend's daily limit, or the team can't keep up
with checking claims.

**Update (11 October 2026, after an independent review; the decision is unchanged).**
- Requests for a code and guesses at a code are now counted *before* Supabase is asked,
  under a lock per address. Many guesses sent at the same moment can't get past the limit
  of 5, and the limits behave the same whether or not the address has an account. While
  new accounts are closed in Supabase, every refusal gets the same neutral reply.
- Because a request counts even when Supabase sends nothing new, asking again within a
  minute restarts the count of guesses for the code already sent. With 3 requests an hour,
  that still allows at most 15 guesses an hour at a 1-in-a-million code.
- The "come back to this page" address after signing in is now read the way a browser reads
  it, so hidden characters (a tab, a backslash) can't turn it into a link to another site.
- IPv6 visitors are counted by their /64 block for the per-minute limit, since one
  connection controls a whole block.
- The stored fingerprint of an address is a plain SHA-256, not the address itself. It stops
  addresses being read straight out of the table, but anyone holding the database could
  check a guessed address against it. Rows older than two days are removed each time a new
  code is asked for.
- **Known limits added:** (1) anyone can use up the site's 60 codes a day with throwaway
  addresses, from many internet addresses or about six minutes from one, which stops
  sign-in for everyone until the day rolls over; (2) anyone who knows a person's email can
  use up that address's 3 codes an hour, or its 5 guesses, locking that person out for up
  to an hour. The remedy for both is Cloudflare's free "are you human" check (Turnstile)
  on "Email me a code", recommended before the public launch (roadmap, Stage 1).

---

## ADR-029 — Owners edit their own listing

**Needs your approval** (user experience). **Accepted: D-34, 11 October 2026.** Stage 1
(screen V2; the team's side on X1 and X2).

**Decision.** An approved owner (D-35) edits their business at **/vendors/<name>/edit**, a
page laid out exactly like the public business page, with dashed boxes where they can type.
**View as a visitor** shows the real public page (the same component) with what they've
typed, before saving. One **Save changes** button; changes are live at once.

- **Owners can change:** short description, About, website, phone, and services (name,
  details, how the price is shown and the amount, show or hide, add new ones).
- **Team only, shown as plain text:** web address, town and categories
  (they decide where it appears in search), email, and status. "Email us to change them."
- **Changed by D-54 (M20, 19 October 2026): the business name.** It was team only (the usual
  way to pose as another business, and what the claim was checked against). Now the **owner**
  (not a manager) changes it on its own page, `/vendors/<name>/name`: at most once in 30 days
  (a change the team undid doesn't count), after the language check; the web address follows
  and the old one keeps working; it's an owner save like any other (`audit_log` and
  `owner_change`, flagged `name`, so the team gets a "check now" email and can undo it). The
  database keeps every former name (`vendor_former_name`, migration 0051), and a customer's
  earlier conversations, plans and reviews show "New name (dba Former name)". When the team
  renames a business, its owner is emailed.
- **Only the owner, checked on every request in the database:** an active `owner`
  membership of a listing that isn't archived. Anyone else (including team admins, who use
  the team page) gets "You can't edit this listing". Every service write is scoped to the
  business; a service id from another business stops the whole save.
- **Only what they changed is written.** The page carries what it loaded; a save writes only
  the fields the owner changed, so it never quietly reverses a team change. If the team
  changed the same field meanwhile, nothing is written and the owner is told ("Our team
  changed this while you were editing…", with what it says now). A box left as it was
  (ignoring spaces and line breaks the save would tidy anyway) keeps exactly what's stored:
  it isn't checked again and isn't a change, so text the team wrote never blocks an owner's
  save. The team's own Details and Services forms work the same way in reverse: they write
  only the boxes the team member changed, and refuse ("The owner changed this while you were
  editing…") when the owner changed the same box since the page loaded.
- **Safety:** web and email addresses are refused in descriptions, naming the words that look
  like one ("put your website in the Website box"; a missed space after a full stop, like
  "area.To", isn't taken for one); shortened links, bare internet addresses and addresses
  with an "@" in them (which go to another site) are refused as websites; invisible
  characters are removed; 20 saves a business a day; 10 a minute a person. A save that
  started while the team was removing the owner waits, then sees the removal and is refused.
  A web address the team changed while the page was open still saves, then moves to the new
  address.
- **Recorded:** each save is one `audit_log` entry (before and after) plus an
  `owner_change` row for the team's review state (in a daily note yet, alerted, undone).
  `audit_log` stays the one record of what changed.
- **The team:**
  - a **"check now" email** when a website moves to another site or a phone number changes
    (at most one per business an hour, 20 a day; each email's place is taken under one lock
    before it goes, so quick saves can't each get one);
  - a **daily note** (Cloudflare's free scheduler, 12:00 UTC, retried at 14:00) listing every
    save since the last note; one a day at most; nothing sent when nothing changed; a failed
    send is retried and its saves stay waiting; its status shows on the Listings page;
  - **Undo** on the listing's team page: tick the lines to put back; a line changed again
    since can't be undone first; a service the owner added is hidden, never deleted; one
    undo per save (lines left unticked stay as the owner set them, and the card then says
    which were put back and which kept); the owner is emailed what changed back and why,
    and sees it on their edit page (only their own saves: a new owner never sees what the
    team told the last one);
  - **Remove owner** (with a reason, emailed to them): ends their access and makes the listing
    claimable again. A website still holding what an owner typed in is flagged on the Claims
    page and can't be used as "their email is at the business's website" evidence (checked on
    the server), whether or not other parts of that save were undone.
- **Business numbers** are not part of this: they come later on an Analytics page the team
  switches on per business (D-37).

**Why.** Owners keep their own listing fresh without waiting for the team, which is what
makes claiming worth it; the team keeps control by reviewing every change and undoing in one
click, instead of approving every edit before it shows.

**Alternatives.** *Edits wait for team approval* — safer, but slow and more work for the team
(rejected in D-34). *A plain form* — simpler to build, but owners can't see how it will look.

**Known limits.** Photos aren't editable yet (no file storage). An undo is one per save. The
daily note and alerts are emails through Resend's free 100 a day, shared with other emails.
The public page's "Your business? Edit your listing" link shows to anyone signed in (checking
ownership there would cost a sign-in check on every page view); anyone else who follows it
is told plainly that only the owner can edit.

**Review (11 October 2026).** An independent review of the first version found 14 confirmed
problems and 26 smaller ones; all were fixed the same day: phantom changes and blocked saves
from the team's text, details added to an existing service that couldn't be undone, a new
owner seeing the last owner's undo notices, a partly undone save hiding the past-owner
website warning, the team's forms overwriting newer owner edits, undo errors that never
showed, unsaved typing lost on the phone's Back gesture, and others (G, release notes).

**Cost.** $0: Cloudflare's scheduler and rate limiter are free; emails within Resend's free
plan.

---

## ADR-030 — Counting what a real browser confirms, and the Analytics page

Engineering, within D-22, D-30 and D-37 (12 October 2026). Extends ADR-023. Screens V10
(owners) and X18 (the team).

**Decision.**
- **Nothing is counted when a page loads.** The page's server signs a short note of what it
  showed (the businesses in a list, in order; or the business on its page, with where the
  visitor came from, read from the request). The page's script reports back with that note
  when something really happened. Search engines and link previews get no note (they run
  no script anyway), so they're never counted. A page can't change which businesses it
  showed, in what order, or where the visitor came from: the note is signed with a secret
  (`ACTIVITY_KEY`) only the server has. Counting is on exactly when that secret is set (at
  least 32 characters).
- **Each note belongs to one browser.** The visitor cookie is signed (`<id>.<signature>`),
  so an id can't be made up; the page sends a new browser its signed cookie with the page,
  and the note names that browser. A report is accepted only with that same cookie, so a
  note can't be passed around. New browsers (and any unsigned or made-up cookie) are limited
  to 20 a minute per internet address, so a script can't pose as endless visitors. Going
  Back to a page reuses the note it had, so the same visit isn't recorded twice.
  A page opening keeps its "place in a list" only if that list page was recorded in the
  last 12 hours.
- **Daily limits on what's kept:** one browser keeps at most 300 actions and 100 searches a
  day, and the whole site 10,000 actions and 5,000 searches a (Toronto) day; past those,
  more aren't kept until the next day, so nothing can fill the free database (D-20). The
  team's Activity page shows the day's use, and reports name any day the site-wide limit
  was reached, so its numbers are never silently low.
- **Definitions** (what the owner's page says, word for word):
  - **Seen in lists:** a business's card at least half on screen for at least a second, in
    search results or a category list; once per list page shown. Stored only as daily
    totals (with the place in the list), never one by one (ADR-023).
  - **Page opened:** the business's page became visible in a browser. At most 3 a day per
    browser per business count; the rest stay in the detail, marked.
  - **Website and phone taps:** taps on Visit website and Call; at least the real number.
  - **Time on the page:** while it was on screen, up to 30 minutes.
  - **Different visitors and came back:** by browser (the `__Host-lc_vid` cookie), for
    whole calendar weeks, months and the year so far; "came back" means they had opened
    the page on an earlier day.
  - **Days are Toronto days.** Totals run to the end of yesterday.
- **Whose visits.** A browser that has opened a signed-in page is linked to that account
  (`visitor_account`). Visits by the business's own people, and by the Localites team, are
  marked in the detail and left out of every total.
- **The nightly count** runs with the daily note (12:00 and 14:00 UTC). It adds each
  finished day's detail into the totals, replacing (never adding to) what it wrote before,
  so a day can be counted again safely. Up to a week of missed days catch up by themselves;
  older ones from the team's **Count this day again**.
- **The owner's Analytics page** (`/vendors/<name>/analytics`): only the business's current
  owner, only when the team has switched it on for that business, never for an archived
  listing, checked in the database on every request. It shows totals, never who. In each
  breakdown (town, device, time of day, where people came from), rows under 5 are grouped as
  "Others, each fewer than 5", and with under 10 page opens in the period no breakdown is
  shown; visitor counts under 5 show as "fewer than 5". The category average and rank only
  when the category has at least 5 published businesses. Days before counting began, and
  days the nightly count hasn't reached yet, are said so, never shown as zeros, and nothing
  is compared with a period that wasn't counted. No emails.
- **The team** (`/admin/activity`, and each listing's **Activity** page): category figures,
  search demand, the nightly count, database space; each business's numbers; the switch
  (recorded in the audit log, with a note). The detail (each action, by browser) and the
  words people searched are shown only after the look is written to the audit log, in the
  same transaction.
- **Limits:** a report must come from Localites' own pages (its Origin, as JSON), at most
  4 KB, 60 a minute per internet address (Cloudflare's free limiter).

**Why.** Counting on page load would count every bot and link preview; counting what the
browser claims without a signed note would let anyone inflate any business. Signed notes
keep the database untouched until something real happens, at no cost.

**Alternatives.** *Count on page load* (simplest, but counts bots, and can't tell what was
on screen). *Store a ticket per page in the database* (also stops forgery, but writes a row
for every page load, bots included). *A third-party analytics service* (rejected in
ADR-023).

**Known limits.** People with scripts blocked aren't counted (the numbers say "at least").
A determined script can still add counts (and can claim any site sent it, since that's read
from what the request says); the browser-tied notes, the new-browser limit, the 3-a-day cap,
the daily limits and the team's "unusual" flag keep that small and visible, and the owner's
numbers are labelled as approximate. Many people sharing one internet address (a library)
can meet the new-browser limit; their visits then simply aren't counted. A brand-new browser
that opens several Localites pages at the same moment is counted in one of them. Grouping
small figures stops a single visit being shown on its own, but someone comparing "This year
so far" every morning could still notice one new visit; the page never shows who. The town comes from the internet connection and is
often a nearby larger town. A business's own visits are recognised only on browsers that
have opened a signed-in page. Public pages must never be put behind a shared cache: each
answer carries its own note. Email, social, share, directions and photo taps come with
those features.

**Cost.** $0: our own database (about 200 MB a year at 1,000 visitors a day, ADR-023),
Cloudflare's free scheduler and limiter.

---

## ADR-031 — Who is acting, in the database (planning an event)

Engineering, within D-13 (R3, R4, R5, R8), D-18 and D-39 to D-43 (13 October 2026). Builds
the per-person rules ADR-004 promised, for events, plans and saved businesses. Migration
`0012_event_plans.sql`; screens C1–C6, A5, V1-lite, V8, X12 and X16 (read-only).

**Plain English.** The website already checks who you are on every page. For planning, the
database now checks too: every request tells it *which person* is asking and *for which side*
(planning their own event, acting for their business, or working as the Localites team), and
the database's own rules decide what that side may see or change. If our website code had a
bug that forgot to check, the database would still refuse, or show nothing.

**Decision.**
- **Who is acting.** The server opens one transaction per page or form and, as its first
  step, sets three settings that last only for that transaction: the person, the side
  (`person`, `business` or `team`) and, for a business, which one
  (`src/server/acting.server.ts`: `actAs`, `actingAs`). The database reads them through
  `acting_user()`, `acting_side()`, `acting_vendor()`, `acting_for_business()` (a current
  owner or manager of a business that isn't archived) and `acting_as_team()` (a current team
  admin). Nothing set means nothing is visible. **The side follows the page:** `/events…`,
  `/saved` and `/vendors/<name>/add` act as the person; `/business` and
  `/vendors/<name>/bookings` act as the business; `/admin/…` acts as the team, after the usual
  team gate.
- **Rules per side (row-level security on all seven new tables, written out one by one; no
  blanket rule for the app):**
  - **The person** reads and changes only their own events, plans and saves.
  - **A business** reads only the plan rows that mark it **booked**, and the event's date,
    town and guest estimate for those; it may flag such a row once and change nothing else.
  - **The team** reads only flagged bookings (and those events), never anyone's private
    details or saves; it manages event types, suggested kinds of business and featured
    placements.
- **Private details live in their own table.** `event_private` holds the event's name
  (required, D-39), where it is, the ages, the budget and the notes. Its only rule is "the
  host, acting as the person". No business rule and no team rule exist, so neither can read
  it even by mistake (E §4.2).
- **No loops between rules.** `event_vendor` keeps a copy of the host's id, held to the event
  by a two-column foreign key, so its rules never need to read `event`.
- **The database owns the times and the history.** When a business is marked booked, removed,
  an event cancelled or a booking flagged, the database sets the time and who did it,
  whatever the server sent; the app has no right to write those columns. Every status change
  and every flag is written to `status_change` by the database itself (ADR-017).
- **Refusals carry a code** (`LP100`–`LP110`) that the server turns into plain words:
  can't be changed, not yours (shown as "not found"), cancelled, kind of event not offered,
  town not offered, date outside 60 days back to 3 years ahead, business not listed, your own
  business, change not possible, already flagged. "Not yours" is always answered as a plain
  404, so nobody can tell someone else's event exists.
- **Every event has a name.** A check at the end of each transaction refuses an event created
  without its private row (`LP109`).
- **Limits** (so one person can't flood anyone): 10 new events a day and 50 open at once; 40
  businesses per event; 15 "marked booked" a day; 500 saved; 30 planning changes a minute
  (`PLAN_LIMIT`, Cloudflare's free limiter). Emails to businesses: a repeat of the same email
  about the same booking within a day is held back, "no longer booked" goes only to a business
  that was told it was booked, and at most 30 planning emails a day reach any one person. Each
  decision is a `notification` row with an honest status (`sent`, `failed` or `suppressed`
  with the reason).
- **What a booked business sees (D-40):** the person's name, the date, the town and about how
  many guests. Never the event's name or kind, the start time, where, the ages, the budget,
  the notes, the other businesses on the plan or the person's email.
- **Flags (D-41):** the business may say "This isn't right" once, with an optional note. The
  team is emailed (no note, no person's name) and sees it on **Booking flags** (read-only,
  every look recorded in `audit_log`); the person is emailed politely and sees a quiet line on
  their plan. The note is team-only. Resolving flags is Stage 3.
- **Featured placements and ideas per kind of event (D-43):**
  - `event_type_category`: the kinds of business suggested for each kind of event. Anyone may
    read it; only the team changes it.
  - `featured_placement`: a business featured for a kind of event between two Toronto dates,
    with an optional team-only note. **No money columns at all** (D-16, D-24, ADR-025). Only
    the team reads or writes it. A placement can't be edited afterwards, only ended early,
    once; the database records when and by whom. It refuses a placement in someone else's
    name, for a business that isn't published, or one already over.
  - People see featured businesses only through `featured_for_type()`, which returns just the
    business, for at most 3 current placements of published businesses (earliest start
    first): never the note, never who added it.
  - **Rules for featuring:** always labelled **Featured**, with the line "Featured businesses
    are promoted by the Localites team." always visible; set only by the team; no payment
    through Localites (any arrangement happens outside the site); it never changes search
    results, their order, reviews or ratings. It appears only on a person's own plan.
  - Every change by the team (types, suggestions, placements) writes `audit_log` in the same
    transaction.
- **Counts for the team only (D-42):** `plan_counts_for_team()` (saved, added to a plan,
  marked booked, per business) and `plan_type_counts_for_team()` (events planned and marked
  booked per kind of event, with "no type given" as its own row) return totals for whole
  Toronto days and refuse anyone not acting as the team. Never who, never which event. They
  are not on a business's Analytics page and not in the nightly activity count.
- **Fails closed.** A forgotten "who is acting" shows empty pages, never someone else's data.
  Functions that must see past the rules (the featured list and the two counts) run with the
  migration's rights, return only what's described above, and only the app's database role may
  run them. Migration 0012 stops unless its role can see past row-level security, so these
  can't silently return nothing.

**Trust model.** This guards against **our own bugs** in the website code: a missing check,
a wrong id, a page on the wrong side. It does not protect against someone who takes over the
server itself, which could set any settings it liked. That is what the separate, restricted
database login (`app_server`, ADR-004) and keeping secrets out of the code are for.

**Alternatives turned down.**
- *A database role per side, switched with `set role`:* the strongest model on paper, but it
  has never been tried through Hyperdrive and Supabase's pooler, isn't tested in CI on that
  stack, and needs every grant repeated for three roles, so a missing grant would only show
  up on the live site.
- *All reads through "security definer" functions:* each function would bypass the rules,
  so the rules would protect nothing; kept only for the narrow functions above (featured list,
  team counts, and the business's view and flag).
- *One rule that lets the app see everything (`using (true)`), as Stage 1 tables do:* then
  only the website's code would stand between one person and another's plans.

**Known limits (residual risk, stated plainly).**
- **What a business sees is enforced by the database (review fix, 13 October 2026).** A
  business has no rules on `event` or `event_vendor` at all: it reads its bookings only
  through `bookings_for_business()`, which returns exactly D-40's summary (the person's name,
  the date, the town, about how many guests; coming up or earlier is by date, so no time is
  revealed), and flags only through `flag_booking()`. The business's note is kept in its own
  team-only table (`event_vendor_flag_note`), which the person's rules can't reach. Plan row
  ids are random, so an id doesn't reveal when the person started considering a business.
  A person's email on `app_user` is still hidden by the server's named queries (as in Stage 1).
- **A flag belongs to one marking.** If the person un-marks and marks again, the old flag no
  longer counts and the business can say again that the new marking isn't right.
- **Bookings marked before a business joined** (D-44, migration 0013) are shown to it only
  while the event is still to come; past ones stay hidden, so a new business can't gauge how
  popular it has been. "Joined" is when its earliest current owner or manager started.
- **Supabase's `postgres` role** must be able to see past row-level security for 0012 to
  apply; it is expected to, but this is first checked when the migration runs on the test
  project. If not, the migration stops, nothing changes, and the update isn't deployed.
- **An owner using a second account** to mark their own business booked can't be prevented;
  flags and Stage 3 review approval are the backstop.
- **Account deletion** isn't built yet (E §8). When it is, it must also remove saves, plans,
  private details and events, in a new reviewed migration.
- **Featured impressions: later.** How often each featured business is shown isn't counted
  yet (D-43); no activity kinds were added.
- **Activity counting of saves, adds and bookings is deferred** (the D-30 funnel): the nightly
  count isn't built for them, and D-42 gives the team its totals another way. The facts are
  already stored (`saved_vendor`, `event_vendor`, `status_change`), so a later migration can
  count them; a save that was un-saved is the only thing lost.

**Engineering defaults (not owner decisions; easy to change):** dates from 60 days back to 3
years ahead; cancelling is final (no archive or undo in 2A); owners and managers see
**Bookings marked** (today only owners exist, D-29); staff see nothing.

**Cost.** $0: our own database and Cloudflare's free limiter. Each page is one transaction
of one to three queries, well inside the free plan's 10 ms of CPU.

---

## ADR-032 — Guests' links made from a key, never stored (Stage 4)

**Date:** 14 October 2026. **Status:** Accepted (migration 0033).

**Context.** D-08: the host sends each guest a personal link from their own phone, and may
need to copy it again days later. E §5 says a copy of the database must open no invitation.

**Decision.** A guest's link is `/i/<token>`, where the token is an HMAC-SHA-256 of the
guest's id and a version number under `INVITE_KEY`, a secret only the site has. The database
stores only the token's SHA-256, so the host's page can make the link again at any time and a
copy of the database alone opens nothing. A new link (version + 1) replaces the old one at
once; the guest's reply is kept. The link is swapped at once for a short-lived cookie
(`__Host-localites-invite`, a day) and the guest lands on `/invite`, so the address bar and
history don't keep it. The `/i/<token>` request itself can appear in Cloudflare's own request
logs, which only the account's owners can read and which are kept a few days. A guest has no account and no side: `invitation_for()` and
`invitation_reply()` find their row by the hash and return only their own invitation.

**The key.** The deploy makes `INVITE_KEY` once, as a random value nobody sees, and stores it
in Cloudflare as a Secret; it never replaces it (every link already sent would stop working):
only a clear list of the site's secrets without it makes one, and any doubt changes nothing.
**Known limit:** the host holds every guest's link, so they could reply as a guest.
If it is ever lost, links stop working and the host makes new ones.

**Cost.** $0: Cloudflare's own crypto and rate limiter (`INVITE_LIMIT`, replies per address).

## ADR-033 — The language check: a word list and Cloudflare's AI checker (D-50)

**Date:** 18 October 2026. **Status:** Accepted (migration 0036).

**Context.** D-50: what business owners save, reviews and businesses' replies are checked for
offensive language before they show; a flagged owner save is paused and the team emailed. The
running cost must stay $0 (D-20), and a save must never fail because a checker is down.

**Decision.**
- **Two checks, on the server** (`src/server/moderation.server.ts`): a word list of strong swearing
  and slurs, whole words only, with look-alikes ("sh1t", "f*ck") caught; and Cloudflare's Workers
  AI with Llama Guard 3 (`@cf/meta/llama-guard-3-8b`) through the Worker's `AI` binding, counting
  only hate, threats and violence, crime, sexual content, self-harm, weapons and defamation
  (privacy is left out: a business's own phone number trips it). The AI checker gets 4 seconds;
  if it fails, is slow or the free daily allowance (10,000 "neurons", reset at midnight UTC) is
  used up, the word list's answer stands and the log says so. On the free plan, Workers AI
  refuses past the allowance rather than billing.
- **Only the words that changed** are checked (an owner's short description, About, service
  names and details), before the database is opened, so a slow checker never holds a lock.
- **A flagged owner save is held whole** (`owner_edit_hold`): nothing is written to the listing.
  One waits per business; the owner can withdraw it, and can't save again until it's dealt
  with. The team puts it live from **Held changes**, which makes the save exactly as an owner's
  save (only what changed, refused on a clash or if they no longer own or manage the business,
  recorded as theirs in `audit_log` and `owner_change`, so the daily note and undo work), or
  declines it with a reason. The owner is emailed either way; the team is emailed when one is
  held (at most 20 a day).
- **Reviews** keep the check's finding (`review.language_flag`), set only with the author's
  words while the review waits; the team sees it in the email and on the review. **A business's
  reply** the check flags is held (`reply_held_*`): `published_reviews` leaves it out until the
  team puts it live; the database lets the business set the hold only as it writes its one
  reply, and only the team release it.
- The writer is never told which words or why (that would teach getting round it); the team is.

**Not chosen.** A paid moderation service (a running cost, D-20); refusing a save outright (an
innocent word would block a business with nobody to ask); checking messages (they're private
between two people, and reports already cover them).

**Tests.** `db/tests/0036_language_checks.test.sql`, `tests/unit/moderation.test.ts`,
`tests/e2e/language-check.mjs` (with a pretend AI checker in `scripts/e2e/mail-server.mjs`).
