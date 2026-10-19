# Roadmap & Estimates

**Status:** Stage 0 approved (D-00). **Stage 1 approved (D-23, 10 October 2026); in progress.**
**Stage 2 started:** its first part, "Plan an event" (slice 2A), is built and tested (D-39 to
D-43, 12–13 October 2026), ahead of the Stage 1 launch, because the product owner's decisions
were ready.
**Last updated:** 2026-10-13

**10 October 2026:** stages and estimates unchanged. Your answers on the launch list
(D-03), launch area (D-09), team emails (D-11), Inquire (D-04, D-05) and activity
tracking (D-22) are placed in the existing stages below. Later the same day: reviews
before RSVPs (D-14), review rule option B with admin approval (D-06), invitation links
and QR codes (D-08), the paid vendor dashboard in Stage 5 (D-22, D-24), and **Suggest a
business** in Stage 1 (D-25).

**Revision 2:** stages reorganised around the consumer–vendor handshake. Messaging
moves from a late, optional stage to the centre of Stage 2. Quotes, vendor-confirmed
bookings and payments are gone. Reviews come straight after the handshake (D-14).

## How to read the estimates

- **Working weeks of one experienced developer**, as a range.
- They assume your decisions and reviews come back within about two working days.
  **Review turnaround is usually the biggest factor in calendar time.**
- They include automated tests, permission tests, documentation, and fixing what review
  finds. Not legal review or content entry.
- If a stage trends past its range, you'll hear at the midpoint, not the end.

## Overview

```mermaid
flowchart LR
    S0["Stage 0<br/>Architecture<br/><i>~1.5 wks</i>"] --> G0{{"You approve<br/>architecture"}}
    G0 --> G1{{"You approve<br/>Stage 1"}}
    G1 --> S1["Stage 1<br/>Discovery & vendors<br/><i>5–7 wks</i>"]
    S1 --> L1(["Public launch:<br/>directory"])
    L1 --> S2["Stage 2<br/>The handshake<br/><i>5–7 wks</i>"]
    S2 --> L2(["Launch:<br/>messaging"])
    L2 --> S3["Stage 3<br/>Feedback & reviews<br/><i>2–3 wks</i>"]
    S3 --> S4["Stage 4<br/>Guests & RSVPs<br/><i>3–4 wks</i>"]
    S4 --> S5["Stage 5<br/>Growth"]
```

Every arrow after Stage 1 has an approval gate. Approving one stage never approves the
next.

**Why this order.** Messaging only works with businesses that have claimed their
listing. Stage 1 puts the directory in front of the public *and* gives local businesses
5–7 weeks to claim their profiles, so the first consumer who taps "Message" on Stage 2
launch day has someone on the other end. Reviews follow because they complete the
loop: by the time Stage 3 ships, the first events planned through Localites will have
happened.

---

## Stage 0 — Discovery & architecture

| # | Deliverable | Where | Status |
|---|---|---|---|
| 1 | Capability map | [A §4](./A-product-blueprint.md#4-capability-map) | ✅ Revised |
| 2 | **Roles & the consumer–vendor relationship** | [roles-and-relationships.md](./roles-and-relationships.md) | ✅ New |
| 3 | Screen inventory | [screen-inventory.md](./screen-inventory.md) | ✅ Revised |
| 4 | Domain model & diagrams | [B](./B-domain-and-data-model.md) | ✅ Revised |
| 5 | Database: Stage 1 built as migrations; Stages 2–3 proposed | [db/](../db/), [schema/](./schema/) | ✅ 51/51 and 56/56 checks pass |
| 6 | Permissions & privacy | [E](./E-security-and-privacy-model.md) | ✅ Revised |
| 7 | Architecture & deployment | [C](./C-architecture-decision-log.md), [F](./F-operational-runbook.md) | ✅ Revised |
| 8 | API & integrations | [api-strategy.md](./api-strategy.md) | ✅ Revised |
| 9 | Backup & recovery | [F](./F-operational-runbook.md) | ✅ |
| 10 | Testing strategy | [testing-strategy.md](./testing-strategy.md) | ✅ Revised |
| 11 | Roadmap | This document | ✅ Revised |
| 12 | Decisions & actions | [H](./H-product-owner-action-register.md) | ✅ Revised |
| — | Clickable prototypes (5 screens, PO-09) | — | ⏳ Next (D-00 approved; design G chosen, D-21) |

**Remaining:** ~0.5–1 week for prototypes of home, search, vendor profile, a
conversation (both sides), and an event plan with "Mark as booked".

---

## Stage 1 — Discovery & vendor foundation

**Progress (10 October 2026):** foundations done: app skeleton in design G, first two
database migrations with 51 checks, Welcome, Explore, search and business profile pages
on fake test data, automatic checks on GitHub, and the live test site on Cloudflare
through Hyperdrive. The fit test found Next.js too heavy for the free plan (median 22.88 ms
per page against 10 ms), so the site moved to React Router (ADR-005, 7% of the size
limit); live CPU time 8 ms, under the 10 ms limit, so the fit test passes. Team sign-in
with two-step codes and the admin page for listings are built and tested (D-28; switched
on by PO-10, live). The 28 test businesses are loaded as drafts for the team to check and
publish (PO-11). Suggest a business is built (D-25), and its team email works (PO-12 done).
Signing in with an emailed code and claiming a business are built and tested (D-27,
D-29, D-32, D-33, D-35, ADR-028): the "Sign in or create an account" screen, **Your
account**, "Claim this business" on every unclaimed profile, and the team's **Claims**
page (live since PO-13, 11 October 2026). Owners now edit their own listing on a page
laid out like it, live at once, with the team's daily note, undo and Remove owner (D-34,
ADR-029). Activity is counted (only what a real browser confirms, ADR-030), added up each
night, shown to the team on **Activity** and to owners on an **Analytics** page the team
switches on per business (D-30, D-37); counting starts once the activity key is added
(PO-14). Cloudflare's free "are you human" check (Turnstile) on signing in with a code is
built but **parked** (D-38): signing in stays a 6-digit emailed code, with our own limits
on codes (ADR-028).

**Still to do from Stage 1 (stated plainly, 13 October 2026):**
- **Before public launch:** privacy policy and terms pages (PO-07 legal review; the mailing
  address, D-12); the production environment (localites.ca with its own database, updated only
  when the product owner presses a **Release** button in GitHub, copying exactly what was tried
  on the test site; the current workers.dev site and test database stay as the test site, where
  every change lands first; free plans only; product owner, 13 October 2026); our own nightly backups and the first restore drill (built 13 October
  2026; switched on by PO-18); alerts when the site breaks (D-11; built 13 October 2026, switched on by PO-19); automated accessibility and
  screen-size checks (built 13 October 2026 at phone and computer sizes; a tablet size and
  screenshot comparison still to come).
- **Policy drafts written 18 October 2026** ([docs/legal](./legal/)): privacy policy, terms of use,
  review policy and a brief for the lawyer (PO-07), each checked against what the site does.
  Pages for them are built after the lawyer's review.
- **Fixes from the scenario tests (D-54, 19 October 2026), in five rounds:**
  1. ✅ **built 19 October 2026** (migration 0046): quick fixes and wording (see G);
  2. ✅ **built 19 October 2026** (migration 0047): reviews and fake bookings: withdraw a review, ask for one to be removed, emails on replies and
     report outcomes, the team decides "wasn't booked" notes, a 24-hour wait when a booking is
     marked after the event (M4, M7, M8, M9);
  3. ✅ **built 19 October 2026** (migration 0048): messages: a person deletes a conversation; both sides edit a message, with earlier versions a
     tap away (M1, M2);
  4. events and guests: copy or delete a cancelled event, tell guests about changes, paste a guest
     list, limits and name matching, a cancellation notice, a lighter guest page (M10–M13, C10, B9);
  5. businesses: hand over or leave a team, hide a page, rename with "(dba former name)", the two
     hats of an owner who also plans events, a readable data download, suggestion limits (B6, M18,
     M20, C6, M21, M22).
- **Added before launch (product owner, 18 October 2026: "add all of them"):**
  1. ✅ **built 18 October 2026** (migration 0041): scheduled deletions the privacy policy promises (email records 1 year, the team's change log
     2 years, conversations 3 years after the last message, declined suggestions' contact
     details 1 year);
  2. ✅ **built** (migration 0042, Admin → Accounts): the team can suspend an account (checked on the server, recorded in `audit_log`);
  3. ✅ **built** (migration 0043): **Download my data** on Your account (a person's right to a copy);
  4. ✅ **built** (`.github/dependabot.yml`; the owner switches on alerts in GitHub's settings, F §9): GitHub's automatic alerts and updates for known security problems in the code packages;
  5. ✅ **first pass done 18 October 2026** (to be repeated just before launch): one full security
     review of the whole site. No high-severity finding. Fixed (migration 0045): reports capped (10 a
     day per person, no duplicates, 20 team emails a day), files capped at 25 MB a day per person,
     reported files let go 90 days after the decision, the health check no longer lists the site's
     settings, the "Where" box now says guests see it, group-link replies limited per connection, an
     unused database right taken back. **Still open:** the "are you human" check against sign-in code
     lockouts (D-38; the owner, 18 October 2026: "not yet", ask again before launch); live-site backups go to private
     storage (step 3); a content security policy; a limit on team password attempts; tighter
     suggestion limits; the older tables still readable by the server without "acting as" rules;
     PDFs aren't checked inside;
  6. ✅ **built** (migration 0044): a reminder in the team's daily note for the hand-done removal of a deleted account's
     sign-in record;
  7. ✅ **built** (`/admin/waiting`, first in the team menu): one "waiting for you" page for the team (held changes, reviews, reports, claims,
     suggestions, inquiries, deleted accounts);
  8. ✅ **written** ([team-handbook.md](./team-handbook.md)): a short team handbook;
  9. ✅ **built** (`/help`): a help and contact page, linked from a footer on every page;
  10. ✅ **built**: "Something wrong with this listing?" on each business page;
  11. ✅ **built** (`/sitemap.xml`, `public/share.png`): previews when a link is shared (title, picture) and a site map for search engines;
  12. ✅ **written** ([owner-phone-checklist.md](./owner-phone-checklist.md)): a click-through checklist for the product owner to try every feature on their phone.
- **Built since (13 October 2026):** deleting your own account (0014); a business's team
  (0015); business photos, added by owners and managers, reviewed and removed by the team
  (0016, switched on by PO-16); categories and towns for the team (0017).
- **Team tools not built yet:** verification records,
  filters (attributes), collections. **Built 18 October 2026:** users and roles (migration
  0035) and the audit-log page; listing review (X3) isn't planned for now, as owners' changes go
  live with the team's daily note and Undo (D-34).
- **Pages not built yet:** collections. **Built 18 October 2026:** How it works, For businesses.
- **Built 18 October 2026 (D-50):** the language check on owners' saves, reviews and replies, with
  the team's **Held changes** page (migration 0036).
- **Owner steps waiting:** PO-11 (check and publish the test businesses), PO-14 (switch on
  activity counting).

**Outcome.** A real, public directory of local event vendors, useful to a parent on its
own, with the admin tools to build it. **Local businesses claim their listings** so
they're ready for messaging.

**In scope.** Landing page · category browsing · search with filters (town, category,
attributes, keyword, typo-tolerant) · vendor profiles (mobile-first, fast, findable on
Google) · honest empty states · vendor website/phone (D-04) · activity counted for each
vendor (seen in search, profile views, website and phone taps) and reports prepared by
the team (D-22) · **Suggest a business**: a three-question form open to everyone, emailed
to the team, with an admin list for vetting (D-25)
· vendor accounts: sign up, claim, edit, submit for review (teammates later, D-29) · one
login joining personal and business, with a switch (D-29) · admin:
create, review, publish, claims, verification, categories, attributes, places,
collections · image upload · audit trail · privacy policy and terms (from PO-07) ·
production environment, monitoring, backups, restore drill.

**Excluded.** Consumer accounts, events, messaging, reviews (later stages). Anything
involving payment (never).

**Dependencies.** Your approval (D-23). D-00, D-01, D-03, D-04, D-07, D-09 and D-11 are
decided; PO-05 and PO-08 are done (test set of 28 businesses); PO-03 on day one; PO-07
before public launch.

**Effort.** 5–7 weeks, plus about three-quarters of a week for the fuller activity tracking
(D-22) and Suggest a business (D-25).
| Work | Weeks |
|---|---|
| **Fit test (first day):** one vendor page, one search, one signed-in page on Cloudflare's free plan; confirm it fits the free limits (ADR-005) | 0.2 |
| Foundations: setup, CI, environments, sign-in, permissions module, audit, migrations, nightly backup | 1.5 |
| Taxonomy, vendor model, admin listing tools | 1.5–2 |
| Public discovery: landing, browse, search, profile, SEO | 1.5–2 |
| Vendor accounts, claiming, self-editing (teammates later, D-29) | 0.75 |
| Activity tracking and vendor reports (D-22, extended by D-30) | 1–1.5 |
| Suggest a business: form, spam protection, team email, admin list (D-25) | 0.25 |
| Hardening: accessibility, security tests, restore drill, launch checklist | 0.5–1 |

**Acceptance criteria.**
1. A visitor with no account can browse, search, filter, and view a profile on a phone.
2. Search finds the right vendor despite common misspellings.
3. An admin can create and publish a listing and see it in search within a minute.
4. A business can claim its listing; after approval, its team can edit it.
5. The database rejects dishonest states (Stage 1 schema checks pass).
6. Every rule in [E §4.1](./E-security-and-privacy-model.md#41-discovery--listings-stage-1)
   has passing tests, including cross-vendor and role-escalation attempts.
7. Every page passes automated accessibility checks and works at 360px wide.
8. A backup has been restored successfully and recorded in G.
9. Every service is on a free plan; the only payment is the domain.
10. Activity is counted for each vendor (seen in search, profile views, taps); only the
    Localites team can see another business's numbers (tested).
11. Anyone can suggest a business in under a minute; the team email arrives; the
    suggestion is in the admin list; nothing is published until an admin adds the business.
12. **Success measure to watch:** how many listed businesses claim their profile.

**Risks.** Too few vendors (high; mitigated by D-03 B and D-09 B) · a business objects to
being listed (medium; clear labels, fast removal, personal contact) · legal review
delays launch (medium; start PO-07 now) · **low claim rate leaves Stage 2 with few
messageable vendors** (medium; PO-08 claim calls; Stage 1 activity numbers, then
inquiries in Stage 2, give a truthful reason to claim).

---

## Stage 2 — The handshake

**Progress (13 October 2026): slice 2A "Plan an event" is built and tested** (migration 0012,
ADR-031; not yet on the test site):
- **Accounts and switching:** consumer accounts (since Stage 1's sign-in) and the switch
  between **My events** and **My business** (D-13 R8, D-29).
- **Saving and events:** saved businesses; events with a private name, date and town, an
  optional kind of event (D-39) and optional details.
- **The event plan:** **Add to event** → **Mark as booked** → un-mark, remove and put back.
- **The business side:** **Bookings marked** with the limited summary (D-40) and **This
  isn't right** (D-41), with emails to the business, and to the person when flagged.
- **Ideas and featured businesses per kind of event (D-43):** run by the team at **Event
  types**. **Featured placements were brought forward from Stage 5 by D-43**, for plans
  only: clearly labelled, set by the team, no payment through Localites, never affecting
  search order, reviews or ratings.
- **Team pages:** read-only **Booking flags**, and team-only planning counts (D-42).
- **Per-person database rules** for events, plans and saves.

**Built since (14 October 2026):** **Inquire** for businesses not on Localites yet, with the
team's **Inquiries** list and an email to each person when the business joins (ADR-024,
migrations 0021–0022); the team's **Bookings** page (D-46, migration 0020); **messages, part
1** (text): conversations, replies by the whole team, emails once per unread stretch, each
person's own new counts, blocking, removing your own message (migration 0023); **part 2**:
Report and the team's Reports page (migration 0024); fixes after review: a business's next team
never sees the last one's conversations, paused while a business isn't listed, the site's own
cap on message emails, and a cheaper look for new messages (migration 0025); **part 3**: files in
conversations, a photo or PDF with a message (migration 0028; switched on by PO-20).

**Not built yet in Stage 2:**
- ~~batched email digests~~ **built 18 October 2026** (D-53, migration 0040): booking emails to
  a business come as one summary each morning;
- counting how often featured businesses are shown (D-43: later);
- counting saves, inquiries, conversations and messages as activity (the D-30 funnel; D-42
  gives the team planning totals meanwhile): **inquiries, conversations, messages and reply
  time built 18 October 2026** on a business's Analytics page (D-52, migration 0039);
- ~~suggestions from signed-in people linked to their account~~ **built 18 October 2026**
  (migration 0038): linked from their session, and emailed once when the business is listed;
- ~~linking a conversation to an event~~: **already built** with messages (choose an event when
  starting a conversation, or change it in the conversation; the business sees only the D-40 summary).
- **end dates for photos people share from an event (D-47), when that's built:** 30 days after
  the event (conversation files' end dates are built: migration 0030);
- **storage for growth (D-47):** staying on Supabase for now (owner's choice); Cloudflare's own
  storage (R2) to revisit as storage grows (it needs a payment card and bills past its free
  amount).

Also deferred from 2A: archiving or un-cancelling events, the team opening any event for
support, typing in a business that isn't on Localites, and the team's screens for managers
and staff.

**Outcome.** A consumer can find a vendor, talk to them directly, share files, plan
the event, and keep track of who they've booked. A vendor can reply, share files, and
see who marked them booked.

**In scope.**
- Consumer accounts; switching between "My events" and "My business" (D-13 R8)
- Saved vendors
- Events: type, date, town; optional time, venue note, guest estimate, age range,
  private budget and notes
- Event plan: **Add to event** (considering) → **Mark as booked** → un-mark / remove
- Vendor view of bookings marked, with event summary; **flag** if not real
- **Conversations**: consumer starts; vendor team replies; optionally about an event;
  text + files (images, PDFs); updates every ~15 seconds on screen; batched email
  notices; private unread counts
- Block and report, both sides; reports queue for the platform team
- **Inquire** on unclaimed or unverified businesses: saved, and emailed to the Localites
  team (supportlocalites@gmail.com) naming the business and the person asking; plus a notice
  when the business joins (D-04, D-05, ADR-024)
- Activity tracking extended to saves, inquiries, conversations and messages (D-22)
- Suggestions from signed-in people linked to their account, with an email when the
  business is added (D-25)
- Per-person database rules on events, conversations, messages and files (ADR-004)
- "Localites doesn't process payments" notice in every conversation (ADR-018)

**Excluded.** Typing indicators, read receipts, online status, group chats, voice/video;
text-message notifications; reviews (Stage 3); guests (Stage 4); payment of any kind.

**Dependencies.** Stage 1 released and businesses claiming; D-10, D-13 decided (D-05 is);
domain registered so email works (D-07).

**Effort.** 5–7 weeks.
| Work | Weeks |
|---|---|
| Consumer accounts, side switching, saved vendors | 0.5–1 (✅ built, 2A) |
| Events and event plan (considering / booked / flag), plus ideas and featured businesses per kind of event (D-43) | 1–1.5 (✅ built, 2A) |
| Conversations, messages, files, unread counts, polling | 1.5–2 |
| Email notices (batched), block, report, reports queue, Inquire | 1 |
| Per-person database rules, security tests, hardening | 1–1.5 |

**Acceptance criteria** (✅ = passing tests now).
1. A consumer can go from a vendor profile to a sent message in under a minute on a
   phone.
2. A vendor team member receives an email notice and can reply from their phone.
3. Both sides can share a photo and a PDF; nobody else can open them, even with the link
   (tested).
4. ✅ Only the consumer can mark booked; the vendor is notified and can flag it.
5. ✅ A vendor can never see a consumer's "considering" list, budget, notes, or guest list
   (tested; also the event's name and kind, D-40).
6. Vendors cannot start conversations; nobody can post into a conversation they're not
   in (database-enforced, already proven).
7. The words in [A §6](./A-product-blueprint.md#6-language-rules) are checked across all
   screens and emails: no wording implies payment or confirmation (✅ for every planning
   page and email).
8. Blocking stops messages both ways; reports reach the queue.
9. **Inquire** saves the inquiry and emails the team; if the email fails, the person and
   the team's list say so honestly. Nothing suggests the business received a message.

---

## Stage 3 — Feedback & reviews

**Outcome.** After an event, consumers are asked how each booked vendor did. Reviews
build vendors' reputations; vendors can reply.

**In scope.** Feedback requests the morning after (email + in-app) and one reminder ·
retroactive requests for events in the previous 60 days · review form (stars +
comments) · eligibility per D-06 (option B: any real booking; reviews without a
Localites conversation labelled "Planned outside Localites") · **every new review
emailed to the team with a link to approve or decline it in the admin area** (ADR-026) ·
moderation queue with written policy · booking-flag resolution · publication on
profiles · vendor reply (once) · rating summary (from 3 reviews).

**Built, part 1 (14 October 2026, migration 0031).** Review form (stars and words) from
"Plan an event"; eligibility per D-06; the team emailed each new review and deciding it on
**Admin → Reviews** (publish, decline with a reason, remove, remove a reply); the person
emailed when it is published (not when denied: D-51, approved or denied from the team's email
with no reason needed, leaving its author no trace), the business when it is published; reviews on
the business page with "Sarah M." and Living Local (D-48); one reply from the owner or a
manager; the average from 3 reviews. **Built, part 2 (migration 0032):** the morning-after
"How was it?" email and one reminder a week later (events from the previous 60 days asked
too), turned off on **Your account**; reporting a review (people, and the business about
its own), with the team's Reported list. **Still to do:** the written review policy
(lawyer, PO-07).

**Dependencies.** Stage 2 (D-06 and D-14 decided); review policy reviewed by the lawyer.

**Effort.** 2–3 weeks.

**Acceptance criteria.** The database refuses every ineligible review (already proven).
A consumer can leave a review from the email in under two minutes. Nothing is published
without a recorded moderator. Ratings appear only from three reviews.

---

## Stage 4 — Guests & RSVPs

**Outcome.** Consumers invite guests with secure links and collect RSVPs without guests
creating accounts.

**In scope.** Guest list · a personal link per guest, and a group link for group chats
and social posts (guests type their name; the host matches it to the list) · share by
text, WhatsApp, social media or email from the host's phone, or as a printable QR code
(D-08) · revoke/expire · account-free RSVP with plus-ones and host questions · attendance
view showing who has replied and who hasn't · event updates · events kept for as long as
the host's account exists (D-10).

**Built, part 1 (14 October 2026, migration 0033, ADR-032):** the guest list on each event;
a personal link per guest, sent from the host's phone (share sheet, text, WhatsApp, email,
copy); a new link replaces the old; account-free replies (yes, maybe, no, how many, a note),
changeable until the event; who opened and who replied, with totals; the host's message;
links stop 30 days after the event; phone numbers and emails erased 90 days after. **Then
(D-49, migration 0034):** the host changes any guest's reply and the guest is emailed;
guests add the event to Google, Apple, Outlook, Microsoft 365, Yahoo or any calendar.
**Part 2, built 18 October 2026 (migration 0037):** the group link and matching names, the
printable QR code, the host's questions (up to 5) with each guest's answers, and updates shown on
every invitation (not sent by Localites, D-08: the host shares them from their phone).

**Dependencies.** Stage 3 (D-14); D-08 and D-10 decided. **Effort:** 3–4 weeks.

---

## Stage 5 — Growth

Each item proposed and approved separately, based on real use: **vendor dashboard for
vendors on a paid plan**, showing only their own anonymous counts (D-22; paid for
outside Localites, D-24) · more communities (data only) · featured placements, clearly labelled and sold by
the team (never affecting reviews) · text-message notices (needs a service and
approval).

**Brought forward by D-43 (12 October 2026):** featured businesses per kind of event, shown
on a person's own plan, are built in Stage 2 (slice 2A). Featured spots elsewhere (search,
category pages, Welcome) and counting how often they're shown stay here, each needing its
own approval.

---

## Cross-stage risks

| Risk | Mitigation |
|---|---|
| Vendors don't claim, so messaging has nobody to talk to | Claim drive during Stage 1 (PO-08); **Inquire** reaches the team for every unclaimed business (D-04); measure claim rate weekly |
| Vendors don't reply, so consumers lose trust | Email notices; reply-rate visible to the platform team; later, a gentle "replies usually within a day" on profiles (only once true) |
| Messaging misuse: spam, harassment, fake invoices | Vendors can't start conversations; block/report; "Localites doesn't process payments" notice; reports reviewed daily |
| Fake bookings used to post unfair reviews | Consumer-only "booked"; vendor flag; an admin approves every review (D-06); "Planned outside Localites" label |
| Nobody available when messaging breaks | Alerts by email to you; a ready-made note for starting a fix session (D-11) |
| A free-plan limit is reached (most likely email at 100/day, then file storage) | Free plans stop rather than bill. We warn you at 80% with free options first: tighter email batching, a second free email service, photo compression ([cost-model.md](./cost-model.md)) |
| Cloudflare's free plan doesn't fit, or its terms don't allow business use | Fit test and terms check before real building starts; options brought to you before anything costs money |
| Building beyond validated need | Stage gates; Stage 5 items need usage evidence |
| Estimates slip | Mid-stage check-in with a revised range and reason |
