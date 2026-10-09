# Tallo — Engineering Documentation

This folder is the permanent home for the documents the product owner asked us to
maintain from day one. Everything here is written to be read **without reading source
code**.

**Status: Stage 0 (Discovery & Architecture) — proposed, awaiting approval.**
No application code has been written. No infrastructure has been created. No money has
been spent. Nothing in this folder has been built yet.

---

## If you only read three things

1. **[A — Product Blueprint](./A-product-blueprint.md)** — what we are building, in plain English.
2. **[B — Domain & Data Model](./B-domain-and-data-model.md)** — how the data connects across the whole product (the relationship diagrams live here).
3. **[H — Product Owner Action Register](./H-product-owner-action-register.md)** — the decisions and tasks that are yours, with step-by-step instructions.

---

## The document set

| Doc | Title | What it answers |
|---|---|---|
| A | [Product Blueprint](./A-product-blueprint.md) | What the full product is; capability map; phased roadmap |
| B | [Domain & Data Model](./B-domain-and-data-model.md) | Canonical records, relationships, lifecycle states, metadata rules |
| C | [Architecture Decision Log](./C-architecture-decision-log.md) | Every significant technical decision, why, alternatives, revisit triggers |
| D | [Feature-to-Domain Map](./D-feature-to-domain-map.md) | Which features use which data and services, and what depends on what |
| E | [Security & Privacy Model](./E-security-and-privacy-model.md) | Who can see and do what; invitation-link security; privacy commitments |
| F | [Operational Runbook](./F-operational-runbook.md) | Deploy, monitor, back up, restore, recover; who is responsible for what |
| G | [Release & Migration History](./G-release-and-migration-history.md) | What shipped, which migrations ran, how to roll back |
| H | [Product Owner Action Register](./H-product-owner-action-register.md) | Your open decisions and tasks, with instructions |

## Supporting documents

| Doc | What it answers |
|---|---|
| [Screen Inventory](./screen-inventory.md) | Every screen in the intended product, by stage |
| [Roadmap & Estimates](./roadmap.md) | Stage scope, exclusions, dependencies, effort, risks, acceptance criteria |
| [Cost Model](./cost-model.md) | What this costs per month, verified against vendor pricing pages |
| [API & Integration Strategy](./api-strategy.md) | Internal contracts, domain boundaries, third-party integrations |
| [Testing Strategy](./testing-strategy.md) | What we test, how, and what "done" means |
| [Proposed Stage 1 Schema](./schema/stage1-proposed.sql) | The actual database tables we propose creating first (not yet applied) |

---

## How these documents are kept current

- Every change to the data model updates **B** in the same change as the code.
- Every significant technical decision adds an entry to **C**. Decisions are never
  silently reversed; a superseding entry is added instead.
- Every release appends to **G** before it is deployed.
- Anything that needs the product owner moves to **H** immediately, not into a
  technical document where it would be missed.

## A note on honesty in these documents

Where something is unverified, estimated, or assumed, it says so. Where a price came
from a third-party source rather than the vendor, the document says so and asks us to
confirm it at signup. We would rather hand over a document with visible uncertainty
than one that reads as confident and turns out to be wrong.
