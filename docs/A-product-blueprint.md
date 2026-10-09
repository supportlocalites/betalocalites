# A — Product Blueprint

**Status:** Proposed (Stage 0). Awaiting product owner approval.
**Last updated:** 2026-10-09

---

## 1. What Tallo is

A local event discovery and coordination platform. It helps people find the local
vendors who serve their kind of event, bring those vendors and their guests together,
and run the event from one place instead of across texts, spreadsheets, and four
different apps.

It serves two sides of the same local ecosystem:

- **Organizers** — people planning an event, who need to know what's available locally
  and want to stop coordinating across disconnected tools.
- **Vendors** — local businesses who provide event services, who want to be found.

**First market:** Orillia, Ontario. Designed from the first day to extend into Simcoe
County and other communities without a rewrite.

**First use case:** children's birthday parties. **Not the only use case** — the data
model treats "birthday" as one row in a reference table, never as a hardcoded
assumption. See [B §6](./B-domain-and-data-model.md#6-metadata-strategy).

## 2. The three questions the product answers

| Question the user has | How Tallo answers it | Stage |
|---|---|---|
| What's available locally for the event I want? | Public vendor discovery — browse, search, filter, no account required | 1 |
| How do I bring the right vendors and people together? | Attach vendors to an event; invite guests; collect RSVPs | 2–3 |
| How do I manage this without five separate apps? | One event record that holds vendors, guests, invitations, inquiries, and updates | 2–4 |

## 3. Product principles

These are design constraints, not aspirations. Each one has a corresponding technical
control, listed so it can be checked.

| Principle | Technical control |
|---|---|
| Discovery is open. No account, no event, and no vendor selection required to browse. | Public read paths require no session. Enforced by route-level tests. |
| One vendor, one record, forever. | Single canonical `vendor.id` reused by every feature. [B §2](./B-domain-and-data-model.md#2-the-spine-five-canonical-records) |
| Events are private by default. | Default-deny authorization; `event.visibility` defaults to private. [E](./E-security-and-privacy-model.md) |
| We never claim something happened that didn't. | Distinct lifecycle states for *selected*, *contacted*, *delivered*, *responded*, *booked*. [B §5](./B-domain-and-data-model.md#5-lifecycle-states-and-what-they-do-not-mean) |
| We collect as little personal information as possible, especially about children and guests. | No child profiles, no dates of birth, no guest accounts. [E §6](./E-security-and-privacy-model.md#6-data-minimisation-commitments) |
| Nothing is hardcoded to birthdays or to Orillia. | `event_type` and `municipality` are reference data, not code. |
| No fabricated content, ever. | No seeded fake vendors, reviews, prices, or availability. Verification requires recorded evidence. |
| Calm, not enterprise. | Mobile-first; no dashboards before there is data worth showing. |

## 4. Capability map

Each capability is marked with the stage in which we propose **building** it. Every
capability is **designed for** now, in the sense that the data model and permissions
leave a defined place for it. Designing for it is cheap. Building it is not.

### A. Public discovery — Stage 1
- Landing page explaining the platform
- Vendor browse by category and subcategory
- Search and filter: location, service type, event suitability, structured attributes
- Vendor profile pages (services, description, images, service areas, verified info)
- Curated local collections (editorially controlled, not algorithmic)
- Honest, helpful empty states when the local market is thin — this will happen often
  in a town of ~33,000 and the design must not treat it as an error
- Saved vendors / favourites — Stage 1 *if* approved, otherwise Stage 2 (decision D-02)
- Clearly labelled sponsored placements — **Stage 4+, design only**

### B. Vendor ecosystem — Stage 1 core, later extensions
- Business identity and profile — Stage 1
- Categories, subcategories, services — Stage 1
- Service areas and structured attributes — Stage 1
- Photos and logos — Stage 1
- Contact and inquiry preferences — Stage 1 (fields), Stage 3 (used)
- Listing status (draft / pending review / published / unpublished / archived) — Stage 1
- Claimed vs unclaimed profiles — Stage 1
- Verification status with recorded evidence — Stage 1
- Pricing where the vendor provides it, including "custom quote only" — Stage 1
- Vendor team members and permissions — Stage 1 (table), Stage 3 (UI)
- Availability — **not built.** Requires a reliable integration we don't have. Design only.
- Engagement analytics — Stage 4
- Subscriptions, entitlements, sponsorships — Stage 4+, design only

### C. Event creation and management — Stage 2
- Title, event type, date/time, location, host
- Planning preferences and optional fields
- Budget guidance
- Selected vendors
- Guest list and invitations
- RSVPs
- Event updates
- Privacy settings
- Lifecycle and historical records

### D. Vendor-to-event relationships — Stage 2
The single most important relationship in the product. An event has many vendors; a
vendor serves many events; a person hosts many events. Modelled explicitly, with an
honest status, in `event_vendor`.

### E. Invitations, guests, RSVPs — Stage 2
- Secure, shareable, revocable invitation links
- Sent through the organizer's own channels (text, WhatsApp, email) — we don't need to
  be a messaging platform to do this well
- Account-free RSVP
- Plus-ones and organizer-defined questions as structured data
- Organizer attendance view
- Event updates to invited guests
- Guest privacy controls

### F. Inquiries and communication — Stage 3
- Inquiry attached to the right vendor and, where relevant, the right event
- Status and history
- Vendor responses for eligible claimed listings
- Concierge queue for unclaimed listings, handled by a person
- Clear ownership and access rules
- **Not building:** real-time messaging, typing indicators, read receipts

### G. Quotes, bookings, agreements — Stage 4, assessed first
- Quotes, revisions, acceptance
- Booking requests and confirmations
- Agreements and documents
- Booking status and cancellation
- Historical records linking event, customer, vendor, transaction
- **Not building without separate written approval:** payments, card storage, payouts,
  automated billing

### H. Reviews and reputation — Stage 4, policy approval first
Our recommendation, for approval as decision D-06: **a review may only be written by
someone whose interaction with that vendor is recorded by the platform** (a completed
booking, or a concierge-confirmed service delivered after a Tallo inquiry). Open reviews
would be cheaper to build and would immediately become the platform's biggest liability
and moderation cost in a town where everyone knows each other.

### I. Administration and platform operations — Stage 1
Needed from the first day, because someone has to create the first listings.
- Vendor listing creation and management
- Listing review and approval
- Claim and ownership workflow
- Category and taxonomy management
- Moderation and correction
- Concierge inquiry queue — Stage 3
- Account and access management
- Basic operational reporting
- Commercial placements and entitlements — Stage 4+

Administrative privileges are enforced server-side. See
[E §3](./E-security-and-privacy-model.md#3-roles).

### J. Future growth — not committed
Vendor subscriptions and entitlements; sponsored placements; notifications and
reminders; reviews; search recommendations; vendor analytics; more event types and
locations; richer coordination; payments if the business model justifies them.

**On the vendor value proposition:** at launch, the honest offer to a vendor is *local
exposure and the chance to be found*. We will not promise leads, bookings, or business
results until we can measure them. The analytics to measure them is Stage 4, which is
the right order: earn the claim before making it.

## 5. What we are explicitly not building

Carried from the brief, and treated as binding until changed in writing:

Real-time messaging with typing indicators and read receipts · native mobile apps ·
automated recommendation engines · analytics dashboards before meaningful data exists ·
automated vendor availability or booking confirmation without a reliable integration ·
payment gateways, card storage, payouts, automated billing · unapproved SMS, email, AI,
mapping, or analytics services with ongoing costs · speculative infrastructure with no
identified requirement.

Also binding: no fake functionality or mock production data presented as real; no
invented business information; no claiming a process succeeded when it did not; no
architecture changes without a documented reason; no destructive production change
without an approved migration and recovery plan; no weakening security to go faster; no
duplicate sources of truth.

## 6. Roadmap summary

Detail, dependencies, risks, and effort in [roadmap.md](./roadmap.md).

| Stage | Outcome | Effort (1 senior dev) |
|---|---|---|
| **0 — Discovery & architecture** | This document set, data model, security model, prototypes | ~1.5 weeks |
| **1 — Discovery & vendor foundation** | A real, public, useful local vendor directory with admin tooling | 5–7 weeks |
| **2 — Complete event journey** | Create an event, attach vendors, invite guests, collect RSVPs | 4–6 weeks |
| **3 — Vendor engagement** | Inquiries, with a concierge queue for unclaimed listings | 3–4 weeks |
| **4 — Commercial & operational** | Quotes, bookings, reviews, entitlements, analytics (scoped per item) | 6–10 weeks |
| **5 — Expansion** | More communities, richer discovery, based on real usage | TBD |

Stage 1 is a genuinely releasable product on its own: a local directory is useful to a
parent in Orillia even with no event features at all. That matters, because it means we
can put something real in front of users at week 7 rather than week 20.

## 7. Open decisions

See [H](./H-product-owner-action-register.md). The ones that block Stage 1 are:

- **D-01** — product name and domain
- **D-02** — exact Stage 1 release scope (accounts and favourites in or out)
- **D-03** — do we publish unclaimed listings built from public information, and how do
  we approach those businesses (this one has legal dimensions)
- **D-04** — what a vendor's contact options are at launch
- **D-07** — monthly infrastructure budget ceiling
- **D-09** — launch geography: Orillia only, or Orillia plus immediate townships
