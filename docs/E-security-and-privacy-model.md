# E — Security & Privacy Model

**Status:** Approved (D-00, 10 October 2026).
**Last updated:** 2026-10-09

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

- Provider: Supabase Auth (ADR-003). Email + password, or an emailed sign-in link.
- Sessions in secure, HTTP-only cookies that page scripts can't read.
- Localites code never sees or stores passwords.
- Platform team accounts **must** use two-factor authentication, enforced on the server.
- **Browsing needs no account.** Guests (Stage 4) never need one.

## 3. Roles

Two users, one platform team. See [roles-and-relationships.md](./roles-and-relationships.md).

| Role | How you get it | Scope |
|---|---|---|
| **Visitor** | Anyone | Public pages |
| **Consumer** | Any signed-in account | Their own saved vendors, events, conversations, reviews |
| **Vendor owner** | Approved claim, or assigned by the platform team | Their business: listing, team, conversations, bookings marked, review replies |
| **Vendor manager** | Added by the owner | As owner, except team and ownership changes |
| **Vendor staff** | Added by the owner | Read and reply to the business's conversations |
| **Guest** (Stage 4) | Holds a valid invitation link | One invitation page and their own RSVP |
| **Platform admin** | Granted by another admin; logged | Listings, claims, verification, reports, review moderation |

One person can be a consumer and a vendor team member (ADR-022). Permissions are
checked against **the side they're acting as** in each request. Acting for your
business never gives access to your personal events, and vice versa.

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
| Categories, attributes, places, event types | R | R | R | R | R C U X |
| Activity totals (seen in search, visits, taps, saves, inquiries, messages; §7a) | — | — | R (own) | R (own) | R (detail, logged) |

### 4.2 Consumer planning (Stage 2)

| Record | Visitor | The consumer | Another consumer | Vendor on the plan | Admin |
|---|---|---|---|---|---|
| Saved vendors | — | R C X (own) | — | — (not told) | aggregate counts only |
| Event | — | R C U X (own) | — | **Summary only**¹ | R (support, logged) |
| Event plan: vendors *considering* | — | R C U X (own) | — | — (not told) | R (support, logged) |
| Event plan: vendor *booked* | — | R U (own) | — | R (own row)²; can flag | R; resolves flags |
| Budget, notes | — | R U (own) | — | — | — |

¹ The event's type, date, town and guest-count estimate, and only if the consumer
linked the event to a conversation with that vendor, or marked them booked. Never the
title, notes, budget, address, or guest list.
² The vendor sees that they were marked booked and the event summary, so they can
recognise the booking or flag it.

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

### 4.4 Feedback & reviews (Stage 3)

| Record | Visitor | Author | The reviewed vendor | Other vendors | Admin |
|---|---|---|---|---|---|
| Published review + vendor reply | R | R | R | R | R |
| Pending / rejected review | — | R; edit while pending | — | — | R; publish / reject with reason |
| Write a review | — | C if eligible (§4.5) | — | — | — |
| Vendor reply | — | — | Owner/manager C, once | — | R; remove for policy breach |
| Rating summary | R (shown from 3 reviews) | R | R | R | R |

### 4.5 Review eligibility (enforced by the database)

A consumer can review a vendor only if: they marked that vendor booked on their own
event; the event date has passed; it's within 60 days; and the vendor hasn't flagged the
booking (or the platform team confirmed it). A Localites conversation isn't required
(D-06, option B); the database records whether there was one, and the app can't change
that record. One review per booking. Every review stays hidden until an admin approves
it in the admin area (ADR-026); the team is emailed each new review with a link there,
never a one-tap approve link.

### 4.6 Guests (Stage 4)

As in revision 1: the host controls guests, invitations and RSVPs. A guest's link opens
only their invitation and RSVP form. Vendors never see guest lists.

## 5. Invitation-link security

Stage 4. Unchanged from revision 1:

| Threat | Control |
|---|---|
| Guessing a link | 256-bit random tokens; rate-limited RSVP |
| Database copied | Only token hashes stored |
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
| Photos reveal home location | GPS data stripped from images on upload. |
| Former staff keep access | Access ends the moment membership ends. |
| Platform staff snoop | Staff can open a conversation only through a report, and each access is logged with the report ID. |

## 7. Data minimisation commitments

Changing any of these requires product owner approval.

**About children:** No child profiles or accounts. No dates of birth. An event may have
an optional age range ("ages 4–7"). The event title is free text; no child's name is
required.

**About consumers:** Name and email. Phone optional. A vendor sees the consumer's
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
| A vendor's team (dashboard on a paid plan, Stage 5; until then, reports from the team) | Totals for their own business only: seen in search, profile views, website and phone taps, saves, inquiries, conversations, messages, reply times (later, bookings marked). **Never who** viewed or saved them. They see the people who message them, as part of the conversation. |
| Other vendors and prospective vendors | Category-level figures, or one vendor's own numbers only with that vendor's permission |
| The Localites team (platform admins) | The detailed records, to run the service, prepare reports and compare year over year. Every look is recorded in the audit log. |
| Anyone else | Nothing. Tracking data is never sold. |

- **Told plainly** in the privacy policy, in everyday words. Visitors who aren't signed in
  get a random visitor ID in Localites' own cookie, with no outside trackers. The legal
  review (PO-07) confirms whether a notice is also needed on first visit.
- **Counted, not watched:** we record that something happened (a profile view, a tap), not
  what someone typed or read.
- **Retention:** detailed records are kept with no deletion date, for year-over-year
  reports (D-22, §8). When someone deletes their account, their records stay but the link
  to them is removed. Canadian privacy law expects personal information to be kept only
  as long as a stated purpose needs it; the privacy policy names that purpose, and the
  legal review (PO-07) confirms it.
- **Starts with each feature:** seen in search, profile views and taps from Stage 1;
  saves, inquiries, conversations and messages from Stage 2, when those exist.

## 8. Retention and deletion

**Approved as D-10 (10 October 2026)**, with events kept for as long as the host's
account exists, and detailed activity records kept for year-over-year reports (D-22).

| Data | Kept for | Then |
|---|---|---|
| Events and event plans (type, date, place, vendors, bookings, guest names and replies) | As long as the host's account exists, with no time limit, so hosts can look back years later | Deleted with the account |
| Conversations and files | While both parties' accounts exist, up to 3 years after the last message | Deleted |
| When a consumer deletes their account | — | Their events, plans and saved vendors are deleted. In conversations, their messages show as *"Former Localites member"* and their files are deleted, so the vendor keeps a record of their own side. |
| When a vendor leaves Localites | — | The listing is archived. Consumers keep their copies of conversations, shown as *"This business has left Localites"*. Published reviews stay, without the reply option. |
| Published reviews | While the listing exists | The author is shown as *"A Localites member"* if they delete their account |
| Guest phone numbers and emails (Stage 4) | Until 90 days after the event | Erased. Guest names and their replies stay with the event so the host can look back |
| Detailed activity records (§7a) | No deletion date (D-22), for year-over-year reports | Daily totals are also kept. If the database nears its free limit, older detail moves to archive storage. Unlinked from anyone who deletes their account |
| Email delivery log | 1 year | Deleted |
| Audit log | 2 years | Deleted |
| Verification evidence | While verified + 1 year | Deleted; outcome kept |
| Account deletion request | Within 30 days | As above |
| Backups | Our own nightly backup, kept 30 days (F §5) | Expire automatically; deleted data is fully gone after 30 days |

## 9. Media and files

| Kind | Storage | Access |
|---|---|---|
| Published vendor photos and logos | Public | Anyone |
| Unpublished listing media | Private | Signed links after a permission check |
| Verification evidence | Private | Admins only |
| **Files in conversations** | **Private, Canada** | **The two parties only**; links expire in minutes |

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
before/after values. It is append-only, enforced by the database (tested).

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
  must fail. *(Database layer already proven.)*
- **File access:** expired links, links for files in other conversations, public
  storage attempts. All must fail.
- **Role escalation:** vendor staff attempt owner actions; consumers attempt admin
  actions. All must fail.

**Current results (database layer, 2026-10-10):** 85 of 85 checks passed on PostgreSQL
16. That's 29 for Stage 1 rules and 56 for the consumer–vendor relationship rules,
including the review rule chosen in D-06. Application-layer tests will be added with the code.

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
