# Screen Inventory

**Status:** Proposed (Stage 0, revision 2).
**Last updated:** 2026-10-09

Every screen in the intended product, grouped by who uses it. **★** marks the screens
we'll prototype first (PO-09) so you can judge the experience on your phone. Every
screen is designed mobile-first and has defined **loading, empty, error, and success**
states. A screen isn't finished until all four exist.

**Revision 2:** organised around the two users. Messaging, event plans and reviews
added; quotes, bookings and the concierge queue removed.

---

## Public — anyone, no account

| # | Screen | Purpose | Stage |
|---|---|---|---|
| P1 ★ | Home | What Localites is, for consumers and for vendors; categories; collections; search | 1 |
| P2 | Category page | Vendors in a category, with filters | 1 |
| P3 ★ | Search results | Keyword + filters; honest empty state | 1 |
| P4 ★ | Vendor profile | Services, published prices, photos, area, verification; **Message** (claimed) or the business's own contact + *"Let them know you're interested"* (unclaimed); **Add to event**; reviews from Stage 3 | 1 |
| P5 | Collection page | A curated list | 1 |
| P6 | How it works | For consumers and for vendors. States plainly that Localites doesn't handle payments. | 1 |
| P7 | For vendors | Why join, how claiming works, that it's free | 1 |
| P8 | Claim or remove this listing | From an unclaimed profile | 1 |
| P9 | Privacy · Terms · Review policy · Contact | | 1 |
| P10 | 404 / error | Friendly, with a way back | 1 |

## Account

| # | Screen | Stage |
|---|---|---|
| A1 | Sign up (one sign-up for everyone) | 1 |
| A2 | Sign in / sign-in link sent | 1 |
| A3 | Reset password | 1 |
| A4 | Account settings, delete my account | 1 |
| A5 | Switch: "My events" ⇄ "My business" (only shown to people on a vendor team) | 2 |

## Consumer

| # | Screen | Purpose | Stage |
|---|---|---|---|
| C1 | My events | Upcoming and past | 2 |
| C2 | Create event | Type, date, town; everything else optional | 2 |
| C3 ★ | Event plan | One calm page: vendors **considering** and **booked**, conversations about this event, what's next | 2 |
| C4 | Add to event | From a profile: pick an event (or create one) | 2 |
| C5 | Mark as booked | Confirms, and says plainly: *"We'll let [Vendor] know you've marked them as booked."* | 2 |
| C6 | Saved vendors | | 2 |
| C7 | Messages | All conversations, unread first | 2 |
| C8 ★ | Conversation | Messages and files; "about" an event (optional); block, report; "Localites doesn't process payments" footer | 2 |
| C9 | Start a conversation | Choose whether to share an event, with a preview of exactly what the vendor will see | 2 |
| C10 | Not on Localites yet | Their own contact details + *"Let them know you're interested"* | 2 |
| C11 | How was it? | From the feedback email: stars + comments, one per booked vendor | 3 |
| C12 | My reviews | Status: checking, published, declined (with reason) | 3 |
| C13 | Guests | Guest list and invitation status | 4 |
| C14 | Invitation setup | Wording, questions, share buttons | 4 |
| C15 | RSVP results | | 4 |
| C16 | Event updates to guests | | 4 |

## Vendor

| # | Screen | Purpose | Stage |
|---|---|---|---|
| V1 | My business | Listing status; from Stage 2, unread conversations and bookings marked | 1 |
| V2 | Edit listing | Profile, services, pricing information, areas, attributes, photos | 1 |
| V3 | Submit for review / status | | 1 |
| V4 | Team | Invite, change role, remove | 1 |
| V5 | Claim status | | 1 |
| V6 | Inbox | Conversations with consumers | 2 |
| V7 ★ | Conversation (vendor view) | Messages and files; event summary panel (type, date, town, guest estimate) when shared | 2 |
| V8 | Bookings marked | Consumers who marked the business booked; **"This isn't right"** to flag | 2 |
| V9 | Reviews | Published reviews; reply once | 3 |
| V10 | Insights | Visits, clicks, conversations, bookings marked, reviews | 5 |

## Guest — invitation link only, no account

| # | Screen | Stage |
|---|---|---|
| G1 | Invitation | 4 |
| G2 | RSVP form | 4 |
| G3 | RSVP confirmation | 4 |
| G4 | Link no longer valid | 4 |

## Platform team

| # | Screen | Purpose | Stage |
|---|---|---|---|
| X1 | Admin home | Queues needing attention | 1 |
| X2 | Listing editor | Create/edit any listing; history | 1 |
| X3 | Listing review | Approve or return with reason | 1 |
| X4 | Claims | Approve or reject with reason | 1 |
| X5 | Verification | Record a check with evidence | 1 |
| X6 | Categories | | 1 |
| X7 | Attributes (filters) | | 1 |
| X8 | Places | | 1 |
| X9 | Collections | | 1 |
| X10 | Users & roles | | 1 |
| X11 | Audit log | | 1 |
| X12 | Event types | | 2 |
| X13 | Reports | Reported messages, conversations, listings. Opening a conversation is logged. | 2 |
| X14 | Businesses consumers want | Unclaimed businesses with interest, to invite | 2 |
| X15 | Review moderation | Publish or decline against the written policy | 3 |
| X16 | Booking flags | Resolve vendor flags | 3 |
| X17 | Operations report | Listings, claims, conversations, reply rates, reviews | 3 |

## Counts

| Stage | Screens |
|---|---|
| 1 — Discovery & vendors | 30 |
| 2 — The handshake | 17 |
| 3 — Feedback & reviews | 6 |
| 4 — Guests & RSVPs | 8 |
| 5 — Growth | 1 |
| **Total** | **62** |
