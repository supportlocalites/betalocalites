# H — Product Owner Action Register

**Last updated:** 2026-10-09

This is the one place where everything that needs **you** is listed. If it isn't here,
you don't need to do it. Nothing that needs you will be buried in another document.

- **Decisions** (D-xx) — choices only you can make. Each has options and a
  recommendation.
- **Actions** (PO-xx) — things you need to do, with step-by-step instructions.

---

## Right now: what's needed from you

| # | What | Type | Blocks | Effort for you |
|---|---|---|---|---|
| **D-00** | Approve the architecture (separately from Stage 1) | Decision | Everything | Read the summary, reply yes / no / questions |
| **D-01** | Product name and web address | Decision | Stage 1 launch | 10 min |
| **D-02** | Stage 1 scope: favourites in Stage 1 or Stage 2? | Decision | Stage 1 build | 2 min |
| **D-03** | Unclaimed listings: publish from public info, and how to approach businesses | Decision | Stage 1 content | 15 min + lawyer (PO-07) |
| **D-04** | How organizers contact vendors before inquiries exist | Decision | Stage 1 build | 2 min |
| **D-07** | Monthly infrastructure budget ceiling | Decision | Stage 1 launch | 2 min |
| **D-09** | Launch geography | Decision | Stage 1 content | 2 min |
| **D-11** | Who is on call when production breaks | Decision | Stage 1 launch | 10 min |
| **PO-01** | Reply with your decisions on the above | Action | Stage 1 | — |

Everything else below is needed later and is listed so you can see it coming.

**How to respond:** reply in this conversation with the decision numbers and your
choice, e.g. *"D-02: recommended. D-03: option B. D-07: approve $75."* Questions are
welcome; "I don't understand this one" is a perfectly good answer and we'll explain it
differently.

---

## Decisions

### D-00 — Approve the architecture

**What needs deciding.** Whether the overall technical direction is approved: one
application, one PostgreSQL database as the single source of truth, the data model in
[B](./B-domain-and-data-model.md), the security model in
[E](./E-security-and-privacy-model.md), and the staged roadmap.

**Why it matters.** Everything after this builds on it. Changing direction now costs
a few days of documents. Changing it after Stage 1 costs weeks.

**What approval means — and doesn't.** Approving the architecture means you agree with
the direction. It does **not** approve Stage 1 spending, any recurring cost, any future
feature, or any third-party service. Those come to you separately, as you recommended.

**Recommendation.** Approve, with Stage 1 approved as a separate decision once you've
reviewed the Stage 1 scope in [roadmap.md](./roadmap.md) and the screen prototypes.

**Status:** ⏳ Awaiting you.

---

### D-01 — Product name and web address

**What needs deciding.** Is "Tallo" the public product name, and which domain do we
use?

**Why it matters.** The domain appears in every invitation link and every vendor's
shared listing URL. Changing it after launch breaks links already in people's group
chats.

**Options.**
| Option | Pros | Cons |
|---|---|---|
| **A. A `.ca` domain** (e.g. `tallo.ca`, if available) | Signals local and Canadian. Requires a Canadian presence to register, which you have. | Must check availability. |
| B. A `.com` domain | Familiar worldwide | Less local signal; short `.com` names are rarely available |
| C. A town-specific name (e.g. something Orillia-branded) | Very local | Becomes wrong the day we expand to Barrie |

**Recommendation.** A — a `.ca` domain under the product name, not a town name.

**What you'll need to do.** PO-04, once decided.

**Status:** ⏳ Awaiting you.

---

### D-02 — Favourites: Stage 1 or Stage 2?

**What needs deciding.** Whether organizers can create accounts and save favourite
vendors in Stage 1, or whether that waits for Stage 2.

**Options.**
| Option | User experience | Cost | Risk |
|---|---|---|---|
| A. Favourites in Stage 1 | Parents can save vendors while browsing | ~1 extra week | Asks parents to sign up before there's much reason to |
| **B. Favourites in Stage 2** | Stage 1 is pure browsing, no sign-up for parents at all | Saves ~1 week | None significant |

**Recommendation.** B. Stage 1's job is to be the frictionless local directory. In
Stage 2, a parent's natural reason to sign up is creating an event, and "save this
vendor" becomes "add to my event's shortlist" — a more useful version of the same
thing. The `saved_vendor` table is designed now either way. Vendor and admin accounts
are still in Stage 1, because claiming and managing listings needs them.

**Status:** ⏳ Awaiting you.

---

### D-03 — Unclaimed listings

**What needs deciding.** A directory with three vendors in it is not useful. To have
enough listings at launch, do we create listings for local businesses that haven't
signed up yet, using information they've published themselves?

**Why it matters.** This is the single biggest factor in whether Stage 1 is useful at
launch. It also has legal and reputational dimensions in a small town where business
owners talk to each other.

**Options.**
| Option | Listings at launch | Risk |
|---|---|---|
| A. Opt-in only: we list a business only after they say yes | Slow — depends on how many you can reach | Lowest |
| **B. Public-info listings, clearly marked "unclaimed", with easy claim or removal** | Fast | Low if done carefully (see conditions) |
| C. Vendor self-signup only | Slowest | Lowest, but the directory may stay empty |

**Recommendation.** B, with these conditions:
1. We list only what the business itself publishes: name, category, town, and a link
   to their own website or social page. **No photos copied from their site** (that's
   their copyright), **no prices**, **no "verified" badge**.
2. Every unclaimed listing says so plainly, with a "Is this your business?" link to
   claim it or ask for removal. Removal requests are honoured within two business days,
   no questions asked.
3. We let each business know they've been listed, by phone or an individual email to
   a business address they publish. No bulk email.
4. A lawyer reviews this approach before public launch (PO-07). Canada's anti-spam law
   (CASL) affects how we may contact businesses by email; the lawyer should confirm
   the contact approach.

**What you'll need to do.** Choose, and if B, provide a starting list (PO-08).

**Status:** ⏳ Awaiting you.

---

### D-04 — How organizers contact vendors in Stage 1

**What needs deciding.** Inquiries through Tallo arrive in Stage 3. Until then, how
does a parent who finds a vendor actually reach them?

**Options.**
| Option | User experience | What we learn |
|---|---|---|
| **A. Show the vendor's own website/phone/email on their listing** | Useful immediately | We count clicks on "Visit website" / "Call" (no personal data) so we can show vendors they're getting exposure |
| B. No contact until Stage 3 | Frustrating: a directory you can't act on | Nothing |

**Recommendation.** A, including counting contact clicks. This is the only evidence
we'll have for the vendor value proposition before Stage 3, and it's the honest kind:
"14 people clicked through to your website this month" is a true statement we can
make; "you got 14 leads" is not.

**Status:** ⏳ Awaiting you.

---

### D-05 — Who runs the concierge queue (needed before Stage 3)

**What needs deciding.** Inquiries to unclaimed vendors are handled by a person who
contacts the vendor on the organizer's behalf and records what happened. Who?

**Options.** You, initially / a part-time contractor / a partner business.

**Recommendation.** You, initially, for the first few months. The queue volume will be
small, and you'll learn more about what vendors and parents need from it than from any
report. We'll build the queue to make this take minutes a day, not hours.

**Status:** Not needed yet.

---

### D-06 — Review policy (needed before Stage 4)

**Recommendation.** Only someone with a booking recorded on Tallo, marked completed,
may review that vendor, within 60 days of the event. Reviews are moderated before
publishing against a written policy. Vendors may post one public reply. The database
design already enforces "no review without a recorded booking"
([B §4.4](./B-domain-and-data-model.md#44-engagement--commerce-domain--s3-inquiries-s4d-the-rest)).

**Status:** Not needed yet.

---

### D-07 — Monthly infrastructure budget ceiling

**What needs deciding.** The most we may spend per month on hosting and services
without coming back to you.

**Expected costs** (details and sources in [cost-model.md](./cost-model.md); all USD):
| Period | Expected |
|---|---|
| Building, before launch | $0 – $25 |
| After public launch | about $45 – $70 |

**Recommendation.** Approve a ceiling of **US$75/month** through the end of Stage 2.
Anything that would exceed it, or any new service with a recurring cost, comes back
to you first. We'll set spending caps inside the providers where they're available so
the ceiling is enforced, not just promised.

**Status:** ⏳ Awaiting you.

---

### D-08 — How invitations are delivered (needed before Stage 2)

**Recommendation.** The host copies their invitation link, or individual guest links,
and sends them through their own phone, WhatsApp, Facebook, or email. We provide
one-tap share buttons. Tallo does not send invitation emails or texts itself in Stage
2. This costs nothing, avoids anti-spam law exposure, and matches how parents already
invite people. Sending from Tallo can be added later once a notification service is
approved.

**Status:** Not needed yet.

---

### D-09 — Launch geography

**What needs deciding.** Which towns are included at launch.

**Options.**
| Option | Effect |
|---|---|
| A. City of Orillia only | Thinnest vendor pool |
| **B. Orillia plus the surrounding townships it serves (Severn, Oro-Medonte, Ramara)** | Matches how local vendors actually operate; denser directory |
| C. All of Simcoe County | Too broad to curate well at launch |

**Recommendation.** B. The data model handles any of these equally; this is purely a
business choice about where you can curate quality listings.

**Status:** ⏳ Awaiting you.

---

### D-10 — Data retention defaults (needed before Stage 2)

Approve, amend, or reject the retention table in
[E §7](./E-security-and-privacy-model.md#7-retention-and-deletion). Recommended: approve
as written, subject to the lawyer's review (PO-07).

**Status:** Not needed yet.

---

### D-11 — Who responds when production breaks

**What needs deciding.** When the live site has a problem at 9pm on a Saturday, who is
alerted, and who fixes it?

**Why it matters.** The engineering work in this project is being done through
AI-assisted development sessions like this one. Those sessions can write, test, and
ship code and diagnose problems when someone starts one. They **cannot** watch for
alerts on their own, receive a phone call, or log in to your hosting accounts. Someone
has to be reachable and able to start that work.

**Options.**
| Option | Response time | Cost |
|---|---|---|
| A. You receive alerts and start a session to diagnose and fix | Depends on your availability | None |
| **B. You receive alerts; a retained freelance developer is on call for serious incidents** | Hours | Retainer, to be quoted |
| C. Accept best-effort response until usage justifies more | Varies | None |

**Recommendation.** C until public launch, then B. Before launch there are no users to
affect. After launch, a calm local product can tolerate a few hours of downtime, but
not days. Alerts will be set up to email you plain-English summaries (PO-06).

**Status:** ⏳ Awaiting you.

---

### D-12 — Business details (needed before launch)

The legal name, address, and contact email that appear in the privacy policy and
terms, and who is responsible for privacy requests. Needed for PO-07.

**Status:** Not needed yet.

---

## Actions

Every account action below follows one principle: **you own the root accounts**. The
engineering team is invited as members. You never share a password, key, or code with
anyone, including us. Production secrets are stored inside the hosting services
themselves, so they never pass through chat, email, or documents.

> **About the step-by-step instructions below.** Website menus change. The labels below
> are the best known as of this writing, and we'll check them against the live sites
> with you on the day you do each step. If what you see doesn't match, stop and tell us
> what you see — that's expected sometimes, not a mistake on your part.

---

### PO-01 — Reply with your decisions

**When:** Now.
**Steps:** Reply in this conversation with your choices on D-00, D-01, D-02, D-03,
D-04, D-07, D-09, D-11.
**Done when:** Each shows ✅ in the table at the top of this document.

---

### PO-02 — Secure your own accounts

**When:** Now. It's good practice regardless of this project.
**Why:** You'll own the root accounts for the platform. If your email or GitHub account
is compromised, so is the platform.

**Steps:**
1. Install a password manager. **Recommended: Bitwarden** (free for individuals). Go to
   **bitwarden.com**, click **Get started**, and create an account. Choose a long master
   password you've never used elsewhere and write it down somewhere physical and safe.
   - *Expected result:* you can log in to the Bitwarden web vault.
   - *If not:* check your email for a verification link.
2. Install the Bitwarden browser extension when prompted, and the phone app.
3. Turn on two-step login in Bitwarden: **Settings → Security → Two-step login**. Use an
   authenticator app (e.g. Google Authenticator, Microsoft Authenticator, or Authy).
   Save the **recovery code** it shows you — print it or write it down.
4. Turn on two-factor authentication for **GitHub**: go to **github.com**, click your
   profile picture (top right) → **Settings** → **Password and authentication** →
   **Enable two-factor authentication**. Follow the prompts with your authenticator app.
   Save the recovery codes into Bitwarden.
   - *Expected result:* GitHub shows "Two-factor authentication is enabled".
5. Do the same for the email account you use for GitHub.

**Done when:** You can tell us "2FA is on for GitHub and my email." Don't send screenshots
of recovery codes.

---

### PO-03 — Create hosting and database accounts

**When:** **Not yet.** After you approve Stage 1. We'll do this together, live.

**What you'll do (summary):**
1. **Vercel** (hosting): sign up with your GitHub account, choose the plan for
   commercial projects (Pro), set a spending cap, and connect the `tallo` GitHub
   repository. After this, every change we push automatically gets its own private
   preview link that you can open on your phone to review.
2. **Supabase** (database): sign up with your GitHub account, create an organisation,
   and invite the engineering team. We create the actual database project, in the
   Canada (Central) region (ADR-014), so you don't have to make technical choices.
3. **Connect them**: install the Supabase integration inside Vercel, which copies the
   database connection settings into Vercel securely. No one has to copy a secret by
   hand.

Full step-by-step instructions, verified against the live sites, will be added here
when Stage 1 is approved.

**Why this is safe:** the engineering sessions never receive production passwords.
Code goes to GitHub; Vercel picks it up from there. Database changes run through an
automated, reviewed process that uses a secret stored inside GitHub's encrypted
settings.

---

### PO-04 — Register the domain

**When:** After D-01 is decided. Can be done any time before launch; earlier is safer
because good names get taken.
**Cost:** typically around CA$15–25/year for a `.ca` domain.

Full step-by-step instructions for your chosen registrar will be added when D-01 is
decided. We'll recommend a registrar that offers free privacy protection and two-factor
login.

---

### PO-05 — Provide or confirm the starting category list

**When:** During Stage 1, week 1.
**What:** We'll send you a proposed category list (e.g. *Entertainment → Magicians,
Face painters, Balloon artists; Venues → Party rooms, Parks & pavilions; Food → Cakes &
bakeries, Catering*). You mark it up: add, remove, rename. You know the local market;
we don't.

---

### PO-06 — Set up alert emails

**When:** Just before launch.
**What:** Confirm the email address where you want to receive error and uptime alerts.
We'll configure them; you'll receive a test alert to confirm it works.

---

### PO-07 — Legal review

**When:** Before public launch (end of Stage 1). Start looking now; lawyers book up.
**What:** Engage a lawyer familiar with Canadian privacy law (PIPEDA) and anti-spam law
(CASL) to review: the privacy policy, the terms of use, the unclaimed-listing approach
(D-03), and the retention defaults (D-10). We'll prepare draft documents and a
one-page summary of what the platform collects and why, so the lawyer's time is spent
reviewing, not discovering.
**Cost:** a fixed-fee quote is reasonable to ask for. Not included in the
infrastructure budget.

---

### PO-08 — Starting vendor list

**When:** Stage 1, weeks 1–4 (if D-03 option B).
**What:** A spreadsheet of local businesses you'd like listed at launch: name, website
or Facebook page, and category. 30–50 is a good start. We'll provide the template. We
enter them through the admin screens, which also tests those screens with real data.

---

### PO-09 — Review prototypes

**When:** Stage 1, week 1.
**What:** We'll send you links to clickable screen prototypes (landing page, search,
vendor profile, admin listing editor) that work on your phone. You tell us what feels
right and what doesn't. No code to read.

---

## Completed

*Nothing yet.*
