# Screen Inventory

**Status:** Proposed (Stage 0, revision 2).
**Last updated:** 2026-10-14 (guests, Stage 4 part 1: C13, C14, G1–G4 built; reviews, parts 1 and 2: C11, V9, X15, A4 emails built; 2026-10-13: Plan an event, slice 2A: C1–C6, A5, V1-lite, V8, X12 and X16 (read-only) built; earlier, sign-in with emailed codes and claiming: A1–A4, P8, V5 and X4)

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
| P4 ★ | Vendor profile | Services, published prices, photos (**built**: the first photo whole in a band on top, the square profile photo beside the name, every photo whole in rows, opening in a full-screen viewer; search results show the square profile photo), area, verification; **Message** (claimed) or the business's own contact + **Inquire** (unclaimed or unverified, D-04); **Add to event**; reviews from Stage 3. **Planning an event?** section built (2A): **Add to event**, **Save**, and a line saying the business isn't told | 1 |
| P5 | Collection page | A curated list | 1 |
| P6 | How it works | For consumers and for vendors. States plainly that Localites doesn't handle payments. **Built** (`/how-it-works`, linked from Explore): find, talk directly or Inquire, plan, invite guests, say how it went; no money through Localites | 1 |
| P7 | For vendors | Why join, how claiming works, that it's free. **Built** (`/for-businesses`, linked from Explore): already listed from public details and removal on request (D-03), claiming and how it's checked (D-33, D-35), what an owner can do (ADR-029, 0015), D-40's booked summary; nothing about paid plans (not decided) | 1 |
| P8 | Claim or remove this listing | From an unclaimed profile. **Built** (`/vendors/<name>/claim`, ADR-028): how you're connected, a note, "I'm allowed to manage this listing"; removal by email to the team | 1 |
| P9 | Privacy · Terms · Review policy · Contact | | 1 |
| P10 | 404 / error | Friendly, with a way back | 1 |
| P11 | Suggest a business | Three questions (name; website; phone or email), then an honest "our team will look into it" (D-25) | 1 |

## Account

| # | Screen | Stage |
|---|---|---|
| A1 | Sign in or create an account: one screen for both (D-27). **Built** (`/join`): email, a 6-digit emailed code (with a reminder to check spam), then, for new people, their name and, if they wish, gender, date of birth and address (D-32, D-36) | 1 |
| A2 | "We've emailed you a code" (part of A1; codes, not links, D-32) | 1 |
| A3 | ~~Reset password~~: not needed, no passwords for the public (D-32). The team's password reset is in the runbook | — |
| A4 | Account settings, delete my account. **Built** (`/account`; **Delete your account** at `/account/delete`, 13 October 2026, E §8): name, email, personal details (D-36), your businesses and claims, a "Planning" section, **Emails** (turn "How was it?" emails on or off, reviews part 2) and, for owners, **Bookings marked**, sign out; deleting an account comes before launch | 1 |
| A5 | Switch: "My events" ⇄ "My business" (only shown to people on a vendor team). **Built** (2A) on My events, Saved businesses and My business | 2 |

## Consumer

| # | Screen | Purpose | Stage |
|---|---|---|---|
| C1 | My events | Upcoming and past. **Built** (`/events`): cards show the event's name, date and town; **Plan an event** | 2 |
| C2 | Create event | **Built** (`/events/new`, `/events/<id>/edit`, D-39): name (required, private), "What kind of event? (optional)" with **None** chosen, date, town; "Add more details" (times, guests, where, ages, budget, notes); the box saying what a booked business sees (D-40). Editing tells booked businesses when the date or town changes; **Cancel this event** is final | 2 |
| C3 ★ | Event plan | One calm page: vendors **considering** and **booked**, conversations about this event, what's next. **Built** (`/events/<id>`): Booked, Considering, Removed, What's next, "Only you can see this", a flagged booking's quiet line (D-41), and **Ideas for your …** with up to 3 **Featured** businesses (always with "Featured businesses are promoted by the Localites team.") and "Businesses people often need" (D-43); with no kind of event, one quiet line linking to Edit details. Conversations come with messaging | 2 |
| C4 | Add to event | From a profile: pick an event (or create one). **Built** (`/vendors/<name>/add`): two taps, or a three-box quick event; also **Save** and **Remove from saved** | 2 |
| C5 | Mark as booked | Confirms, and says plainly: *"We'll let [Vendor] know you've marked them as booked."* **Built** (`/events/<id>/plan/<row>/book`, with un-mark, remove and put back, each asking first and working without JavaScript); for a business not on Localites yet it says it can't be told | 2 |
| C6 | Saved vendors | **Built** (`/saved`, "Saved businesses"): private; nobody is told | 2 |
| C7 | Messages | All conversations, unread first. **Built** (Stage 2B part 1, `/messages`, "Messages" in the header): newest first, each with the business's square photo, the last message ("You: …"), and the person's own new count; blocked, "Paused" (the business isn't listed at the moment) and "No longer on Localites" said | 2 |
| C8 ★ | Conversation | Messages and files; "about" an event (optional); block, report; "Localites doesn't process payments" footer. **Built (text, part 1)** (`/messages/<id>`): messages oldest first, your own on the right, looks for new ones about every 15 seconds while you're there (a quick look, `/messages/<id>/check`; slower when nothing changes, none while you're away); says so when the business isn't listed at the moment (paused) or has left (ended); "about one of your events" with what the business sees said beside it; remove your own message; block and unblock; the payments line and "only share what's needed". Report and files built; once an ended conversation's business has joined again, a link to message it afresh; a photo or PDF with any message (part 3), shown in the conversation and opened only by the two sides | 2 |
| C9 | Start a conversation | Choose whether to share an event, with a preview of exactly what the vendor will see. **Built** (`/vendors/<name>/message`, from **Questions? → Message …** on the page of a business that has joined): one conversation per person and business (goes back to it); a business that hasn't joined goes to Inquire; a photo or PDF can go with the first message, or be all of it | 2 |
| C10 | Inquire | For unclaimed or unverified businesses: their own contact details, an optional note and event; says honestly what happens next (D-04). **Built** (ADR-024, `/vendors/<name>/inquire`, from **Interested? → Inquire** on the business page): once per business; the team email sent before the page answers, and a failure said plainly with **Try sending again**; the person is emailed when the business joins | 2 |
| C11 | How was it? | From the feedback email: stars + comments, one per booked vendor. **Built, part 1** (`/events/<id>/review/<row>`, linked from "Plan an event" once the event has passed): stars and words, editable while the team checks it. **Part 2:** the "How was it?" email the morning after, and one reminder a week later, link here | 3 |
| C12 | My reviews | Status: checking, published (a denied review isn't shown to its author at all, D-51) | 3 |
| C13 | Guests | Guest list; who has opened and replied; match names from the group link; "No reply yet" list (D-08). **Built, part 1** (`/events/<id>/guests`, from the event plan): add a guest (name; phone or email optional, deleted 90 days after), remove, each one's state (no reply yet, opened, coming with how many, maybe, can't come, their note), the totals, the host's message to guests. **Part 2 built** (migration 0037): replies from the group link, matched to a guest with one tap or removed; each guest's answers; the host's questions (up to 5) and updates for guests (up to 20, shown on every invitation, shared from the host's phone) | 4 |
| C14 | Invitation setup | Wording, questions; personal links per guest and a group link; share by text, WhatsApp, social media or email; printable QR code (D-08). **Built, part 1** (`/events/<id>/guests/<guest>`): the guest's own link with ready words, the phone's share sheet, Copy link, Text message, WhatsApp, Email; make a new link (the old one stops at once); **change their reply** (D-49: the guest is emailed if the host gave their email). **Part 2 built:** the group link (Copy, Share, Text message, WhatsApp; make a new one; switch it off) and a printable invitation with a QR code (`/events/<id>/guests/print`, for the group link or one guest) | 4 |
| C15 | RSVP results | | 4 |
| C16 | Event updates to guests | | 4 |

## Vendor

| # | Screen | Purpose | Stage |
|---|---|---|---|
| V1 | My business | Listing status; from Stage 2, unread conversations and bookings marked. **V1-lite built** (2A, `/business`): each business the person owns or manages, with bookings marked coming up and links to edit, Analytics and Bookings marked | 1 |
| V2 | Edit listing | Profile, services, pricing information, areas, attributes, photos. **Built** (`/vendors/<name>/edit`, D-34, ADR-029): laid out like the public page, with "View as a visitor"; descriptions, services and prices, website and phone. **Photos built** (`/vendors/<name>/photos`, owner and managers, migration 0016): up to 8, each with a description; the first is the main photo; shrunk in the browser, checked and stripped of location details on the server; the team reviews and removes at **Admin → Photos** | 1 |
| V3 | Submit for review / status | | 1 |
| V4 | Team | Invite, change role, remove. **Built** (`/vendors/<name>/team`, owner only): invite a manager or staff by email (link works 7 days, once, for that address only), cancel an invitation, remove someone. To change someone's role, remove them and invite them again. The invited person accepts at `/team-invite/<link>` | 1 |
| V5 | Claim status | **Built** as part of A4: waiting, approved, or not approved with the reason | 1 |
| V6 | Inbox | Conversations with consumers. **Built** (`/vendors/<name>/messages`, "Messages (n new)" on My business): for everyone on the team, owner, managers and staff; each person's own new count; never a conversation from before the team last ended (migration 0025); "Left Localites" for a person who deleted their account; says messages are paused while the business isn't listed | 2 |
| V7 ★ | Conversation (vendor view) | Messages and files; event summary panel (type, date, town, guest estimate) when shared. **Built (text, part 1)** (`/vendors/<name>/messages/<id>`): reply (anyone on the team; the person sees only the business's name); "Their event": the date, the town and about how many guests (D-40: never the kind, as built); owners and managers block and unblock; says so when the business isn't listed (paused) or the person has left Localites (ended); the same quick look for new messages (`…/check`); the same photos and PDFs | 2 |
| V8 | Bookings marked | Consumers who marked the business booked; **"This isn't right"** to flag. **Built** (`/vendors/<name>/bookings`, owners and managers): the person's name, the date, the town and about how many guests only (D-40); flag once with an optional note for the team; afterwards "You told us this isn’t right on …" (D-41) | 2 |
| V9 | Reviews | Published reviews; reply once. **Built** (`/vendors/<name>/reviews`, owners and managers; staff see but cannot reply): published reviews, one reply each, the team can remove a reply; **Report this review** (part 2). People report from the business page (`/reviews/<id>/report`) | 3 |
| V10 | Analytics | The business's own anonymous counts: seen in search, profile views, taps; later saves, inquiries, messages, bookings marked, reviews; compared with last year. Shown only when the team has switched it on for that business (D-22, D-37; may be part of a paid plan, D-24). **Built** (`/vendors/<name>/analytics`, ADR-030): last week, last month or this year so far; compared with the period before and last year; how people found you, device, town, time of day; category average and rank | 1 |

## Guest — invitation link only, no account

| # | Screen | Stage |
|---|---|---|
| G1 | Invitation. **Built** (`/i/<token>` then `/invite`, no account): the event's name, date and times, town, where, the host's first name and message; part 2: the host's updates and questions. By the group link (`/g/<token>` then `/group-invite`): the same, asking for the guest's name, showing only this browser's own reply | 4 |
| G2 | RSVP form. **Built**: yes, maybe or no; how many, including them (1 to 20); a note; changeable until the event; says when the host set the reply (D-49) | 4 |
| G3 | RSVP confirmation. **Built**: thanks, and what the host sees; coming or maybe: **Add it to your calendar** (Google, Apple, Outlook.com, Microsoft 365, Yahoo, a calendar file; D-49) | 4 |
| G4 | Link no longer valid. **Built**: replaced, removed, made up, or 30 days after the event | 4 |

## Platform team

| # | Screen | Purpose | Stage |
|---|---|---|---|
| X1 | Admin home | Queues needing attention | 1 |
| X2 | Listing editor | Create/edit any listing; history. **Plus** the owner, Remove owner, and **Changes by the owner** with Undo (ADR-029) | 1 |
| X3 | Listing review | Approve or return with reason. **Not built, not planned for now:** owners' changes go live at once, with the team's daily note and Undo (D-34, ADR-029), so nothing waits for approval; the product owner can ask for it | 1 |
| X4 | Claims | Approve (saying how it was confirmed, D-33) or decline with a reason emailed to the claimant; first approved wins (D-35). **Built** (`/admin/claims`) | 1 |
| X5 | Verification | Record a check with evidence | 1 |
| X6 | Categories | **Built** (`/admin/categories`, with X8): add, rename, describe, reorder, hide; two levels (a main kind and kinds within it); web addresses never change | 1 |
| X7 | Attributes (filters) | | 1 |
| X8 | Places | **Built** (same page as X6): add, rename, reorder, show or hide towns; a new town starts hidden | 1 |
| X9 | Collections | | 1 |
| X10 | Users & roles | **Built** (`/admin/team`, migration 0035): who is on the team and since when, added by whom; add an admin by the email of an existing account, with a reason; remove one, with a reason (never yourself); former members listed. Only through the database's own functions, each recorded | 1 |
| X11 | Audit log | **Built** (`/admin/audit`): every entry, newest first, 50 at a time; by who, by kind of record, or one record's history; links to the record's team page; each look recorded | 1 |
| X12 | Event types | **Built** (`/admin/event-types`, D-39, D-43): add, rename, order, hide (never delete); per type, the kinds of business to suggest (ticks and order) and featured businesses (first and last day, team note, End early; showing now, coming up, earlier; a warning when more than 3 overlap); a business finder. Every change recorded | 2 |
| X13 | Reports | Reported messages, conversations, listings. Opening a conversation is logged. **Built for conversations and messages** (part 2, `/admin/reports`, "Reports (n open)" in the team menu): the list shows who reported what and why, never the messages; a report's page shows the whole conversation (each look written to the audit log with the report); hide the reported message, block or unblock the conversation, close as dealt with or dismissed with a note. Listing reports come with Stage 3; a message its author removed after the report still shows its words to the team, marked so, and isn't offered Hide (migration 0026); a reported conversation's files, opened only through the report, each look recorded | 2 |
| X14 | Inquiries | Every inquiry, by business, to follow up and invite (D-04). **Built** (`/admin/inquiries`, "Inquiries (n waiting)" in the team menu): business, who (name, email), note, event summary, the team email's status, when they were told it joined; waiting only or all; every look recorded | 2 |
| X15 | Review moderation | Approve or decline each review against the written policy; opened from the new-review email (D-06, ADR-026). **Built** (`/admin/reviews`, "Reviews (n waiting)" in the team menu): publish, decline with a reason, remove a published one or its reply, each logged; **Reported** (part 2): each report's reason and words, keep the review and close them with a reason, or remove it; the written policy is still to come | 3 |
| X16 | Booking flags | Resolve vendor flags. **Read-only list built** (2A, `/admin/booking-flags`, "Booking flags (n)" in the team menu): business, note, who marked it, when; every look recorded. Resolving stays Stage 3 | 3 |
| X20 | Bookings (team) | **Built** (D-46, `/admin/bookings`, "Bookings (n to check in)" in the team menu): every business marked booked, listed or not, with the person's name and email, the date, the town and guests; taken-down businesses with bookings still to come first ("Check in with these people"), then coming up, then past and cancelled; one business's from its listing page. Every look recorded | 2 |
| X21 | Held changes | **Built** (`/admin/held-changes`, D-50, migration 0036, "Held changes (n waiting)" in the team menu): owners' saves the language check held, with what changed and what the check found; Put live (as the owner's save) or Decline with a reason the owner is emailed; the last 30 days' decisions | 1 |
| X17 | Operations report | Listings, claims, conversations, reply rates, reviews | 3 |
| X18 | Vendor activity reports | One vendor's totals by period (seen in search, views, taps; later saves, inquiries, messages), and the switch that turns on that business's Analytics page (V10, D-37); category-level figures for others (D-22). **Built** (`/admin/activity`, each listing's **Activity** page; the detail by day and the words searched, each look recorded). **Plus "Planning (team only)"** (D-42): saved, added to an event plan and marked booked per business, a top-20 table, and totals by kind of event with "No type given" | 1 |
| X19 | Suggested businesses | Every suggestion, with likely duplicates; mark added, declined or duplicate; link to the new listing (D-25) | 1 |

## Counts

| Stage | Screens |
|---|---|
| 1 — Discovery & vendors | 33 |
| 2 — The handshake | 17 |
| 3 — Feedback & reviews | 6 |
| 4 — Guests & RSVPs | 8 |
| 5 — Growth | 1 |
| **Total** | **65** |
