# H — Product Owner Action Register

**Last updated:** 2026-10-09 (revision 2)

This is the one place where everything that needs **you** is listed. If it isn't here,
you don't need to do it.

- **Decisions** (D-xx): choices only you can make, each with options and a
  recommendation.
- **Actions** (PO-xx): things you need to do, with step-by-step instructions.

---

## Already decided by you

Recorded from your message of 9 October 2026. These now shape every document.

| # | Decision | Effect |
|---|---|---|
| ✅ D-15 | **Two users: consumers and vendors.** The relationship between them is the core of the product. | New [roles-and-relationships.md](./roles-and-relationships.md); data model rebuilt around it. |
| ✅ D-16 | **No payments. Tallo doesn't handle cash and never says or implies it does.** | ADR-018. No payment features or fields anywhere. Language rules in [A §6](./A-product-blueprint.md#6-language-rules). |
| ✅ D-17 | **Tallo is the digital handshake.** Consumers and vendors talk directly and plan together, and can share files (an invoice is just a file). | Messaging with files is the centre of Stage 2 (ADR-019, ADR-020). Quotes, vendor-confirmed bookings and agreements removed. |
| ✅ D-18 | **"Add to event" and "Booked" are the consumer's tools.** | ADR-021. Only the consumer can set them (database-enforced). |
| ✅ D-19 | **After the event, ask the consumer for feedback; that feeds reviews and ratings.** | Stage 3: feedback requests → reviews → ratings. |
| ✅ D-20 | **No running costs.** Every service runs on a free plan. | [cost-model.md](./cost-model.md) revision 3. Supabase, email, error alerts and backups on free plans; hosting moved from Vercel to Cloudflare's free plan (ADR-007). Only the web address remains (D-07). |

---

## Needed from you now

| # | What | Blocks | Your effort |
|---|---|---|---|
| **D-00** | Approve the revised architecture (separately from Stage 1) | Everything | Read the blueprint page; reply |
| **D-13** | Approve the consumer–vendor rules | Stage 2 design | 10 min |
| **D-05** | Messaging businesses that haven't joined Tallo | Stage 2 design | 2 min |
| **D-06** | Who may leave a review | Stage 3 design | 5 min |
| **D-14** | After the handshake: reviews first, or guest RSVPs first? | Roadmap | 2 min |
| **D-01** | Product name and web address | Stage 1 launch | 10 min |
| **D-03** | List businesses before they join? | Stage 1 content | 15 min + lawyer |
| **D-04** | How consumers contact vendors in Stage 1 | Stage 1 build | 2 min |
| **D-07** | The one cost: the web address (~CA$15–25/year) | Email, launch | 2 min |
| **D-09** | Launch area | Stage 1 content | 2 min |
| **D-11** | Who responds when the live site breaks | Stage 1 launch | 10 min |

**How to respond:** reply in the conversation with decision numbers and your choice,
e.g. *"D-13 approve. D-06 recommended. D-07 yes to the domain."* "I don't understand
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

**Status:** ⏳ Awaiting you.

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
| R6 | Tallo staff don't read conversations unless one side reports it | ✅ Yes |
| R7 | Either side can block the other | ✅ Yes |
| R8 | One account per person; a person can be both a consumer and on a vendor's team, and switches between "My events" and "My business" | ✅ Yes |

**The rule most worth your attention is R3.** Telling a vendor when they're marked
booked is good for vendors (it's real evidence Tallo works for them) and protects
reviews (they can flag fakes). The cost: a consumer's name and event date are shared
with that vendor. We'd tell the consumer this clearly when they tap "Mark as booked".
The alternative is to keep "booked" completely private, which removes the flagging
protection.

**Status:** ⏳ Awaiting you.

---

### D-05 — Messaging businesses that haven't joined Tallo

*(Replaces the earlier concierge proposal.)*

**What.** Many listings at launch will be businesses that haven't claimed their profile
(D-03). A consumer taps "Message". What happens?

**Options.**
| Option | Consumer experience | Your workload | Honesty |
|---|---|---|---|
| **A. Not messageable; show their own contact details; "Let them know you're interested"** | Calls or visits their website directly. Gets an email if the business joins later. | You (or someone) contact interested businesses to invite them. Light. | Clean: we never hold a message we can't deliver |
| B. Concierge relay: Tallo staff pass messages back and forth by phone/email | Feels like messaging, but slow and indirect | Heavy: you'd relay every message | Risky: easy to imply delivery that hasn't happened |

**Recommendation.** A. Your clarification puts the consumer and vendor talking
*directly* at the centre, which a relay can't provide. Interest from real consumers is
also the most persuasive, truthful reason for a business to claim its listing: *"Three
parents tried to message you on Tallo this month."*

**Status:** ⏳ Awaiting you.

---

### D-06 — Who may leave a review

**What.** "Booked" is the consumer's own word. What else must be true before they can
review?

**Options.**
| Option | Rule | Review volume | Credibility |
|---|---|---|---|
| **A. Booked + event passed + talked on Tallo (vendor replied) + not flagged** | Strict | Lower early on | High: both sides took part on Tallo |
| B. Booked + event passed + not flagged | Looser | Higher | Medium: a consumer could review a business they only phoned. Such reviews would be labelled "Planned outside Tallo". |

Both options: one review per booking; checked by the platform team before publishing;
vendor gets one public reply; average shown only from three reviews; 60-day window.

**Recommendation.** A. It matches your original preference for reviews tied to
interactions the platform recorded, and it can't be gamed by marking a random business
"booked". Relaxing to B later is easy. Tightening after unverifiable reviews are public
is not.

**Status:** ⏳ Awaiting you. Needed before Stage 3, but it shapes Stage 2's design, so
earlier is better.

---

### D-14 — Order after the handshake

**What.** After Stage 2, which comes first: **feedback & reviews**, or **guest
invitations & RSVPs**?

**Recommendation.** Reviews first (Stage 3, 2–3 weeks), then RSVPs (Stage 4, 3–4
weeks). Reviews complete the consumer–vendor loop you described, and the timing works:
the first events booked through Tallo will be happening by the time reviews ship.
Parents already have workable RSVP tools (Evite, group chats); nobody else has
reviews tied to real local bookings. No feedback is lost in the meantime: bookings are
recorded from Stage 2, and Stage 3 asks about any event in the previous 60 days.

**Status:** ⏳ Awaiting you.

---

### D-01 — Product name and web address

**Why it matters.** The domain appears in every shared vendor link and invitation.
Changing it breaks links already in group chats.

**Recommendation.** A `.ca` domain under the product name (not a town name, which
becomes wrong when you expand). Requires Canadian presence, which you have.

**Status:** ⏳ Awaiting you. Then PO-04.

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

**Status:** ⏳ Awaiting you.

---

### D-04 — How consumers contact vendors in Stage 1

Messaging arrives in Stage 2. Until then: **Recommend: show the vendor's own website and
phone on their listing, and count the clicks anonymously**, so we can tell vendors
truthfully how many people reached them through Tallo.

**Status:** ⏳ Awaiting you.

---

### D-07 — The one cost: the web address

*(Revision 3: replaces the monthly budget ceiling. Per D-20, Tallo runs on free plans
and has no monthly costs. Details in [cost-model.md](./cost-model.md).)*

**What needs deciding.** Whether to pay for the web address (e.g. `tallo.ca`), about
CA$15–25 a year.

**Why it matters.**
1. **Email needs it.** The email service only sends to other people from a domain you
   own. Without one, nobody receives sign-in links, message notices, or "How was it?"
   emails.
2. **Links last.** Vendor links shared on Facebook keep working forever. Starting on a
   free address and switching later breaks every link already shared.
3. **Trust.** `tallo.ca` reads as a real local business.

**Options.**
| Option | Cost | Effect |
|---|---|---|
| **A. Buy the domain** | ~CA$15–25/year | Everything works |
| B. Free Cloudflare address (`something.pages.dev`) | $0 | The directory works; sign-in and all email don't, until a domain is added |

**Recommendation.** A. It's the only spending in the plan, and email (and therefore
messaging notices and reviews) depends on it.

**Standing rule.** Nothing else that costs money is added without your written
approval. When a free plan approaches its limit, we tell you at 80%, with options.

**Status:** ⏳ Awaiting you.

---

### D-08 — How guest invitations are delivered (needed before Stage 4)

**Recommendation.** The consumer shares links through their own phone, WhatsApp,
Facebook or email, with one-tap share buttons. Tallo doesn't email guests. Free, and
avoids anti-spam issues.

**Status:** Not needed yet.

---

### D-09 — Launch area

**Recommendation.** Orillia plus Severn, Oro-Medonte and Ramara, which matches how local
vendors work. The system handles any choice equally.

**Status:** ⏳ Awaiting you.

---

### D-10 — Retention defaults (needed before Stage 2)

Approve or amend [E §8](./E-security-and-privacy-model.md#8-retention-and-deletion),
including how conversations are handled when one side deletes their account. Recommend:
approve as written, subject to the lawyer's review.

**Status:** Not needed yet.

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

**Status:** ⏳ Awaiting you.

---

### D-12 — Business details (needed before launch)

Legal name, address, and privacy contact for the privacy policy and terms. Needed for
PO-07.

**Status:** Not needed yet.

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
**When:** Now. Good practice regardless.
1. Install a password manager. **Recommended: Bitwarden** (free). Go to
   **bitwarden.com** → **Get started** → create an account with a long master password
   you've never used elsewhere; write it down somewhere physical and safe.
   *Expected:* you can log in to the web vault. *If not:* check email for a verification
   link.
2. Install the browser extension and phone app when prompted.
3. In Bitwarden: **Settings → Security → Two-step login**. Use an authenticator app.
   Save the **recovery code** on paper.
4. GitHub: **github.com** → profile picture (top right) → **Settings** → **Password and
   authentication** → **Enable two-factor authentication**. Save recovery codes into
   Bitwarden. *Expected:* "Two-factor authentication is enabled."
5. Do the same for the email account you use for GitHub.

**Done when:** you tell us "2FA is on for GitHub and my email." Never send recovery
codes or screenshots of them.

### PO-03 — Create hosting and database accounts
**When:** **Not yet.** After Stage 1 is approved. We'll do it together, live.
**Cost:** $0. Every account below is on a free plan, and none needs a payment method
for what we use.
**Summary:**
1. **Supabase** (you've used it before): create two free projects, "tallo" and
   "tallo-test", in the Canada region.
2. **Cloudflare**: create a free account and connect it to the `Tallo` GitHub
   repository, so every change we push is built automatically. Before connecting, we
   read Cloudflare's terms together to confirm business use is allowed on the free plan
   (ADR-007).
3. **Connect them**: copy the database connection details from Supabase's dashboard
   into Cloudflare's encrypted settings, from one screen to the other. They never go
   into chat or email.
4. **Resend** (email) and **Sentry** (error alerts): free accounts, after the domain is
   registered (PO-04).

Full step-by-step instructions, checked against the live sites, will be added here at
that point.

### PO-04 — Register the domain
**When:** After D-01. Earlier is safer. **Cost:** ~CA$15–25/year. Verified instructions
for a recommended registrar will be added once D-01 is decided.

### PO-05 — Confirm the starting category list
**When:** Stage 1, week 1. We send a proposed list; you mark it up from local knowledge.

### PO-06 — Alert email address
**When:** Just before launch. Confirm where alerts go; you'll receive a test alert.

### PO-07 — Legal review
**When:** Before public launch. **Start looking now.**
**Scope:** privacy policy; terms of use (especially that **Tallo is not a party to
arrangements or payments between consumers and vendors**); review policy and how vendor
flags are handled; the unclaimed-listing approach (D-03); emails we send (CASL);
retention (D-10). We'll prepare drafts and a one-page summary so the lawyer reviews
rather than discovers. Ask for a fixed-fee quote. Not in the infrastructure budget.

### PO-08 — Starting vendor list, and early claims
**When:** Stage 1, weeks 1–4.
**What:** A spreadsheet of 30–50 local businesses to list at launch (name, website or
Facebook, category); we'll send a template. **New in revision 2:** during Stage 1,
we'd like as many of them as possible to *claim* their listing, because only claimed
businesses can receive messages when Stage 2 launches. We'll give you a short script
for those calls and a claim link for each business.

### PO-09 — Review prototypes
**When:** After D-00.
**What:** Clickable screens on your phone: home, search, vendor profile, a
**conversation** (as the consumer and as the vendor), and an **event plan with "Mark as
booked"**. You tell us what feels right. No code to read.

---

## Completed

| Date | Item |
|---|---|
| 2026-10-09 | D-15 to D-19 decided (see top of this document) |
