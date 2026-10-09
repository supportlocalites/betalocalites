# E — Security & Privacy Model

**Status:** Proposed (Stage 0). Awaiting product owner approval.
**Last updated:** 2026-10-09

---

## 1. Principles

1. **Deny by default.** Nobody can see or change anything unless a rule explicitly
   allows it.
2. **Server-side only.** Every permission check happens on our server. Hiding a button
   is a courtesy, not a control. (ADR-004)
3. **Two locks.** Application policy checks, plus database row-level security as a
   backstop.
4. **Ownership is explicit.** Every private record belongs to a user, a vendor team, or
   the platform, traceable in one step.
5. **Collect less.** Information we never collect can't leak.
6. **Prove it.** Every rule in the matrix below has an automated test that tries to
   break it. A rule without a test is a hope.

## 2. Authentication (signing in)

- Provider: Supabase Auth (ADR-003).
- Methods at launch: email + password, and email sign-in link. No social sign-in until
  requested (each adds a dependency and a data-sharing relationship).
- Sessions are held in secure, HTTP-only cookies that page scripts cannot read.
- Passwords are never seen or stored by Tallo code; the provider handles them.
- Staff accounts (admin, concierge) **must** use two-factor authentication. Enforced
  server-side: a staff action from a session without 2FA is refused.
- **Guests never need an account.** They act only through an invitation link.

## 3. Roles

A person's permissions come from relationships, not from a single "user type". The same
person can host a birthday party and also be a vendor's manager.

| Role | How you get it | Scope |
|---|---|---|
| **Visitor** | Anyone, no account | Public pages only |
| **Signed-in user** | Create an account | Their own profile, saved vendors, events they host |
| **Event host** | Create an event | That event and everything on it |
| **Event co-host / helper** | Invited by the host | That event; helpers can't see contact details or delete |
| **Guest** | Holds a valid invitation link | That one invitation page and their own RSVP |
| **Vendor owner** | Approved claim, or created by admin and assigned | That vendor's listing, team, and inquiries |
| **Vendor manager / staff** | Added by vendor owner | That vendor; staff can't change team or ownership |
| **Concierge** | Granted by admin (`platform_role`) | Inquiries to unclaimed vendors; read-only listing data |
| **Admin** | Granted by another admin, recorded in `audit_log` | Platform-wide administration |

**There is no "super user" bypass in the application.** Admins act through the same
policy checks as everyone else; their role simply grants more. Every admin action is
recorded in `audit_log`.

## 4. Permission matrix

**R** read · **C** create · **U** update · **X** archive/remove · **—** no access.
"Own" means records where the person holds the relevant relationship.

### 4.1 Discovery & vendor (Stage 1)

| Record | Visitor | Signed-in user | Vendor owner/manager | Vendor staff | Concierge | Admin |
|---|---|---|---|---|---|---|
| Published vendor listing | R | R | R | R | R | R |
| Unpublished / draft listing | — | — | R U (own) | R (own) | R | R C U X |
| Submit listing for review | — | — | C (own) | — | — | C |
| Approve / publish listing | — | — | — | — | — | U |
| Vendor services, media, attributes | R (published) | R (published) | R C U X (own) | R C U (own) | R | R C U X |
| Vendor team (`vendor_member`) | — | — | R C U X (own; owner only for C/X) | R (own) | — | R C U X |
| Claim request | — | C (own), R (own) | — | — | R | R U |
| Verification record & evidence | — (status only, on listing) | — | R (own) | — | — | R C U |
| Categories, attributes, places | R | R | R | R | R | R C U X |
| Saved vendors | — | R C X (own) | — | — | — | — (aggregate counts only) |

### 4.2 Events & guests (Stage 2)

| Record | Visitor | Other signed-in user | Host | Co-host | Helper | Guest (link) | Vendor on event | Admin |
|---|---|---|---|---|---|---|---|---|
| Event details | — | — | R U X | R U | R | R (invitation fields only) | R (date, town, type only — after an inquiry, Stage 3) | R (support, logged) |
| Event ↔ vendor list | — | — | R C U X | R C U | R | — | R (own row only) | R |
| Guest list | — | — | R C U X | R C U | R (names only) | — | — | R (support, logged) |
| Guest contact details | — | — | R U | R U | — | own only | — | — (unless support, logged) |
| Invitation link | — | — | C X (revoke) | C X | — | R (own) | — | X |
| RSVP | — | — | R | R | R (counts + names) | C U (own) | — | R (support, logged) |
| Other guests' RSVPs | — | — | R | R | R (counts) | — | — | — |
| Event updates | — | — | R C U X | R C | R | R (if audience matches) | — | R |

### 4.3 Inquiries (Stage 3)

| Record | Requester | Vendor owner/manager | Vendor staff | Concierge | Admin |
|---|---|---|---|---|---|
| Inquiry to a claimed vendor | R C, X (withdraw) | R U (respond, close) | R U (respond) | — | R |
| Inquiry to an unclaimed vendor | R C, X | — (vendor has no account) | — | R U (log delivery, relay responses) | R |
| Inquiry messages | R C (own inquiries) | R C (own vendor) | R C (own vendor) | R C (concierge inquiries) | R |

**Admin "support, logged"** means: an admin may view the record only to resolve a
support request, and each view writes an `audit_log` row with the reason. This is
visible in the operations report so access can be reviewed.

## 5. Invitation-link security

| Threat | Control |
|---|---|
| Someone guesses a link | 256-bit random tokens. Guessing one is not practically possible. RSVP endpoint is rate-limited. |
| Our database is copied | Only token **hashes** are stored. Hashes can't be turned back into working links. |
| A guest forwards their link | The link shows only the invitation and that guest's RSVP form. Nothing else. Hosts can revoke and reissue. |
| A link is used after the event | Links expire (default 30 days after the event end). |
| A link opens the host's workspace | Impossible by design: the invitation page is a separate, minimal view with its own query that reads only invitation-safe fields. Tested explicitly. |
| A guest sees other guests | Never shown on the invitation page. Not in the page's data, not merely hidden. |
| Search engines index invitations | Invitation pages send `noindex` and are excluded in `robots.txt`. |
| Link appears in browser history on a shared computer | Token is exchanged for a short-lived, invitation-scoped cookie on first open; the address bar then shows a token-free URL. |

**Open-link invitations** (one link shared to a group chat) are supported, because
that's how many parents invite a class. They are inherently less private: anyone with
the link can RSVP. The host is told this plainly when choosing it, and the host can
see and remove any RSVP.

## 6. Data minimisation commitments

These are product commitments, not just engineering ones. Changing any requires
product owner approval and an update here.

**About children:**
- No child profiles. No child accounts.
- No date of birth. An event may record an optional *age range* (e.g. "turning 6",
  "ages 4–7") because it's useful for vendor suitability. Not a birthdate.
- The event title is free text the host controls. We don't require a child's name.
- No photos of children are required anywhere. If image upload is added to events
  later, it needs its own privacy review.

**About guests:**
- A guest needs only a display name. Email and phone are optional and used only for
  the host's own reference unless a notification channel is later approved.
- Dietary or accessibility answers are collected only if the host asks them as an
  event question, and are visible only to the host and co-hosts.
- Guests don't create accounts, so we hold no guest password, profile, or history
  across events.

**About organizers:**
- Name and email. Phone optional.
- No home address required. Event location can be a venue name, a street address, or
  just a town; the host chooses.

**About vendors:**
- Business contact details are public only where the vendor (or, for an unclaimed
  listing, already-public business information) makes them so. See decision D-03.

**About everyone:**
- No third-party advertising or tracking scripts (ADR-015).
- IP addresses are used transiently for rate limiting and abuse prevention, not stored
  against records.

## 7. Retention and deletion

Proposed defaults. **D-10 asks you to approve these.**

| Data | Kept for | Then |
|---|---|---|
| Guest contact details | Until 90 days after the event | Erased. Name and RSVP counts kept for the host's history. |
| Invitation tokens | Until expiry or revocation | Hash retained (useless without the token), status kept |
| Event records | While the host's account exists | Deleted with the account, except where linked to a booking with a vendor (kept, anonymised on the host side) |
| Inquiry threads | 2 years after closing | Anonymised |
| Audit log | 2 years | Deleted |
| Verification evidence (documents) | While listing is verified + 1 year | Deleted; the outcome (verified/date) is kept |
| Account deletion request | Processed within 30 days | Personal fields erased; history anonymised |
| Backups | Rolling window set by the provider plan (expected ~7 days on Supabase Pro; confirm at signup) | Expire automatically. Deleted data is fully gone once the backup window passes. |

## 8. Media and documents

| Kind | Storage | Access |
|---|---|---|
| Vendor logos, photos (published listings) | Public bucket | Anyone, via CDN |
| Vendor media on unpublished listings | Private bucket | Signed URLs, expiring in minutes, issued after a policy check |
| Verification evidence | Private bucket | Admin only. Never shown publicly. |
| Agreements, booking documents (Stage 4) | Private bucket | Parties to the booking. Signed, short-lived URLs. |

Uploads are checked server-side for file type and size. Images have location metadata
(EXIF GPS) stripped before storage.

## 9. Secrets and credentials

- Secrets (database keys, email API keys) are stored only in the hosting provider's
  encrypted environment settings and in a team password manager. **Never in git, chat,
  email, or documents.**
- The product owner owns the root accounts (hosting, database, domain, email). The
  engineering team is invited as members with the least access needed. If a team
  member leaves, their access is removed without changing anything else. See action
  PO-03 in [H](./H-product-owner-action-register.md).
- The product owner **will never be asked to paste a password, key, or code into
  chat.** If anyone asks, it's not us — or it's a mistake, and the answer is still no.
- Automated secret scanning runs on every change to the code repository.
- Keys are rotated when a team member with access leaves, and at least yearly.

## 10. Audit trail

`audit_log` records, for every admin action and every permission-sensitive action:
who, what, which record, when, from where (session ID, not IP), and before/after
values for changed fields. It is append-only: the application has no code path to edit
or delete audit rows.

## 11. Security testing

Every row of the permission matrix in §4 becomes automated tests that run before every
deployment. Specifically:

- **Cross-account tests:** User A creates an event. User B attempts to read, edit, list
  guests of, and revoke invitations on it by supplying its ID directly. All must fail.
- **Cross-event tests:** A guest holding a valid invitation for Event 1 attempts to read
  Event 2's details, guest list, and RSVPs. All must fail.
- **Cross-vendor tests:** A manager of Vendor A attempts to edit Vendor B, read Vendor
  B's inquiries, and add themselves to Vendor B's team. All must fail.
- **Role escalation tests:** A vendor staff member attempts owner-only actions. A
  signed-in user attempts admin actions. All must fail.
- **Invitation tests:** revoked token, expired token, malformed token, a valid token
  from another event, and rate-limit enforcement.
- **State machine tests:** every disallowed status transition is attempted and must be
  rejected.

Results are recorded in [G](./G-release-and-migration-history.md) for every release.

**Current results:** none. No code exists yet.

## 12. Legal context (not legal advice)

- **PIPEDA** governs how a private business in Ontario handles personal information.
  We'll need a privacy policy explaining what we collect and why, and a way to request
  access or deletion.
- **CASL** (Canada's anti-spam law) restricts commercial electronic messages sent
  without consent. It's the main reason we recommend hosts share invitations through
  their own channels (D-08), and it matters for how we contact unclaimed vendors (D-03).
- Publishing listings for businesses that haven't asked to be listed, using publicly
  available information, is common practice for directories, but the approach should
  be reviewed.

**A lawyer familiar with Canadian privacy law should review the privacy policy, terms
of use, and the unclaimed-listing approach before public launch** (action PO-07). This
document describes engineering controls; it is not a legal opinion.
