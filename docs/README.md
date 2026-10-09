# Tallo — Engineering Documentation

This folder is the permanent home for the documents the product owner asked us to
maintain from day one. Everything here is written to be read **without reading source
code**.

**Status: Stage 0 (Discovery & Architecture), revision 2. Proposed, awaiting approval.**
No application code has been written. No infrastructure has been created. No money has
been spent.

**Revision 2** reworks the plan around the product owner's clarification: two users
(consumer and vendor), Tallo as the digital handshake between them, direct messaging
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
| [Screen Inventory](./screen-inventory.md) | All 62 screens, by user and stage |
| [Roadmap & Estimates](./roadmap.md) | Stage scope, effort, dependencies, risks, acceptance criteria |
| [Cost Model](./cost-model.md) | Monthly costs, with sources |
| [API & Integration Strategy](./api-strategy.md) | Internal contracts, messaging delivery, third-party services |
| [Testing Strategy](./testing-strategy.md) | What we test and what "done" means |
| [Proposed schema: Stage 1](./schema/stage1-proposed.sql) · [checks](./schema/stage1-proposed.test.sql) | Vendors and discovery tables (not applied) |
| [Proposed schema: Stages 2–3](./schema/stage2-3-proposed.sql) · [checks](./schema/stage2-3-proposed.test.sql) | Events, conversations, files, reviews (not applied) |

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
