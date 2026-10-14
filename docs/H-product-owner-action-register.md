# H — Product Owner Action Register

**Last updated:** 2026-10-14 (revision 29: PO-20, switch on files in conversations; revision 28: PO-11 and D-12 parked by you; revision 27: PO-15 done, planning works on the test site; revision 26: PO-16 done, business photos on; revision 25: PO-18 done, nightly backups on; revision 24: PO-19 and PO-06 done, alerts reach you; messages fixed after two reviews; revision 23: messages and reports; revision 22: Inquire built, D-04 and D-05; revision 21: D-46, the team sees every booking; a business taken down can't be newly booked; revision 20: D-45, square profile photo and whole page photos; revision 19: business photos built, PO-16 to switch them on; revision 18: D-44, bookings marked before a business joined; revision 17: D-39 revised to D-43, "Plan an event" built)

**Revision 29 changes:** files in conversations are built: a photo or PDF with any message.
One small step for you, **PO-20**: a private storage folder in Supabase (3 minutes, no keys).

**Revision 24 changes:** PO-19 is done (and with it PO-06): the site watch's email reached
supportlocalites@gmail.com at 5:20 am on 14 October, so you'll hear within minutes if the test
site stops working. Messages were also fixed after two reviews (a business's new owner never
sees the last owner's conversations; email and running-cost limits). Nothing for you to do.

**Revision 23 changes:** messages are built (your D-13 and D-17): people message businesses
that have joined, and the whole business team replies (part 1); either side can report a
conversation or a message, and the team deals with it under **Reports** (part 2). Files in
conversations come next, and will need one small step from you (a private storage folder in
Supabase). Nothing for you to do yet.

**Revision 22 changes:** Inquire is built (your D-04 and D-05): people can tell our team
they're interested in a business that hasn't joined, and are emailed when it does. Nothing for
you to do; see "Inquiries" in the team menu.

**Revision 21 changes:** D-46, what happens when a business is taken down, and the team's view
of every booking, is recorded in your own words and built. Nothing for you to do.

**Revision 20 changes:** D-45, your profile photo and page photo design, is recorded and built.
Nothing for you to do; once PO-16 is done you can try it on your test business.

**Revision 19 changes:** businesses can add photos (you chose this on 13 October 2026). To
switch it on, PO-16: make one storage folder in Supabase and copy two keys into Cloudflare.

**Revision 17 changes:** your five decisions on planning an event (D-39 to D-43) are recorded
in your own words below, and in the table of decisions. "Plan an event" is built and tested
on our computers with all five (see [G](./G-release-and-migration-history.md)); it reaches
the test site with the next update. One new check for you after that: PO-15.

**Revision 16 changes:** D-38, signing in stays a 6-digit emailed code; the "are you human"
check is parked.

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
| ✅ D-26 | **A website only; no mobile app.** Everyone signs in with their email address, and every notice (new messages, "marked you as booked", "How was it?") goes to that email. | ADR-013 already works this way; no app-store fees, so D-20 holds. The website can still be made installable (a home-screen icon) at no cost later if you ask; not planned. |
| ✅ D-27 | **Welcome first; an account only when it's needed.** The Welcome page is always the front door at localites.ca. Browsing, searching and viewing businesses never need an account. Any button that needs one shows a single "Sign in or create an account" screen, then returns the person to what they were doing. A link to a specific business (from Google or shared by text) opens that business directly. | Stage 1: the screen first appears on "Claim this business". Stage 2: "Plan an event", Save and Message use the same screen. |
| ✅ D-28 | **An admin page to add and edit every listing.** The team adds, edits, publishes and hides any business. Every change is recorded. | Stage 1, built first, after sign-in. Admin accounts need a code from a phone app, checked on the server. |
| ✅ D-29 | **Businesses claim their listing; no teammates yet. Personal and business are joined in one login.** A vendor signs in once and switches between their personal side and their business from the menu, without signing out. The switch matters for vendors, the paying users. | ADR-022 confirmed. "Manage team" leaves Stage 1. The personal side arrives with consumer accounts in Stage 2. **Update 13 October 2026:** the product owner chose "Owners add their own staff"; teammates (managers and staff) are now built (migration 0015, screen V4). |
| ✅ D-30 | **Activity reports: the more the better; trim later.** Per business: how often it appears in search and category lists and in what position; profile views, separate people and returning visitors; time on the profile, photos opened, services viewed; website, phone, email, directions, social and share taps; where visitors came from (Google, shared link, Localites search, category); phone or computer; approximate town; day and time; trends week over week and year over year; comparison with the category average (anonymous) and rank in category; "people asked for you" (Suggest a business); search demand in its category, including searches that found nothing. Stage 2 adds saves, inquiries, messages, reply time, added to events and booked, as a funnel. | ADR-023 extended; E §7a. **Everything is tracked, including the words people search**, linked to the visitor or account like the rest of the detail; the privacy policy says it's used to improve Localites and for vendor reports. Only the Localites team sees the detail; businesses see totals. Effort for activity tracking grows to about 1–1.5 weeks. The lawyer (PO-07) reviews the wording, the returning-visitor cookie and approximate town. |
| ✅ D-31 | **The brand: a black map pin dots the "i" in Localites.** A plain black pin with a round window (chosen over a glossy one), sized to the lettering, wherever the name appears as the brand: the Welcome page, the header and the browser tab. | [design-system.md](./design-system.md) §6; `src/components/Wordmark.tsx`. |
| ✅ D-32 | **Sign in with an emailed 6-digit code, for everyone but the team.** No passwords to remember: type your email, then the code we email you. New people also give their name. The team keeps its password and authenticator app. | ADR-028. Built: "Sign in or create an account" at `/join`. Needs PO-13 so codes reach everyone. |
| ✅ D-33 | **Checking a claim: email match, else contact the business.** If the person's email address is at the business's own website (jane@sweettreats.ca for sweettreats.ca), the team can approve. Otherwise the team contacts the business at the phone number or email the business publishes itself, then decides. | ADR-028. The Claims page shows the evidence and the business's own details, and asks how each approval was confirmed. |
| ✅ D-34 | **Owners' edits go live at once; the team can undo.** Changes a business makes to its own listing show straight away; the team gets a daily note of what changed and can undo any of it. Owners edit on a page that looks like their business page, with "View as a visitor". | ADR-029. Built: owners change their descriptions, services and prices, website and phone; the name, town and categories stay with the team. The team gets a daily note, a "check now" email for a new website or phone, Undo and Remove owner. |
| ✅ D-36 | **Sign-up asks about the person.** **First name and last name, in two boxes**, are needed to continue: nothing says "required", but if either is empty, *Continue* shows "Please enter your first and last name to continue." Gender, full date of birth and full street address are asked on the same screen but not required, and not labelled either way, so people fill in what they're happy to; anyone can add or change them later on **Your account**. **Anyone can create an account** (no minimum age). Businesses never see these details (they see totals only, D-30). | Built: migrations 0005 (`person_profile`) and 0006 (first and last name). Changes the privacy promise in E §7 (it said name and email only, and no children's accounts): the lawyer reviews it (PO-07), in particular a parent's consent for children under 13. |
| ✅ D-37 | **Business analytics live on an Analytics page, switched on per business.** Owners see their numbers on an Analytics page in their business's area of Localites, not by email. The team turns it on or off for each business, so it can become part of a paid plan (paid for outside Localites, D-24). Owners get no daily emails; the daily note of owners' changes (D-34) goes only to the team. | **Built (12 October 2026, ADR-030):** the owner's **Analytics** page (`/vendors/<name>/analytics`, linked from Your account) and the team's switch on each listing's **Activity** page. Counting starts once you add the activity key (PO-14). |
| ✅ D-38 | **Signing in stays a 6-digit code sent by email, with no "are you human" check** (12 October 2026). | The check (Cloudflare Turnstile) was built and is **parked**: its code stays in the project, switched off, so it can be turned on later without rebuilding (ADR-028). Our own limits on codes stay in place. Known limit: someone determined could still use up the day's sign-in codes. |
| ✅ D-39 | **Planning an event asks for a name, a date and a town; the kind of event is optional, one tap** (revised by you, 12 October 2026). The name is private to the person. Starting kinds: Children's birthday party, Birthday party, Baby shower, Wedding, Wedding shower, Graduation, Anniversary, Retirement party, Work or team event, Fundraiser, Something else. | Built (migration 0012, ADR-031). The team renames, reorders, hides or adds kinds at **Admin → Event types** without a developer. Businesses never see the kind or the name. |
| ✅ D-40 | **What a booked business sees: the person's name, the date, the town and about how many guests. Nothing else** (12 October 2026). | Built: the business's **Bookings marked** page and its emails show only those four things, and the database itself gives the business nothing else; the person is told exactly this on the event form and on **Mark as booked**. |
| ✅ D-41 | **"This isn't right": the team and the person are both told** (12 October 2026). The business's note stays with the team. | Built: the team gets an email (no note, no name) and a read-only **Booking flags** list; the person gets a polite email and a line on their plan. Deciding on flags comes in Stage 3. |
| ✅ D-42 | **Count saves, adds to event plans and "marked booked" now, seen only by the Localites team** (12 October 2026). Not on a business's own Analytics page. | Built: "Planning (team only)" on the team's **Activity** pages, with totals by kind of event. Totals only: never who, never which event. |
| ✅ D-43 | **Tailored ideas per kind of event, and featured businesses per kind, run by the team** (12 October 2026). | Built: on a person's plan, "Ideas for your …" with up to 3 businesses labelled **Featured** ("Featured businesses are promoted by the Localites team.") and the kinds of business people often need. The team chooses both at **Admin → Event types**. No money is recorded; any arrangement with a business happens outside Localites (D-24). Brought forward from Stage 5. |
| ✅ D-44 | **A business that joins Localites later sees bookings marked before it joined only if the event is still to come** (13 October 2026). | The owner: "The only scenario where I see it is important is if they add them to Localites and their party hasn't technically yet happened. If it's in the past I wouldn't worry about it. Don't want them to see how popular/unpopular the business is on the app." Built (migration 0013): past bookings from before it joined stay hidden, and can't be flagged. |
| ✅ D-46 | **A business that's taken down is hidden from people and can't be newly booked; the team sees every booking, always** (13–14 October 2026). | The owner: "it should be hidden to others - so they cant book but for those who have booked it (and the event had yet to happen) we will want to know so we can reach out to proactively to see if this is an issue." Then: "at any moment an admin should know all businesses who are booking business on the app and who they are workign with. Even after we remove them - their data should still exist from an admin view and see who was workign with them so we can reach out to them. Their data should exist just from the admin side unless we specifically delete the account from our database - but again this is hidden to everyone else except our admin socialite team". Built (migration 0020): a business that isn't listed disappears from people's Saved and from what they're considering, and can't be marked booked; a booking already marked stays on that person's plan by name only (no photo, no link). The team's **Bookings** page (`/admin/bookings`) lists every booking (listed or not, past and cancelled too): the business, the person's name and email, the date, the town and about how many guests; bookings still to come of a business taken down are listed first, "Check in with these people", and counted in the team menu. Never the event's name or private details, nor what a person is only considering or saved. Every look is recorded. Taking a business down deletes nothing. People are told on the Mark as booked page that the team sees bookings. Since migration 0025 (14 October 2026), messages with a business that's taken down are paused both ways (both sides can still read them) until it's listed again. |
| ✅ D-45 | **Each business has a square profile photo; the photos on its page are never cut** (13 October 2026). | The owner: "I want the business to have almost a logo photo - the photo that will be beside their business when in list views (this can be their logo a photo they like but I think this one should be square) then when you enter the business profile there can be additional photos and those can be landscape/potrait but we need to do a heck of a job at making it look clean and inviting." Chose the smart default (a nearly square photo fills the square; any other shape shows whole). Built (migration 0019): a full-screen framing screen for the profile photo; page photos whole in a band and in even rows, with a full-screen viewer. Replaces the earlier same-day 4:3 frames. |
| ✅ D-35 | **Two claims for one business: the first approved wins.** Any other waiting claims are declined automatically with a polite email; a claimed business shows "This business manages its own listing" with a way to contact us. | ADR-028; the database allows only one owner per business. |

---

## Needed from you now

| # | What | Blocks | Your effort |
|---|---|---|---|
| **ADR-005** | ✅ CPU time 8 ms with React Router (passes). A day after the speed improvements go live, glance at **Metrics** once more: CPU time, and whether any "Exceeded CPU" errors appear | Nothing; a final check | 2 min |
| **PO-14** | Switch on activity counting: add one secret in Cloudflare (steps below) | Any numbers on the team's Activity pages and the owners' Analytics pages | 3 min |
| **PO-20** | Switch on files in conversations: one private storage folder in Supabase (steps below) | People and businesses sending photos and PDFs in messages | 3 min |

**How to respond:** reply in the conversation with decision numbers and your choice,
e.g. *"Median 6 ms, P99 20 ms, no errors."* "I don't understand
this one" is a perfectly good answer.

---

**Parked by you (14 October 2026), not needed now:**
- **PO-11** (the 28 test businesses): not needed; real businesses will be added when the
  site goes live.
- **D-12** (mailing address for the privacy policy): left blank; raise it only when you ask
  what's missing before launch.

## Decisions

The newest decisions come first; older ones follow in their original order.

### D-39 — What we ask when someone plans an event (revised)

**What you said (12 October 2026).** First: "just name the event". Then, on reflection: *"it
would be nice to track what type of events it was.. just worried about asking for too much
info"*.

**Decided.**
- **Name your event: required.** The hint says "Just for you, like “Sam’s party”. No need
  to use a child’s full name." It is private: only the person sees it, never a business and
  never the team.
- **What kind of event? (optional).** One row of buttons under the name, with **None**
  chosen to begin with, so skipping it is one less tap, not one more. The kind is used for
  ideas on the person's own plan (D-43) and for the team's totals (D-42). **A business never
  sees it.**
- **Also required:** the date and the town. Everything else (times, how many guests, where,
  ages, budget, notes) is optional and tucked under "Add more details".
- **Starting list of kinds:** Children's birthday party, Birthday party, Baby shower,
  Wedding, Wedding shower, Graduation, Anniversary, Retirement party, Work or team event,
  Fundraiser, Something else. The team can rename, reorder, hide or add kinds at **Admin →
  Event types** at any time, without a developer. A hidden kind stays on events that already
  use it.

**Status:** ✅ Decided, 12 October 2026 (revised the same day). Built (migration 0012).

---

### D-40 — What a business sees when it's marked booked

**Choices we gave you:** a limited summary (our recommendation), or more of the event.

**Decided (12 October 2026): the limited summary**, adjusted for D-39. A booked business sees
**the person's name, the date, the town and about how many guests. Nothing else:** not the
event's name, its kind, the start time, where it is, the ages, the budget, the notes, the
other businesses on the plan, or the person's email.

- The person is told exactly this on the event form and again on the **Mark as booked** page
  (every way of sharing passes that page): *"… will see your name, the date, the town and
  about how many guests. Never your event’s name, where it is, the ages, your budget or your
  notes."*
- The business gets an email when it's marked booked, when it's un-marked, when the event is
  cancelled, and when the date or town changes. A "marked booked" email is held back only
  when the business's last word was already "marked booked", so it is never left with old
  news; and no one gets more than 30 of these emails a day, so a person changing their mind
  can't flood a business's inbox.
- A business not yet on Localites isn't emailed. If it joins later, it sees a booking marked
  before it joined only while that event is still to come (D-44); the **Mark as booked** page
  tells the person this plainly.

**Status:** ✅ Decided, 12 October 2026. Built.

---

### D-41 — "This isn't right": who is told

**Our first recommendation** was that only the team is told. **You chose: the team and the
person are both told** (12 October 2026).

- When a business says a booking isn't right, **the team** gets an email naming the business,
  with a link (no note, no person's name), and the booking appears on **Admin → Booking
  flags**.
- **The person who marked it booked** gets a polite email: *"{Business} told us it isn’t
  booked for your event on {date}. It may be a mix-up. If you did arrange something with
  them, please contact them directly: their phone number and website are on their Localites
  page."*, with a link to their plan. Their plan shows the quiet line "{Business} says it
  isn’t booked for this event."
- **The business's note stays with the team.** It is never in either email and never shown
  to the person.
- A booking can be flagged once. **Deciding on flags comes in Stage 3**, with reviews: until
  then the team's list is for reading only.

**Status:** ✅ Decided, 12 October 2026. Built.

---

### D-42 — Counting saves, adds to plans and bookings

**Our first recommendation** was not to count them yet. **You chose: count saves, adds to event
plans and "marked booked" now, seen only by the Localites team** (12 October 2026).

- The team sees, for any period, how many times each business was **saved**, **added to an
  event plan** and **marked booked**, on the business's **Activity** page ("Planning (team
  only)") and as a top-20 table on **Activity**, with a small table by kind of event (events
  planned, businesses marked booked, and "No type given" as its own row).
- **Totals only:** never who, never which event. The page says "Only the Localites team sees
  these. The business doesn’t (D-42)."
- **Not** on a business's own Analytics page, and not part of the nightly activity count.
- **Honest limit:** a save that is later un-saved isn't counted (un-saving removes it).
  Marking, un-marking and re-marking the same booking counts once.

**Status:** ✅ Decided, 12 October 2026. Built.

---

### D-43 — Ideas for each kind of event, and featured businesses

**What you said (12 October 2026):** *"I like Tailored but we need to program this on the back
end - likely businesses that pay more we would put as a featured business and tailor it to
specific parties they want. It's super important we think like this in how we optimize the
website for our end users but also how we can make opportunities to charge more ways for the
businesses to promote their business."*

**Decided and built.**
- On a person's plan, when they chose a kind of event, a section **"Ideas for your …"** (for
  example "Ideas for your children's birthday party") shows:
  - **Featured:** up to 3 businesses the team features for that kind of event, each labelled
    **Featured**, with the line **"Featured businesses are promoted by the Localites team."**
    always visible, a link to the business and **Add to event**;
  - **Businesses people often need:** the kinds of business the team chose for that kind of
    event, each linking to that category's list.
- With no kind chosen, one quiet line: "Tell us what kind of event it is to see ideas.",
  linking to Edit details.
- **The team runs it** at **Admin → Event types**: for each kind, tick the kinds of business
  to suggest (with an order), and feature a business between a first and last day, with an
  optional note only the team sees. A placement can be ended early. Every change is recorded.
  If more than 3 placements overlap, the page warns that only the first 3 are shown.
- **No money in Localites (D-16, D-24):** Localites records only that a placement exists and
  its dates. Any arrangement with the business, including payment, happens outside the site.
- **Featured never changes search results, reviews or anything else**, and is always labelled.
- Counting how often each featured business is shown comes later.
- This brings "featured placements" forward from Stage 5 (roadmap), for plans only.

**Status:** ✅ Decided, 12 October 2026. Built.

---

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

**Status:** ✅ Approved, 10 October 2026 (all eight rules). **Refined by D-40 and D-41 (12
October 2026):** a booked business sees the person's name, the date, the town and about how
many guests (not the kind of event); when a business flags a booking, the person is told too.

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
   the conversation.) Vendors see their counts on an **Analytics page** in their business's
   area, which the team switches on or off for each business so it can be part of a paid
   plan (D-37; paid for outside Localites, D-24). No reports are emailed to owners.
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
everything, detail kept for year-over-year numbers). **For now, by D-42 (12 October 2026):**
saves, adds to event plans and "marked booked" are counted as totals for the Localites team
only, not on a business's Analytics page.

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
    - **Build command:** `npm run build`
    - **Deploy command:** `npx wrangler deploy`
    - If it asks for a command for other branches: `npx wrangler versions upload`
    *(Changed 10 October 2026 for React Router; see step G.)*
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

*F. Hyperdrive (Cloudflare's free database connector), added 10 October 2026*
15. Cloudflare's direct encrypted connection to Supabase kept being cut off, so the site
    connects through Hyperdrive instead. In Cloudflare: **Storage & Databases →
    Hyperdrive → Create configuration → Connect to public database**. Name
    `localites-test-db`; the **Session pooler** address (port **5432**) with the
    `app_server.` user name and app_server password; **SSL mode: Require**; **caching
    off** for now. Send us the configuration **ID** (not a secret); we add it to the
    site. ✅ Done: ID `4e3e6b64b1cb4015a679dd85ad7a8daa`.

**✅ Done (10 October 2026).** The test site is live at
https://localites.supportlocalites.workers.dev, connected through Hyperdrive
(`/api/health` reports `"database":"ok"`).

*G. New build commands for React Router, added 10 October 2026*
16. Next.js used too much processing per page for the free plan (ADR-005), so the site
    now uses React Router, which Cloudflare builds with different commands. Until you
    change them, Cloudflare's builds fail and the site **stays on the last working
    version**, so nothing breaks in the meantime.
17. In Cloudflare, open the **localites** Worker → **Settings** → **Build** → **Build
    configuration** → the pencil (edit) icon. Change:
    - **Build command:** `npm run build`
    - **Deploy command:** `npx wrangler deploy`
    - **Non-production branch deploy command** (if shown): `npx wrangler versions upload`
    Leave everything else as it is, and click **Update** (or **Save**).
18. Open the **Deployments** tab and choose **Retry build** on the newest one (or tell
    us and we'll send a small update that starts a fresh build). When it shows green,
    open https://localites.supportlocalites.workers.dev/api/health: you should see
    `"database":"ok"` and a `"build"` code matching the newest change on GitHub.
19. Use the site for a few minutes (open categories, search, open a business), then a
    day later read **Metrics → CPU time** (median and P99) and send them to us.

**✅ G done (10 October 2026).** New commands saved; the React Router version is live
(`/api/health`: database ok via Hyperdrive, build `4df99e0`).

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
test alert there and you confirm it arrived. **Now part of PO-19** (its first email is the
test alert). ✅ **Done 14 October 2026** with PO-19.

### PO-07 — Legal review
**When:** Before public launch. **Start looking now.**
**Scope:** privacy policy; terms of use (especially that **Localites is not a party to
arrangements or payments between consumers and vendors**); review policy and how vendor
flags are handled; the unclaimed-listing approach (D-03); emails we send (CASL);
retention (D-10), including **keeping detailed activity records with no deletion date**
(D-22), which the lawyer should specifically check; **the personal details asked at
sign-up (D-36): full date of birth and full street address, from anyone, with no minimum
age**, including whether a parent's consent is needed for children (the privacy
regulator's guidance points to under 13), how the purposes are worded, and how long they're
kept; and the business name (D-12): if
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

### PO-10 — Switch on sign-in for the team (admin page, D-28)
**When:** Now. **Cost:** $0. **Time:** about 15 minutes. You'll need your phone.
Nothing here is sent to us: you type every password and key straight into Supabase or
Cloudflare.

*A. Keep sign-ups closed for now (Supabase)*
1. In Supabase, open the **localites-test** project → **Authentication** → **Sign In /
   Providers** (it may be under **Settings**). Turn **off** "Allow new users to sign up"
   and save. Only accounts you create can sign in until businesses can claim their
   listings; we'll turn it back on then.
2. In **Authentication** → **Multi-Factor**, check that **TOTP (App Authenticator)** is
   enabled (it is by default).

*B. Create your team account (Supabase)*
3. **Authentication** → **Users** → **Add user** → **Create new user**. Email:
   **supportlocalites@gmail.com**. Password: a new one, only for Localites, kept with your
   passwords. Tick **Auto Confirm User**. Click **Create user**.

*C. Make it the first admin (Supabase)*
4. **SQL Editor** → **New query** → paste exactly:
   `select grant_first_admin('supportlocalites@gmail.com');` → **Run**. Expect
   *"Done: supportlocalites@gmail.com is now a Localites admin."* This only works once:
   after that, admins are added from the admin page. If it says the command doesn't
   exist, GitHub hasn't updated the test database yet: wait ten minutes and try again.

*D. Tell the website how to reach Supabase's sign-in (Supabase → Cloudflare)*
5. In Supabase, open **Project Settings** → **Data API** (or the **Connect** button) and
   copy the **Project URL** (it looks like `https://abcd….supabase.co`).
6. In Cloudflare, open the **localites** Worker → **Settings** → **Variables and Secrets**
   → **Add**. Type: **Secret**. Name: `SUPABASE_URL`. Value: paste. Save.
7. In Supabase, open **Project Settings** → **API Keys** and copy the **Publishable key**
   (it starts with `sb_publishable_`). It's designed to be public, but keep it in
   Cloudflare rather than anywhere else.
8. In Cloudflare, **Add** again. Type: **Secret**. Name: `SUPABASE_PUBLISHABLE_KEY`.
   Value: paste. Then **Deploy** (or save and deploy).

*E. Sign in and set up your phone*
9. Install **Google Authenticator** or **Microsoft Authenticator** (both free) on your phone.
10. Open https://localites.supportlocalites.workers.dev/admin and sign in with the email
    and password from step 3.
11. The site shows a square code. In the app, add an account and scan it (or type the
    setup key shown under it). Enter the 6-digit code the app shows. You're in.
12. From now on, signing in asks for your password and then a code from the app. For
    safety, team sign-ins last 12 hours.

**Never send us** the password, the codes, or a photo of the square code: anyone with the
square code can make your codes. If you lose your phone, tell us and we'll remove the old
authenticator so you can set up a new one (runbook, "Team sign-in and admins").

**Done when:** you see the **Listings** page. Reply *"PO-10 done"*.

**✅ Done (10 October 2026).** Sign-in and the admin page work on the live test site;
`/api/health` sees both Supabase settings.

### PO-11 — Check and publish the test businesses
**When:** At your pace, once GitHub has loaded them (about ten minutes after our update).
**Cost:** $0.
The 28 test businesses (PO-08) are in the admin page as **drafts**, so nobody else sees
them yet. Each has only what the research could confirm: name, town, category and, where
we found it, the business's own website. Its **History** (at the bottom) shows the
research link and what to check.
1. Open https://localites.supportlocalites.workers.dev/admin, set **Status** to **Draft**,
   and click **Show**.
2. Open a business. Look at its own website or social page, and fill in only what the
   business publishes itself: a short description, an about paragraph, phone, email, and
   services with prices exactly as it shows them. Fix the category if needed. **Save
   details** (and **Add service** for each service).
3. If it's right, click **Publish**: it appears on Explore and in search straight away.
   If it has closed or doesn't fit, click **Archive**.
4. When enough real ones are live, archive the six fake "Test Vendor" listings the same
   way.

Nothing is ever deleted: every change is kept in the listing's history.

### PO-12 — Email from localites.ca (ADR-013)
**When:** Now, while we build Suggest a business. **Cost:** $0 (Cloudflare and Resend
free plans; the domain you already pay for). **Time:** about 20 minutes, then a wait of
up to a few hours for the internet to catch up.
**Why:** Localites must email the team about each suggested business (D-25), and soon
send businesses their sign-up emails. Email services only deliver reliably from a
domain you own and have proved is yours.

*A. Let Cloudflare manage the domain's settings (one-time)*
1. In Cloudflare (supportlocalites@gmail.com), choose **Add a domain** (on the home page,
   or **Websites** → **Add a site**). Type `localites.ca`, continue, and choose the
   **Free** plan.
2. Cloudflare checks for existing settings; click **Continue**. It then shows **two
   nameservers** (two addresses ending in `ns.cloudflare.com`). Keep that page open.
3. Sign in where you bought `localites.ca`. Find **Nameservers** (sometimes under
   **DNS** or **Manage domain**), choose **custom nameservers**, and replace what's there
   with Cloudflare's two. Save.
4. Back in Cloudflare, click **Check nameservers**. It can take from minutes to a few
   hours; Cloudflare emails you when `localites.ca` is **Active**. The live test site
   isn't affected: it stays at its `.workers.dev` address.

*B. Connect the email service (after A shows Active)*
5. Go to **resend.com** and sign up with **supportlocalites@gmail.com** (free plan; turn
   on two-step login in its settings).
6. **Domains** → **Add Domain** → `localites.ca` → keep the suggested region → **Add**.
7. Choose **Auto configure** (or **Sign in to Cloudflare**) and allow it for
   `localites.ca` only; Resend adds its records for you. If that option isn't shown,
   tell us: we'll walk you through adding the records by hand in Cloudflare's **DNS**
   page.
8. Click **Verify**. Within a few minutes the domain shows **Verified**.

*C. Give the website its sending key*
9. In Resend, **API Keys** → **Create API Key**. Name: `localites-website`. Permission:
   **Sending access**, domain `localites.ca`. Copy the key (it's shown only once).
10. In Cloudflare, open the **localites** Worker → **Settings** → **Variables and
    Secrets** → **Add**. Type: **Secret**. Name: `RESEND_API_KEY`. Value: paste. Deploy.

**Never send us** the key. If it's ever exposed, delete it in Resend and make a new one
(steps 9–10).

**Done when:** Resend shows `localites.ca` as **Verified** and `/api/health` lists
`RESEND_API_KEY`. Reply *"PO-12 done"*. Until then, suggestions are still saved and shown
in the admin page; only the email to the team waits.

**✅ Done (11 October 2026).** `localites.ca` is on Cloudflare (moved from GoDaddy's
nameservers) and verified in Resend; a test suggestion emailed supportlocalites@gmail.com.
Resend's automatic set-up didn't reach Cloudflare, so its three records were added by hand
in Cloudflare's DNS page: TXT `resend._domainkey`, and CNAMEs `send` and `rsend` (both
"DNS only"). If Resend ever shows the domain as unverified, check those three first.

### PO-13 — Switch on sign-in for businesses (emailed codes, D-32)
**When:** After PO-12 shows `localites.ca` as **Verified** in Resend. **Cost:** $0
(Supabase and Resend free plans). **Time:** about 15 minutes.
**Why:** Businesses sign in with a 6-digit code we email them (D-32). Supabase's own email
service only sends to the team's address, a couple of times an hour, and won't let us
change its emails, so its sign-in emails must go through Resend, like the rest.
Everything happens in the **localites-test** Supabase project; nothing is sent to us.

*A. Send Supabase's emails through Resend*
1. In Resend, open **API Keys** → **Create API Key**. Name: `supabase-sign-in`.
   Permission: **Sending access**, domain `localites.ca`. Click **Add** and copy the key
   (it's shown only once).
2. In Supabase, open **Authentication** → **Emails** → **SMTP Settings** and turn on
   **Enable custom SMTP**. Fill in:
   - Sender email: `notices@localites.ca`
   - Sender name: `Localites`
   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: `resend`
   - Password: paste the key from step 1.

   Click **Save**. (If Resend offers **Connect to Supabase** under its **Integrations**,
   that fills in the same settings for you; either way is fine.)

*B. Use our code email*
3. Open our email on GitHub:
   https://github.com/supportlocalites/localites/blob/claude/event-discovery-architecture-dz0qgf/emails/sign-in-code.html
   and click the **Copy raw file** button (two overlapping squares, top right of the file).
4. In Supabase, **Authentication** → **Emails** → **Templates** → **Magic link or OTP**
   (it may be called **Magic Link**):
   - Subject: `Your Localites code: {{ .Token }}`
   - Body: delete what's there and paste. Click **Save**.
5. Do the same for **Confirm sign up** (same subject, same body). New people get this
   one; people who've signed in before get the other.

*C. Open sign-ups*
6. **Authentication** → **Sign In / Providers**. Turn **on** "Allow new users to sign up"
   (you turned it off in PO-10). Under **Email**, make sure **Confirm email** is **on**,
   set **Email OTP Expiration** to `900` (15 minutes) and **Email OTP Length** to `6`,
   and turn **Secure email change** on. Click **Save**.
7. Leave **Authentication** → **Rate Limits** as they are.

*D. Try it*
8. In a private browser window, open
   https://localites.supportlocalites.workers.dev/join and enter a personal email address
   (not supportlocalites@gmail.com). Within a minute you should get **"Your Localites
   code: 123456"** from notices@localites.ca. Enter the code, then your name. You land
   on **Your account**.
9. Open one of the six fake **Test Vendor** businesses, click **Claim this business**, and
   send a claim. Then, signed in to the admin page as the team, open **Claims** and
   **decline** it with the reason `Test`. (Don't approve a test claim: making someone an
   owner can't be undone from the admin page yet.) Your personal address gets the
   "couldn't approve" email, and **Your account** shows the claim as not approved, with
   the reason.

**Your team sign-in doesn't change:** password, then the authenticator app, at
`/sign-in`. A code sign-in never opens the team pages.

**Never send us** the Resend key. If it's ever exposed, delete it in Resend, make a new
one and paste it into step 2 again.

**Done when:** the code arrives and step 8 lands on **Your account**. Reply *"PO-13
done"*. Until then, the sign-in screen works only for addresses Supabase's own email
service will send to.

**✅ Done (11 October 2026).** Supabase sends codes through Resend from
notices@localites.ca; a personal Outlook address got its code (in the spam folder at first,
as new senders often do), signed up, claimed a Test Vendor listing, and received the
"received" and "couldn't approve" emails after the team declined it.

---

### PO-14 — Switch on activity counting (D-22, D-30, ADR-030)
**When:** Now (the site isn't public yet, so early numbers just help us check it). **Cost:**
$0. **Time:** about 3 minutes.
**Why:** Localites only counts visits and taps when the website has a secret "activity key"
that lets it sign each page. Until you add it, nothing is counted and the team's Activity
page says "Counting is off".

1. In Cloudflare, open **Workers & Pages** → **localites** → **Settings** → **Variables
   and Secrets** → **Add**.
2. **Type:** Secret. **Name:** `ACTIVITY_KEY`.
3. **Value:** make up a long sentence of at least 40 characters (it must be at least 32),
   for example seven or eight unrelated words with a few numbers mixed in. Don't reuse a
   password. You'll never need to type it again or remember it. If it's too short, the
   team's Activity page says so.
4. Click **Deploy** (or **Save and deploy**).

**Never send us** the key. If you think it's been seen by someone else, replace it the same
way; nothing is lost (pages simply get new notes).

**Done when:** on the team pages, **Activity** no longer says "Counting is off". Reply
*"PO-14 done"*. Numbers appear the morning after the first visits (the count runs each
night). To show an owner their numbers, open their listing's **Activity** page and click
**Switch on**.

---

### PO-15 — Try "Plan an event" on the test site (D-39 to D-43)
**When:** after we tell you the update with "Plan an event" has reached the test site. **Cost:**
$0. **Time:** about 5 minutes. Nothing to type into any settings, and no secrets.
**Why:** everything was tested on our computers. This proves it also works through the real
hosting and database connection (ADR-031 relies on a setting the site sends the database
with every request).

1. On the test site, sign in with your own email (the 6-digit code), not a team account.
2. Tap **My events** at the top, then **Plan an event**. Give it a name (for example "Test
   party"), pick a kind of event, a date and a town, and tap **Plan event**.
3. Your event's plan opens. Check that it shows your event's name, and "Ideas for your …"
   with "Businesses people often need".
4. Open any published test business, tap **Add to event**, choose your test event. Go back to
   your plan: the business is under **Considering**.
5. Optional, to tidy up: on the plan tap **Edit details**, then **Cancel this event**.

**Done when:** all of that works. Reply *"PO-15 done"*, or tell us exactly what you saw if a
step didn't work (a screenshot is fine; never include a code from your email).


✅ **Done (14 October 2026):** you confirmed planning an event works on the test site.
---

### PO-17 — Put the site live only after the tests and the database update
**When:** any time. **Cost:** $0. **Time:** about 10 minutes, in two sittings.
**Why:** today Cloudflare puts each update live the moment it's pushed, while GitHub updates
the database a couple of minutes later. In between, a page that needs the new database change
can fail (it happened with the photo frames). From now on GitHub does it in order: every test,
then the database, then the website. An update that fails a test never goes live.

**Part 1: a deploy key from Cloudflare**
1. In Cloudflare, click the person icon (top right) → **My Profile** → **API Tokens** →
   **Create Token**.
2. Next to **Edit Cloudflare Workers**, click **Use template**.
3. Under **Account Resources**, choose your account. Leave the rest as it is. Click
   **Continue to summary**, then **Create Token**.
4. Cloudflare shows the key once. Keep that page open.
5. Also note your **Account ID**: open **Workers & Pages**; it's on the right-hand side.

**Part 2: put them in GitHub**
6. On GitHub, open the repository **supportlocalites/localites** → **Settings** →
   **Secrets and variables** → **Actions** → **New repository secret**.
7. **Name:** `CLOUDFLARE_API_TOKEN`. **Secret:** paste the key from step 4. **Add secret**.
8. **New repository secret** again. **Name:** `CLOUDFLARE_ACCOUNT_ID`. **Secret:** the
   Account ID from step 5. **Add secret**. You can close the Cloudflare page now.
9. Tell us "PO-17 secrets added". We'll send a small update and check that GitHub's
   **Put the website live** step works.

**Part 3: only after we confirm it worked**
10. In Cloudflare: **Workers & Pages** → **localites** → **Settings** → **Build** (Git
    repository) → **Disconnect**. From then on only GitHub puts the site live.

**Never send us** the key. If you think it's been seen, delete it in Cloudflare (My Profile
→ API Tokens) and make a new one, then replace the GitHub secret.

**Done when:** GitHub's run shows **Put the website live** ticked green and Cloudflare's own
builds are disconnected. Reply *"PO-17 done"*.

---

### PO-18 — Switch on nightly backups

Every night GitHub takes a full copy of the test database (every business, account and
plan), locks it with a passphrase only you choose, keeps it for 30 days, and proves it can
be restored by restoring it into a throwaway database and checking nothing is missing. If
any of that fails, GitHub emails you. Free: it uses GitHub's included minutes (about 3 a night).

**Part 1: the passphrase**
1. Make up a long passphrase: five or six random words is ideal. It's the key to every
   backup: **without it no one, including us, can open them**, so keep a copy wherever you
   keep your passwords.
2. In GitHub, open the **localites** repository → **Settings** → **Secrets and variables** →
   **Actions** → **New repository secret**.
3. Name: `BACKUP_PASSPHRASE`. Secret: your passphrase. Click **Add secret**.
4. On the same page, open the **Variables** tab → **New repository variable**. Name:
   `BACKUPS_ON`, value: `true`, then **Add variable**. (Not secret. It tells the job backups
   are meant to run, so if the passphrase ever goes missing it fails and emails you, rather
   than quietly skipping.)

**Part 2: let GitHub run it every night**
GitHub only runs scheduled jobs from the repository's main ("default") branch, and all of
Localites lives on the branch `claude/event-discovery-architecture-dz0qgf`.
5. Still in **Settings**, open **General**. Under **Default branch**, click the two-arrows
   button, choose `claude/event-discovery-architecture-dz0qgf`, then **Update** and confirm.
   Nothing else changes: the site, the tests and the deploys stay exactly as they are.

**Part 3: make sure a failure emails you**
GitHub emails the person who last switched a scheduled job on, so:
6. Open the **Actions** tab → **Nightly backup** (left) → the **…** button (top right) →
   **Disable workflow**. Then the same button → **Enable workflow**.
7. Your GitHub picture (top right) → **Settings** → **Notifications** → under **Actions**,
   make sure **Email** and **Only notify for failed workflows** are ticked.

**Part 4: the first backup**
8. **Actions** → **Nightly backup** → **Run workflow** → **Run workflow**.
9. After about 3 minutes it shows a green tick. Click it: the summary says the backup was
   taken and the restore check passed, and the locked file is listed under **Artifacts**.

**Never send us** the passphrase. If you think it's been seen, make a new one and replace
the secret: new backups use it; older ones still need the old one until they expire.

**Done when:** the run you started in step 8 shows the green tick. Reply *"PO-18 done"*.

✅ **Done (14 October 2026):** the first backup ran at 13:14 UTC: taken, locked, kept for 30 days, restored into a scratch database and checked. It now runs every night.

---

### PO-19 — Switch on alerts when the site breaks

A small separate program (the **site watch**, `localites-watch` in Cloudflare) looks at the
test site every 5 minutes. If it stops working, supportlocalites@gmail.com gets a plain
email saying what's wrong and what to paste into a new session to get it fixed; a reminder
every 6 hours while it stays down; and an email when it's back. Free. It needs its own key
to send email. (This also does PO-06: the first email is the test alert.)

**Part 1: an email key for the watch (Resend)**
1. Sign in to **resend.com** → **API Keys** → **Create API Key**.
2. Name: `localites-watch`. Permission: **Sending access**. Domain: **localites.ca**.
   Click **Add**. Resend shows the key once: keep that page open.

**Part 2: give it to the watch (Cloudflare)**
3. In Cloudflare: **Workers & Pages** → **localites-watch** (it appears after our next
   update goes live) → **Settings** → **Variables and Secrets** → **Add**.
4. Type: **Secret**. Variable name: `RESEND_API_KEY`. Value: paste the key from step 2.
   Click **Deploy** (or **Save**). You can close the Resend page now.

**Part 3: the test alert**
5. Within 5 minutes, supportlocalites@gmail.com gets **"Localites alerts are switched on"**.
   If it isn't in the inbox, look in spam and mark it **Not spam**, so real alerts arrive.

**Never send us** the key. If you think it's been seen, delete it in Resend and make a new
one, then replace the secret in Cloudflare (steps 3 to 4).

**Done when:** the "alerts are switched on" email arrived. Reply *"PO-19 done"*.

**Status (14 October 2026):** your part is done. The email didn't come at first because of a
Cloudflare fault: on 13 October its scheduler didn't start new every-5-minutes schedules
(its status page: "Workers - Cron Trigger Activation Issues", fixed 00:09 UTC on 14 October).
Since then Cloudflare's own record shows the watch looking at the site every 5 minutes, every
look successful.

✅ **Done (14 October 2026):** the site watch's email arrived at supportlocalites@gmail.com at
5:20 am ("The site is working now… this email only shows that alerts reach you").

---

### PO-20 — Switch on files in conversations (E §9, migration 0028)
**When:** any time after this update reaches the test site. **Cost:** $0 (the same free 1 GB as
business photos; Localites keeps conversation files under 700 MB of it).
**Time:** about 3 minutes. No new keys: the photo keys from PO-16 already reach this folder.
**Why:** a photo or PDF sent in a conversation is kept in a **private** folder: nobody can open
it from an address; the website checks who's asking every time, and hands it over only to the
two sides of the conversation.

**In Supabase** (your Localites project):
1. Open **Storage** in the left menu → **New bucket**.
2. **Name:** `conversation-files` (exactly, lower case). Leave **Public bucket** **off**.
3. Open **Additional configuration**: switch **Restrict file size** on and set **4 MB**; under
   **Allowed MIME types** enter `image/jpeg, image/webp, application/pdf`. Click **Save**
   (or **Create**).

That's all: nothing to add in Cloudflare.

**Try it:** open a conversation on the test site (as a person, or as a business owner), choose
**Add a photo or PDF**, pick a photo, and send. The photo shows in the conversation; the
other side sees it too. A PDF shows as a link that saves it.

**Done when:** a photo shows in a conversation. Reply *"PO-20 done"*, or tell us what you saw.
If the folder name is wrong, sending says "The file couldn't be saved just now".

---

### PO-16 — Switch on business photos (E §9, ADR-003)
**When:** any time after the photos update reaches the test site. **Cost:** $0 (Supabase's
free plan includes 1 GB of file storage; it stops rather than charges when full).
**Time:** about 10 minutes.
**Why:** photos are stored in Supabase's file storage. The website needs a storage folder and
its own keys to put photos there. The keys reach file storage only, never the database.
Until they're added, the Photos page says "Adding photos isn't switched on yet".

**In Supabase** (your Localites project):
1. Open **Storage** in the left menu → **New bucket**.
2. **Name:** `vendor-photos` (exactly, lower case). Switch **Public bucket** on (photos are
   meant to be seen by everyone; file names are random, so nobody can guess one).
3. Open **Additional configuration**: switch **Restrict file size** on and set **2 MB**;
   under **Allowed MIME types** enter `image/jpeg, image/webp`. Click **Save** (or **Create**).
4. Open **Project Settings** (the cog) → **Storage**. Under **S3 Connection**, make sure
   **Enable connection via S3 protocol** is on. Note the **Region** shown there (for example
   `ca-central-1`); it isn't a secret.
5. Under **S3 Access Keys**, click **New access key**. Description: `Localites website
   photos`. Click **Create**. Supabase shows an **Access key ID** and a **Secret access key**
   once. Keep the window open for the next steps.

**In Cloudflare:**
6. Open **Workers & Pages** → **localites** → **Settings** → **Variables and Secrets** →
   **Add**. **Type:** Secret. **Name:** `PHOTO_KEY_ID`. **Value:** paste the Access key ID.
7. **Add** again. **Type:** Secret. **Name:** `PHOTO_SECRET`. **Value:** paste the Secret
   access key.
8. The region (`ca-central-1`) is already in the site's settings file (`wrangler.jsonc`), so
   there's nothing to add for it. If Cloudflare ever shows a `PHOTO_REGION` variable that
   differs from Supabase's region, tell us.
9. Click **Deploy** (or **Save and deploy**). You can close the Supabase window now.

**Never send us** the keys. If you think one has been seen by someone else: in Supabase,
delete that access key and make a new one, then replace the two secrets in Cloudflare.

**Try it:** sign in as the owner of a test business, open **Your account** → **Photos**,
choose a photo from your phone or computer, describe it in a few words and tap **Add photo**.
Open the business's page: the photo is at the top. Then open the team pages → **Photos**:
it's listed there, with **Remove photo**.

**Done when:** the photo shows on the business page. Reply *"PO-16 done"*, or tell us what
you saw (a screenshot is fine; never include a key).

✅ **Done (14 October 2026):** you confirmed a photo shows on a business page. Business photos are on.

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
| 2026-10-10 | PO-03: Supabase, GitHub and Cloudflare connected; test site live |
| 2026-10-10 | PO-08: test set of our 28 suggested businesses (up to 5 per category); vendor list to be refreshed later |
| 2026-10-11 | PO-12: email from localites.ca (Cloudflare DNS, Resend verified, website key added); team emails arrive |
| 2026-10-11 | PO-13: sign-in codes for everyone (Supabase emails through Resend; sign-ups open); a full test claim worked end to end |
| 2026-10-12 | D-37 Analytics page; D-38 signing in stays the emailed code |
| 2026-10-12 | D-39 (revised), D-40, D-41, D-42 and D-43: planning an event, what a booked business sees, flags, team-only counts, ideas and featured businesses |
| 2026-10-13 | PO-17: GitHub puts the test site live only after every test and the database update (first deploy checked healthy); Cloudflare's own builds disconnected |
| 2026-10-13 | D-45: a square profile photo for lists; the photos on a business's page shown whole |
| 2026-10-14 | D-46: a business taken down is hidden from people and can't be newly booked; the team sees every booking |
| 2026-10-14 | PO-15: planning an event checked on the test site; it works |
| 2026-10-14 | PO-16: business photos switched on (storage folder in Supabase, keys in Cloudflare); a photo shows on a business page |
| 2026-10-14 | PO-18: nightly backups on; the first one restored and checked |
| 2026-10-14 | PO-19 and PO-06: alerts switched on; the site watch's first email reached supportlocalites@gmail.com |
