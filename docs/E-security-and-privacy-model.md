# E — Security & Privacy Model

**Status:** Approved (D-00, 10 October 2026).
**Last updated:** 2026-10-14 (§4.6, §5, §8: guests built, part 1, migration 0033; §4.4: reviews part 2, reports and "How was it?" emails, migration 0032; §4.4, §4.5, §8, §12: reviews built, part 1, migration 0031, D-48; §4.3, §8, §9: files in conversations, migration 0028; §4.3, §8: messages fixed after a third review, migration 0027; a second, migration 0026; after review, migration 0025; §4.3: messages built, part 1, migration 0023; §4.2: inquiries built, ADR-024, migration 0021; the team sees every booking, a business taken down can't be newly booked, D-46; 2026-10-13: §3, §4.2, §7, §7a, §8, §12: planning an event built, ADR-031, D-39 to D-43; earlier, §2: "are you human" check on sign-in codes; §7: sign-up details and anyone may join, D-36; §2: emailed sign-in codes and claims)

**Revision 2:** rebuilt around the two users, consumer and vendor. Added
conversations, shared files, consumer-marked bookings, and reviews. Removed the
concierge role and inquiry/quote/booking records.

---

## 1. Principles

1. **Deny by default.** Nobody sees or changes anything unless a rule allows it.
2. **Server-side only.** Permission checks happen on our server. Hiding a button is a
   courtesy, not a control (ADR-004).
3. **Two locks.** Application checks plus database rules. For relationship rules (who
   may message, who may review), the database enforces them too.
4. **Each side owns its actions.** Consumers start conversations and mark bookings.
   Vendors reply and flag. Neither can act as the other.
5. **Conversations are private to the two parties.** Staff don't read them unless one
   side reports the conversation.
6. **Collect less.** What we never collect can't leak.
7. **Prove it.** Every rule in §4 has an automated test that tries to break it.

## 2. Signing in

- Provider: Supabase Auth (ADR-003). The public signs in with a 6-digit code emailed to
  them (D-32, ADR-028); the platform team with a password and an authenticator app.
- Sessions in secure, HTTP-only cookies that page scripts can't read.
- Localites code never sees or stores passwords.
- Platform team accounts **must** use two-factor authentication, enforced on the server.
- **As built (10 October 2026):** our server calls Supabase Auth; the browser never does.
  Session cookies are `__Host-` prefixed, HttpOnly, Secure and SameSite=Lax. Every admin
  request passes one gate (`src/server/auth/admin.server.ts`): a session Supabase confirms
  is still live, a password sign-in within 12 hours, an active admin role in our own
  `platform_role` table, and a two-step code (an authenticator app) for this session.
  Forms from other websites are refused. Each admin change is written to `audit_log` with
  the session it came from. Proven by `tests/e2e/admin-access.mjs` (43 checks) on every
  push.
- **Emailed codes, as built (ADR-028):** "Sign in or create an account" (`/join`) never
  says whether an address has an account: the same reply for every "send me a code", and
  the same words for every unusable code. Our own limits: 5 wrong guesses per code, 3
  codes per address an hour, 60 a day across the site, 10 tries a minute per internet
  address (Cloudflare, never stored; IPv6 by /64 block). Requests and guesses are counted
  before Supabase is asked, under a lock per address. Addresses are kept as a SHA-256
  fingerprint rather than the address itself (`sign_in_code_event`); anyone holding the
  database could still test a guessed address against it. Rows older than two days are
  removed whenever a new code is asked for. A person is added to Localites only after proving
  the address and typing their name. The email holds only the code: no link, no name.
  **A code sign-in never opens the admin pages**, even for an admin. Pages that need an
  account pass one gate (`src/server/auth/member.server.ts`) and show only the person's
  own details and claims. Proven by `tests/e2e/claiming.mjs` (63 checks) on every push.
- **Claims (ADR-028):** only the platform team approves or declines, never a claimant
  (enforced by the admin gate); a team member can't approve their own claim; "their email
  matches the business's website" is accepted only when it does; otherwise the team
  contacts the business at its own published phone or email. One active owner per
  business, enforced by the database.
- **Owners editing (ADR-029):** only a business's current owner (an active owner
  membership, checked in the database on every request, never from the page) can open or
  save its edit page; the name, web address, town, categories and email aren't editable by
  owners; every service write is scoped to the business; only changed fields are written,
  so a save can't reverse a team change; every save is in `audit_log` and the team can undo
  it or remove the owner. Proven by `tests/e2e/owner-editing.mjs` (45 checks).
- **Email processors:** Supabase sends sign-in codes through Resend (PO-13), and our own
  emails go through Resend (ADR-013). Resend sees each recipient's address and the email.
- **"Are you human" check (ADR-028): parked by D-38, switched off.** If switched on,
  signing in with an emailed code needs a pass
  from Cloudflare's Turnstile, checked on our server; each pass works once and must be made
  for this form on this site. Cloudflare (already our host) sees the visitor's browser and
  internet address while it checks; Localites stores nothing from it. The privacy policy
  (PO-07) should mention it. Proven by `tests/e2e/human-check.mjs` (20 checks).
- **Browsing needs no account.** Guests (Stage 4) never need one.

## 3. Roles

Two users, one platform team. See [roles-and-relationships.md](./roles-and-relationships.md).

| Role | How you get it | Scope |
|---|---|---|
| **Visitor** | Anyone | Public pages |
| **Consumer** | Any signed-in account | Their own saved vendors, events, conversations, reviews |
| **Vendor owner** | Approved claim, or assigned by the platform team | Their business: listing, team, conversations, bookings marked, review replies |
| **Vendor manager** | Invited by the owner (built, migration 0015) | As owner, except team and ownership changes |
| **Vendor staff** | Invited by the owner (built, migration 0015) | Read and reply to the business's conversations (built, Stage 2B part 1, migration 0023) |
| **Guest** (Stage 4) | Holds a valid invitation link | One invitation page and their own RSVP |
| **Platform admin** | Granted by another admin on **Users and roles** (migration 0035: only through the database's own functions, as the team, never by the person themselves, nobody removes themselves); logged | Listings, claims, verification, reports, review moderation, the team, the audit log |

One person can be a consumer and a vendor team member (ADR-022). Permissions are
checked against **the side they're acting as** in each request. Acting for your
business never gives access to your personal events, and vice versa.

**Built for planning (ADR-031): the side follows the page.** `/events…`, `/saved` and
`/vendors/<name>/add` act as the person; `/business` and `/vendors/<name>/bookings` act as
the business (its current owner or manager, not staff, and not for an archived business);
`/admin/…` acts as the team after the team gate. The server tells the database the person and
the side at the start of each request, and the database's own rules apply that side's
permissions. Someone on a business's team switches between **My events** and **My business**
(screen A5).

**Built (13 October 2026, migration 0015): the owner invites their own team** at
`/vendors/<name>/team` (screen V4). Only the business's current owner can open the page or
change the team; managers, staff, other owners and everyone else get "not found". An
invitation is emailed and is a single-use link that works for 7 days, only for the email
address it was sent to (someone signed in with another address is told so, without being
shown which address); the database stores a fingerprint of the link, never the link. The
owner can't invite themselves or make someone an owner, can cancel an invitation, and can
remove a manager or staff member; access ends at once. If the last owner leaves (or deletes
their account), everyone else on that business's team leaves too and open invitations are
cancelled. Limits: 10 people besides the owner, 20 invitations a day. Joining, removing,
inviting and cancelling are all in `audit_log`.

**Built (18 October 2026, migration 0036, D-50, ADR-033): words are checked before they show.**
An owner's or manager's save whose words the language check flags is held whole and written to
nothing until the team puts it live (as the owner's own save) or declines it; the owner can
withdraw it. A business's flagged reply to a review is held off its page until the team puts it
live; only the team can release it (database rule). A review keeps the check's finding for the
team only. The writer is never told what was found. The words checked (an owner's changed text,
a review, a reply) are sent to Cloudflare's Workers AI for the check, the same company that
already carries every page of the site; nothing else about the person goes with them, and the
privacy policy should say so (PO-07).

There's no "super user" bypass. Admins go through the same checks; their role simply
grants more, and every admin action is recorded in `audit_log`.

## 4. Permission matrix

**R** read · **C** create · **U** update · **X** remove/archive · **—** no access.

### 4.1 Discovery & listings (Stage 1)

| Record | Visitor | Consumer | Vendor owner / manager | Vendor staff | Admin |
|---|---|---|---|---|---|
| Published listing | R | R | R | R | R |
| Draft / unpublished listing | — | — | R U (own) | R (own) | R C U X |
| Submit listing for review | — | — | C (own) | — | C |
| Publish listing | — | — | — | — | U |
| Services, media, attributes | R (published) | R (published) | R C U X (own) | R (own) | R C U X |
| Vendor team | — | — | R; owner C U X (own) | R (own) | R C U X |
| Claim request | — | C, R (own) | — | — | R U |
| Verification evidence | — (outcome only) | — (outcome only) | R (own) | — | R C U |
| Categories, attributes, places, event types | R | R | R | R | R C U X (event types: hide, not delete) |
| Suggested kinds of business per event type (D-43) | — | R (on own plan) | — | — | R C U X |
| Featured placements (D-43) | — | Which businesses only, for current placements of published businesses, at most 3 per kind of event, on own plan; never the note | — | — | R C; end early (no edit, no delete) |
| Activity totals (seen in search, visits, taps, saves, inquiries, messages; §7a) | — | — | R (own; the owner and managers, when the team has switched the Analytics page on) | R (own, same) | R (detail, logged) |
| Suggest a business (D-25) | C (rate-limited) | C; R (own, from Stage 2) | — | — | R U |

### 4.2 Consumer planning (Stage 2)

| Record | Visitor | The consumer | Another consumer | Vendor on the plan | Admin |
|---|---|---|---|---|---|
| Saved vendors | — | R C X (own) | — | — (not told) | aggregate counts only (D-42) |
| Event | — | R C U; cancel (own) | — | **Summary only**¹ | The booking summary³ for every event with a business marked booked; the rest only when a booking on it is flagged |
| Event plan: vendors *considering* | — | R C U X (own) | — | — (not told) | — |
| Event plan: vendor *booked* | — | R U (own); can't newly mark a business that isn't listed (D-46) | — | R (own row)²; can flag once | R³, every booking, logged (D-46); R when flagged (read-only in 2A); resolves flags in Stage 3 |
| The event's name, where, ages, budget, notes (`event_private`) | — | R U (own) | — | — | — |
| Flag note | — | — | — | C (own flag) | R |
| Saves, adds and bookings per business (D-42) | — | — | — | — (not on their Analytics page) | totals only |
| Inquiry about a business not on Localites yet (`vendor_interest`, ADR-024)⁴ | — | R C (own, once per business; again only if the team email failed) | — | — (never sent anything) | R, every inquiry, logged |

¹ **Built (D-40):** for a booking, the person's name, the date, the town and about how many
guests. Never the event's name or kind, start time, where, ages, budget, notes, the other
businesses on the plan, or the person's email. For conversations (not built yet), only if
the consumer links the event, and the same summary is expected.
² The vendor sees that they were marked booked and the event summary, so they can
recognise the booking or flag it. When it flags, the team and the person are told; the note
stays with the team (D-41).
³ **Built (D-46, migration 0020):** the team's **Bookings** page lists every business marked
booked, listed or not, past and cancelled events too: the business, the person's name and
email, the date, the town and about how many guests, so the team always knows who works
with whom and can check in with people whose business was taken down before their event.
Never the event's name, kind, times, where, ages, budget or notes, and never what a person
is only considering or has saved. Every look is written to `audit_log`. Taking a business
down deletes nothing. A booking leaves the team's view only when the person removes it from
their plan or deletes their account (§8); a booked business that isn't listed can be removed
but not un-marked, so it never silently drops off the plan. People are told on the **Mark as booked** page and in the event
form's privacy box. A business that isn't listed disappears from people's Saved and from
what they're considering; one already marked booked stays on that person's plan by name only.

**How each cell is enforced (ADR-031).**
- *By the database's per-side rules:* everything the person may not see of another person;
  a business seeing only rows that mark it booked; the team seeing only flagged bookings;
  only the team writing event types, suggestions and placements; only the host changing a
  plan's status; only the business flagging, once.
- *By a separate table with a host-only rule:* the event's name, where, ages, budget and notes
  (`event_private`). No business or team rule exists for it.
- *By a database function that returns only totals or only business ids:* the team's counts
  (D-42) and the featured list (D-43).
- *By two database functions for the business side:* a booked business has no rules on the
  planning tables; `bookings_for_business()` returns only the person's name, the date, the
  town and about how many guests, and `flag_booking()` is the only way to flag. The flag note
  is in a team-only table. (Review fix, 13 October 2026.)
- *By the server asking only for named columns, plus end-to-end tests:* the person's email
  on `app_user` (as in Stage 1).
- *By two team-only database functions (D-46):* `bookings_for_team()` returns only the
  columns in note ³, and `taken_down_booking_count()` only a count; both refuse anyone not
  acting as the team. The team still has no rule on the planning tables themselves.
- *Admin "support, logged" reads of any event:* not built; beyond the booking summary
  (note ³), the team can't open a person's event unless a booking on it is flagged.

⁴ **Built (ADR-024, migration 0021, 14 October 2026):** a signed-in person can tell the team
they're interested in a published business that hasn't joined, with an optional note and
one of their own events still to come. The team receives the person's name and email, the
note, and the event as a one-line summary (kind, date, town, about how many guests; never
its name or private details), by email and on the team's **Inquiries** page (each look
logged). The business is never sent anything by Localites. When the team approves the
business's claim, each person who asked is emailed once that it joined
(`take_joined_notices()`, team only). Enforced by the database's per-side rules: the person
reads and writes only their own; the team only reads; no business rule exists. Deleting
your account deletes your inquiries (a trigger on the account row, §8).

### 4.3 Conversations & files (Stage 2)

| Record | The consumer in it | The vendor's team | Another consumer | Another vendor | Admin |
|---|---|---|---|---|---|
| Conversation | R C; block | R; owner/manager block | — | — | **Only if reported**, logged |
| Messages | R C; remove own | R C (after the consumer's first message); remove own | — | — | **Only if reported**, logged |
| Files | R C (own uploads) | R C (own uploads) | — | — | **Only if reported**, logged |
| Own unread position | R U | R U (each person) | — | — | — |
| Report a message / conversation / listing | C | C | C (listing) | C (listing) | R U |

Former team members lose access to the business's conversations the moment their
membership ends. Their past messages stay, attributed to the business.

**Built (Stage 2B part 1, migration 0023, 14 October 2026): text messages.** Enforced by the
database's per-side rules (ADR-031), with no rule for the team at all: the person reads and
writes only their own conversations (with a business that has joined, never their own);
anyone currently on the business's team (owner, manager or staff; not archived) reads and
replies, only after the person's first message; owners and managers block and unblock; the
person blocks and unblocks; a block stops messages both ways. Messages are never rewritten:
the author can remove one, which blanks it and shows "Message removed". Each person's unread
position is their own (no read receipts). If the person mentions an event, the business sees
only the date, the town and about how many guests (`conversation_event_for_business()`).
Emails about new messages link to the conversation and never include the message; each
person is emailed once per unread stretch, at most 30 a day (`new_message_notices()`). The
person sees only the business's name on its replies, never which team member wrote. Every
other side's attempt (another person, another business, a former team member, the team) is
"not found", tested end to end.

**Built (part 2, migration 0024): Report.** Either side reports the conversation, or one
message in it (anyone on the business's team for the business). The page says that, because
they reported it, the team can read the conversation, and that the other side isn't told who
reported. The team is emailed a link, never the messages. The team's **Reports** list shows
who reported what and why; the conversation itself is read only through a report
(`reported_conversation_for_team()`), and the database writes each look to `audit_log` with
the report. The team can hide the reported message (both sides then see "Hidden by
Localites"), block the conversation ("The Localites team has closed this conversation"; only
the team can reopen it), and close the report with a note; each decision is recorded. The
team sees which conversations were reported (who, which business, status), never any other.

**Fixed after review (migration 0025, 14 October 2026).**
- **A new team never reads the last one's conversations** (ADR-029's rule: "a new owner never
  sees what the team told the last one"). When a business stops being claimed (the team uses
  Remove owner, or its last owner deletes their account), or its last owner leaves, its
  conversations **end**: the person
  keeps their copy ("… isn't on Localites any more, so this conversation has ended"); nobody can
  write in them; no later team of that business can open, read, mark, report or reply to them,
  or see the event summary. If the business is claimed again, the person can start a new
  conversation with it.
- **When a person deletes their account**, their conversations end too: the business keeps its
  copy, from "Former Localites member", and can't write to them (§8).
- **A business that isn't listed** (taken down by the team, D-46) can't send or receive
  messages until it's listed again; both sides can still read, and are told why.
- **Someone who joins a business's team** never sees their own conversation with it from the
  business's side (so they can't reply to themselves as the business).
- **Emails about new messages:** at most 30 a day across the site (the email service's free plan
  sends 100 a day, and sign-in codes use the same account); beyond that each one is recorded as
  held back, with the reason. The site decides about 20 seconds after a message is written, and
  never emails someone who has already seen it, so two people chatting with the conversation
  open aren't emailed about every message.
- **Looking for new messages** is a quick look (one small read, nothing marked read); the page
  reloads only when something changed. Quiet looks slow down from every 15 seconds to every 2
  minutes, and stop while the tab is hidden or after 10 minutes without anyone touching the
  page (Cloudflare's free plan counts every request; its database connection allows 100,000
  queries a day).
- **Send pressed twice** (or two quick sends to start a conversation) makes one message and one
  conversation.
- Message and "read up to" times are taken when written, so a message shown is never counted
  unread.
- Known and accepted: inside the database, the person's side could technically read which
  team member wrote a reply and who blocked; no page or query on the site shows it.

**Fixed after a second review (migration 0026, 14 October 2026).**
- Conversations a new team had already inherited before 0025 are ended now, and when a new
  team forms (an owner joins a business that has none), anything still current ends first.
  So a conversation started at the very moment the last owner was removed can't pass to the
  next team either.
- Emails about a person's message go only to people on the business's team when it was
  written, never about a conversation that has ended, and in one request for the whole team.
  The site decides about 18 seconds after the message.
- "Read up to" is the newest message the page showed, so a message saved a moment later is
  never counted as read (or as seen, for emails).
- If the author removes a message that was there when its conversation was reported, the
  team keeps a copy of its words with the report (table `reported_message_text`, no rule for
  any side; read only through `reported_conversation_for_team()`, logged; since migration
  0027, never anything written after the report). Both sides see it removed. Words removed
  before any report are gone for everyone. "Hide" isn't offered for a message that's already
  removed.
- Since migration 0027: "once per unread stretch" counts from the first message from the
  other side someone hasn't read, so reading without replying never stops the next email.
  The email work stops trying again rather than run past Cloudflare's 30 seconds.
- A person whose conversation ended sees "… left Localites, so this conversation has ended",
  and, once the business has joined again, a link to message it afresh. An archived business
  that may come back: "isn't on Localites at the moment".

**Built (part 3, migration 0028, 14 October 2026): files in conversations.** Either side can
send one photo (JPEG or WebP) or one PDF with a message, or on its own. The sender's browser
makes a photo smaller first and leaves behind its hidden details; the server checks the file by
its contents (never its name) and removes those details again (where and when it was taken). A
PDF is sent as it is, up to 4 MB; Localites doesn't read it. Files are kept in a **private**
storage folder (`conversation-files`, PO-20) with no public address: every time someone opens
one, the site checks with the database's rules (the same as the messages, ADR-031) that they're
one of the two sides, then hands it over itself. Photos show in the page; PDFs are saved, never
shown as a page of the site; nothing the browser could run. The team opens a reported
conversation's files only through the report, and each look is logged with it. A file goes
when its message does (removed by its author, hidden by the team) or when its sender deletes
their account, and its storage is then deleted (straight away, and by the nightly run if
storage was down), unless the conversation had been reported while the file was there: then
the team keeps it with the report. Limits: 20 files a day per person, counted across every side
they send from (migration 0029), and 700 MB for all conversation files together (the free
plan's 1 GB is shared with business photos). The website reaches storage with the same keys as
business photos (PO-16), which reach every folder in the project; only the site holds them. A
file is checked again each time it's opened (never kept by the browser for later), so a removed
one stops showing at once. Known and accepted: if the site is stopped between storing a file and
saving its message (rare), that file stays in storage unseen by anyone; a check for such files
isn't built yet.

### 4.4 Feedback & reviews (Stage 3)

**Built, part 1 (migration 0031, 14 October 2026).** The database enforces every cell below
(per side, ADR-031): the author sees and edits only their own review, and only while it
waits; the business sees its published reviews and replies once (owner or manager, not
staff); the team publishes, declines with a reason, removes with a reason, or removes a
reply, each logged. The public sees published reviews only, with the author as "Sarah M."
(D-48), never their full name or email. A waiting review is withdrawn if the person
unmarks the booking or cancels the event; the team decides on the words it read (if the
author changed them meanwhile, the team is asked to look again).

**Built, part 2 (migration 0032, 14 October 2026).** *Reporting a review:* anyone signed in
reports a published review in their own name (not their own review), and anyone on a
business's team reports its own reviews; once per review while the report is open, 10 a
day. Only the team reads reports (the reporter sees only their own); the author isn't told
who reported. The team keeps the review and closes the reports with a reason, or removes
the review, which closes them; each decision is logged. The team is emailed once per
reported review, at most 20 a day, never the reporter's words. *"How was it?" emails:* the
morning after an event, the host is emailed once about the businesses they booked and
haven't reviewed, and once more a week later; never the event's name, only its date; never
after the 60 days; at most 20 a day across the site. Each person can turn them off on
**Your account → Emails**; that choice is theirs only and is deleted with the account.

| Record | Visitor | Author | The reviewed vendor | Other vendors | Admin |
|---|---|---|---|---|---|
| Published review + vendor reply | R | R | R | R | R |
| Pending / declined review | — | R; edit while pending (a declined one isn't shown to its author at all, D-51) | — | — | R; approve / deny (no reason needed, D-51) |
| Write a review | — | C if eligible (§4.5) | — | — | — |
| Vendor reply | — | — | Owner/manager C, once | — | R; remove for policy breach |
| Remove a published review | — | — | — | — | With a reason, logged |
| Rating summary | R (shown from 3 reviews) | R | R | R | R |

### 4.5 Review eligibility (enforced by the database)

A consumer can review a vendor only if: they marked that vendor booked on their own
event; the event wasn't cancelled; the event date has passed; it's within 60 days; the
vendor hasn't flagged the booking (or the platform team confirmed it); the business is
listed; and it isn't the person's own business. A Localites conversation isn't required
(D-06, option B); the database records whether there was one, and the app can't change
that record. One review per booking. Every review stays hidden until an admin approves
it in the admin area (ADR-026); the team is emailed each new review with a link there,
never a one-tap approve link.

### 4.6 Guests (Stage 4)

As in revision 1: the host controls guests, invitations and RSVPs. A guest's link opens
only their invitation and RSVP form. Vendors never see guest lists.

**Built, part 1 (migration 0033, ADR-032, 14 October 2026).** Only the host reads or changes
their guest list (as the person, ADR-031); another person, a booked business, the Localites
team and anyone not signed in see nothing. A guest's link opens, through
`invitation_for()`, only: their own name, the event's name, date, times, town, where, the
host's first name and message, and their own reply; never the plan, the businesses, the
budget, notes, other guests or the host's last name. Replies go only through
`invitation_reply()`, limited per internet address, and close when the event is over; a
cancelled event says so. Up to 300 guests an event.

**The host changes a reply (D-49, migration 0034).** Only through `host_set_reply()`, as the
host of that guest's event; the reply records that the host set it and the guest's
invitation says so. **Localites emails the guest** (the one case it does, amending D-08) only
if the host gave their email and the event isn't over: what changed and the guest's own link,
never the host's email; at most 10 a day per host, 3 a day per guest, 2 a day to one address
and 30 a day across the site, the rest recorded as held back (only a fingerprint of the
address is kept) and the host told to tell the guest themselves (`guest_email`, readable only by the host). **Add to
calendar:** links for Google, Outlook.com, Microsoft 365 and Yahoo are made on the page and go
nowhere until the guest taps one; the calendar file needs the guest's link. Neither contains
the guest's link.

**Built, part 2 (18 October 2026, migration 0037).** **The group link:** one per event, made
from `INVITE_KEY` like a guest's link (only its hash stored); the host switches it off or makes a
new one, and the old one stops at once; it opens through `group_invitation_for()` only the
invitation (no guest's name) and this browser's own reply, found by the hash of a random key in
a cookie (`__Host-localites-gkey`, 60 days); never anyone else's reply. Replies go only through
`group_invitation_reply()` (a name, limited per internet address, at most 300 an event), and
the host matches each to a guest (`match_group_reply()`) or removes it. **Questions** (up to 5,
short answers, optional) and **updates** (up to 20) are the host's own; guests' answers are
written only through the invitation functions, and nobody, the host included, can write or
change them otherwise. Another person, a booked business and the Localites team see none of it.
**QR code:** drawn on the server from the link (no outside service sees it), on a printable page
only the host opens.

## 5. Invitation-link security

Stage 4. Unchanged from revision 1:

| Threat | Control |
|---|---|
| Guessing a link | 256-bit tokens (an HMAC of the guest under a site-only key, ADR-032); rate-limited RSVP |
| Database copied | Only token hashes stored; the key is in Cloudflare, not the database |
| Link forwarded | Opens only that invitation; host can revoke and reissue |
| Link used after the event | Expires (default 30 days after) |
| Link opens host workspace | Impossible: separate minimal view and query |
| Guest sees other guests | Never in the page's data |
| Search engines | `noindex`; excluded in `robots.txt` |
| Link left in browser history | Swapped for a short-lived cookie; address bar shows no token |
| **Group link** in a group chat or social post (D-08) | Anyone holding it can reply, so it asks for a name, is rate-limited, shows nothing about other guests, and the host can switch it off or replace it at any time. Replies are matched to the guest list by the host. |
| **QR code** | The same link drawn as a square, with the same protections. A printed code can't be revoked, so a QR for a group link is replaced, not reused, if it leaks. |

## 6. Conversation and file safety

| Risk | Control |
|---|---|
| Someone reads a conversation that isn't theirs | Server and database both check membership on every request. Tested by changing IDs directly. |
| A vendor spams consumers | Vendors cannot start conversations (database-enforced). Consumers can block and report. |
| A consumer harasses a vendor | Vendors can block and report. Reports go to the platform team. |
| Fake or fraudulent invoices | Localites never handles money, and says so in every conversation's footer: *"Localites doesn't process payments. Arrange payment directly with the business."* Report button on every message. Verified badge only for vendors with recorded checks. |
| Malicious files | Images and PDFs only; content-type checked; PDFs download rather than open in Localites; 10 MB limit. No automatic virus scanning at launch (ADR-020): known gap, revisited if reports warrant it. |
| A shared file link leaks | File links expire within minutes and are issued only after a membership check. |
| Photos reveal home location | GPS data stripped from images on upload (business photos: built, in the browser and again on the server). |
| Former staff keep access | Access ends the moment membership ends. |
| Platform staff snoop | Staff can open a conversation only through a report, and each access is logged with the report ID. |

## 7. Data minimisation commitments

Changing any of these requires product owner approval.

**About children:** Changed by D-36 (11 October 2026): **anyone can create an account**,
with no minimum age, and sign-up asks for a date of birth, so Localites may hold children's
details. Before launch the lawyer (PO-07) confirms what's needed, in particular a parent's
consent for children under 13. An event may have an optional age range ("ages 4–7"). The
event's name is required but private (D-39); its hint says "No need to use a child’s full
name." Only the person sees it: never a business, never the team.

**About consumers:** First name, last name and email required. Asked at sign-up but not required (D-36):
gender, full date of birth and full street address, kept in their own table
(`person_profile`), seen only by the person themselves (Your account) and, in the database,
the Localites team; never by businesses, who see only totals (D-30); used to improve
Localites and for those totals; removed when the person clears them or their account is
erased; no row at all for someone who gives none. Phone optional (Stage 2). A vendor sees the consumer's
display name, plus whatever the consumer chooses to write or share. Never their email,
unless the consumer types it.

**About vendors:** Business contact details are public only where the business
published them (D-03) or provided them.

**About guests (Stage 4):** A display name. Email and phone optional and visible only
to the host.

**About conversations:** We can't control what people write, so we don't pretend to.
The conversation screen reminds people not to share sensitive information they don't
need to. Staff don't read conversations unless reported.

**About everyone:** No third-party advertising or tracking. IP addresses are used
briefly for abuse prevention, never stored against records. Localites' own activity
tracking is described in §7a.

## 7a. Activity tracking (D-22)

Localites counts how people interact with each vendor (ADR-023), to report to vendors and
to sell featured placements.

| Who | Sees |
|---|---|
| A business's owner and managers, on its Analytics page, when the team has switched it on (D-37) | Totals for their own business only: seen in search, profile views, website and phone taps; later inquiries, conversations, messages, reply times. **Never who** viewed them. **Not saves, adds to plans or bookings marked** (D-42: team only). They see the people who message them, as part of the conversation, and the people who marked them booked (D-40). |
| Other vendors and prospective vendors | Category-level figures, or one vendor's own numbers only with that vendor's permission |
| The Localites team (platform admins) | The detailed records, to run the service, prepare reports and compare year over year. Every look is recorded in the audit log. **Planning (D-42):** totals only of saves, adds to plans and bookings marked, per business and per kind of event; never who, never which event. |
| Anyone else | Nothing. Tracking data is never sold. |

- **Told plainly** in the privacy policy, in everyday words. Visitors who aren't signed in
  get a random visitor ID in Localites' own cookie (`__Host-lc_vid`: HttpOnly, Secure,
  one year), with no outside trackers. It's set when someone suggests a business, when a
  browser's first activity report is accepted, and on signed-in pages (where it's linked
  to the account, so a business's own visits and the team's are left out of totals). The
  legal review (PO-07) confirms whether a notice is also needed on first visit.
- **Only what a real browser confirms is counted** (ADR-030): pages carry a note signed by
  the server for that browser, and bots get none. On an owner's page, small groups are
  combined ("Others, each fewer than 5") so no single visitor can be singled out. Each action also records phone, tablet or computer, the
  approximate town and province from Cloudflare (never the internet address), where the
  visitor came from (the other site's name only), and their place in a list.
- **Everything is tracked (D-30):** each action (a profile view, a tap, how long a
  profile was open, which photos were opened) and **the words people search**, linked to
  the visitor ID or account. The privacy policy says plainly that this is used to improve
  Localites and for vendor reports. Only the Localites team sees the detail, and every
  look is logged; vendors see totals. Approximate town is city level, from Cloudflare. The
  legal review (PO-07) checks the wording, the returning-visitor cookie and town.
- **Retention:** detailed records are kept with no deletion date, for year-over-year
  reports (D-22, §8). When someone deletes their account, their records stay but the link
  to them is removed. Canadian privacy law expects personal information to be kept only
  as long as a stated purpose needs it; the privacy policy names that purpose, and the
  legal review (PO-07) confirms it.
- **Starts with each feature:** seen in search, profile views, taps and the D-30 additions
  from Stage 1; inquiries, conversations and messages from Stage 2, when those exist. Saves,
  adds and bookings are **not** recorded as activity yet (ADR-031): the team's totals come
  from the planning records themselves (D-42). Featured businesses on plans aren't counted
  as "seen" yet (D-43: later).

## 8. Retention and deletion

**Approved as D-10 (10 October 2026)**, with events kept for as long as the host's
account exists, and detailed activity records kept for year-over-year reports (D-22).

| Data | Kept for | Then |
|---|---|---|
| Events and event plans (type, date, place, vendors, bookings, guest names and replies) | As long as the host's account exists, with no time limit, so hosts can look back years later | Deleted with the account |
| Conversations and files | Conversations: up to 3 years after the last message (deleting them then isn't built yet). **Files (D-47, built: migration 0030):** until 30 days after the conversation's event (at least 30 days after sending), or 1 year after sending if it isn't about an event; then deleted nightly and shown as "This file has expired" (kept with a report that covers them) | Deleted. **Built (migration 0025):** when either side leaves (the person deletes their account, or the business stops being claimed), the conversation ends: the other side keeps its copy, nobody can write in it, and a business's later team never sees it |
| When a consumer deletes their account | — | **Built (13 October 2026, migration 0014):** from **Your account → Delete your account**, after typing their email address. At once, in one step in the database: their events, plans (and any flag notes on them) and saved businesses are deleted, so businesses they marked booked no longer see the booking; their name, email and personal details are erased (the account row stays as *"Former Localites member"* because history points at it); they leave any business's team, and a business left with no owner goes back to unclaimed; open claims are withdrawn and their notes erased; they're unlinked from activity and suggestions; the session ends. The team then removes their Supabase sign-in record by hand within 30 days (**Admin → Deleted accounts**; the site doesn't hold Supabase's admin key). A team member can't delete their account until their team role is removed. From Stage 2B, in conversations their messages show as *"Former Localites member"* and their files are deleted (built, migration 0028: unless kept for a report made while they were there). |
| When a vendor leaves Localites | — | The listing is archived. Consumers keep their copies of conversations, shown as *"This business has left Localites"*. Published reviews stay, without the reply option. |
| Published reviews | While the listing exists | **Built (migration 0031):** the author is shown as *"A Localites member"* if they delete their account, and a review still waiting is withdrawn; a review only shows while the business is listed |
| Guest phone numbers and emails (Stage 4) | Until 90 days after the event | Erased (**built**, the morning job, migration 0033). Guest names and their replies stay with the event so the host can look back, as do group-link replies (a name, a reply, a note) and guests' answers to the host's questions (part 2), which may be things like allergies; the guest list goes with the host's account |
| Detailed activity records (§7a) | No deletion date (D-22), for year-over-year reports | Daily totals are also kept. If the database nears its free limit, older detail moves to archive storage. Unlinked from anyone who deletes their account |
| Suggested businesses (D-25) | Kept | On a declined suggestion, the phone number or email typed in is erased after 1 year; the count stays for reports |
| Email delivery log | 1 year | Deleted |
| Audit log | 2 years | Deleted |
| Words of a message removed after its conversation was reported (migrations 0026, 0027: only messages there when it was reported) | With the report (deleting reports isn't built yet) | Read only by the team, through the report |
| A file in a conversation reported while it was there, then removed (migration 0028) | With the report (deleting reports isn't built yet) | Opened only by the team, through the report, each look logged |
| Verification evidence | While verified + 1 year | Deleted; outcome kept |
| Account deletion request | Within 30 days | As above |
| Backups | Our own nightly backup, kept 30 days (F §5) | Expire automatically; deleted data is fully gone after 30 days |

## 9. Media and files

| Kind | Storage | Access |
|---|---|---|
| Published vendor photos and logos | Public | Anyone |
| Unpublished listing media | Public storage, random file names (built: see below) | Anyone with the exact address; shown only on published pages |
| Verification evidence | Private | Admins only |
| **Files in conversations** | **Private** (`conversation-files`, built: migration 0028) | **The two parties only**, checked by the site on every request; no public address at all. The team only through a report, logged |

**Built (13 October 2026, migration 0016): business photos.** The business's owner or a
manager adds up to 8 at `/vendors/<name>/photos` (checked in the database on every request;
staff, other businesses and everyone else get "not found"); the team removes any from
**Admin → Photos**, with a reason. The owner's browser shrinks each photo (up to 1600 pixels a
side, plus a 640-pixel copy for lists), which also drops where and when it was taken. The
server doesn't trust that: it accepts only JPEG and WebP, judged from the file's contents,
up to 2048 pixels and 1 MB, refuses moving pictures, and removes EXIF (including GPS), XMP
and comments before storing. Each photo needs a short description (shown to screen readers).
Files go to one public Supabase Storage bucket, `vendor-photos`, under random names, through
Supabase's S3 connection with keys that reach file storage only (Cloudflare secrets, PO-16);
a photo uploaded to a listing that isn't published yet is stored the same way but shown
nowhere until it is. Removing a photo takes it off the business at once and deletes its
files (anyone who already had the direct address may see it from caches for up to an hour);
if storage is down, the nightly run retries. The server checks the whole file, not just its
start: hidden details between parts of the picture, a second picture or anything after the
end are removed, and in WebP only the picture, transparency and colour profile are kept. Every addition, description change,
main-photo choice and removal is in `audit_log`.
The **profile photo** (migration 0019: the business's one `vendor_media` row with role
`logo`, not counted in the 8) follows the same rules and checks. Choosing a new one takes the
old one off at once and deletes its files. Its framing is four numbers (where the square sits
on the photo, in percentages), checked on the server and again by the database (all four or
none, within set ranges); only the owner or a manager of that business can set it, only on
its profile photo, and each change is in `audit_log`. The photo file itself is never altered.

## 10. Secrets and credentials

- Secrets live only in the hosting providers' encrypted settings. Never in git, chat,
  email, or documents.
- **You own the root accounts.** The engineering team is invited with the least access
  needed. Development sessions never receive production credentials: code goes to
  GitHub; Cloudflare deploys it; migrations run through a reviewed process using a secret
  stored in GitHub's encrypted settings.
- **You will never be asked to paste a password, key, or code into chat.**
- Automated secret scanning on every change. Keys rotated when someone with access
  leaves, and at least yearly.

## 11. Audit trail

`audit_log` records every admin action and every permission-sensitive action (including
every staff view of a reported conversation): who, what, which record, when, and
before/after values. It is append-only, enforced by the database (tested). The team reads it
on the **Audit log** page (`/admin/audit`, screen X11); each look is itself recorded, as a look
at the log with its filters (never as part of the record looked at).

## 12. Security testing

Every row of §4 becomes automated tests run before every deployment, including:

- **Cross-conversation:** Consumer B, and a member of Vendor B, try to read, post to,
  and download files from a conversation between Consumer A and Vendor A, by supplying
  its ID directly. All must fail.
- **Impersonation:** a consumer tries to post as a vendor; a vendor tries to post as the
  consumer; a former team member tries to post; a vendor tries to start a
  conversation. All must fail. *(Database layer already proven; see below.)*
- **Planning privacy:** a vendor tries to see a consumer's *considering* list, budget,
  notes, or another vendor's row on the same event. All must fail.
- **Booking integrity:** a vendor tries to mark themselves booked; another consumer tries
  to mark a vendor booked on someone else's event. All must fail.
- **Review integrity:** reviews without a booking, before the event, after the window,
  without a Localites conversation, on a flagged booking, by someone else, or twice. All
  must fail. *(Built: database checks 0031, 42 of 42, and the reviews browser checks.)*
- **File access:** expired links, links for files in other conversations, public
  storage attempts. All must fail.
- **Role escalation:** vendor staff attempt owner actions; consumers attempt admin
  actions. All must fail.

**Current results (database layer, 2026-10-10):** 85 of 85 checks passed on PostgreSQL
16. That's 29 for Stage 1 rules and 56 for the consumer–vendor relationship rules,
including the review rule chosen in D-06. Application-layer tests will be added with the code.

**Planning an event (13 October 2026), as built:**
- **Database ([0012 checks](../db/tests/0012_event_plans.test.sql), 164 of 164):** each side
  sees only its own rows; nobody but the host reads `event_private`; another person's event,
  plan or save is refused; a business reads only rows that mark it booked and flags once; the
  host can't flag and the business can't change a status; the database sets the times and
  writes the history; only the team writes event types, suggestions and placements; the
  person reads featured businesses only through the function, never the note; ended, expired
  and unpublished placements aren't returned; no money columns exist; the team's counts
  refuse every other side and hold no personal data; browser-facing roles see nothing.
- **End to end ([tests/e2e/event-plans.mjs](../tests/e2e/event-plans.mjs), 120 of 120):**
  planning privacy (a business never sees a "considering" plan, the event's name, kind,
  start time, where, ages, budget, notes, the person's email or other businesses on the
  plan, on any page or in any email); booking integrity (a business can't mark itself
  booked; another person, another business, staff and a non-member get "not found" on
  someone else's event, plan rows or bookings, and nothing changes); role escalation (a
  non-admin can't reach Event types or Booking flags, and a person can't reach the team's
  planning counts); the flag tells the team and the person, never with the note; every page
  and email is checked for words implying payment or confirmation.

## 13. Legal context (not legal advice)

- **PIPEDA** governs personal information. We need a privacy policy, plus access and
  deletion requests.
- **CASL** (anti-spam law) affects commercial email. Our emails are transactional
  (messages, sign-in, feedback on a booking the consumer recorded). The lawyer should
  confirm that the feedback request and the "business joined" notice fit that
  description.
- **Not a party to the deal.** The terms of use must state clearly that Localites connects
  consumers and vendors and is not a party to their arrangements, payments, or disputes.
- **Reviews** need a published policy (what's allowed, how disputes work) and fair
  treatment of vendors' flags.
- Listing businesses that haven't joined (D-03) should be reviewed.

**A lawyer familiar with Canadian privacy and consumer law should review the privacy
policy, terms of use, review policy, and the unclaimed-listing approach before launch**
(PO-07). This document describes engineering controls, not legal advice.
