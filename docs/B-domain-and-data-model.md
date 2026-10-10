# B — Domain & Data Model

**Status:** Proposed (Stage 0, revision 2). Awaiting product owner approval.
**Last updated:** 2026-10-09

**Revision 2:** reworked around the two users, consumer and vendor, and the
relationship between them. The commercial domain (quotes, vendor-confirmed bookings,
agreements, payments) has been removed: Localites is the digital handshake, never a party
to the deal. Messaging with file sharing is now central. "Booked" is the consumer's own
record, and it drives post-event feedback and reviews. Plain-English version:
[roles-and-relationships.md](./roles-and-relationships.md).

This is the most important document in the set. If the data model is right, features
can be added for years. If it is wrong, every feature after the mistake inherits it.

---

## 1. Rules that apply to every table

These are decided now because changing them later means touching every table.

| Rule | What it means | Why |
|---|---|---|
| **Stable identity** | Every record has a permanent `id` (UUID v7). It never changes and is never reused. | A vendor is the same vendor whichever screen you reach it from. UUIDs also can't be guessed by incrementing a number in the address bar. |
| **Public addresses are separate from identity** | Vendors also have a readable `slug` (`/vendors/lakeside-face-painting`). Slugs can change; old ones redirect. | Links shared on Facebook keep working after a business renames itself. |
| **One source of truth** | A fact is stored in exactly one place. Other records point to it; they don't copy it. | No conflicting versions of a vendor's name or an event's date. |
| **Nothing important is hard-deleted** | Relationships end with a status and a timestamp, not a `DELETE`. | History survives when a vendor is removed from an event. |
| **Real deletion exists for personal data** | When a person deletes their account, personal fields are erased or anonymised. | Privacy law and basic decency. See [E §7](./E-security-and-privacy-model.md#7-retention-and-deletion). |
| **Every status change is recorded** | Changes write a `status_change` row: who, when, from, to, why. | We can always answer "when was this marked booked, and by whom?" |
| **Each status has one owner** | Every status field says *who* is allowed to set it (consumer, vendor, platform, or system). | "Booked" is the consumer's word; it can never be set by anyone else. |
| **Time** | Stored in UTC. Events store their date, optional times, and local time zone. | Correct times across daylight saving, and ready for other regions. |
| **Money** | Only appears as a vendor's *published* price information, in integer cents. No transaction, payment, or balance fields exist anywhere. | Localites never handles money (ADR-018). |
| **Place** | Every vendor and event is tied to a real `municipality`, not just free text. | Expansion to new towns is adding rows, not rewriting search. |
| **Reference data, not code** | Event types, categories, places, attribute definitions live in admin-editable tables. | Adding "baby shower" or "Barrie" doesn't need a developer. |
| **Ownership on every row** | Every private record traces to its owner (a consumer, a vendor team, or the platform) in one step. | Permission checks are simple and auditable. |

## 2. The two users and the records between them

```mermaid
flowchart LR
    C(["<b>Consumer</b><br/>app_user"])
    V(["<b>Vendor</b><br/>vendor + its team"])

    C -- saves --> SV["saved_vendor<br/><i>private</i>"] --> V
    C -- starts --> CV["conversation<br/>+ messages + files"] -- replies --- V
    C -- plans --> E["event"] -- adds vendor --> EV["event_vendor<br/>considering → booked"] --> V
    CV -. "can be about" .-> E
    EV -- "booked + event passed" --> RR["review_request<br/><i>'How was it?'</i>"] --> R["review"] -- "shown on" --> V
    E -- "later stage" --> G["guests · invitations · RSVPs"]
```

| Record | What it is | Owned by |
|---|---|---|
| `app_user` | A person with an account. Every account is a **consumer** by default. | Themselves |
| `vendor` | A local business. One record per business, forever. | The platform until claimed; then the vendor's team |
| `vendor_member` | A person on a vendor's team (owner, manager, staff). This is what makes someone act **as a vendor**. | The vendor's owner |
| `saved_vendor` | A consumer's private bookmark of a vendor | The consumer |
| `event` | Something a consumer is planning | The consumer (host) |
| `event_vendor` | A vendor on a consumer's event plan, with the consumer's status: considering → booked | The consumer |
| `conversation` | The handshake: one consumer and one vendor talking, optionally about one event | Both, jointly |
| `message`, `message_attachment` | What they say and share | The author |
| `review_request` | Localites asking the consumer how it went | The platform |
| `review` | The consumer's rating and comments, and the vendor's one reply | Consumer (review), vendor (reply), platform (publication) |

**Why there's no "consumer" table.** A consumer isn't a separate kind of account. It's
any person acting on their own behalf. A person becomes able to act *as a vendor* only
through `vendor_member`. This is how one person can wear both hats (D-13) without two
logins, and without any screen ever confusing the two.

## 3. Entity-relationship diagrams

Stage badges: **[S1]** discovery & vendors, **[S2]** the handshake, **[S3]** feedback &
reviews, **[S4]** guests & RSVPs (stage order is decision D-14).

### 3.1 The whole picture

```mermaid
erDiagram
    APP_USER ||--o{ VENDOR_MEMBER : "acts for"
    VENDOR   ||--o{ VENDOR_MEMBER : "team"
    APP_USER ||--o{ SAVED_VENDOR : saves
    VENDOR   ||--o{ SAVED_VENDOR : "saved as"
    APP_USER ||--o{ EVENT : plans
    EVENT    ||--o{ EVENT_VENDOR : "has on plan"
    VENDOR   ||--o{ EVENT_VENDOR : "is on plans"
    APP_USER ||--o{ CONVERSATION : "starts (consumer)"
    VENDOR   ||--o{ CONVERSATION : "replies (vendor)"
    EVENT    |o--o{ CONVERSATION : "about"
    CONVERSATION ||--o{ MESSAGE : contains
    MESSAGE  ||--o{ MESSAGE_ATTACHMENT : "has files"
    EVENT_VENDOR ||--o| REVIEW_REQUEST : "booked, then asked"
    EVENT_VENDOR ||--o| REVIEW : "reviewed once"
    APP_USER ||--o{ VENDOR_INTEREST : "wants to reach"
    VENDOR   ||--o{ VENDOR_INTEREST : "unclaimed"
    VENDOR   }o--o{ CATEGORY : "listed under"
    VENDOR   }o--o{ MUNICIPALITY : serves
    EVENT    }o--o| MUNICIPALITY : "located in"
    EVENT    }o--|| EVENT_TYPE : "is a"
    EVENT    ||--o{ GUEST : "invites (S4)"
```

### 3.2 Discovery & vendor — [S1]

```mermaid
erDiagram
    VENDOR {
        uuid id PK
        text slug UK
        text display_name
        text listing_status "draft|pending_review|published|unpublished|archived"
        text claim_status "unclaimed|claim_pending|claimed"
        text verification_status "unverified|verified|lapsed"
        uuid primary_municipality_id FK
    }
    VENDOR_MEMBER {
        uuid vendor_id FK
        uuid user_id FK
        text role "owner|manager|staff"
        timestamptz ended_at
    }
    VENDOR_SERVICE {
        uuid id PK
        uuid vendor_id FK
        text pricing_model "fixed|starting_at|hourly|on_request|not_listed"
        int  price_cents "published info only, null unless the vendor gave it"
    }
    CATEGORY {
        uuid id PK
        uuid parent_id FK
        text slug UK
    }
    ATTRIBUTE_DEFINITION {
        uuid id PK
        text key UK
        text data_type "boolean|number|single_choice|multi_choice|text"
        bool is_filterable
    }
    VENDOR_ATTRIBUTE_VALUE {
        uuid vendor_id FK
        uuid attribute_definition_id FK
        uuid option_id FK
    }
    VENDOR_CLAIM {
        uuid vendor_id FK
        uuid claimant_user_id FK
        text status "submitted|approved|rejected|withdrawn"
    }
    VERIFICATION_RECORD {
        uuid vendor_id FK
        text check_type
        text outcome
        uuid evidence_media_id FK "private"
    }
    VENDOR ||--o{ VENDOR_MEMBER : ""
    VENDOR ||--o{ VENDOR_SERVICE : offers
    VENDOR }o--o{ CATEGORY : ""
    VENDOR ||--o{ VENDOR_ATTRIBUTE_VALUE : ""
    ATTRIBUTE_DEFINITION ||--o{ VENDOR_ATTRIBUTE_VALUE : ""
    VENDOR ||--o{ VENDOR_CLAIM : ""
    VENDOR ||--o{ VERIFICATION_RECORD : ""
```

Full Stage 1 detail, including service areas, media, collections and the audit tables,
is in [schema/stage1-proposed.sql](./schema/stage1-proposed.sql).

### 3.3 The handshake: events, plans, conversations — [S2]

```mermaid
erDiagram
    EVENT {
        uuid id PK
        uuid host_user_id FK "the consumer"
        uuid event_type_id FK
        text title
        date event_date
        time start_time "optional"
        time end_time "optional"
        text timezone
        uuid municipality_id FK "optional"
        int  guest_count_estimate "optional"
        text status "planning|cancelled|archived"
    }
    EVENT_VENDOR {
        uuid id PK
        uuid event_id FK
        uuid vendor_id FK
        text status "considering|booked|removed  (set by consumer only)"
        timestamptz booked_at
        timestamptz vendor_flagged_at "vendor says: not a real booking"
    }
    CONVERSATION {
        uuid id PK
        uuid consumer_user_id FK
        uuid vendor_id FK "must be claimed"
        uuid event_id FK "optional; consumer's own event"
        text status "open|blocked_by_consumer|blocked_by_vendor"
        timestamptz last_message_at
    }
    MESSAGE {
        uuid id PK
        uuid conversation_id FK
        uuid author_user_id FK
        text author_side "consumer|vendor"
        text body
        timestamptz removed_at
    }
    MESSAGE_ATTACHMENT {
        uuid message_id FK
        uuid media_asset_id FK "private storage only"
    }
    CONVERSATION_READ_MARKER {
        uuid conversation_id FK
        uuid user_id FK
        timestamptz last_read_at "private unread count, not a read receipt"
    }
    VENDOR_INTEREST {
        uuid vendor_id FK "unclaimed vendor"
        uuid user_id FK
        timestamptz notified_joined_at
    }
    EVENT ||--o{ EVENT_VENDOR : ""
    EVENT |o--o{ CONVERSATION : ""
    CONVERSATION ||--o{ MESSAGE : ""
    MESSAGE ||--o{ MESSAGE_ATTACHMENT : ""
    CONVERSATION ||--o{ CONVERSATION_READ_MARKER : ""
```

### 3.4 Feedback & reviews — [S3]

```mermaid
erDiagram
    EVENT_VENDOR {
        uuid id PK
        text status "must be booked"
    }
    REVIEW_REQUEST {
        uuid id PK
        uuid event_vendor_id FK "one per booked vendor"
        timestamptz scheduled_for "morning after the event"
        timestamptz sent_at "null until actually sent"
        text status "scheduled|sent|completed|expired|cancelled"
        timestamptz expires_at "60 days"
    }
    REVIEW {
        uuid id PK
        uuid event_vendor_id FK "unique: one review per booking"
        uuid author_user_id FK "must be the event's host"
        smallint rating "1-5"
        text body
        text moderation_status "pending|published|rejected|removed"
        text vendor_reply "one reply"
    }
    VENDOR_RATING_SUMMARY {
        uuid vendor_id
        int  review_count
        numeric average_rating "null until 3 published reviews"
    }
    EVENT_VENDOR ||--o| REVIEW_REQUEST : ""
    EVENT_VENDOR ||--o| REVIEW : ""
    REVIEW }o--|| VENDOR_RATING_SUMMARY : "counted in"
```

`VENDOR_RATING_SUMMARY` is calculated from published reviews, never stored or typed in.

**A review is chained to a booking:** `review → event_vendor (status = booked) → event
(date passed) → host`. The database refuses a review that breaks any link in that
chain. See the proposed SQL in
[schema/stage2-3-proposed.sql](./schema/stage2-3-proposed.sql).

### 3.5 Guests & RSVPs — [S4]

```mermaid
erDiagram
    EVENT ||--o{ GUEST : ""
    EVENT ||--o{ INVITATION : ""
    GUEST |o--o{ INVITATION : ""
    INVITATION ||--o{ RSVP : "latest wins"
    EVENT ||--o{ EVENT_QUESTION : ""
    RSVP ||--o{ RSVP_ANSWER : ""
    EVENT ||--o{ EVENT_UPDATE : ""
    GUEST {
        uuid id PK
        uuid event_id FK
        text display_name
        text contact_email "optional"
    }
    INVITATION {
        uuid id PK
        bytea token_hash "token itself never stored"
        text status "active|revoked|expired"
        timestamptz first_opened_at
    }
    RSVP {
        uuid id PK
        text response "attending|not_attending|maybe"
        int  party_size
    }
```

Guests are **not users**: they never have accounts and never interact with vendors.
Invitation-link security is in [E §5](./E-security-and-privacy-model.md#5-invitation-link-security).

## 4. Lifecycle states and what they do NOT mean

User-facing wording must match the "means" column and must never imply the "does not
mean" column.

| Moment | Where it lives | Set by | It means | It does **not** mean |
|---|---|---|---|---|
| Appears in search | Calculated live | — | Listing is published and matches | Endorsed or available |
| Saved | `saved_vendor` | Consumer | A private bookmark | Any contact. The vendor isn't told. |
| Conversation started | `conversation` + first `message` | Consumer | The consumer wrote to the vendor through Localites | The vendor has read or replied |
| Vendor replied | `message` with `author_side = vendor` | Vendor | A reply exists | Availability or agreement |
| File shared | `message_attachment` | Either | A file was sent in the conversation | Anything about its contents. Localites doesn't read or act on files. |
| Added to event | `event_vendor.status = considering` | Consumer | The consumer is considering this vendor | Contacted or booked. The vendor isn't told. |
| Booked | `event_vendor.status = booked` | Consumer | **The consumer says** they've booked this vendor | That Localites or the vendor confirmed it, or that money moved |
| Booking flagged | `event_vendor.vendor_flagged_at` | Vendor | The vendor says this booking isn't real | That it isn't; the platform team resolves it |
| Feedback requested | `review_request.status = sent` | System | An email was actually sent (or the in-app prompt shown) | That it was read |
| Review submitted | `review.moderation_status = pending` | Consumer | Awaiting the platform team's check | Published |
| Review published | `review.moderation_status = published` | Platform | Passed the review policy and is public | Localites endorses the vendor or the opinion |

### State machines

Only these transitions are allowed; anything else is rejected by the server (ADR-017).

**`event_vendor.status`** — consumer only.
```
considering → booked       (consumer marks booked; vendor is notified)
booked      → considering  (consumer un-marks; vendor is notified; any pending feedback request is cancelled)
considering → removed      (row kept, removed_at set)
booked      → removed      (row kept; vendor is notified)
removed     → considering  (consumer re-adds the same vendor; same row, history kept)
```

**`conversation.status`**
```
open → blocked_by_consumer   (consumer blocks)
open → blocked_by_vendor     (vendor owner/manager blocks)
blocked_* → open             (only the side that blocked can unblock)
```

**`review_request.status`** — system only.
```
scheduled → sent → completed
    ↓        ↓
cancelled  expired   (after 60 days, or if the booking is un-marked or flagged)
```

**`review.moderation_status`** — platform only (except the consumer submitting).
```
pending → published → removed   (removed only for a policy breach, with reason)
pending → rejected              (with reason shown to the author)
```

**`vendor.listing_status`** — unchanged from revision 1.
```
draft → pending_review → published ⇄ unpublished → archived
```

**`invitation.status`** — Stage 4, unchanged. Opening a link is recorded separately
from RSVPing.

## 5. Metadata strategy

Unchanged from revision 1.

**Tier 1, real columns:** anything that drives behaviour, permissions or lifecycle.
**Tier 2, typed attributes:** admin-managed filters (`attribute_definition`,
`attribute_option`, `vendor_attribute_value`). An admin adds a filter without a
developer, and values are validated by type. **Tier 3, display-only extras:** a small
JSON field for things never filtered on. A database check prevents a Tier 2 key from
hiding there.

| To add… | You do… | Developer needed? |
|---|---|---|
| A category or subcategory | Admin → Categories → Add | No |
| An event type ("Retirement party") | Admin → Event types → Add | No |
| A filter ("Offers gluten-free") | Admin → Attributes → Add | No |
| A town | Admin → Places → Add | No |
| A new **core** field | Migration + code | Yes, by design |

## 6. Relationship semantics

| Relationship | Cardinality | What ending it means |
|---|---|---|
| Person ↔ Vendor team (`vendor_member`) | many-to-many, with role | Ended, not deleted. Past messages stay attributed to the business. |
| Consumer → Event | one host, many events | Cancelling sets status; vendors marked booked are notified. |
| Event ↔ Vendor (`event_vendor`) | one row per event+vendor pair | Removing sets `removed`; re-adding reuses the row. History in `status_change`. |
| Consumer ↔ Vendor (`conversation`) | at most one general conversation per pair, plus at most one per event | Blocking closes it for both; nothing is deleted. |
| Conversation → Event | optional; can be linked later | The vendor sees only the event's type, date, town and guest-count estimate. |
| Event ↔ Vendor → Review | at most one | Enforced by the database. |
| Consumer ↔ unclaimed Vendor (`vendor_interest`) | one per pair | When the vendor claims, the consumer is told they can now message them. |

## 7. Future changes we already know about

| Possible future need | Path |
|---|---|
| A business with several listings, or non-vendor organisations | Add `organization` above `vendor`; no vendor IDs change. |
| Households (co-parents planning together) | Add `household`; events gain an optional household. Conversations stay one consumer ↔ one vendor. |
| Co-hosts on an event | Add `event_collaborator`; conversations remain the host's unless shared explicitly. |
| "Within 30 km" search | Coordinates are already stored on places; add a vendor base location and radius. |
| A search service at scale | Fed from PostgreSQL, which remains the source of truth. |
| Vendors sending structured price estimates | Could be added as a message *type* inside a conversation. It would remain information between the two parties, never a transaction. |
| Vendor subscriptions or sponsored placements | `entitlement` and `placement` keyed on `vendor_id`, clearly labelled. They never affect reviews or ratings. |
| Payments | **Not planned.** Nothing in the model assumes or prepares for them. It would be a new decision, a new domain, and a change to the terms of use. |

## 8. Table catalogue

| Table | Domain | Stage | Purpose |
|---|---|---|---|
| `app_user` | People | S1 | Anyone with an account. A consumer by default. |
| `platform_role` | People | S1 | Grants `admin` to the platform team. |
| `municipality`, `category`, `attribute_*` | Reference | S1 | Places, taxonomy, typed filters |
| `vendor` + `vendor_*` | Vendor | S1 | The business, its team, services, areas, attributes, media, links, slugs |
| `vendor_claim`, `verification_record` | Vendor | S1 | Ownership claims; evidence-backed checks |
| `media_asset` | Media | S1 | Every stored file, with owner and visibility |
| `collection`, `collection_item` | Discovery | S1 | Curated lists |
| `status_change`, `audit_log` | Audit | S1 | Append-only history |
| `analytics_event` | Analytics | S1 | Anonymous counts: profile views, contact clicks (if D-04 A) |
| `saved_vendor` | Consumer | S2 | Private bookmarks |
| `event_type`, `event` | Event | S2 | The consumer's event |
| `event_vendor` | Event | S2 | Considering → booked |
| `conversation`, `message`, `message_attachment` | Handshake | S2 | Consumer ↔ vendor messaging with files |
| `conversation_read_marker` | Handshake | S2 | Private unread counts |
| `vendor_interest` | Handshake | S2 | Consumers who want to reach an unclaimed vendor |
| `moderation_report` | Safety | S2 | Reports of messages, conversations, reviews, listings |
| `notification` | Comms | S2 | Log of every email sent, with honest status |
| `review_request` | Reviews | S3 | "How was it?" prompts |
| `review` | Reviews | S3 | Ratings, comments, vendor reply |
| `vendor_rating_summary` | Reviews | S3 | Calculated view. Average shown only at 3+ reviews. |
| `guest`, `invitation`, `event_question`, `rsvp`, `rsvp_answer`, `event_update` | Guests | S4 | Invitations and RSVPs |
| `entitlement`, `placement` | Commercial | Future | Designed only, if ever approved |

**Removed in revision 2:** `inquiry`, `inquiry_message`, `quote`, `quote_line`,
`booking`, `document`, `review_eligibility`, and the concierge role.
