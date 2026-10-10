# C — Architecture Decision Log

**Status:** Accepted (D-00, 10 October 2026), except ADR-022, which awaits D-13.
**Last updated:** 2026-10-10

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
| ADR-005 | Next.js + TypeScript, confirmed by a fit test on the free host | Team | Accepted |
| ADR-006 | Drizzle for database access, with SQL migrations in git | Team | Accepted |
| ADR-007 | Cloudflare (free plan) for hosting | Team ($0) | Accepted (rev. 3) |
| ADR-008 | Postgres full-text search for Stage 1; no search service | Team | Accepted |
| ADR-009 | UUID v7 identifiers plus human-readable slugs | Team | Accepted |
| ADR-010 | Invitation links: random, hashed, revocable, expiring | Team | Accepted |
| ADR-011 | Three-tier metadata (columns, typed attributes, display extras) | Team | Accepted |
| ADR-012 | One `vendor` table with team membership; no `organization` yet | Team | Accepted |
| ADR-013 | Email via Resend (free plan): sign-in, message notices, feedback requests | Team ($0) | Accepted |
| ADR-014 | Data stored in Canada | **Needs approval** (trust/legal) | Accepted |
| ADR-015 | First-party counts in our own database; no third-party trackers | Team | Accepted |
| ADR-016 | Sentry for error monitoring, free tier | Team | Accepted |
| ADR-017 | One gatekeeper for every status change | Team | Accepted |
| ADR-018 | **Localites never handles money**, and nothing in the system prepares for it | **Needs approval** (product commitment) | Accepted (D-16) |
| ADR-019 | Messaging: stored conversations, polled updates, batched email notices | Team | Accepted |
| ADR-020 | Files in conversations: private, participants only, limited types | Team | Accepted |
| ADR-021 | "Booked" is the consumer's own record, labelled as such | **Needs approval** (user experience) | Accepted (D-18) |
| ADR-022 | One account per person; acting as a vendor comes from team membership | **Needs approval** (user experience; D-13) | Proposed (awaits D-13) |

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

**Why not let the browser query the database directly?** Supabase supports that, with
the database rules as the only protection. It puts the whole security model in one
layer that's easy to get subtly wrong. Server-side checks are easier to test and
explain.

---

## ADR-005 — Next.js + TypeScript

**Decision.** Build the application with Next.js (React) in TypeScript.

**Why.** Pages render on the server, so vendor profiles load fast on phones and can be
found through Google, which is central to a local directory. Server code and screens
share one project and one set of types. It's the most widely used framework of its kind,
so hiring and handover are easy.

**Alternatives.** *Remix / SvelteKit* — good, smaller talent pool. *Rails / Django* —
excellent for this; rejected only to keep the codebase to one language.

**Fit test (revision 3).** Cloudflare's free plan (ADR-007) allows 10 ms of processing
per request and a 3 MiB application size. In Stage 1 week 1, before real building
starts, we deploy one vendor profile page, one search, and one signed-in page to the
free plan and measure them. If Next.js doesn't fit comfortably, we use **React Router**
(formerly Remix) instead: same language, same React components, and built to run on
Cloudflare. Either way the data model, database, and security model are unchanged.
The result is recorded here.

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

---

## ADR-022 — One account per person; vendor capability through team membership

**Needs your approval** (sign-up experience; part of D-13).

**Decision.** Everyone signs up the same way. Every account can act as a consumer. A
person acts **as a vendor** only through membership of a vendor's team. Someone who is
both switches between "My events" and "My business".

**Why.** A local face painter is also a local parent. Two logins would be confusing, and
two separate account systems would duplicate people, which the brief forbids. The
screens keep the two sides clearly separate.

**Alternative.** Separate consumer and vendor sign-ups. Simpler to explain on day one;
creates duplicate identities later.
