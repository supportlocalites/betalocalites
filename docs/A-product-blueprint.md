# A — Product Blueprint

**Status:** Proposed (Stage 0, revision 2). Awaiting product owner approval.
**Last updated:** 2026-10-09

**Revision 2** reflects the product owner's clarification:
- Localites has **two users**, the consumer and the vendor, and the product centres on the
  relationship between them.
- Localites is the **digital handshake**: consumers and vendors message each other directly,
  share files, and plan the event together.
- **No payments, ever.** Localites doesn't handle money and never implies it does. A file
  shared in a conversation is just a file, even if it's an invoice.
- **"Add to event" and "Booked" are the consumer's own planning tools.** Marking a vendor
  booked lets Localites ask, after the event, how it went. That feedback becomes reviews
  and ratings.

---

## 1. What Localites is

A local event discovery and coordination platform. A **consumer** planning an event
finds local **vendors**, talks to them directly, and keeps track of who they've booked.
A **vendor** gets found, hears from people planning events, and builds a reputation
from real feedback.

**First market:** Orillia, Ontario. Built from day one to extend to Simcoe County and
beyond without a rewrite.

**First use case:** children's birthday parties. **Not the only one.** "Birthday" is one
row in an event-type list, never a hardcoded assumption.

**The roles and the relationship between consumer and vendor** are set out in plain
English in [roles-and-relationships.md](./roles-and-relationships.md). Read that first.

## 2. The three questions the product answers

| Question the consumer has | How Localites answers it | Stage |
|---|---|---|
| What's available locally for my event? | Public vendor discovery: browse, search, filter, no account needed | 1 |
| How do I reach the right vendors and work it out with them? | Message vendors directly, share files, plan it together | 2 |
| How do I keep track of it all? | One event plan: who I'm considering, who I've booked, and later, my guests | 2, 4 |

And for the vendor: **How do I get found by people planning events nearby, and earn
their trust?** Through a listing, direct conversations, and reviews from consumers who
actually booked them.

## 3. Product principles

Each principle has a technical control that makes it checkable.

| Principle | Control |
|---|---|
| Discovery is open: no account needed to browse. | Public pages need no sign-in. Tested. |
| One vendor, one record, forever. | A single `vendor.id` used by every feature. |
| Localites is the handshake, never a party to the deal. | No payment, transaction, or balance fields exist anywhere (ADR-018). Banned words in the interface. |
| Each side owns its own actions. | Only consumers start conversations and mark bookings; only vendors reply and flag. Enforced in the database. |
| Events and conversations are private. | Default-deny permissions; staff don't read conversations unless reported. |
| We never claim something happened that didn't. | "Booked" is labelled as the consumer's record. An email is "sent" only when it really was. |
| Reviews come from real, recorded relationships. | The database refuses reviews that don't trace to a booked vendor, a past event, and a Localites conversation. |
| Collect as little personal information as possible. | No child profiles, no birthdates, no guest accounts. |
| Nothing hardcoded to birthdays or Orillia. | Event types and places are reference data. |
| Calm, not enterprise. | Mobile-first; no dashboards before there's data worth showing. |
| No running costs. | Every service on a free plan; only the web address is paid (D-20, [cost-model.md](./cost-model.md)). |

## 4. Capability map

Each capability shows the stage in which we propose **building** it. Every capability
is **designed for** now: the data model and permissions already have a place for it.

### A. Public discovery — Stage 1
- Landing page explaining Localites to consumers and vendors
- Browse by category and subcategory
- Search and filter: town, service type, suitability, structured attributes
- Vendor profile pages: services, published prices where given, photos, service area,
  verification, and (from Stage 3) reviews and rating
- Curated local collections
- Honest empty states. A town of ~33,000 will have thin categories, and the design
  treats that as normal, not an error.
- Unclaimed listings show the business's own website and phone (D-03, D-04)

### B. The vendor side — Stage 1 foundation, Stage 2 messaging
- Claim a listing; manage profile, services, areas, photos — Stage 1
- Vendor team: owner, manager, staff — Stage 1
- Verification with recorded evidence — Stage 1
- **Inbox: reply to consumers, share files** — Stage 2
- **See consumers who marked them booked; flag any that aren't real** — Stage 2
- **Reply once to each review** — Stage 3
- Simple insights: profile visits, website clicks, conversations, bookings marked —
  Stage 5, once there's data
- Availability calendars — **not built.** No reliable integration; we won't imply
  availability we can't know.

### C. The consumer side — Stage 2
- Free account
- Saved vendors
- Create an event: type, date, place; everything else optional
- Event plan: vendors **considering** → **booked**
- **Message vendors and share files**
- "Let them know you're interested" for businesses not yet on Localites

### D. The handshake: consumer ↔ vendor conversations — Stage 2
- One conversation per consumer–vendor pair, optionally about one of the consumer's
  events
- Text messages and files (photos, PDFs, up to 5 per message, 10 MB each)
- Email notice of new messages, batched so nobody gets spammed
- Unread counts for each person (private, not read receipts)
- Report and block, on both sides
- **Not building:** typing indicators, read receipts, voice/video, group chats

### E. Feedback, reviews and ratings — Stage 3
- The morning after an event, consumers are asked about each vendor they marked booked
- Reviews: 1–5 stars and comments, checked by the platform team before publishing
- Strict eligibility (D-06): booked + event passed + talked on Localites + not flagged
- Vendor's one public reply
- Average rating shown once a vendor has three published reviews

### F. Guests, invitations, RSVPs — Stage 4
- Guest list; secure, revocable invitation links shared through the consumer's own
  phone or email
- Account-free RSVP, plus-ones, host-defined questions
- Attendance view; event updates to guests
- Guests are not users and never interact with vendors

### G. Platform operations — Stage 1 onward
- Listing creation, review, approval; claims; verification — Stage 1
- Categories, attributes, places, event types — Stages 1–2
- Reports queue: messages, conversations, listings — Stage 2
- Review moderation and booking-flag resolution — Stage 3
- Every staff action logged; staff permissions enforced on the server

### H. Future, not committed
More communities; vendor insights; clearly labelled sponsored placements or vendor
subscriptions, if the business model calls for them (these would never affect reviews
or ratings); notifications by text message; richer coordination.

**Never, without a new decision:** payments of any kind.

**On the vendor value proposition:** at launch, the honest offer to vendors is *being
found by local people planning events, and hearing from them directly*. Once
consumers start marking vendors booked, we can tell a vendor *"6 people marked you
booked through Localites this season"*, which is true and verifiable. We won't promise
leads or revenue.

## 5. What we are explicitly not building

Payments, deposits, checkout, card storage, payouts, invoicing, or billing between
consumers and vendors · any wording that implies Localites handles money or confirms
bookings · real-time chat features (typing indicators, read receipts, presence) ·
native mobile apps · automated recommendation engines · analytics dashboards before
meaningful data exists · automated vendor availability · unapproved third-party
services with ongoing costs · speculative infrastructure.

Also binding: no fake functionality or mock data presented as real; no invented
business information; no claiming a process succeeded when it didn't; no
architecture changes without a documented reason; no destructive production change
without an approved recovery plan; no weakening security to go faster; no duplicate
sources of truth.

## 6. Language rules

Words carry promises. These apply to every screen, email, and help page.

| Use | Never use |
|---|---|
| Message, conversation, reply | Inquiry, request a quote, request to book |
| Add to event · Considering | Shortlist confirmed, reserved |
| **Mark as booked** · You marked this booked | Book now, booking confirmed, secure your booking |
| Shared a file | Invoice received, payment due, pay now |
| How was it? · Leave a review | Verified purchase, verified booking |
| Localites connects you with local vendors | Localites guarantees, Localites-approved |
| Arrange details directly with the vendor | Checkout, deposit, transaction, fee |

## 7. Roadmap summary

Detail in [roadmap.md](./roadmap.md).

| Stage | Outcome | Effort (1 senior developer) |
|---|---|---|
| **0 — Architecture** | This document set, data model, prototypes | ~1.5 weeks |
| **1 — Discovery & vendors** | A real public directory; vendors claim their listings | 5–7 weeks |
| **2 — The handshake** | Consumer accounts, events, messaging with files, add to event, mark as booked | 5–7 weeks |
| **3 — Feedback & reviews** | "How was it?", reviews, ratings, vendor replies | 2–3 weeks |
| **4 — Guests & RSVPs** | Invitations and RSVPs | 3–4 weeks |
| **5 — Growth** | Vendor insights, more communities, based on real use | TBD |

Stage order after Stage 2 is decision D-14. **Why Stage 1 comes before messaging:**
messaging only works with vendors who have claimed their listing. Stage 1 gives
businesses several weeks to claim their profiles, so the first consumer who sends a
message on launch day has someone on the other end.

## 8. Open decisions

All in [H](./H-product-owner-action-register.md). The ones that shape the work now:
D-00 (approve architecture), D-01 (web address; the name, Localites, is decided), D-03
(listing businesses before they join), D-04 (contact before messaging), D-05 (messaging
unclaimed businesses), D-06 (review rule), D-07 (the web address, the only cost), D-09
(launch area), D-11 (who's on call), D-13 (consumer–vendor rules), D-14 (stage order).
