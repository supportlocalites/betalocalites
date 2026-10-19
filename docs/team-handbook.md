# Localites team handbook

How to do each job on the team pages, in plain steps. Written 18 October 2026 for anyone the
owner adds to the team. The technical runbook is [F](./F-operational-runbook.md); this page is
the everyday version.

## Every day (about 10 minutes)

1. Sign in at **/sign-in** with your password and authenticator app.
2. Open **Waiting for you** (first in the team menu). It lists everything waiting, oldest
   first. Work down it; each line links to its page.
3. Read the team's emails at supportlocalites@gmail.com: new reviews, held changes, reports,
   claims, inquiries and suggestions arrive there too, plus the daily note of owners' changes.

**Never:** ask anyone for a password, code or key; promise or take any payment (Localites
doesn't process payments, D-16, D-24); copy people's details out of the team pages into other
places. Every look and every change you make is recorded with your name.

## Reviews (Reviews page)

Every review waits for a person before it shows (D-51).

- **Approve** if it's about a real experience with that business, and follows the
  [review policy](./legal/review-policy.md): no abuse, hate, threats or sexual content, no one's
  personal details, no advertising, not written for a reward, not from the business or a
  competitor.
- **Deny** if it breaks those rules. No reason is needed; the author isn't told, and the business
  never sees it.
- The language check's note (if any) is a hint, not a decision.
- **Reported reviews:** read the reason. Keep the review (close the reports with a reason) unless it
  breaks the policy; then remove it.
- **Held replies:** a business's reply the language check held. Put it live if it's fine, or remove
  it with a reason.

## Owners' changes (Held changes, and the daily note)

- **Held changes:** the language check held an owner's whole save. **Put live** if it's fine (it
  goes live as the owner's own save), or **Decline** with a reason the owner is emailed.
- **The daily note** lists owners' changes that went live. Look for anything that breaks the rules,
  and any new website or phone number marked CHECK. Undo a change from the listing's team page.
- **A business's new name (M20, D-54):** owners can change their business's name themselves, once
  every 30 days. You get a "Check now" email; if the new name isn't really theirs (another
  business's name, say), undo the "Business name" change on the listing's team page with the reason
  (they're emailed). Its web address stays the new one; the old one keeps working. When you rename
  a business yourself, its owner is emailed the old and new names.

## Reports of conversations and messages (Reports page)

- You can only read a conversation through a report, and each look is recorded.
- **Hide** the reported message if it breaks the rules; **Block** the conversation if it keeps
  happening; then close the report as dealt with, or dismiss it, with a short note.
- A message that was edited shows what it said before ("Before … it said"). A conversation the
  person deleted stays readable through its report; the business can no longer see it, but can
  report it for 30 days after it was deleted (the email says "a conversation the customer has
  since deleted").
- For someone who keeps causing trouble across conversations or reviews, see **Suspending an
  account** below.

## Claims (Claims page)

Someone asks to manage a business's page. Approve only when you've checked one of these, and tick
which:

- their email address is at the business's own website; or
- you phoned the business at its **published** number and they confirmed; or
- you emailed the business at its **published** address and they confirmed.

Otherwise decline with a reason they're emailed. Approving one claim declines any others for the
same business automatically.

## Businesses and listings

- **Suggested businesses:** check it's a real local business. **Add** it as a draft listing (using
  only what it publishes itself), mark it a **duplicate** of an existing listing, or **decline** it
  with a reason. Whoever suggested it signed in is emailed once it's listed.
- **Inquiries:** people asking about a business that hasn't joined. Contact the business and invite
  it to claim its page; the people who asked are emailed if it joins.
- **"Please remove my business":** owners can now do this themselves (Team, then **Stepping back**):
  hide the page for a while, hand the business to someone on its team, or, with nobody else on the
  team, take it off Localites (the listing is archived and unclaimed). If they ask you instead and
  the request comes from the business (check as for claims), archive the listing on its team page,
  with the reason. A page its owner hid shows "The owner hid the page." in its history; anything
  you change on its status replaces the owner's hiding.
- **A business that left and wants to come back:** an archived listing can't be brought back. Check
  it's them (as for claims), add it again as a new listing (it needs a new web address), and ask
  them to claim it.
- **"Something wrong with this listing":** check the business's own website, and correct the listing
  on its team page, or ask the owner to if it's claimed.
- **Booking flags:** a business says someone marked it booked by mistake (the person has already
  been told). Look into it: email the business or the person if you need to. Then press **The
  booking stands** (it can be reviewed) or **Not a real booking** (it can't, and any review of it
  is removed). Both are emailed; the business's note is never shared. You can't change a decision.
- **A review's author asks for it to be removed:** it shows under the review's reports as "Its
  author asks for it to be removed". Remove it (with a short reason) or close the request; the
  author is emailed either way. Whoever sends any report is told the outcome, never your note.
- **A booking marked minutes before its review, or only after the event:** the review page says
  so. Worth a second look before approving.
- **Bookings to check in on:** a business people had booked was taken down. Email those people so
  they can make other arrangements.

## People and accounts

- **Deleted accounts to finish:** within 30 days of each, open Supabase → **Authentication →
  Users**, search for the id shown, delete that user, then click **Done** on the team page. The
  daily note reminds you while any are waiting.
- **Suspending an account (Accounts page):** for someone who keeps breaking the rules. Find them by
  the email they sign in with, then **Suspend** with a reason (kept in the record, never shown to
  them). They can still download their data or delete their account. **Lift the suspension** on the
  same page, with a reason. Team members can't be suspended.
- **"Send me my data":** point them to **Your account → Download your data**. Reply only to the
  email address on the account. Answer within 30 days.
- **"Delete my account":** point them to **Your account → Delete your account**; it's immediate.
- **"I never got my code":** ask them to check spam, junk and Promotions; then see the runbook (F,
  "Sign-in codes and claims").

## The team itself (Users and roles)

- To add someone, follow the steps on the Users and roles page (they create their own password in
  Supabase; you never see it). Give a reason.
- Remove someone who leaves, with a reason. Nobody removes themselves.

## When something looks wrong with the site

- The site watch emails supportlocalites@gmail.com within minutes if the site goes down.
- Write down what you saw, the time, and the page address, and tell the owner. Don't try fixes in
  the database.
