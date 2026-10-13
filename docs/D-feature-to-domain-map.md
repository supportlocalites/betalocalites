# D — Feature-to-Domain Map

**Status:** Proposed (Stage 0, revision 2).
**Last updated:** 2026-10-10 (Inquire and activity tracking)

For every capability: which records it reads and writes, which module owns it, which
side of the marketplace uses it, and what it depends on. Use this to answer *"if we
change X, what else is affected?"*

**Status key:** 📐 designed · 🔨 in progress · ✅ released · ⏸ deferred

**Note (13 October 2026):** the status column is from the design stage and isn't kept up to
date; what is built is in [roadmap.md](./roadmap.md) and [screen-inventory.md](./screen-inventory.md).
Slice 2A added `event_private`, `saved_vendor`, `event_type_category`, `featured_placement`,
`event_vendor_flag_note` and the team-only counts (D-42, D-43; ADR-031).

---

## Modules

One codebase (ADR-001), divided into modules. Each module owns its tables, and only
that module writes to them. Others go through its public functions.

| Module | Owns tables | Depends on |
|---|---|---|
| `identity` | `app_user`, `platform_role` | — |
| `policy` | *(the permission rules; no tables)* | ownership fields of every module |
| `taxonomy` | `category`, `attribute_*`, `municipality`, `event_type` | — |
| `media` | `media_asset` | identity |
| `vendors` | `vendor`, `vendor_member`, `vendor_category`, `vendor_service`, `vendor_service_area`, `vendor_attribute_value`, `vendor_media`, `vendor_link`, `vendor_slug_history`, `vendor_claim`, `verification_record` | taxonomy, media, identity |
| `discovery` | `collection`, `collection_item`, `saved_vendor` | vendors, taxonomy |
| `events` | `event`, `event_vendor` | vendors, taxonomy, identity |
| `messaging` | `conversation`, `message`, `message_attachment`, `conversation_read_marker`, `vendor_interest` | vendors, events, media |
| `reviews` | `review_request`, `review` (+ `vendor_rating_summary` view) | events, messaging |
| `guests` | `guest`, `invitation`, `event_question`, `rsvp`, `rsvp_answer`, `event_update` | events |
| `safety` | `moderation_report` | messaging, reviews, vendors |
| `notifications` | `notification` | *(called by messaging, events, reviews, vendors)* |
| `audit` | `status_change`, `audit_log` | *(written to by all)* |
| `analytics` | `activity_event`, `vendor_daily_stats` (D-22, ADR-023) | *(written to by discovery, vendors and messaging)* |

## Capabilities

### Stage 1 — Discovery & vendor foundation

| Capability | Side | Reads | Writes | Module | Status |
|---|---|---|---|---|---|
| Landing page | Visitor | `category`, `collection` | — | discovery | 📐 |
| Browse by category | Visitor | `category`, `vendor`, `vendor_category` | — | discovery | 📐 |
| Search & filter | Visitor | `vendor` + attributes, areas, places | — | discovery | 📐 |
| Vendor profile | Visitor | `vendor` + services, media, areas, attributes, verification outcome | `activity_event` (view) | vendors | 📐 |
| Website / phone tap counting (D-04, D-22) | Visitor | — | `activity_event` | analytics | 📐 |
| "Seen in search" counting, batched per page (D-22) | Visitor | — | `vendor_daily_stats` | analytics | 📐 |
| Vendor activity reports (team only, D-22) | Admin | `vendor_daily_stats`, `activity_event` | `audit_log` | analytics | 📐 |
| Suggest a business; team email; admin list with likely duplicates (D-25) | Visitor | `vendor`, `category` | `vendor_suggestion`, `notification`, `activity_event` | discovery, notifications | 📐 |
| Vendor sign-up / sign-in | Vendor | `app_user` | `app_user` | identity | 📐 |
| Claim a listing | Vendor | `vendor` | `vendor_claim`, `status_change` | vendors | 📐 |
| Edit own listing, submit for review | Vendor | `vendor` + children | `vendor` + children, `status_change`, `audit_log` | vendors | 📐 |
| Manage team | Vendor | `vendor_member` | `vendor_member`, `audit_log` | vendors | 📐 |
| Create / review / publish listings | Admin | taxonomy | `vendor` + children, `status_change`, `audit_log` | vendors | 📐 |
| Approve claims; record verification | Admin | `vendor_claim` | `vendor_claim`, `vendor_member`, `verification_record`, `audit_log` | vendors | 📐 |
| Manage categories, attributes, places | Admin | taxonomy | taxonomy, `audit_log` | taxonomy | 📐 |
| Curated collections | Admin | `vendor` | `collection`, `collection_item` | discovery | 📐 |

### Stage 2 — The handshake

| Capability | Side | Reads | Writes | Module | Status |
|---|---|---|---|---|---|
| Consumer sign-up | Consumer | `app_user` | `app_user` | identity | 📐 |
| Switch between "My events" and "My business" | Both | `vendor_member` | — | identity | 📐 |
| Save a vendor | Consumer | `vendor` | `saved_vendor` | discovery | 📐 |
| Create / edit / cancel an event | Consumer | `event_type`, `municipality` | `event`, `status_change` | events | 📐 |
| **Add to event** (considering) | Consumer | `vendor` | `event_vendor`, `status_change` | events | 📐 |
| **Mark as booked** / un-mark / remove | Consumer | `event_vendor` | `event_vendor`, `status_change`, `notification` | events | 📐 |
| See bookings marked; flag one | Vendor | `event_vendor` (own), event summary | `event_vendor` (flag), `status_change` | events | 📐 |
| **Start a conversation** | Consumer | `vendor` (claimed) | `conversation`, `message` | messaging | 📐 |
| Link a conversation to an event | Consumer | `event` (own) | `conversation.event_id` | messaging | 📐 |
| **Reply** | Vendor | `conversation` (own vendor) | `message` | messaging | 📐 |
| **Share files** | Both | — | `media_asset`, `message_attachment` | messaging, media | 📐 |
| Conversation list, unread counts | Both | `conversation`, `conversation_read_marker` | `conversation_read_marker` | messaging | 📐 |
| New-message email (batched) | Both | `conversation_read_marker` | `notification` | notifications | 📐 |
| Block | Both | `conversation` | `conversation`, `status_change` | messaging | 📐 |
| Report | Both | — | `moderation_report` | safety | 📐 |
| Reports queue | Admin | `moderation_report`, reported item | `moderation_report`, `audit_log` | safety | 📐 |
| **Inquire** (unclaimed or unverified; emails the team, D-04) | Consumer | `vendor` (unclaimed) | `vendor_interest`, `notification`, `activity_event` | messaging, notifications | 📐 |
| "Now on Localites" notice when claimed | Consumer | `vendor_interest` | `notification` | messaging, vendors | 📐 |
| Event types | Admin | `event_type` | `event_type`, `audit_log` | taxonomy | 📐 |

### Stage 3 — Feedback & reviews

| Capability | Side | Reads | Writes | Module | Status |
|---|---|---|---|---|---|
| Schedule "How was it?" | System | `event_vendor` (booked), `event` | `review_request` | reviews | 📐 |
| Send request + one reminder | System | `review_request` | `review_request`, `notification` | reviews, notifications | 📐 |
| Write a review | Consumer | eligibility chain | `review` | reviews | 📐 |
| Email the team about each new review (D-06) | System | `review` | `notification` | reviews, notifications | 📐 |
| Approve or decline reviews | Admin | `review` | `review`, `audit_log` | reviews | 📐 |
| Resolve booking flags | Admin | `event_vendor` | `event_vendor`, `audit_log` | events | 📐 |
| Reply to a review | Vendor | `review` | `review.vendor_reply` | reviews | 📐 |
| Reviews and rating on profile | Visitor | `review`, `vendor_rating_summary` | — | reviews | 📐 |

### Stage 4 — Guests & RSVPs

| Capability | Side | Writes | Module | Status |
|---|---|---|---|---|
| Guest list | Consumer | `guest` | guests | 📐 |
| Personal and group invitation links, QR code, revoke (D-08) | Consumer | `invitation` | guests | 📐 |
| Match group-link replies to the guest list | Consumer | `rsvp`, `guest` | `rsvp.matched_guest_id` | guests | 📐 |
| Open invitation; RSVP | Guest | `invitation.first_opened_at`, `rsvp`, `rsvp_answer` | guests | 📐 |
| Attendance view; event updates | Consumer | `event_update` | guests | 📐 |

### Stage 5 — Growth (each approved separately)

Paid vendor dashboard (D-24; from `vendor_daily_stats`, `conversation`, `event_vendor`, `review`) ·
more communities (data only) · labelled sponsored placements or subscriptions, if
approved · text-message notifications, if approved.

## Cross-stage links the database guarantees

1. `event_vendor.vendor_id → vendor.id`. Event plans reuse Stage 1 vendors; no second
   vendor record is possible.
2. `conversation.vendor_id → vendor.id` and `conversation.event_id → event.id` (the
   consumer's own). The handshake reuses both.
3. `review.event_vendor_id → event_vendor.id` (booked), whose event has passed. No
   review without a recorded booking; whether the two talked on Localites is recorded
   on the review by the database (D-06).
4. `message_attachment → message → conversation`. No file without a conversation.
5. `rsvp → invitation → event` (Stage 4). RSVPs can't float free of an event.
