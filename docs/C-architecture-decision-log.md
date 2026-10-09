# C — Architecture Decision Log

**Status:** Proposed (Stage 0). Awaiting product owner approval.
**Last updated:** 2026-10-09

Each entry records a significant technical decision: what we chose, why, what we
rejected, what it costs, and what would make us reconsider. Entries are never edited
after approval; if a decision changes, a new entry supersedes the old one and both stay.

**Who decides.** Each entry is labelled:
- **Team decision** — routine technical choice. We make it and explain it. You can
  overrule, but you don't need to act.
- **Needs your approval** — it costs money, creates a commitment, or changes what users
  experience.

---

## Summary

| # | Decision | Who decides | Status |
|---|---|---|---|
| ADR-001 | One application (modular monolith), not microservices | Team | Proposed |
| ADR-002 | PostgreSQL is the single source of truth | Team | Proposed |
| ADR-003 | Supabase for database, sign-in, and file storage | **Needs approval** (cost) | Proposed |
| ADR-004 | The browser never talks to the database directly | Team | Proposed |
| ADR-005 | Next.js + TypeScript for the application | Team | Proposed |
| ADR-006 | Drizzle for database access, with SQL migrations in git | Team | Proposed |
| ADR-007 | Vercel for hosting, on the paid Pro plan | **Needs approval** (cost) | Proposed |
| ADR-008 | Postgres full-text search for Stage 1; no search service | Team | Proposed |
| ADR-009 | UUID v7 identifiers plus human-readable slugs | Team | Proposed |
| ADR-010 | Invitation links: random, hashed, revocable, expiring | Team | Proposed |
| ADR-011 | Three-tier metadata (columns, typed attributes, display extras) | Team | Proposed |
| ADR-012 | One `vendor` table with team membership; no `organization` yet | Team | Proposed |
| ADR-013 | Transactional email via Resend, sign-in emails only in Stage 1 | **Needs approval** (cost) | Proposed |
| ADR-014 | Data stored in Canada | **Needs approval** (trust/legal) | Proposed |
| ADR-015 | First-party analytics in our own database; no third-party trackers | Team | Proposed |
| ADR-016 | Sentry for error monitoring, free tier | Team | Proposed |
| ADR-017 | Status changes go through one place in the code that enforces the state machines | Team | Proposed |

---

## ADR-001 — One application (modular monolith)

**Decision.** Build a single web application, internally divided into modules with
clear boundaries (discovery, vendors, events, guests, engagement, admin). One codebase,
one deployment, one database.

**Plain English.** One well-organised building with separate rooms, not a campus of
separate buildings connected by walkways.

**Why.** The brief asks for an architecture the team can reliably operate. A small team
running microservices spends its time on the walkways: network failures between
services, keeping data consistent across databases, deploying many things in the right
order. None of that delivers anything to a parent in Orillia.

**Alternatives rejected.**
- *Microservices* — operational cost far exceeds benefit at our scale.
- *Separate backend API + separate frontend app* — doubles deployment and contract
  maintenance with no user benefit yet. Our internal module boundaries keep this option
  open if a native app is ever approved.

**Revisit when.** A module needs to scale or deploy independently for a measured
reason, or the team grows past ~8 engineers working in the same code.

---

## ADR-002 — PostgreSQL is the single source of truth

**Decision.** All product data lives in one PostgreSQL database. Anything else (a search
index, a cache, an analytics export) is derived from it and can be rebuilt from it.

**Why.** Our data is deeply relational: events link to vendors link to inquiries link to
bookings. PostgreSQL is built for exactly this, enforces relationships so bad data can't
be saved, supports full-text search and geography (PostGIS) natively, and is the most
widely supported open-source database. It is not tied to any one vendor.

**Alternatives rejected.** *Document databases (Firebase, MongoDB)* — they make
relationships the application's problem. That's how duplicate sources of truth start.

**Revisit when.** Not expected to change.

---

## ADR-003 — Supabase for database, sign-in, and file storage

**Needs your approval** (it carries a monthly cost — see [cost-model.md](./cost-model.md)).

**Decision.** Use Supabase as the managed provider for PostgreSQL, user sign-in, and
file storage.

**Plain English.** Supabase runs the database for us: backups, security patches,
uptime. It also provides sign-in (email links, passwords) and a place to store vendor
photos, so we don't need three separate providers.

**Why.**
- It is standard PostgreSQL. If we ever leave, we take the database with us using
  standard tools. The lock-in is limited to the sign-in and storage features, which are
  replaceable.
- Daily backups on the Pro plan; point-in-time recovery available as an add-on.
- A Canadian hosting region is available (ADR-014).
- One bill, one dashboard, one set of credentials to protect.

**Cost.** Free tier for development. Pro plan (US$25/month per third-party sources,
including a small compute credit) required before launch, because free projects pause
after a week of inactivity and have limited backups. Confirm at supabase.com/pricing.

**Alternatives considered.**
- *Neon (database) + Auth.js (sign-in) + S3 (storage)* — Equally sound. More pieces to
  operate and secure. Choose this if Supabase pricing or reliability becomes a problem.
- *AWS directly* — Most flexible, highest operational burden. Wrong for a small team.
- *Firebase* — Not relational. Rejected under ADR-002.

**Revisit when.** Costs exceed ~US$150/month without a corresponding increase in usage,
or reliability falls short over two consecutive months.

---

## ADR-004 — The browser never talks to the database directly

**Decision.** Every read and write goes through our server code, which checks who you
are and whether you are allowed to do it. The database adds a second layer, described
precisely below.

**Plain English.** Two locks. The first is our application checking permissions on
every request. The second is the database itself refusing access that doesn't come
through the proper door.

**What the second lock covers, exactly.**
- **All tables, from Stage 1:** row-level security is on, with no rules granting access
  to Supabase's public browser-facing roles. If a public Supabase key were ever exposed
  or misused, it could read nothing.
- **All tables, from Stage 1:** the server connects as a restricted database role. It
  cannot change the database structure, and it cannot edit or delete audit history.
- **Guest, invitation, and RSVP tables, from Stage 2:** the server tells the database
  which user (or which invitation) each request is for, and database rules limit rows
  to that user's events. For this most sensitive data, a bug in the application's
  permission check would still not expose another host's guests.

We are deliberately not applying the per-user database rules to every table in Stage
1: published vendor listings are public anyway, and doubling every rule doubles the
places a rule can be wrong. We'll extend it table by table where the data warrants it.

**Why.** The brief says hidden buttons and frontend checks don't count as security.
Supabase *can* be used with the browser querying the database directly, protected only
by database rules. We choose not to: it puts the whole security model in one layer, and
those rules are easy to get subtly wrong. Server-side checks are easier to test,
review, and explain.

**How it's enforced.**
- The database key that can bypass row-level security exists only on the server and is
  never sent to a browser.
- All permission decisions live in one module (`policy`), so there is one place to
  review and test. Screens ask the policy module; they never decide for themselves.
- Automated tests attempt cross-account access for every protected record type. See
  [testing-strategy.md](./testing-strategy.md).

**Revisit when.** Not expected to change.

---

## ADR-005 — Next.js + TypeScript

**Decision.** Build the application with Next.js (React) in TypeScript.

**Why.**
- Pages are rendered on the server, so vendor profiles load fast on phones and can be
  found through Google. Being found through Google is a core part of a local directory.
- Server code and screens live in one project with shared types, so a change to the
  data model is caught everywhere at once.
- It's the most widely used framework of its kind. Hiring and handover are easy.

**Alternatives rejected.** *Remix / SvelteKit* — good, smaller talent pool. *Rails /
Django* — excellent for this kind of app; rejected only because a single TypeScript
codebase reduces the number of languages a future team must know.

**Revisit when.** Not expected to change.

---

## ADR-006 — Drizzle for database access, SQL migrations in git

**Decision.** Use Drizzle ORM to talk to the database. Every database change is a
numbered SQL migration file, stored in git and reviewed like code.

**Why.** Drizzle stays close to plain SQL, which matters because we use PostgreSQL
features (full-text search, geography, row-level security, check constraints) that
heavier tools hide or don't support well. Migrations are readable SQL files, so anyone
reviewing a change can see exactly what it does to the database.

**Alternative.** *Prisma* — more popular, more polished tooling. Weaker on the
PostgreSQL features we rely on. A reasonable choice; this is a close call.

**Revisit when.** Drizzle becomes unmaintained or the team strongly prefers Prisma
before Stage 1 code exists. After Stage 1, switching costs more than it saves.

---

## ADR-007 — Vercel for hosting, on the Pro plan

**Needs your approval** (monthly cost).

**Decision.** Host the application on Vercel. Use the free Hobby plan only for
development; move to Pro before any public launch.

**Important.** Vercel's free Hobby plan is restricted to **personal, non-commercial
use**. Tallo is a business, so it cannot run in production on the free plan. Pro is
US$20 per developer seat per month (viewer seats are free), with usage beyond the
included amount billed separately. We will set a spending cap so a traffic spike can't
produce a surprise bill. Confirm at vercel.com/pricing.

**Why.** Vercel builds Next.js; deploying is a `git push`. Every proposed change gets
its own private preview link, which is how you'll review work without reading code.

**Alternatives.** *Netlify, Render, Railway, Fly.io* — all workable at similar cost. We
recommend Vercel for the preview links and the smallest operational burden.

**Revisit when.** Monthly hosting cost exceeds ~US$100 without a matching increase in
traffic.

---

## ADR-008 — Postgres full-text search for Stage 1

**Decision.** Implement vendor search using PostgreSQL's built-in full-text search,
plus trigram matching for typos ("face paintr"). No separate search service.

**Why.** We'll have dozens to a few hundred vendors in the first year. PostgreSQL
handles that comfortably, at no extra cost, with no second system to keep in sync.
Filtering by structured attributes is a database query; that's what databases are for.

**Alternatives rejected for now.** *Algolia, Typesense, Elasticsearch* — excellent at
scale; recurring cost and a second copy of the data. The search module is written behind
an interface so one can be added later without rewriting screens.

**Revisit when.** Search response time exceeds 300 ms at the 95th percentile, or we pass
~20,000 listings, or we need features PostgreSQL can't provide.

---

## ADR-009 — UUID v7 identifiers plus slugs

**Decision.** Every record's permanent ID is a UUID v7 (a long random-looking value that
also sorts by creation time). Vendors also get a human-readable slug for their web
address. Old slugs are kept so old links redirect.

**Why.** Sequential IDs (`/vendor/41`) let anyone count our vendors and try `/vendor/42`.
UUIDs remove that. They are *not* a substitute for permission checks (ADR-004) — they
just remove an easy target.

---

## ADR-010 — Invitation link security

**Decision.**
- Each invitation link contains a 256-bit random token from a cryptographically secure
  generator.
- The database stores only a **hash** of the token. If our database were ever copied,
  the copy would contain no working invitation links.
- Links can be revoked by the host at any time, and expire (default: 30 days after the
  event).
- A link grants access to **one event's public invitation page and one RSVP form**,
  never to the host's workspace, the guest list, or other guests' answers.
- Opening a link is logged separately from responding, so "opened" can never be
  reported as "accepted".
- RSVP endpoints are rate-limited to stop automated guessing.

**Why.** The brief requires invitation links that can't expose the host's private
workspace or unrelated guest information. This design means even a leaked link exposes
only what the host already chose to share with that guest.

---

## ADR-011 — Three-tier metadata

**Decision.** Real columns for core fields; a typed, admin-managed attribute registry
for filterable descriptive attributes; a small JSON field only for display-only extras.
Full explanation in [B §6](./B-domain-and-data-model.md#6-metadata-strategy).

**Why.** Satisfies both halves of the brief: new filters without developer involvement,
and no unvalidated catch-all blob.

**Revisit when.** We need attributes on records other than vendors (e.g. venues as
their own entity). The registry is designed so `applies_to` can be extended.

---

## ADR-012 — One `vendor` table with team membership

**Decision.** The business and its public listing are one record (`vendor`). People
manage it through `vendor_member` with a role (`owner`, `manager`, `staff`). We do not
create a separate `organization` layer yet.

**Why.** In a local market, one business has one listing. An extra layer would add a
join to every query and a concept to every screen for no current benefit. The migration
path if we ever need it is documented in [B §8](./B-domain-and-data-model.md#8-future-migrations-we-already-know-about)
and does not change any vendor IDs.

**Revisit when.** A real business needs two distinct listings, or we need to represent
non-vendor organisations (schools, community groups).

---

## ADR-013 — Transactional email via Resend

**Needs your approval** (may carry a monthly cost).

**Decision.** Use Resend to send emails the system must send: sign-in links and
password resets in Stage 1; vendor claim confirmations; later, inquiry notifications.
No marketing email.

**Cost.** Third-party sources report a free tier of 3,000 emails/month **with a
100-per-day cap**, and a Pro tier around US$20/month. The daily cap is the one that would
bite first. Confirm at resend.com/pricing.

**Not decided here.** Sending invitations *by email* from Tallo. Our Stage 2 proposal is
that hosts share invitation links through their own channels (text, WhatsApp, email),
which costs nothing and avoids anti-spam law (CASL) issues with us emailing people who
never signed up. See decision D-08.

**Alternative.** *Postmark* — better reputation for inbox delivery; free plan is only
100 emails/month. A good switch if delivery problems appear.

---

## ADR-014 — Data stored in Canada

**Needs your approval** (trust and legal positioning, no extra cost expected).

**Decision.** Create the Supabase project in its Canada (Central) region, so the
database and stored files reside in Canada.

**Why.** Canadian private-sector privacy law (PIPEDA) does not strictly require
Canadian storage, but local parents and businesses may reasonably ask, and the answer
"in Canada" is simpler to give than an explanation of cross-border transfer
safeguards. It costs nothing extra to choose now and is disruptive to change later.

**Caveat.** Application servers on Vercel may run outside Canada while processing a
request. We'll pin them to the nearest available region and disclose this in the
privacy policy. **We are not lawyers; the privacy policy should be reviewed by one
before launch** (action PO-07).

---

## ADR-015 — First-party analytics

**Decision.** When we need usage numbers (Stage 4), record them as rows in our own
`analytics_event` table. No Google Analytics, Meta Pixel, or similar.

**Why.** No added cost, no cookie banner, no third party profiling parents and guests,
and the numbers live next to the data they describe so vendor reports can be built
directly. The brief also prohibits unapproved analytics services with ongoing costs.

---

## ADR-016 — Sentry for error monitoring

**Decision.** Use Sentry's free tier to be alerted when something breaks in production.

**Why.** We need to know about errors before users tell us. The free tier covers our
expected volume. Personal data is scrubbed before error reports leave our servers.

---

## ADR-017 — One gatekeeper for status changes

**Decision.** Every status change on a lifecycle record (`vendor`, `event_vendor`,
`inquiry`, `invitation`, `booking`, `review`) goes through a single function per record
type that (1) checks the transition is allowed by the state machine in
[B §5](./B-domain-and-data-model.md#5-lifecycle-states-and-what-they-do-not-mean),
(2) checks the person is allowed to make it, (3) writes the change and a
`status_change` history row in the same database transaction.

**Why.** If any screen could set any status directly, eventually one would set
`booked` when nothing was booked. One gatekeeper makes honest states enforceable.
