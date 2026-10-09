# Screen Inventory

**Status:** Proposed (Stage 0).
**Last updated:** 2026-10-09

Every screen in the intended product, grouped by who uses it. **★** marks the four
screens we'll prototype first, so you can judge the look and feel before Stage 1 is
approved. Every screen is designed mobile-first.

Each screen will have defined **loading, empty, error, and success** states. A screen
isn't done until all four exist.

---

## Public — anyone, no account

| # | Screen | Purpose | Stage |
|---|---|---|---|
| P1 ★ | Home | What Tallo is; browse categories; curated collections; search box | 1 |
| P2 | Category page | Vendors in a category, with subcategories and filters | 1 |
| P3 ★ | Search results | Keyword + filters (town, category, attributes); honest empty state | 1 |
| P4 ★ | Vendor profile | Description, services and pricing (where given), photos, service area, verification, contact | 1 |
| P5 | Collection page | A curated list ("Rainy-day party ideas") | 1 |
| P6 | About / how it works | For organizers and for vendors | 1 |
| P7 | For vendors | Why list, how claiming works, what it costs (free) | 1 |
| P8 | Claim or remove this listing | Entry point from an unclaimed profile | 1 |
| P9 | Privacy policy · Terms · Contact | Legal and contact | 1 |
| P10 | 404 / error | Friendly, with a way back | 1 |

## Account

| # | Screen | Stage |
|---|---|---|
| A1 | Sign up | 1 (vendors), 2 (organizers) |
| A2 | Sign in / magic link sent | 1 |
| A3 | Reset password | 1 |
| A4 | Account settings, delete my account | 1 |

## Organizer

| # | Screen | Purpose | Stage |
|---|---|---|---|
| O1 | My events | List of events, upcoming and past | 2 |
| O2 | Create event | Type, date, place — the minimum; everything else optional | 2 |
| O3 | Event home | One calm page: date, place, vendors, guests, RSVP summary, next steps | 2 |
| O4 | Event vendors | Shortlisted vendors and their honest status | 2 |
| O5 | Add vendor to event | From a profile or from saved vendors | 2 |
| O6 | Guests | Guest list, add/edit, invitation status | 2 |
| O7 | Invitation setup | Wording, questions, open vs per-guest links, share buttons | 2 |
| O8 | RSVP results | Attending / not / maybe / no response; answers | 2 |
| O9 | Event updates | Post an update to guests | 2 |
| O10 | Event settings | Co-hosts, privacy, cancel, archive | 2 |
| O11 | Saved vendors | Favourites | 1 or 2 (D-02) |
| O12 | Send inquiry | Message to a vendor, optionally about an event | 3 |
| O13 | My inquiries | Status and thread | 3 |
| O14 | Quotes & bookings | Per event | 4 |
| O15 | Write a review | Only when eligible | 4 |

## Guest — invitation link only, no account

| # | Screen | Purpose | Stage |
|---|---|---|---|
| G1 | Invitation | Event details the host chose to share; updates; RSVP button | 2 |
| G2 | RSVP form | Attending? party size; host's questions | 2 |
| G3 | RSVP confirmation | "Thanks — you can change your answer with this link" | 2 |
| G4 | Link no longer valid | Revoked or expired, without revealing anything about the event | 2 |

## Vendor

| # | Screen | Purpose | Stage |
|---|---|---|---|
| V1 | Vendor home | Listing status, what's next, contact-click counts (if D-04 A) | 1 |
| V2 | Edit listing | Profile, services, pricing model, areas, attributes, photos | 1 |
| V3 | Submit for review / review status | | 1 |
| V4 | Team | Invite, change role, remove | 1 |
| V5 | Claim status | For a pending claim | 1 |
| V6 | Inquiry inbox & thread | | 3 |
| V7 | Quotes & bookings | | 4 |
| V8 | Reviews & reply | | 4 |
| V9 | Engagement report | | 4 |

## Admin & concierge

| # | Screen | Purpose | Stage |
|---|---|---|---|
| X1 | Admin home | Queues: listings awaiting review, claims, verification, removal requests | 1 |
| X2 ★ | Listing editor | Create/edit any listing; status controls; history | 1 |
| X3 | Listing review | Approve/return with reason | 1 |
| X4 | Claims | Approve/reject with reason | 1 |
| X5 | Verification | Record a check with evidence | 1 |
| X6 | Categories | Tree editor | 1 |
| X7 | Attributes | Define filters, options, which categories they apply to | 1 |
| X8 | Places | Municipalities, active/inactive | 1 |
| X9 | Collections | Curate | 1 |
| X10 | Users & roles | Find a user; grant/revoke staff roles | 1 |
| X11 | Audit log | Search admin actions | 1 |
| X12 | Event types | Add/edit event types | 2 |
| X13 | Concierge queue | Inquiries to unclaimed vendors; log delivery and replies | 3 |
| X14 | Review moderation | | 4 |
| X15 | Entitlements & placements | | 4+ |
| X16 | Operations report | Listings, claims, inquiries, response times | 3–4 |

**Count:** 58 screens across all stages; 30 in Stage 1 (31 if favourites are included
per D-02).
