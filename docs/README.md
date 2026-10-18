# Localites — Engineering Documentation

This folder is the permanent home for the documents the product owner asked us to
maintain from day one. Everything here is written to be read **without reading source
code**.

**Status (13 October 2026): Stage 1 in progress, and the first part of Stage 2 built.**
Architecture approved (D-00) and Stage 1 approved (D-23), both 10 October 2026. The test
site runs on Cloudflare's free plan with a free Supabase database: the public directory,
sign-in, claiming, owner editing, the team's admin pages and activity counting are built.
**"Plan an event"** (Stage 2, slice 2A: events, plans, saved businesses, bookings marked,
flags, ideas and featured businesses per kind of event; D-39 to D-43) is built and tested on
our computers and reaches the test site with the next update. What is still to do is listed
plainly in the [roadmap](./roadmap.md). The only spending is the web address,
`localites.ca`. The design is direction G, one website for phones and computers
([Design System](./design-system.md)).

**Revision 2** reworks the plan around the product owner's clarification: two users
(consumer and vendor), Localites as the digital handshake between them, direct messaging
with file sharing, **no payments of any kind**, and consumer-controlled "Add to event"
and "Booked" that lead to post-event feedback and reviews.

---

## If you only read four things

1. **[Roles & Relationships](./roles-and-relationships.md)**: the consumer, the vendor,
   and how they relate, step by step.
2. **[A — Product Blueprint](./A-product-blueprint.md)**: what we're building.
3. **[B — Domain & Data Model](./B-domain-and-data-model.md)**: how the data connects
   (diagrams).
4. **[H — Product Owner Action Register](./H-product-owner-action-register.md)**: your
   decisions and tasks.

---

## The document set

| Doc | Title | What it answers |
|---|---|---|
| — | [Roles & Relationships](./roles-and-relationships.md) | Who the two users are, what each can do and see, and the rules between them |
| A | [Product Blueprint](./A-product-blueprint.md) | The product, capability map, language rules, roadmap summary |
| B | [Domain & Data Model](./B-domain-and-data-model.md) | Records, relationships, lifecycle states, metadata |
| C | [Architecture Decision Log](./C-architecture-decision-log.md) | Technical decisions, why, alternatives, revisit triggers |
| D | [Feature-to-Domain Map](./D-feature-to-domain-map.md) | Which features use which data, for which side |
| E | [Security & Privacy Model](./E-security-and-privacy-model.md) | Who can see and do what; conversation and file safety; retention |
| F | [Operational Runbook](./F-operational-runbook.md) | Deploy, monitor, back up, restore, recover |
| G | [Release & Migration History](./G-release-and-migration-history.md) | What changed, what was tested |
| H | [Product Owner Action Register](./H-product-owner-action-register.md) | Your decisions and tasks |

## Supporting documents

| Doc | What it answers |
|---|---|
| [Screen Inventory](./screen-inventory.md) | All 65 screens, by user and stage, and which are built |
| [Roadmap & Estimates](./roadmap.md) | Stage scope, effort, dependencies, risks, acceptance criteria |
| [Cost Model](./cost-model.md) | Monthly costs, with sources |
| [API & Integration Strategy](./api-strategy.md) | Internal contracts, messaging delivery, third-party services |
| [Testing Strategy](./testing-strategy.md) | What we test and what "done" means |
| [Design System](./design-system.md) | How Localites looks and behaves on phones and computers (direction G) |
| [Policy drafts](./legal/) | Privacy policy, terms of use, review policy and the brief for the lawyer (PO-07): drafts, not in force |
| [Launch vendor research](./launch/vendor-research-2026-10-10.md) | Researched Orillia-area businesses for the launch list (PO-08) |
| [Design archive](./design/README.md) | Every mockup explored (A to H), kept for reference |
| [Database migrations](../db/migrations/) · [checks](../db/tests/) (built: 0001–0011 Stage 1; 0012 events, plans and saves, Stage 2) · [original proposal](./schema/stage1-proposed.sql) | The real database, in order (the Stage 1 proposal was not applied as is) |
| [Proposed schema: Stages 2–3](./schema/stage2-3-proposed.sql) · [checks](./schema/stage2-3-proposed.test.sql) | Conversations, files, inquiries, reviews (not applied); checked on top of migrations 0001–0012. The event part is built in 0012 |

---

## How these documents are kept current

- Every data model change updates **B** in the same change as the code.
- Every significant technical decision adds an entry to **C**; nothing is silently
  reversed.
- Every release appends to **G** before deployment.
- Anything that needs the product owner goes into **H** immediately.

## Honesty in these documents

Where something is unverified, estimated, or assumed, it says so. Prices from
third-party sources are marked for confirmation at signup.
