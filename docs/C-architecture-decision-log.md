# C — Architecture Decision Log

**Status:** Accepted (D-00, 10 October 2026). ADR-022 accepted with D-13; ADR-025 accepted
with D-24.
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

**Fit test, part 1 (10 October 2026, local).** Built with Next.js 16.3.8 and the
OpenNext Cloudflare adapter 1.20.10. Size: **932 KiB compressed, 30% of the 3 MiB
limit**; `npm run cf:size` fails the build above 80%. The same build ran in Cloudflare's
own runtime (workerd, locally) against PostgreSQL as the restricted `app_server` role:
the welcome page, Explore, search (including typos) and a business profile all worked.
Next.js 16.4.0 was tried first and failed in that runtime (the adapter doesn't yet
support a file 16.4 added), so we stay on 16.3.8 until the adapter catches up.
**Part 2, still to do on Cloudflare itself after PO-03:** time per request against the
10 ms limit, on the real free plan, with a signed-in page.

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

---

## ADR-022 — One account per person; vendor capability through team membership

**Needs your approval** (sign-up experience; part of D-13). **Accepted: D-13, 10 October 2026.**

**Decision.** Everyone signs up the same way. Every account can act as a consumer. A
person acts **as a vendor** only through membership of a vendor's team. Someone who is
both switches between "My events" and "My business".

**Why.** A local face painter is also a local parent. Two logins would be confusing, and
two separate account systems would duplicate people, which the brief forbids. The
screens keep the two sides clearly separate.

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
