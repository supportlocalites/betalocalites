# H — Product Owner Action Register

**Last updated:** 2026-10-10 (revision 10)

This is the one place where everything that needs **you** is listed. If it isn't here,
you don't need to do it.

- **Decisions** (D-xx): choices only you can make, each with options and a
  recommendation.
- **Actions** (PO-xx): things you need to do, with step-by-step instructions.

---

## Already decided by you

Recorded from your messages of 9 and 10 October 2026. These now shape every document.

| # | Decision | Effect |
|---|---|---|
| ✅ D-15 | **Two users: consumers and vendors.** The relationship between them is the core of the product. | New [roles-and-relationships.md](./roles-and-relationships.md); data model rebuilt around it. |
| ✅ D-16 | **No payments. Localites doesn't handle cash and never says or implies it does.** | ADR-018. No payment features or fields anywhere. Language rules in [A §6](./A-product-blueprint.md#6-language-rules). Extended by D-24: this includes vendors paying Localites. |
| ✅ D-17 | **Localites is the digital handshake.** Consumers and vendors talk directly and plan together, and can share files (an invoice is just a file). | Messaging with files is the centre of Stage 2 (ADR-019, ADR-020). Quotes, vendor-confirmed bookings and agreements removed. |
| ✅ D-18 | **"Add to event" and "Booked" are the consumer's tools.** | ADR-021. Only the consumer can set them (database-enforced). |
| ✅ D-19 | **After the event, ask the consumer for feedback; that feeds reviews and ratings.** | Stage 3: feedback requests → reviews → ratings. |
| ✅ D-20 | **No running costs.** Every service runs on a free plan. | [cost-model.md](./cost-model.md) revision 3. Supabase, email, error alerts and backups on free plans; hosting moved from Vercel to Cloudflare's free plan (ADR-007). Only the web address remains (D-07). |
| ✅ D-00 | **The architecture is approved** (10 October 2026): one application, one PostgreSQL database, the consumer–vendor data model, the security model and the staged roadmap. | Stage 0 documents marked approved; technical decisions accepted in [C](./C-architecture-decision-log.md). Stage 1 is approved separately. |
| ✅ D-01 | **The product is called Localites, at `localites.ca`.** Renamed from Tallo; you bought the domain on 10 October 2026. | Every document, the proposed schemas and the design mockups say Localites. |
| ✅ D-07 | **Pay for the web address.** Done: `localites.ca` is yours. | The only running cost (~CA$15–25 a year). Email can be set up on it when we get there. |
| ✅ D-21 | **Build the app with design G, for phones and computers.** One website that adapts to the screen; all earlier designs kept for reference. | [design-system.md](./design-system.md); archive in [design/](./design/README.md); phone, tablet and desktop checks in [testing-strategy.md](./testing-strategy.md). |
| ✅ D-03 | **A curated launch list.** We research Orillia-based businesses in the categories you choose (PO-05) and send a shortlist; you pick which go live. Start with businesses rated 4 stars or more on public review sites; others are added by hand later. | Listings use only what each business publishes itself, marked unclaimed, removed on request. The star rating is our private shortlist filter: never copied or shown on Localites. **Test set:** our 28 suggestions, up to 5 per category, to test the app; you'll refresh the list later (PO-08). |
| ✅ D-04 | **The stages stay as planned.** In Stage 1, vendor profiles show the business's own website and phone, and taps are counted. When messaging arrives in Stage 2, claimed, verified vendors get **Message**; unclaimed or unverified vendors get **Inquire**, which emails the Localites team at supportlocalites@gmail.com saying which vendor was requested and by whom. | [Roadmap](./roadmap.md) unchanged; ADR-024 (Stage 2). Settles D-05. |
| ✅ D-09 | **Launch area:** Orillia plus Severn, Oro-Medonte and Ramara. | The first vendor list is Orillia-based (D-03); consumers can be anywhere in the area. |
| ✅ D-11 | **supportlocalites@gmail.com is the Localites admin address**: every service account is registered to it, and all alerts and team emails go to it. | [F](./F-operational-runbook.md) monitoring; inquiry emails (D-04) too. |
| ✅ D-13 | **The consumer–vendor rules R1–R8 are approved.** | [roles-and-relationships.md §3](./roles-and-relationships.md#3-rules-we-propose-for-the-relationship); ADR-022 accepted. |
| ✅ D-06 | **Reviews: option B, and an admin approves every one.** Any real booking can be reviewed after the event (no Localites conversation needed); each new review is emailed to supportlocalites@gmail.com and goes live only when an admin approves it. | ADR-026; database rule updated and checked (56 of 56). Reviews without a Localites conversation are labelled "Planned outside Localites". |
| ✅ D-14 | **Reviews come before guest RSVPs.** | Stage 3 reviews, Stage 4 RSVPs ([roadmap](./roadmap.md)). |
| ✅ D-08 | **Invitations are shared from the host's own phone**: text, WhatsApp, social media, email or a printable QR code, with a personal link per guest and a group link for group chats. | [roadmap](./roadmap.md) Stage 4; [E §5](./E-security-and-privacy-model.md#5-invitation-link-security). |
| ✅ D-10 | **Data-keeping rules approved**, except that **events are kept for as long as the host's account exists**, so hosts can look back years later. | [E §8](./E-security-and-privacy-model.md#8-retention-and-deletion). |
| ✅ D-12 | **Business name: Localites. Privacy contact: supportlocalites@gmail.com.** Mailing address left blank for now; it must be added before launch. | Privacy policy and terms (PO-07). |
| ✅ D-24 | **No payments of any kind go through Localites.** Consumers pay vendors, and vendors pay Localites (for a paid plan or a featured spot), entirely outside the site. | ADR-018 extended; ADR-025: Localites records only which plan a vendor has and its dates. |
| ✅ D-25 | **Suggest a business.** Anyone who doesn't see a business they want can suggest it by answering three questions: its name, its website (if any), and a phone number or email (if known). It's emailed to supportlocalites@gmail.com; the team vets it and adds it. | ADR-027; Stage 1. Screens P11 and X19. |
| ✅ D-23 | **Stage 1 approved.** Build the public directory, vendor accounts, admin tools, activity tracking and Suggest a business, loaded with the test set. | [roadmap](./roadmap.md) Stage 1; building started 10 October 2026. |
| ✅ D-22 | **Full activity tracking for vendor reports**: who and how many people see each vendor in search, open their profile, tap their website or phone (from Stage 1), and save, inquire, message, add them to an event or mark them booked (from Stage 2). | ADR-023; [E §7a](./E-security-and-privacy-model.md#7a-activity-tracking-d-22). Used to sell featured placements and help with renewals. **Amended:** detailed records kept with no deletion date, for year-over-year numbers; vendors see only anonymous counts, in a dashboard for paying vendors. |

---

## Needed from you now

| # | What | Blocks | Your effort |
|---|---|---|---|
| **PO-03** | Part 3: connect GitHub, Supabase and Cloudflare (step by step below) | Fit test and first preview | About 30 minutes |
| **D-12** | Mailing address for the privacy policy and terms | Public launch | 1 min, later |

**How to respond:** reply in the conversation with decision numbers and your choice,
e.g. *"PO-03 done: localites.example.workers.dev"* "I don't understand
this one" is a perfectly good answer.

---

## Decisions

### D-00 — Approve the revised architecture

**What.** The overall direction: one application, one PostgreSQL database, the
consumer–vendor data model in [B](./B-domain-and-data-model.md), the security model in
[E](./E-security-and-privacy-model.md), and the staged roadmap.

**What approval means.** You agree with the direction. It does **not** approve Stage 1
spending, any recurring cost, or any future feature.

**Recommendation.** Approve, then approve Stage 1 separately after reviewing the
prototypes.

**Status:** ✅ Approved, 10 October 2026.

---

### D-13 — The consumer–vendor rules

**What.** The rules that govern how the two sides interact. Full explanation in
[roles-and-relationships.md §3](./roles-and-relationships.md#3-rules-we-propose-for-the-relationship).

| # | Rule | Recommendation |
|---|---|---|
| R1 | Only consumers start conversations; vendors reply | ✅ Yes |
| R2 | A conversation is one consumer + one vendor, optionally about one event | ✅ Yes |
| R3 | "Considering" is private; "booked" notifies the vendor | ✅ Yes |
| R4 | Vendors can flag a booking that isn't real; it can't lead to a review until resolved | ✅ Yes |
| R5 | The consumer controls what event details a vendor sees (type, date, town, guest count; never the guest list) | ✅ Yes |
| R6 | Localites staff don't read conversations unless one side reports it | ✅ Yes |
| R7 | Either side can block the other | ✅ Yes |
| R8 | One account per person; a person can be both a consumer and on a vendor's team, and switches between "My events" and "My business" | ✅ Yes |

**The rule most worth your attention is R3.** Telling a vendor when they're marked
booked is good for vendors (it's real evidence Localites works for them) and protects
reviews (they can flag fakes). The cost: a consumer's name and event date are shared
with that vendor. We'd tell the consumer this clearly when they tap "Mark as booked".
The alternative is to keep "booked" completely private, which removes the flagging
protection.

**Status:** ✅ Approved, 10 October 2026 (all eight rules).

---

### D-05 — Messaging businesses that haven't joined Localites

*(Replaces the earlier concierge proposal.)*

**What.** Many listings at launch will be businesses that haven't claimed their profile
(D-03). A consumer taps "Message". What happens?

**Options.**
| Option | Consumer experience | Your workload | Honesty |
|---|---|---|---|
| **A. Not messageable; show their own contact details; "Let them know you're interested"** | Calls or visits their website directly. Gets an email if the business joins later. | You (or someone) contact interested businesses to invite them. Light. | Clean: we never hold a message we can't deliver |
| B. Concierge relay: Localites staff pass messages back and forth by phone/email | Feels like messaging, but slow and indirect | Heavy: you'd relay every message | Risky: easy to imply delivery that hasn't happened |

**Recommendation.** A. Your clarification puts the consumer and vendor talking
*directly* at the centre, which a relay can't provide. Interest from real consumers is
also the most persuasive, truthful reason for a business to claim its listing: *"Three
parents tried to message you on Localites this month."*

**Status:** ✅ Settled by D-04, 10 October 2026: from Stage 2, unclaimed businesses get
**Inquire**, which reaches the Localites team. We recommend the team uses each inquiry to invite the
business to join and reply on Localites, rather than passing messages back and forth, so
conversations stay direct (D-17).

---

### D-06 — Who may leave a review

**What.** "Booked" is the consumer's own word. What else must be true before they can
review?

**Options.**
| Option | Rule | Review volume | Credibility |
|---|---|---|---|
| **A. Booked + event passed + talked on Localites (vendor replied) + not flagged** | Strict | Lower early on | High: both sides took part on Localites |
| B. Booked + event passed + not flagged | Looser | Higher | Medium: a consumer could review a business they only phoned. Such reviews would be labelled "Planned outside Localites". |

Both options: one review per booking; checked by the platform team before publishing;
vendor gets one public reply; average shown only from three reviews; 60-day window.

**Recommendation.** A. It matches your original preference for reviews tied to
interactions the platform recorded, and it can't be gamed by marking a random business
"booked". Relaxing to B later is easy. Tightening after unverifiable reviews are public
is not.

**Status:** ✅ Decided, 10 October 2026: **option B, with an admin approving every
review.** Each new review is emailed to supportlocalites@gmail.com with a link to it in
the admin area, where an admin taps **Approve** or **Decline**. For safety, the email
doesn't contain a one-tap approve button: email security scanners open links on their
own, and a forwarded email could publish a review nobody read (ADR-026).

---

### D-14 — Order after the handshake

**What.** After Stage 2, which comes first: **feedback & reviews**, or **guest
invitations & RSVPs**?

**Recommendation.** Reviews first (Stage 3, 2–3 weeks), then RSVPs (Stage 4, 3–4
weeks). Reviews complete the consumer–vendor loop you described, and the timing works:
the first events booked through Localites will be happening by the time reviews ship.
Parents already have workable RSVP tools (Evite, group chats); nobody else has
reviews tied to real local bookings. No feedback is lost in the meantime: bookings are
recorded from Stage 2, and Stage 3 asks about any event in the previous 60 days.

**Status:** ✅ Decided, 10 October 2026: reviews first, then RSVPs.

---

### D-21 — Design direction

**Decided.** Localites is built with mockup **G**: F's ivory, black and gold look, with D's calm
layouts for conversations, the event plan, booking and reviews, and the guest invite and RSVP
screens. It's one website that works on phones, tablets and computers, so every change
appears on all of them at once. All earlier designs (A to H) are saved in
[design/](./design/README.md). The rules the build follows are in
[design-system.md](./design-system.md).

**Status:** ✅ Decided, 10 October 2026.

---

### D-22 — Tracking vendor activity

**Decided (10 October 2026).** Localites records how people interact with each vendor,
so you can show vendors what they get from Localites, sell featured placements, and help
with renewals.

**What's counted for each vendor**, as totals and as unique people, by day:

| Measure | Counted when |
|---|---|
| Seen in search | Their card actually appears on someone's screen in search results, a category page, a collection or the Featured row. Scrolling past counts once per visit. Featured and ordinary appearances are counted separately. |
| Profile views | Someone opens their profile, and from where (search, Featured, a collection, a shared link) |
| Website and phone taps | Someone taps their website or phone number |
| Saves *(from Stage 2)* | Someone saves them |
| Inquiries *(from Stage 2)* | Someone taps **Inquire** (D-04) |
| Conversations and messages *(from Stage 2)* | Someone starts a conversation; messages each way; how quickly the business replies |
| Added to an event, marked booked *(from Stage 2)* | From the event plan |

**How we keep it trustworthy and private** (amended by you, 10 October 2026):
1. **Vendors see anonymous counts, never people.** "212 people saw you in search; 31
   opened your profile", never who. (They do see the people who message them, as part of
   the conversation.) Vendors on a **paid plan** see their counts in a dashboard
   (Stage 5; paid for outside Localites, D-24); others get reports from the Localites team.
2. **When selling to other vendors**, use category-level figures ("face painters on
   Localites averaged 180 profile views a month"), or one vendor's own numbers only with
   that vendor's permission.
3. **Admins see the full detail** (who did what, when), for running the service,
   preparing reports and comparing year over year. Every look is logged. It's never
   sold.
4. **Said plainly in the privacy policy**, and checked in the legal review (PO-07).
5. **No outside trackers** (no Google Analytics or ad pixels). Everything is counted in
   our own database (ADR-023).
6. **Detailed records are never deleted**, so you can run year-over-year numbers. If they
   near the free database limit, older ones move to our free archive storage instead.
   When someone deletes their account, their records stay but the link to them is
   removed (recommended, so the privacy policy can promise deletion of the person; the
   legal review confirms).

**Status:** ✅ Decided, 10 October 2026; amended the same day (paid dashboard, admins see
everything, detail kept for year-over-year numbers).

---

### D-24 — How vendors pay for a paid plan

**Decided (10 October 2026): outside Localites, always.** No payment of any kind goes
through the site or app: not between consumers and vendors (D-16), and not from vendors
to Localites for a paid plan or a featured spot. You arrange and collect those yourself
(for example, an invoice paid by e-Transfer). Localites records only **which plan a vendor
has and its start and end dates**, set by an admin, so the paid dashboard switches on and
off. No prices, invoices, card details or payment status are stored (ADR-018, ADR-025).
A reminder email before a plan ends tells the team when to renew.

**Status:** ✅ Decided, 10 October 2026.

---

### D-25 — Suggest a business

**Decided (10 October 2026).** When someone doesn't see a business they want on
Localites, they can suggest it. We ask three simple questions:
1. **What's the business called?** (required)
2. **Do they have a website or social page?** (optional)
3. **Do you have a phone number or email for them?** (optional)

The suggestion is emailed to supportlocalites@gmail.com. The team vets it and, if it's a
fit, adds the business. Details recommended by us; tell us if you'd change any:
- **Where it appears:** "Don't see who you're looking for? **Suggest a business**" on
  search results, category pages and empty results. We also note which category or
  search the person was on, without asking.
- **The button says "Suggest a business", not "Add a vendor"**, because nothing is added
  until the team vets it, and "Add" already means *Add to event*.
- **Open to everyone from Stage 1**, no account needed, with spam protection. From
  Stage 2, a signed-in person's suggestion is linked to their account and they get an
  email when the business is added.
- **What the person sees afterwards:** *"Thanks. Our team will look into this business
  and add it if it's a fit."* Nothing suggests it's already listed.
- **What gets published:** only the business's own public information, marked unclaimed
  (D-03). A phone number or email someone else typed in is used only to contact the
  business, never shown, because it may be personal.
- **Counted** like every other activity (D-22), so you can see which categories people
  want most.

**Status:** ✅ Decided, 10 October 2026.

---

### D-23 — Approve Stage 1

**What.** Start building Stage 1: the public directory (browse, search, vendor profiles),
vendor accounts and claiming, the admin tools, activity tracking (D-22) and Suggest a
business (D-25), loaded with the test set of businesses (PO-08). Estimate: 5–7 weeks,
plus about three-quarters of a week for tracking and Suggest a business. Details in the
[roadmap](./roadmap.md#stage-1--discovery--vendor-foundation).

**What approval means.** Building starts. On day one we create the free hosting and
database accounts together, live, on your screen (PO-03), registered to
supportlocalites@gmail.com. It doesn't approve any running cost (still $0 apart from the
domain) or any later stage. You'll see real screens through private preview links as
they're built (PO-09).

**Recommendation.** Approve.

**Status:** ✅ Approved, 10 October 2026. Building has started (see G).

---

### D-01 — Product name and web address

**Name: decided.** The product is called **Localites** (your message of 10 October
2026). It replaces the working name, Tallo.

**Web address: decided.** You bought **`localites.ca`** on 10 October 2026. Every vendor
link and invitation will use it.

**Still recommended.** A quick, free search of the Canadian trademarks database for
"Localites", and a mention to your lawyer (PO-07) that an unrelated travel app called
"Localites" exists in some app stores. Neither blocks building.

**Status:** ✅ Decided (name and web address).

---

### D-02 — Favourites in Stage 1 or 2

**No longer needed.** Consumer accounts now arrive with messaging in Stage 2, so
saved vendors come with them. Stage 1 is browse-only for consumers. Tell us if you'd
like favourites earlier.

---

### D-03 — List businesses before they join?

**Why it matters.** A directory with three vendors isn't useful. This is the biggest
factor in whether Stage 1 is useful at launch.

**Options.** A: opt-in only (slow). **B: list from the business's own public information,
clearly marked unclaimed (fast).** C: self-signup only (slowest).

**Recommendation.** B, with conditions:
1. Only what the business itself publishes: name, category, town, link to their
   website or social page. **No copied photos** (their copyright), **no prices**, **no
   "verified" badge**.
2. Marked unclaimed, with "Is this your business?" to claim or ask for removal.
   Removals honoured within two business days.
3. Each business told personally, by phone or an individual email. No bulk email.
4. Not messageable until claimed (D-05).
5. Lawyer review before launch (PO-07).

**Status:** ✅ Decided, 10 October 2026: **a curated list.** We research Orillia-based
businesses in the categories you choose (PO-05) and send you a shortlist with each one's
own website or page, town and public star rating; you pick which go live, starting with
businesses rated 4 stars or more. Conditions 1–5 above still apply; from Stage 2,
unclaimed businesses show an **Inquire** button (D-04). **The star rating is only our filter.** Ratings
and reviews from review sites are never copied or shown on Localites (their terms and
copyright); Localites shows only its own reviews (Stage 3).

---

### D-04 — How consumers contact vendors in Stage 1

Messaging arrives in Stage 2. Until then: **Recommend: show the vendor's own website and
phone on their listing, and count the clicks anonymously**, so we can tell vendors
truthfully how many people reached them through Localites.

**Status:** ✅ Decided, 10 October 2026: **the stages stay as planned.** In Stage 1, the
listing shows the vendor's own website and phone, and taps are counted (D-22). Messaging
arrives in Stage 2: claimed and verified vendors get **Message**; unclaimed or unverified
vendors get **Inquire**: the person (signed in) taps it, can add a note and pick an event,
and the Localites team gets an email at supportlocalites@gmail.com saying which vendor was
requested, by whom, and any details they chose to share. The inquiry is saved, so it appears in reports (D-22). The
person is told honestly that the business isn't on Localites yet and that our team will
contact them; nothing suggests the business has received a message (ADR-024).

---

### D-07 — The one cost: the web address

*(Revision 3: replaces the monthly budget ceiling. Per D-20, Localites runs on free plans
and has no monthly costs. Details in [cost-model.md](./cost-model.md).)*

**What needs deciding.** Whether to pay for the web address (e.g. `localites.ca`), about
CA$15–25 a year.

**Why it matters.**
1. **Email needs it.** The email service only sends to other people from a domain you
   own. Without one, nobody receives sign-in links, message notices, or "How was it?"
   emails.
2. **Links last.** Vendor links shared on Facebook keep working forever. Starting on a
   free address and switching later breaks every link already shared.
3. **Trust.** `localites.ca` reads as a real local business.

**Options.**
| Option | Cost | Effect |
|---|---|---|
| **A. Buy the domain** | ~CA$15–25/year | Everything works |
| B. Free Cloudflare address (`something.pages.dev`) | $0 | The directory works; sign-in and all email don't, until a domain is added |

**Recommendation.** A. It's the only spending in the plan, and email (and therefore
messaging notices and reviews) depends on it.

**Standing rule.** Nothing else that costs money is added without your written
approval. When a free plan approaches its limit, we tell you at 80%, with options.

**Status:** ✅ Decided: A. You bought `localites.ca` on 10 October 2026.

---

### D-08 — How guest invitations are delivered (needed before Stage 4)

**Recommendation.** The consumer shares links through their own phone, WhatsApp,
Facebook or email, with one-tap share buttons. Localites doesn't email guests. Free, and
avoids anti-spam issues.

**Status:** ✅ Decided, 10 October 2026: shared from the host's own phone by text,
WhatsApp, social media, email, or a printable QR code. Localites doesn't send texts or
emails to guests (no cost, no spam risk). Two kinds of link:
- **Personal link** (one per guest): Localites knows exactly who opened it and who
  replied. Best when you want to track everyone.
- **Group link** (one for a group chat, a social post or a QR code on a printed
  invitation): anyone with it can reply and is asked for their name. Localites can't tell
  who in a group chat has *seen* it, but each reply comes with a name, and the host
  matches it to their guest list with one tap. Everyone on the list without a reply shows
  as **No reply yet**, so the host still knows who to chase.

---

### D-09 — Launch area

**Recommendation.** Orillia plus Severn, Oro-Medonte and Ramara, which matches how local
vendors work. The system handles any choice equally.

**Status:** ✅ Decided, 10 October 2026: Orillia plus Severn, Oro-Medonte and Ramara. The
first vendor list is Orillia-based (D-03).

---

### D-10 — Retention defaults (needed before Stage 2)

Approve or amend [E §8](./E-security-and-privacy-model.md#8-retention-and-deletion),
including how conversations are handled when one side deletes their account. Recommend:
approve as written, subject to the lawyer's review.

**Status:** ✅ Decided, 10 October 2026: approved, except **events are kept for as long
as the host's account exists**, so they can look back years later. Kept with the event:
type, date, place, vendors, bookings, guest names and replies. Guest phone numbers and
emails are still erased 90 days after the event, because guests never agreed to
Localites keeping them. Tell us if you'd like those kept too. Detailed activity records
are kept with no deletion date (D-22).

---

### D-11 — Who responds when the live site breaks

**Why it matters.** Development sessions like this one can write, test and fix code when
someone starts one. They can't watch for alerts on their own, take a call, or log in to
your hosting accounts. Once consumers and vendors depend on messaging, an outage
matters more than it does for a directory.

**Options.**
| Option | Cost | Response |
|---|---|---|
| **A. Alerts go to you by email; you start a session to diagnose and fix** | $0 | As soon as you see the alert |
| B. As A, plus a retained developer for serious incidents | A retainer | Hours, any time |

**Recommendation.** A, in keeping with no running costs (D-20). Alerts arrive as
plain-English emails saying what's wrong. The runbook will include a one-paragraph
"what to paste into a new session" note for each kind of alert. Revisit B only if
outages start to matter to users.

**Status:** ✅ Decided, 10 October 2026: option A. Alerts, and every other email meant for
the Localites team, go to **supportlocalites@gmail.com**, which is also the admin address
for every service account (PO-03).

---

### D-12 — Business details (needed before launch)

Legal name, address, and privacy contact for the privacy policy and terms. Needed for
PO-07.

**Status:** ✅ Decided for now, 10 October 2026: the business is named **Localites**, and
the privacy contact is **supportlocalites@gmail.com**. The mailing address is left blank
and **must be added before public launch**; it stays in the "Needed from you" list until
then.

---

## Actions

You own every root account. The engineering team is invited as members. **You never
share a password, key, or code with anyone, including us.**

> **About the step-by-step instructions.** Website menus change. Labels below are the
> best known as of this writing, and we'll check them against the live sites with you
> on the day. If what you see doesn't match, stop and tell us what you see.

### PO-01 — Reply with your decisions
**When:** Now. **Steps:** Reply with your choices on the "Needed from you now" table.

### PO-02 — Secure your own accounts
**Handled by you** (10 October 2026). You keep your passwords in a place of your
choosing. The only rules we ask for: two-step login on GitHub, your email and every
service account, and never sending passwords, codes or recovery codes to anyone,
including us.

### PO-03 — Create hosting and database accounts
**When:** **Now** (Stage 1 approved). Parts 1 and 2 now; part 3 when we tell you the
first version is ready.
**Cost:** $0. No payment method is needed. If a screen asks for a card or pushes a paid
plan, choose the free option, or stop and tell us what you see.
**Before you start:** sign in to supportlocalites@gmail.com and have your password store open.
Every account uses **supportlocalites@gmail.com**, never a personal address. Turn on
two-step login wherever it's offered.

**Part 1: Supabase (the database)**
1. Go to **supabase.com** and choose **Sign up** (or *Start your project*). Sign up with
   the email supportlocalites@gmail.com, not "Continue with GitHub", so the account
   belongs to the Localites address. Confirm the email Supabase sends you.
2. If asked to create an organization: name it **Localites** and choose the **Free**
   plan.
3. Create a new project:
   - **Name:** `localites-test`
   - **Database password:** click **Generate**, then save it with your passwords as
     "Supabase localites-test database password". **Don't send it to us.**
   - **Region:** **Canada (Central)**. If there's no Canada option, stop and tell us.
   - Click **Create**. It takes a few minutes.
4. Don't create the second project ("localites") yet; that comes before launch.

*Expected:* a dashboard for `localites-test`. *If a screen looks different from this,
tell us what it says; these sites change their wording often.*

**Part 2: Cloudflare (the hosting)**
5. Go to **dash.cloudflare.com** and choose **Sign up**, with supportlocalites@gmail.com.
   Confirm the email. If asked for a plan, choose **Free**. Skip adding a website or
   domain for now.

*Expected:* you can see the Cloudflare dashboard.

**Parts 1 and 2: ✅ done (10 October 2026).**

**Part 3: Connect them (about 30 minutes).** Wording on these sites changes often; if a
screen doesn't match, tell us what it says. **Never paste a password or connection
address into chat or email**; they go only into the boxes named below. A "private note"
means a note on your own computer that you delete straight after.

*A. Give GitHub the test database's admin address*
1. In Supabase, open **localites-test** and click **Connect** at the top.
2. Choose the **Session pooler** connection string (it contains `pooler.supabase.com`
   and ends in `:5432/postgres`). Copy it into a private note.
3. In the note, replace `[YOUR-PASSWORD]` (including the square brackets) with the
   database password you saved in part 1.
4. On GitHub, open **supportlocalites/localites** → **Settings** → **Secrets and
   variables** → **Actions** → **New repository secret**. Name:
   `SUPABASE_TEST_ADMIN_URL`. Secret: paste the edited text. Click **Add secret**, then
   delete the note.

*B. Let GitHub set up the test database*
5. On GitHub, open the **Actions** tab, click the newest **CI** run, and choose
   **Re-run all jobs**. In about five minutes both jobs should show green ticks. The
   second, **Update the test database**, creates the tables and loads six fake
   "Test Vendor" businesses. If anything is red, tell us; GitHub hides secrets in its
   logs, so the logs are safe to look at.

*C. Give the app its own password*
6. Create a new password of about 32 characters using **letters and numbers only** (no
   symbols, because it goes inside a web address). Save it with your passwords as
   "Supabase localites-test app_server password".
7. In Supabase, open **SQL Editor** → **New query** and paste
   `alter role app_server login password 'PASTE-HERE';`, replacing `PASTE-HERE` with
   that password (keep the quote marks). Click **Run**; expect "Success. No rows
   returned".
8. Delete that query from the SQL Editor's list (its **⋯** menu → **Delete**), so the
   password isn't kept there.

*D. Connect Cloudflare to GitHub*
9. In Cloudflare, open **Workers & Pages** (it may sit under **Compute**) → **Create** →
   **Import a repository**. When asked, allow Cloudflare's GitHub app on the
   **supportlocalites** account, for **only** the `localites` repository.
10. Use these settings exactly:
    - **Project name:** `localites`
    - **Build command:** `npx opennextjs-cloudflare build`
    - **Deploy command:** `npx opennextjs-cloudflare deploy`
    - If it asks for a command for other branches: `npx opennextjs-cloudflare upload`
11. Click **Create and deploy**. This first build may fail, because Cloudflare starts
    from the `main` branch, which doesn't hold the website yet. That's expected.
11a. Point Cloudflare at the branch that holds the website: open the **localites**
    Worker → **Settings** → **Build** → **Branch control** → **Production branch** →
    choose `claude/event-discovery-architecture-dz0qgf` → **Save**. (We'll switch to
    `main` before launch.) Tell us, and we'll send a small update that starts a fresh
    build from that branch.

*E. Give the site its database address*
12. Back in Supabase **Connect**, copy the **Transaction pooler** string (it ends in
    `:6543/postgres`) into a private note, and make two changes:
    - The user name right after `postgresql://` looks like `postgres.abcdefghijk`.
      Change only the word `postgres` at its start to `app_server`, keeping the dot and
      the letters after it.
    - Replace `[YOUR-PASSWORD]` with the app_server password from step 6.
13. In Cloudflare, open the **localites** Worker → **Settings** → **Variables and
    Secrets** → **Add**. Type: **Secret**. Name: `DATABASE_URL`. Value: paste. Save and
    deploy, then delete the note.
14. Open the address Cloudflare shows for the Worker (it ends in `.workers.dev`) and tap
    **Browse local**. You should see six "Test Vendor" businesses.

**Done when:** you reply *"PO-03 done"* with the `.workers.dev` address (an address,
not a secret). We then run the speed half of the fit test (ADR-005) and check
Cloudflare's numbers with you.

**On Cloudflare's terms (ADR-007):** as far as we know, Cloudflare's free plan doesn't
restrict business use (unlike Vercel's). We can't open Cloudflare's site from our side,
so the lawyer's review (PO-07) should confirm it.

### PO-04 — Register the domain
**✅ Done.** You bought `localites.ca` on 10 October 2026. Three things to check in your
domain company's account (the registrar), today:
1. **Two-step login is on** for that account, and its password is stored safely
   (PO-02). The domain is valuable: whoever controls this account controls the address.
2. **Auto-renew is on**, with a card that won't expire soon, so the address can't lapse.
3. **Privacy is on** for your contact details. For `.ca` addresses owned by an
   individual this is usually automatic; check that your home address isn't shown.

Later, when we create the hosting accounts (PO-03), we'll point the domain at Cloudflare
together, live, from your screen. **Never send the registrar password to anyone, including
us.**

### PO-05 — Choose the starting categories
**Status:** ✅ Done, 10 October 2026. Your six categories, with what we've put in each:
- **Venue:** party rooms, halls, indoor play, bowling and activity centres, event spaces
- **Food & Beverage:** caterers, food trucks, party trays, mobile bars
- **Sweets:** custom cakes, cupcakes, cookies, chocolates, dessert tables, ice cream
- **Rentals & Decor:** tents, tables and chairs, bouncy castles, balloons, decor, photo
  booths
- **Activities:** entertainers (face painters, magicians, balloon twisters, characters,
  DJs, animal shows) and activities (crafts, science, sports). There's no separate
  "Entertainment" category; tell us if you'd like one.
- **Photography:** photographers and videographers

### PO-06 — Alert email address
**When:** Just before launch. Alerts go to supportlocalites@gmail.com (D-11); we'll send a
test alert there and you confirm it arrived.

### PO-07 — Legal review
**When:** Before public launch. **Start looking now.**
**Scope:** privacy policy; terms of use (especially that **Localites is not a party to
arrangements or payments between consumers and vendors**); review policy and how vendor
flags are handled; the unclaimed-listing approach (D-03); emails we send (CASL);
retention (D-10), including **keeping detailed activity records with no deletion date**
(D-22), which the lawyer should specifically check; and the business name (D-12): if
"Localites" isn't yet a registered business name, ask whether it needs registering in
Ontario before launch. We'll prepare drafts and a one-page summary so the lawyer reviews
rather than discovers. Ask for a fixed-fee quote. Not in the infrastructure budget.

### PO-08 — Starting vendor list, and early claims
**When:** Stage 1, weeks 1–4.
**What:** We research Orillia-based businesses in your categories (PO-05, D-03) and send
you a shortlist; you pick which go live. **Test set (your decision, 10 October 2026):**
the 28 businesses we suggested, up to 5 per category, are used to test the app before
launch. You'll refresh the vendor list later. Five isn't a limit in the app; more can be
added at any time, including from Suggest a business (D-25). First research done: 61 Orillia businesses and 17 nearby, in
[launch/vendor-research-2026-10-10.md](./launch/vendor-research-2026-10-10.md), with 28
in the test set (5 per category; 3 in Activities, two of them just outside Orillia but
inside the launch area). Add any you know personally. **New in revision 2:** during Stage 1,
we'd like as many of them as possible to *claim* their listing, because only claimed
businesses can receive messages when Stage 2 launches. We'll give you a short script
for those calls and a claim link for each business.

### PO-09 — Review prototypes
**Partly done.** The design mockups were reviewed on the canvas, and direction G was chosen
(D-21).
**Still to come, now that D-00 is approved:** the real screens from the build, on your own phone and
computer through private preview links. You tell us what feels right. No code to read.

---

## Completed

| Date | Item |
|---|---|
| 2026-10-09 | D-15 to D-19 decided (see top of this document) |
| 2026-10-10 | D-01: the product is called Localites, at `localites.ca` |
| 2026-10-10 | D-07 and PO-04: domain bought |
| 2026-10-10 | D-21: design direction G, for phones and computers |
| 2026-10-10 | D-00: architecture approved |
| 2026-10-10 | D-03, D-04 (settling D-05), D-09, D-11 decided; D-22 activity tracking; stages unchanged |
| 2026-10-10 | PO-05 categories; D-13, D-06, D-14, D-08, D-10 decided; D-12 privacy contact; D-22 amended |
| 2026-10-10 | D-24 (no payments of any kind through Localites); D-12 business name; PO-08 pilot of 5 per category |
| 2026-10-10 | D-25 Suggest a business |
| 2026-10-10 | D-23: Stage 1 approved; building started |
| 2026-10-10 | PO-08: test set of our 28 suggested businesses (up to 5 per category); vendor list to be refreshed later |
