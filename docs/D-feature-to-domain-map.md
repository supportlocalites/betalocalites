# D — Feature-to-Domain Map

**Status:** Proposed (Stage 0).
**Last updated:** 2026-10-09

For every capability: which records it reads and writes, which code module owns it,
and what it depends on. Use this to answer *"if we change X, what else is affected?"*

**Status key:** 📐 designed · 🔨 in progress · ✅ released · ⏸ deferred

---

## Modules

The application is one codebase (ADR-001), divided into modules. Each module owns its
tables: only that module writes to them. Other modules read through the owning module's
functions, never by querying its tables directly. This is what keeps one application
from turning into a tangle.

| Module | Owns tables | Depends on |
|---|---|---|
| `identity` | `app_user`, `platform_role` | — |
| `policy` | *(no tables — the permission rules)* | `identity` and the ownership fields of every module |
| `taxonomy` | `category`, `attribute_definition`, `attribute_option`, `attribute_definition_category`, `municipality`, `event_type` | — |
| `media` | `media_asset` | `identity` |
| `vendors` | `vendor`, `vendor_member`, `vendor_category`, `vendor_service`, `vendor_service_area`, `vendor_attribute_value`, `vendor_media`, `vendor_slug_history`, `vendor_claim`, `verification_record` | `taxonomy`, `media`, `identity` |
| `discovery` | `collection`, `collection_item`, `saved_vendor` | `vendors`, `taxonomy` |
| `events` | `event`, `event_collaborator`, `event_vendor`, `event_update` | `vendors`, `taxonomy`, `identity` |
| `guests` | `guest`, `invitation`, `event_question`, `rsvp`, `rsvp_answer` | `events` |
| `engagement` | `inquiry`, `inquiry_message` | `vendors`, `events` |
| `commerce` | `quote`, `quote_line`, `booking`, `document` | `engagement`, `events`, `vendors` |
| `reputation` | `review_eligibility`, `review` | `commerce` |
| `audit` | `status_change`, `audit_log` | *(written to by all modules)* |
| `analytics` | `analytics_event` | *(written to by all modules)* |

## Capability map

### Stage 1 — Discovery & vendor foundation

| Capability | Status | Reads | Writes | Module | Depends on |
|---|---|---|---|---|---|
| Landing page | 📐 | `category`, `collection` | — | discovery | taxonomy |
| Browse by category | 📐 | `category`, `vendor`, `vendor_category` | — | discovery | vendors, taxonomy |
| Search & filter | 📐 | `vendor`, `vendor_category`, `vendor_attribute_value`, `vendor_service_area`, `municipality` | — | discovery | vendors, taxonomy |
| Vendor profile page | 📐 | `vendor`, `vendor_service`, `vendor_media`, `vendor_service_area`, `vendor_attribute_value`, `verification_record` (outcome only) | — | vendors | media, taxonomy |
| Old-slug redirects | 📐 | `vendor_slug_history` | — | vendors | — |
| Contact click counting (if D-04 A) | 📐 | — | `analytics_event` | analytics | vendors |
| Vendor sign-up / sign-in | 📐 | `app_user` | `app_user` | identity | Supabase Auth |
| Claim a listing | 📐 | `vendor` | `vendor_claim`, `status_change` | vendors | identity, policy |
| Approve a claim | 📐 | `vendor_claim` | `vendor_claim`, `vendor`, `vendor_member`, `status_change`, `audit_log` | vendors | policy |
| Vendor edits own listing | 📐 | `vendor` + children | `vendor` + children, `audit_log` | vendors | policy, media |
| Submit for review | 📐 | `vendor` | `vendor`, `status_change` | vendors | policy |
| Admin: create listing | 📐 | `taxonomy` | `vendor` + children, `audit_log` | vendors | policy |
| Admin: review & publish | 📐 | `vendor` | `vendor`, `status_change`, `audit_log` | vendors | policy |
| Admin: record verification | 📐 | `vendor` | `verification_record`, `vendor`, `audit_log` | vendors | media, policy |
| Admin: manage categories, attributes, places | 📐 | taxonomy tables | taxonomy tables, `audit_log` | taxonomy | policy |
| Admin: curated collections | 📐 | `vendor` | `collection`, `collection_item` | discovery | vendors |
| Image upload | 📐 | — | `media_asset`, `vendor_media` | media | Supabase Storage |
| Favourites (if D-02 A) | 📐/⏸ | `saved_vendor` | `saved_vendor` | discovery | identity |

### Stage 2 — Complete event journey

| Capability | Status | Reads | Writes | Module | Depends on |
|---|---|---|---|---|---|
| Organizer sign-up | 📐 | `app_user` | `app_user` | identity | Stage 1 auth |
| Create / edit event | 📐 | `event_type`, `municipality` | `event`, `status_change` | events | taxonomy |
| Add co-host / helper | 📐 | `event` | `event_collaborator`, `audit_log` | events | policy |
| Add vendor to event ("shortlist") | 📐 | `vendor` | `event_vendor`, `status_change` | events | **Stage 1 vendor records** |
| Remove vendor from event | 📐 | `event_vendor` | `event_vendor` (status, `removed_at`) | events | — |
| Favourites (if D-02 B) | 📐 | `saved_vendor` | `saved_vendor` | discovery | identity |
| Guest list | 📐 | `guest` | `guest` | guests | events |
| Create invitation link | 📐 | `event`, `guest` | `invitation` | guests | events |
| Revoke invitation | 📐 | `invitation` | `invitation`, `status_change` | guests | policy |
| Open invitation (guest) | 📐 | `invitation`, `event` (safe fields), `event_question` | `invitation.first_opened_at` | guests | — |
| Submit RSVP (guest, no account) | 📐 | `invitation`, `event_question` | `rsvp`, `rsvp_answer` | guests | — |
| Organizer RSVP view | 📐 | `guest`, `rsvp`, `rsvp_answer` | — | guests | policy |
| Event updates | 📐 | `event_update` | `event_update` | events | guests (audience) |

### Stage 3 — Vendor engagement

| Capability | Status | Reads | Writes | Module | Depends on |
|---|---|---|---|---|---|
| Send inquiry | 📐 | `vendor`, `event`, `event_vendor` | `inquiry`, `inquiry_message`, `status_change` | engagement | Stage 1 vendors, Stage 2 events |
| Route inquiry (direct vs concierge) | 📐 | `vendor.claim_status` | `inquiry.handling_mode` | engagement | vendors |
| Concierge queue | 📐 | `inquiry` (concierge mode) | `inquiry`, `inquiry_message`, `status_change` | engagement | policy |
| Vendor inbox & respond | 📐 | `inquiry` (own vendor) | `inquiry_message`, `inquiry`, `status_change` | engagement | policy |
| Update `event_vendor` to `contacted` on delivery | 📐 | — | `event_vendor`, `status_change` | events (called by engagement) | engagement |
| Inquiry notification emails | 📐 | — | — | engagement | Resend (ADR-013) |

### Stage 4 — Commercial & operational (each item approved separately)

| Capability | Status | Writes | Depends on |
|---|---|---|---|
| Quotes & revisions | 📐 | `quote`, `quote_line` | Stage 3 inquiries |
| Bookings | 📐 | `booking`, `event_vendor` status | Quotes |
| Documents & agreements | 📐 | `document`, `media_asset` (private) | Bookings |
| Review eligibility & reviews | 📐 | `review_eligibility`, `review` | Bookings, D-06 |
| Vendor engagement analytics | 📐 | `analytics_event` | Stage 1 click counting |
| Manual entitlements | 📐 | `entitlement` | D-xx (commercial model) |
| Sponsored placements | 📐 | `placement` | Entitlements; disclosure UI |
| Notifications & reminders | 📐 | `notification`, `notification_preference` | An approved delivery service |

## Cross-stage dependencies that must not be broken

These are the connections the brief warns about. Each is enforced by a foreign key in
the database, so it cannot be bypassed by accident.

1. `event_vendor.vendor_id` → `vendor.id`. Stage 2 cannot create its own vendor records.
2. `inquiry.vendor_id` → `vendor.id` and `inquiry.event_id` → `event.id`. Stage 3 reuses
   both.
3. `booking.event_vendor_id` → `event_vendor.id`. A booking is the confirmation of an
   existing event–vendor relationship, not a new one.
4. `review.review_eligibility_id` → `review_eligibility.booking_id` → `booking.id`. No
   review without a booking.
5. `rsvp.invitation_id` → `invitation.event_id` → `event.id`. RSVPs can't float free of
   an event.
