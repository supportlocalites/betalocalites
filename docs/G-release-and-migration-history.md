# G — Release & Migration History

Every release and every database migration, in order. Appended before each deploy.

---

## Template

```
### Release YYYY-MM-DD — <short name>
**Stage:** <n>
**What changed (plain English):**
**Migrations applied:** <files, or "none">
**Destructive?** yes/no — if yes, link to approval and recovery plan
**Tests run:** <suite: passed/failed counts>
**Security tests:** <cross-account / cross-event / invitation: passed/failed>
**Existing functionality affected:** <none / what>
**How to roll back:**
**Approved by:**
```

---

## Restore drills

| Date | Backup restored | Integrity checks | Result |
|---|---|---|---|
| — | — | — | No production environment yet |

---

## Releases

### 2026-10-18 — Before-launch tasks, part 2: Waiting for you, the handbook, and fixes from the whole-site security review

**Stage:** 1 (screen X23; E §6, §8)
**What changed (plain English):** the team's **Waiting for you** page lists everything waiting, oldest
first. A team handbook and the owner's phone checklist are written. The first whole-site security
review found nothing serious (no way to see or change someone else's data); its fixes: reports of
conversations are limited (10 a day per person, not the same thing twice while open, at most 20 report
emails to the team a day so sign-in codes keep their share); files in conversations are limited to
25 MB a day per person; a file kept for a report is let go 90 days after the team closes it; the
public health check no longer lists the site's settings; the "Where" box on an event now says guests
see it (they always did); group-link replies are limited per home connection; message forms that
don't say their size are refused; an unused database right is taken back.
**Migrations applied:** `0045_security_review_fixes.sql`
**Destructive?** No. Reported files are deleted only 90 days after the team's decision.
**Tests run:** database checks 45 of 45 files (0045: 8; 0009 updated to call the unlinking as the
database owner); unit tests 192 of 192; messages 133 of 133, guests part 2 34 of 34, account deletion
22 of 22, event planning 145 of 145, accounts 35 of 35, help and sharing 19 of 19, look 504 of 504.
**Security tests:** an 11th report in a day and a duplicate open report are refused; asking how much
someone else sent gives nothing; a file is released only after 90 days with no open or recent report;
the server can't unlink a person directly; a person can't open Waiting for you.
**Independent review before push:** fixed: two reports sent at the same instant could both slip under
the limits (one person's reports are now taken one at a time); a failure counting report emails no
longer shows an error after the report is saved.
**Existing functionality affected:** none for normal use.
**How to roll back:** with the next update.
**Approved by:** the product owner, 18 October 2026 ("add all of them").

### 2026-10-18 — Before-launch tasks, part 1: deletions, suspensions, a copy of your data, help

**Stage:** 1 (screens A6, A7, X22, P9, P4)
**What changed (plain English):** the deletions the privacy policy promises now run every morning
(email records after a year, the team's change log after two, conversations three years after the
last message, a declined suggestion's contact details after a year). The team can suspend an
account on **Admin → Accounts**; a suspended person sees a page saying so and can still download
their data or delete their account. **Your account → Download your data** gives anyone a file of
their information. The team's daily note reminds them of deleted accounts still to finish. A
**Help** page and a footer on every page; "Something wrong with this listing?" on business pages;
link previews with a Localites picture (invitation links show only "You're invited"); a site map
and robots.txt for search engines. GitHub's Dependabot proposes package updates weekly.
**Migrations applied:** `0041_scheduled_deletions.sql`, `0042_account_suspension.sql`,
`0043_my_data.sql`, `0044_deletion_reminder.sql`
**Destructive?** 0041 deletes old records by design, as the privacy policy promises; nothing younger
than its period. The nightly backups keep 30 days.
**Tests run:** database checks 44 of 44 files (0041: 15, 0042: 17, 0043: 9, 0044: 4); unit tests 192
of 192; every browser suite (accounts 32 of 32, help and sharing 18 of 18, look 496 of 496, and the
rest unchanged).
**Security tests:** nobody but the morning run can delete from the change log (not the server, not the
database owner directly); a person, a business, a team-side claim without the role, the
browser-facing role and the suspended person can't suspend or lift; a suspended person reaches only
their data and deleting; Download my data gives only the person's own, never someone else's
activity on a shared computer, a business's private note, a hidden message or a denied review;
invitation previews show nothing private and set no cookie.
**Independent review before push:** fixed: a shared family computer could have put one person's
activity and searches in the other's download; the team's look-up no longer puts the email in the web
address; each kind of deletion now runs on its own; the data page no longer says "everything".
**Existing functionality affected:** the "it's listed" email is sent only within a year of the team's
decision on the suggestion.
**How to roll back:** with the next update; the deletions can be stopped by removing the morning call.
**Approved by:** the product owner, 18 October 2026 ("add all of them").

### 2026-10-18 — Messages in a business's Analytics (D-52); a daily summary of booking emails (D-53)

**Stage:** 2 (screens V10, X18)
**What changed (plain English):** a business's own Analytics page now also shows, for the chosen
period and the one before: new conversations, messages from people, how many conversations it
replied to, its typical first reply time, and how many people asked about it before it joined.
Booking emails to a business (marked booked, no longer booked, an event cancelled or changed)
now wait and go out as one summary per person each morning (about 8 am Toronto; a second run at
10 am sends any left over; at most 10 a run, oldest first). Someone who has left the business's
team since isn't sent it. If a summary can't be sent it waits for the next run, for up to two days. A booking marked and un-marked overnight isn't mentioned. The email to
a person when a business flags their booking still goes at once.
**Migrations applied:** `0039_contact_totals.sql` (one function, for the server only);
`0040_plan_summaries.sql` (a "waiting" email status, the summary line, cleared once
sent; an index; a check, for the server only, that someone is still on the business's team)
**Destructive?** No.
**Tests run:** database checks 40 of 40 files (0039: 4 checks; 0040: 11 checks); unit tests 191
of 191; event planning 145 of 145; analytics 53 of 53; reviews 73 of 73; messages 133 of 133;
inquiries 41 of 41; look 464 of 464.
**Security tests:** another business's numbers never appear; the browser-facing role can't read
the totals; a removed message and a past team's conversations don't count; a waiting email needs
its line, and an unknown status is refused; someone who left the business's team, staff, or the
owner of an archived business isn't sent the summary; the browser-facing role can't ask who is on
a team.
**Independent review before push:** fixed: someone who left the team between the change and the
morning would still have been sent it (now checked at send time); a run cut short after sending
could have sent it twice (now marked "being sent" first, as other emails are); 30 summaries a run
could exceed Cloudflare's limit with the "How was it?" emails (now 10, oldest first), and a failed
send now waits for the next run instead of being lost; one person's error no longer stops the
rest; the line with the person's name is cleared once sent; a line about an event changing is
dropped if the booking ends up un-marked; summary lines no longer count toward the per-person
daily email limit (the summary is one email). Also fixed a timing flake in the inquiry test.
**Existing functionality affected:** booking emails to businesses arrive the next morning instead
of at once.
**How to roll back:** with the next update (the status and column can stay; waiting rows would be
sent or marked not sent by hand).
**Approved by:** D-52 and D-53 (18 October 2026).

### 2026-10-18 — An email when a suggested business is listed (D-25)

**Stage:** 2 (screens P11, X19)
**What changed (plain English):** when someone signed in suggests a business, the suggestion is
linked to their account (from their sign-in, never from the form), and the thanks page says
"We'll email you when it's on Localites". They're emailed once, with a link, when the team
publishes the listing made from it, or straight away when the team marks it as a business that's
already listed. Someone who has since deleted their account isn't emailed. Signed-out suggestions
work as before. Also found: linking a conversation to an event was already built; the roadmap
said otherwise and is corrected.
**Migrations applied:** `0038_suggestion_emails.sql` (one more kind of email, and an index)
**Destructive?** No.
**Tests run:** database checks 38 of 38 files (0038: 4 checks); suggestion emails 9 of 9; admin
access 43 of 43.
**Security tests:** a signed-out suggestion naming someone in the form is linked to nobody; a
business that isn't listed sends nothing; someone who deleted their account isn't emailed.
**Independent review before push:** fixed: two team members publishing at once could send the
email twice (now one per suggestion, by an index); at most 50 a time (was 20). If the one email
fails, it isn't sent again.
**Existing functionality affected:** none.
**How to roll back:** with the next update (the email kind can stay).
**Approved by:** D-25 (10 October 2026).

### 2026-10-18 — Guests, part 2: the group link, QR codes, questions and updates

**Stage:** 4 (screens C13, C14, G1 to G3; D-08)
**What changed (plain English):**
- **The group link:** one link per event for a group chat, a social post or a printed invitation.
  Anyone with it replies with their name and sees only their own reply (and can change it from
  the same phone or computer). The host sees these replies on the Guests page, matches each to a
  guest on the list with one tap (that guest then shows the reply), or removes it. The host can
  switch the link off or make a new one; the old one stops at once.
- **A printable invitation with a QR code**, for the group link or one guest's own link.
- **Questions:** up to 5 short questions on every invitation ("Any allergies?"); answering is
  optional; the host sees each guest's answers.
- **Updates:** short notes ("We've moved to 3 pm") at the top of every invitation. Localites
  doesn't send them anywhere (D-08); the host can share them from their phone.
**Migrations applied:** `0037_guests_part2.sql`
**Destructive?** No. New tables and functions.
**Tests run:** database checks 37 of 37 files (0037: 39 checks); browser suites guests 47 of 47,
guests part 2 34 of 34, look checks 464 of 464; unit tests 191 of 191.
**Independent review before push:** nobody can see or change another person's guests. Fixed from
it: the 300-reply limit counts only unmatched replies and the host can remove all unmatched at
once (so a flood can't block the link); matching a second reply to a guest unlinks the first (it
could otherwise overwrite the guest's reply later); a test that passed for the wrong reason;
updates dated in Toronto time; less database work for the calendar file; the privacy model says
answers are kept with the event.
**Security tests:** another person and the team can't make, see or change the group link,
questions, updates or replies, or match a reply; a group link's guest never sees anyone else's
reply or the plan's private notes; a switched-off or replaced link opens nothing; nobody but the
guest writes their answers; the browser-facing role can't open an invitation.
**Existing functionality affected:** none.
**How to roll back:** a later migration drops the new tables; the pages can be removed with the
next update.
**Approved by:** D-08 (10 October 2026); the product owner asked for step 7 on 18 October 2026.

### 2026-10-18 — Approve or deny reviews from the email (D-51)

**Stage:** 3 (screens X15, C11)
**What changed (plain English):** the team's email about each new review has an **Approve** link
and a **Deny** link. Each opens the review on the team pages (signed in) with one button to
confirm. Denying needs no reason. The author of a denied review isn't emailed, and nothing about
it shows on their pages: their event plan doesn't mention it or offer to review that booking
again. The team pages and the audit log keep the record. The "your review wasn't published"
email is gone.
**Migrations applied:** none (a denied review is recorded with the reason "Denied by the team").
**Destructive?** No.
**Tests run:** reviews 73 of 73 (11 new), language check 40 of 40, event planning 141 of 141, look
checks 448 of 448; unit tests 191 of 191; database checks 36 of 36 files.
**Security tests:** the email's links refuse anyone not on the team (403); a denied author sending the form
directly gets the plain "can't be reviewed" (independent review); a denied review is
shown neither to its author nor to the public.
**Existing functionality affected:** declined reviews made before today are hidden from their
authors the same way.
**How to roll back:** with the next update.
**Approved by:** the product owner, D-51 (18 October 2026).

### 2026-10-18 — Words checked before they show (D-50)

**Stage:** 1 and 3 (owner editing, reviews; screen X21)
**What changed (plain English):**
- When an owner or manager saves their business page, the words they changed are checked: a list
  of offensive words, and Cloudflare's AI checker (free within its daily allowance). If either
  finds something, **the whole save waits**: the page doesn't change, the owner is told it's
  waiting (and can withdraw it), and the team is emailed. On the new **Held changes** team page,
  the team puts it live or declines it with a reason; the owner is emailed either way.
- **Reviews** still wait for the team as before; what the check found is shown to the team in the
  email and on the review.
- **A business's reply to a review** that the check flags is kept off its page until the team
  puts it live (or removes it).
- If the AI checker is unavailable, the word list's answer stands. Nothing is blocked or charged.
- An older test of the analytics page sometimes failed at random (it searched for "977" anywhere
  on the page, including random codes); it now looks for the number as shown.
**Migrations applied:** `0036_language_checks.sql`
**Destructive?** No. A new table, new empty columns on reviews, a replaced read function that
answers the same for every reply not held, two more kinds of email.
**Tests run:** database checks 36 of 36 files (0036: 24 checks); unit tests 191 of 191 (10 new);
browser suites language check 40 of 40, owner editing 55 of 55, reviews 62 of 62, admin access
43 of 43, business teams 38 of 38, analytics 51 of 51, look checks 448 of 448.
**Security tests:** the owner, another owner and someone not on the team can't put a held save
live; another person can't withdraw it; the business and the reviewer can't release a held reply;
nobody but the author (while it waits) sets a review's finding; a held save can't be rewritten or
deleted; a decision is final.
**Existing functionality affected:** owners' saves now take up to 4 seconds longer when the AI
checker is slow; otherwise none.
**How to roll back:** remove the `ai` binding and the check from the edit and review pages with the
next update; the table and columns can stay (empty).
**Independent review before push:** no way round the hold. Fixed from it: star rows ("*****")
read as a hidden word; everyday words removed from the list (spic and span, Maine Coon, redskin
potatoes, Van Dyke, gypsy jazz, prick the dough and others); the team's decision and the owner's
withdraw now lock in the same order; a re-saved decided review no longer errors; held replies of
removed reviews no longer wait; the privacy model says the words go to Cloudflare's AI.
**Approved by:** the product owner, D-50 (17 October 2026).

### 2026-10-18 — Users and roles, the audit log, How it works, For businesses

**Stage:** 1 (screens X10, X11, P6, P7)
**What changed (plain English):**
- **Users and roles** (`/admin/team`): the team sees who is on it, adds an admin by the email
  of an existing Localites account, and removes one, each with a reason. Nobody removes
  themselves. The database makes each change and records it; the app can no longer write the
  team's roles itself. Replaces the runbook's console steps.
- **Audit log** (`/admin/audit`): every recorded action, newest first, by who, by kind of
  record, or one record's history. Each look is recorded.
- **How it works** and **For businesses**: two reading pages, linked from Explore, saying only
  what the site does today.
- **Listing review (X3)** isn't built or planned for now: owners' changes go live with the
  team's daily note and Undo (D-34), so nothing waits for approval.
- A guest-invitation database check used the server's date instead of Toronto's, so it failed
  in Toronto's evenings; it now uses Toronto's date (the check only, not the database).
**Migrations applied:** `0035_team_admins.sql`
**Destructive?** No. Takes back the app's rights to write `platform_role`, adds two functions
and two indexes.
**Tests run:** database checks 35 of 35 files (0035: 24 checks); unit tests 181 of 181; browser
suites admin access 43 of 43, users and roles and the audit log 31 of 31 (paging and malformed
addresses included), look checks 440 of 440.
**Security tests:** a person, someone claiming the team side without the role, and an admin
acting as a person are refused; removing yourself is refused; a removed admin is refused on the
next click and can't add themselves back; forms from other websites refused; the browser-facing
role can't run either function.
**Existing functionality affected:** none. Adding admins in the SQL editor as the database owner
still works.
**How to roll back:** a new migration granting `insert, update on platform_role` back to
`app_server`; the pages can be removed with the next update.
**Approved by:** Stage 1 (D-23); the product owner chose this work on 17 October 2026.

### 2026-10-14 — The host changes replies; add to calendar (D-49)

**Stage:** 4 (E §4.6)
**What changed (plain English):**
- **The host** can change any guest's reply (coming, maybe, can't come, and how many) on that
  guest's page. If the host gave the guest's email and the event is still to come, Localites
  emails the guest what changed, with their own link to change it back. Limits: 10 a day per
  host, 3 a day per guest, 2 a day to one address, 30 a day across the site; if one is held
  back, the host is told to tell the guest themselves.
- **The guest's invitation** says when the host set their reply.
- **Add to calendar:** after saying yes or maybe, guests can add the event to Google, Apple
  (iPhone, Mac), Outlook.com, Microsoft 365, Yahoo, or any calendar with a file.
**Migrations applied:** `0034_host_changes_reply.sql` (who set a reply, the guest email record,
the host's reply function).
**Destructive?** No.
**Checked before release** by one independent review: added the 2-a-day limit per address (so
one address can't be mailed through many guests), the host is told when an email is held
back, and the calendar file handles line breaks and long titles correctly.
**Tests run:** database 0034 15/15 (new); end to end guests 47/47, look 408/408; unit 181/181
(5 new); checks; size.
**How to roll back:** Cloudflare → Deployments → previous version.

### 2026-10-14 — Guests and replies, part 1 (Stage 4)

**Stage:** 4 (E §4.6, §5, §8; ADR-032)
**What changed (plain English):**
- **Hosts:** each event has **Guests and invitations**: add guests, send each their own link
  from your phone (text, WhatsApp, email, the phone's share button, or copy), see who opened
  it and who replied, with totals, and write a message for guests. A new link replaces one sent
  to the wrong person.
- **Guests:** no account. Their link shows the invitation and lets them reply yes, maybe or no,
  with how many and a note, until the event.
- **Privacy:** only the host sees the list; links show nothing else; links stop 30 days after
  the event; phone numbers and emails are deleted 90 days after it.
- **The links' key** is made once by the deploy and kept in Cloudflare; no step for the owner.
**Migrations applied:** `0033_guests.sql` (the guest table, the guest message, the link and
reply functions, the 90-day erasing).
**Destructive?** No: adds a table, a column and functions.
**Checked before release** by one independent review: the key step now never replaces the key
unless Cloudflare clearly lists it missing; a host with no first name shows as "your host".
**Tests run:** database 0033 30/30 (new); end to end guests 38/38 (new), look 408/408, event
planning 141/141, account deletion 22/22; unit 176/176; checks; size.
**How to roll back:** Cloudflare → Deployments → previous version; the table can stay.

### 2026-10-14 — Reviews, part 2: "How was it?" emails and reporting a review

**Stage:** 3 (E §4.4)
**What changed (plain English):**
- **"How was it?":** the morning after an event, the host is emailed once to review the
  businesses they booked; once more a week later if they haven't; never after the 60 days.
  Events from the last 60 days are asked too. At most 20 of these a day. Anyone can turn
  them off on **Your account → Emails**.
- **Reporting:** "Report this review" under each review, for anyone signed in and for the
  business about its own. The team is emailed and sees it under **Admin → Reviews →
  Reported**: keep the review and close the reports with a reason, or remove the review.
- Staff on the account page now see a link to the business's messages (the old wording said
  messaging hadn't arrived).
**Migrations applied:** `0032_review_requests_and_reports.sql` (email choices, the morning
job's function, review reports and their rules).
**Destructive?** No: adds tables and functions only.
**Checked before release** by one independent review: fixed an interrupted run that could
have emailed a host twice, a long removal reason that blocked removing a reported review,
a failed team email that silenced later reports, and two reports at once both emailing the team.
**Tests run:** database 0032 35/35 (new), every earlier file passing; end-to-end reviews
62/62, look 384/384, every other suite passing; unit 176/176; checks; size.
**How to roll back:** Cloudflare → Deployments → previous version; the new tables can stay.

### 2026-10-14 — Reviews, part 1 (D-06, D-48)

**Stage:** 3 (E §4.4, §4.5)
**What changed (plain English):**
- **People:** once an event has passed, "Plan an event" shows "Review <business>" by each
  business marked booked (within 60 days). Stars and words; editable until the team decides.
- **The team:** each new review is emailed to the team and waits on **Admin → Reviews**:
  publish, decline with a reason (the person is told), remove a published review or a reply.
- **Businesses:** a published review shows on the business page as "Sarah M." (Living Local
  for the top 1% once there are 100 reviewers); the business is emailed and the owner or a
  manager can reply once. The average shows from 3 reviews.
- **Not yet:** the "How was it?" emails and reminder, and reporting a review (part 2).
**Migrations applied:** `0031_reviews.sql` (the review table, its rules and per-side
permissions, the public and team functions, two new email kinds).
**Destructive?** No: adds a table and functions only.
**Checked before release** by one independent review (CLAUDE.md): fixed a Living Local
tie that would have badged everyone, the team publishing words changed while they read
them, the author or business writing the team's reason, a second reply offered after a
removed one, and a waiting review left behind when its booking was unmarked or the event
cancelled.
**Tests run:** database 0031 42/42 (new), every earlier file passing; end-to-end reviews
39/39 (new), look 368/368, every other suite passing; unit 173/173; checks; size.
**How to roll back:** Cloudflare → Deployments → previous version; the review table can stay.

### 2026-10-14 — Files in conversations end (D-47)

**Stage:** 2 (E §8)
**What changed (plain English):**
- **The owner's rule:** a file in a conversation about an event ends 30 days after the event
  (a file sent after that still gets 30 days); any other conversation's file ends a year after
  it was sent.
- **What people see:** both sides see "This file has expired". The file box says how long
  files are kept.
- **Nightly run:** ends files at their date, then deletes their storage; a file covered by a
  report stays with the report.
**Migrations applied:** `0030_conversation_file_expiry.sql` (a column marking when a file
expired; the end-date and nightly functions).
**Destructive?** It deletes files at their end date, by the owner's rule; nothing else.
**Tests run:** database 0030 8/8 (new), every earlier file passing; end-to-end messages 133/133
(2 new), look 336/336; unit 173/173; checks.
**How to roll back:** Cloudflare → Deployments → previous version; a new migration can stop
the nightly ending.
**Approved by:** Product owner (D-47, 14 October 2026).

### 2026-10-14 — Files in conversations, after review (Stage 2B)

**Stage:** 2 (E §4.3, §8)
**What changed (plain English):**
- **Daily limit:** 20 files a day now counts everything a person sends, from every side. Before,
  someone on several business teams could send more.
- **Empty bubbles:** a message that was only a file, whose sender then deleted their account,
  now says "File removed" instead of showing empty.
- **Removed files:** a removed photo stops showing at once; browsers no longer keep it for 5
  minutes.
- **Clean-up:** deleting an account deletes its files from storage straight away; the nightly
  clean-up handles up to 20 at a time.
- **Errors:** an old error no longer sticks in the reply box.
- **First message:** a photo or PDF can now go with the very first message to a business
  (you asked for this), or be all of it.
**Migrations applied:** `0029_conversation_files_fixes.sql` (one function, `files_sent_today()`).
**Destructive?** No.
**Tests run:** database 0029 2/2 (new), every earlier file passing; unit 173/173; checks;
end-to-end messages 131/131 (2 new: a first message that's just a file, opened by the business),
account deletion and look checks passing.
**How to roll back:** Cloudflare → Deployments → previous version.
**Approved by:** Product owner (files in conversations, 14 October 2026).

### 2026-10-14 — Files in conversations (Stage 2B, part 3)

**Stage:** 2 (E §4.3, §8, §9; screens C8, V7, X13)
**What changed (plain English):**
- **Photos and PDFs in messages:** either side can add one photo or one PDF to a message, or
  send it on its own.
- **Photos** are made smaller in the sender's browser. The server removes hidden details such
  as where a photo was taken.
- **PDFs** (quotes, invoices, menus) go as they are, up to 4 MB.
- **Private storage:** files are kept in a private folder. The site hands a file only to the
  two sides of the conversation, checking every time.
- **Removal:** a file goes when its message is removed or hidden, or when its sender deletes
  their account, and its storage is deleted. The exception is a conversation reported while
  the file was there: the team keeps it, and opens it only through the report, logged.
- **Limits:** 20 files a day per person, and 700 MB in all.
- **Switching it on:** needs one step from the owner, PO-20, a private storage folder in
  Supabase. Until then, the reply box doesn't offer files.
**Migrations applied:** `0028_conversation_files.sql`:
- new table `conversation_file`, with per-side rules;
- a message needs words or a file, checked at the end of each step (it replaces the rule
  "not empty");
- files go with their messages and accounts;
- team-only functions to list and open a reported conversation's files, logged;
- housekeeping functions for deleting storage.
**Destructive?** No: one new table; the replaced rule is looser and every existing message
meets it. To undo, a later migration drops them and restores the rule.
**Tests run:**
- database 0028 32/32 (new), every earlier file passing (0023's empty-message check now
  expects the end-of-step refusal), proposal 31/31 (its old file checks removed, now built);
- end-to-end messages 129/129 (22 new: send and open a PDF and a photo, outsiders refused,
  wrong types and too large refused, location removed, removal deletes storage, kept for a
  report and opened by the team, logged, nobody else);
- every other suite passing, look checks 336/336;
- unit 173/173 (6 new); checks; size 308 KiB.
**Security tests:** another person, another business, someone not on the team, the team
directly and someone signed out can't open a file; a file sent to someone else's
conversation is refused and nothing kept; only the team opens kept files, through the report.
**How to roll back:** Cloudflare → Deployments → previous version; the database change is
undone by a new migration.
**Approved by:** Product owner ("Messages with businesses", 14 October 2026; "yes" to files
next).

### 2026-10-14 — Messages, fixed after a third review (Stage 2B)

**Stage:** 2 (E §4.3, §8)
**What changed (plain English):**
- **Emails fixed:** since the previous release, someone who read a conversation without
  replying was never emailed about the next message. Now they are, once per unread stretch
  as intended.
- **Kept words narrowed:** the team keeps the words of a removed message only if it was there
  when the conversation was reported, never anything written after the report.
- **Email time limit:** the email work no longer tries a second time if that would run past
  Cloudflare's 30-second limit for background work.
**Migrations applied:** `0027_conversation_fixes_3.sql` (two functions replaced:
`new_message_notices()` and `keep_reported_message_text()`).
**Destructive?** No. To undo, a later migration restores 0026's functions.
**Tests run:** database 0027 5/5 (new; the email check fails without this migration and passes
with it) and every earlier file passing; end-to-end messages 107/107 (1 new: read, then another
reply, emailed again), every other suite passing (the analytics speed-limit check needed a
minute's pause between local runs), look checks 336/336; unit 167/167; checks.
**How to roll back:** Cloudflare → Deployments → previous version; the database change is
undone by a new migration.
**Approved by:** Product owner (Messages, 14 October 2026), as the releases before.

### 2026-10-14 — Messages, fixed after a second review (Stage 2B)

**Stage:** 2 (E §4.3, §8; screens C7, C8, X13)
**What changed (plain English):**
- **No new team inherits conversations, closing two gaps in the previous release.** Its
  clean-up missed conversations a new owner had *already* taken over before it. A
  conversation started at the very moment an owner was being removed could also pass to the
  next team. Both are ended now. From now on, when a new team forms (an owner joins a
  business that has none), anything still open ends first.
- **Emails about a person's message** go only to people who were on the business's team
  when it was written, never about a conversation that has ended. The whole team's emails go
  in one request, which fits in the time Cloudflare allows. Any email request now gives up
  after 5 seconds and is recorded as failed. An email stuck "being sent" stops counting after
  10 minutes.
- **"Read up to"** is the newest message the page showed, never a later moment.
- **Evidence kept for reports:** if someone removes a message after its conversation was
  reported, the team still sees its words on the report. Both sides see it removed.
  **Hide** isn't offered for it any more; before, pressing it showed an error page.
- **Clearer words:** "… left Localites, so this conversation has ended", with a link to
  message the business afresh once it has joined again. Refusals use each side's own words.
- **Looking for new messages** also notices the event the conversation is about, and
  messages saved a moment out of order. A page whose conversation is gone reloads and says so.
**Migrations applied:** `0026_conversation_fixes_2.sql`:
- a new table `reported_message_text` (team-only, no rule for any side);
- two new triggers (a new team forms; keep a reported message's words);
- the 0025 email, "read up to" and conversation rules replaced;
- the 0024 report reading replaced, to show kept words;
- the read time loses its automatic default (the rule sets it);
- `end_inherited_conversations()` run once.
**Destructive?** No: no rows removed. Conversations a new team had wrongly inherited are
marked ended (none expected). To undo, a later migration restores 0025's functions and drops
the table.
**Tests run:**
- database 0026 20/20 (new) and every earlier file passing (0025 33/33, with one expectation
  updated to the person's own words);
- end-to-end messages 106/106 (5 new), every other suite passing, look checks 336/336;
- unit 167/167; checks.
**Security tests:** a new team can't inherit a conversation that slipped through while the
last owner was being removed; a later team member isn't emailed about earlier messages;
neither side can read kept words; the team can't write them.
**How to roll back:** Cloudflare → Deployments → previous version; the database change is
undone by a new migration.
**Approved by:** Product owner (Messages, 14 October 2026), as the release before.

### 2026-10-14 — Messages, fixed after review (Stage 2B)

**Stage:** 2 (E §4.3, §8; screens C7, C8, V6, V7)
**What changed (plain English):**
- **A business's next team never sees the last one's conversations.** When a business stops
  being claimed (the team uses Remove owner, or its last owner deletes their account), its
  conversations end. The person keeps their copy, told the business "isn't on Localites any
  more, so this conversation has ended", and can message it afresh if it joins again. Before
  this fix, a new owner approved later would have seen them.
- **When a person deletes their account**, their conversations end. The business keeps its
  copy, from "Former Localites member", and can't write to them.
- **A business that's taken down** (D-46): messages are paused both ways until it's listed
  again. Both sides can still read, and are told why.
- **Someone who joins a business's team** never sees their own conversation with it from the
  business's side.
- **Emails about new messages:** at most 30 a day across the site, which keeps room for sign-in
  codes in the email service's 100 a day; the rest are recorded as held back. The site decides
  about 20 seconds after a message, and never emails someone who has already seen it.
- **Looking for new messages** costs one small read instead of reloading the page. It slows
  down when nothing changes, and stops while nobody is there. The free plans count every
  request; the database connection allows 100,000 queries a day (now in the cost notes).
- **Send pressed twice** makes one message, and two quick starts make one conversation.
**Migrations applied:** `0025_conversation_fixes.sql`:
- two new columns on `conversation` (when it ended, and why), empty unless it ended;
- the one-conversation-per-pair rule now counts only conversations that haven't ended;
- the 0023 rules and email function replaced; three triggers added (a business stops being
  claimed, its last owner leaves, a person deletes their account);
- an index on `notification`.
**Destructive?** No: no rows are removed or changed (conversations already belonging to a
business that left, or a deleted account, are marked ended; none were expected, as messages
went live the same day). To undo, a later migration restores 0023's rules.
**Tests run:**
- database 0025 33/33 (new) and every earlier file unchanged and passing (0023 45/45, 0024
  19/19);
- end-to-end messages 101/101 (26 new), every other end-to-end suite passing, look checks
  336/336;
- unit 167/167; checks; size 304 KiB.
**Security tests:** a new owner can't open, read, mark, report, look at or reply to the last
team's conversations; someone on a team can't answer their own conversation as the business;
the quick look answers only the two sides.
**How to roll back:** Cloudflare → Deployments → previous version; the database change is
undone by a new migration.
**Approved by:** Product owner (Messages, 14 October 2026); the fixes follow ADR-029's rule
that a new owner never sees what the team told the last one, and D-46.

### 2026-10-14 — Report a conversation or message; the team's Reports (Stage 2B, part 2)

**Stage:** 2 (E §4.3 and §6; screens C8, V7, X13)
**What changed (plain English):** every message from the other side has **Report**, and every
conversation has **Report this conversation**, for the person and for anyone on the business's
team. The page says plainly that, because they reported it, the Localites team can read the
conversation, and that the other side isn't told who reported. The team is emailed a link
(never the messages). The team's new **Reports** page (count in the menu) lists who reported
what and why; opening a report shows the whole conversation, and each look is written to the
audit log with the report. The team can hide the reported message (both sides then see
"Hidden by Localites"), close the conversation ("The Localites team has closed this
conversation"; only the team can reopen it), and close the report as dealt with or with
nothing to do, with a note; each decision is recorded. Otherwise the team still can't open
any conversation.
**Migrations applied:** `0024_reports.sql` (new table `moderation_report` with its rules; the
conversation can be closed by the team; a message can be hidden by the team; three team-only
functions, each one logged).
**Destructive?** No: one new table and two new, empty columns. To undo, a later migration
drops them.
**Tests run:** database 0024 19/19 (new); end-to-end messages 75/75 (20 new: reporting a
message and a conversation from each side, outsiders refused, the team email, the list without
messages, a logged look, outsiders refused the team's pages, hiding, closing and reopening,
closing a report needs a note); look checks 336/336 (3 new pages).
**How to roll back:** Cloudflare → Deployments → previous version; the database change is
undone by a new migration.
**Approved by:** Product owner (Stage 2 plan, E §4.3; chose "Messages with businesses" on 14
October 2026).

### 2026-10-14 — Messages between people and businesses (Stage 2B, part 1: text)

**Stage:** 2 (D-13, D-17; screens C7, C8, C9, V6, V7)
**What changed (plain English):** on the page of a business that has joined Localites,
**Questions? → Message …** lets a signed-in person write to it, optionally about one of their
events (the business then sees only the date, the town and about how many guests). One
conversation per person and business. Everyone on the business's team (owner, managers and
staff) sees it under **My business → Messages (n new)** and can reply; the person sees only the
business's name on replies. Both sides are emailed about a new message once until they've
read it, with a link and never the message itself. Each person's new count is their own; no
read receipts or typing signs. Either side can block (on the business's side, owners and
managers); a block stops messages both ways. The author can remove their own message ("Message
removed"); nothing is rewritten. Open conversations look for new messages about every 15
seconds. Every conversation says "Localites doesn't process payments" and to share only
what's needed. "Messages" is in the header. Not yet: files, Report and the team's Reports
queue (part 2); until then the team can't open any conversation.
**Migrations applied:** `0023_conversations.sql` (new tables `conversation`, `message` and
`conversation_read` with per-side rules; functions for who to email and the event summary).
**Destructive?** No: new tables only. To undo, a later migration drops them.
**Tests run:** database 0023 45/45 (new); the Stage 2–3 proposal 35/35 (its conversation checks
moved to 0023); end-to-end messages 55/55 (new: where you can message; starting; the team's
emails and their contents; the business's side and each person's own count; replies under the
business's name; another person, another business, a former team member, someone with no
business and the Localites team all "not found"; removing; blocking both ways and who may;
the event taken off; a business that leaves); look checks 312/312 (5 new pages).
**How to roll back:** Cloudflare → Deployments → previous version; the database change is
undone by a new migration.
**Approved by:** Product owner (D-13 and D-17; chose "Messages with businesses" on 14 October 2026).

### 2026-10-14 — Inquire: honest about every email (review fixes)

**Stage:** 2 (ADR-024)
**What changed (plain English):** an independent review of Inquire found no privacy hole but
some places where the record could say more than was true. Now: each "it joined" email is
recorded before it's sent and the team's Inquiries page shows whether it went ("failed:
email them yourself" if not); a team email cut off part-way counts as not sent after 10
minutes, so the person can send it again, and the nightly run records it as failed; once
the business has joined, sending again isn't offered; the database allows only the steps
that make sense for an email's status; inquiry emails stop at 40 a day across the site (the
free email plan's 100 a day also covers sign-in codes), and the inquiry is still saved and
said so; a business that stops being claimed will have its askers told again if it rejoins;
the business's own team isn't told it joined; sending again keeps the event mentioned before
unless changed; the menu count and the list agree.
**Migrations applied:** `0022_inquiry_fixes.sql` (replaces the inquiry rule and
`take_joined_notices`; adds three small functions and one trigger).
**Destructive?** No: no table or row changes. To undo, a later migration puts back 0021's.
**Tests run:** database 0022 15/15 (new), 0021 23/23 (one check corrected to read back as
the team); end-to-end Inquire 41/41 (7 new: your own business, an interrupted email, a
failed email then the business joins, a failed "it joined" email; the email outage switch
always turned back on).
**How to roll back:** Cloudflare → Deployments → previous version; the database change is
undone by a new migration.
**Approved by:** Product owner (Inquire, 14 October 2026); fixes from the independent review.

### 2026-10-14 — Inquire, for businesses not on Localites yet

**Stage:** 2 (ADR-024, D-04, D-05; screens C10 and X14)
**What changed (plain English):** a business that hasn't joined Localites now shows
**Interested? → Inquire**. A signed-in person can add a note and mention one of their events
still to come; the page says exactly what our team receives (name, email, note, and the
event's kind, date, town and about how many guests, never its name or private details) and
that the business isn't sent anything. The team is emailed before the page answers, so the
person is told the truth: "We've passed your interest to our team, who'll get in touch with
them. We'll let you know if they join", or, if the email failed, that it's on the team's
list and they can try again. Once per business. The team's new **Inquiries** page lists them
(every look recorded) with a count in the menu. When the team approves the business's claim,
everyone who asked is emailed once that it joined. Deleting your account deletes your
inquiries.
**Migrations applied:** `0021_inquiries.sql` (new table `vendor_interest` with per-person
rules, the function `take_joined_notices`, and a trigger that deletes a deleted account's
inquiries).
**Destructive?** No: nothing existing changes. To undo, a later migration drops them.
**Tests run:** database 0021 23/23 (new) and every earlier file; the Stage 2–3 proposal
49/49 (now using the built table); end-to-end Inquire 34/34 (new: who sees Inquire, sending,
the team email and its honest failure, once per business, refusals, the daily limit, the
team's page and outsiders refused, the email when the business joins, no wording suggesting
the business got a message); look checks 272/272 (the Inquire page and the team's page).
**How to roll back:** Cloudflare → Deployments → previous version; the database change is
undone by a new migration.
**Approved by:** Product owner (D-04 and D-05, 10 October 2026; chose "Inquire button" on
14 October 2026).

### 2026-10-14 — A business taken down: hidden from people, and the team sees every booking

**Stage:** 2 (D-46)
**What changed (plain English):** when the team takes a business down, people no longer see
it in Saved or among the businesses they're considering, and can't mark it booked. Anyone
who already marked it booked keeps it on their plan by name only (no photo, no empty
square, no link), with "No longer listed on Localites. It stays here as your own record."
The team has a new **Bookings** page: every booking on Localites (which person marked which
business booked, listed or not, past events too), with the person's email so the team can
reach out. Bookings still to come of a business that's been taken down are listed first,
"Check in with these people", and counted in the team menu. Each listing's team page says
how many bookings are still to come and warns before taking it down. Nothing is deleted when
a business is taken down. People are told the team sees bookings (Mark as booked page,
event form, My events). Replaces the empty square from the release below.
**Migrations applied:** `0020_bookings_for_team.sql` (replaces 0012's rule for plan rows
with the same rule plus one refusal; adds two team-only functions).
**Destructive?** No: no table or row changes. To undo, a later migration puts back the 0012
rule and drops the two functions.
**Tests run:** database 0020 22/22 (new) and every earlier file; unit 167/167; end-to-end
event planning 141/141 (21 new: hidden from Saved and Considering, booking kept by name,
marking or un-marking refused, the team's page and count, every outsider refused, listed
again comes back), look checks 256/256 (the Bookings page; the taken-down plan); every
other suite unchanged and passing. Independent review: no privacy leak; its six smaller
points fixed (un-marking refused on the server too, hidden rows no longer count toward a
person's limits, one database connection per page, stricter tests, wording).
**How to roll back:** Cloudflare → Deployments → previous version; the database change is
undone by a new migration.
**Approved by:** Product owner (D-46, 13–14 October 2026).

### 2026-10-13 — Profile photos in a person's lists too

**Stage:** 1 and 2 (D-45)
**What changed (plain English):** the square profile photo now shows beside each business on
an event plan (Booked, Considering, Removed), on the plan's featured suggestions, in Saved
businesses and at the top of "Add to an event", as it already did in search results. A
business that's no longer listed shows an empty square instead (its photos show nowhere
until it's published again, E §9).
**Migrations applied:** none.
**Destructive?** No.
**Tests run:** look checks 246/246 (4 new: the photo on a plan, in Saved and on Add to an
event; gone from the plan and Saved once the business isn't listed); event planning
120/120; unit; checks.
**How to roll back:** Cloudflare → Deployments → previous version.
**Approved by:** Product owner (13 October 2026: chose "Profile photos in more lists").

### 2026-10-13 — Alerts when the site breaks (the site watch)

**Stage:** 1 (before launch; D-11)
**What changed (plain English):** a small separate Cloudflare program, the site watch, looks
at the test site every 5 minutes: its health check (website and database), the home page and
Explore. If that fails twice, 20 seconds apart, supportlocalites@gmail.com gets a plain email
saying what's wrong and what to paste into a new session; a reminder every 6 hours while it
stays down; and an email when it's back, with how long it was down. The first email says
alerts are switched on (the test alert PO-06 asked for). Switched on by PO-19 (its own email
key). GitHub puts it live after the site. Small change to the site: its email sender is
shared with the watch (no change in behaviour).
**Migrations applied:** none.
**Destructive?** No.
**Tests run:** unit 9 (new: when it emails, stays quiet, reminds and says it's back; reading
the health page's own words); the real watch program run on this machine against the local
test site, with emails to the pretend email service: switched on, quiet, down (site stopped),
quiet, back up (site restarted), exactly one email each time; build checked (8 KB).
**How to roll back:** Cloudflare → localites-watch → delete; and remove the CI step.
**Approved by:** Product owner (13 October 2026: chose "Alerts when the site breaks").

### 2026-10-13 — Automatic look and accessibility checks on every update

**Stage:** 1 (before launch)
**What changed (plain English):** before any update can go live, a real browser now opens 30
pages and screens (signed out, as a person planning an event, as a business owner, as the
team; with the photo viewer and the framing screen open) at phone size and computer size,
and checks that nothing is wider than the screen, that the standard accessibility checker
(axe-core, WCAG 2.2 A and AA: colour contrast, tap-target size, labels, headings, keyboard
reach) finds nothing, and that the page shows no errors. A failure stops the update, and the
failing page's screenshot is kept for 7 days. The first run found one real problem, now
fixed: the team's Activity tables, which scroll sideways on a phone, couldn't be scrolled
with the keyboard; each is now reachable with Tab, named for screen readers, and outlined
when it has focus.
**Migrations applied:** none.
**Destructive?** No.
**Tests run:** look checks 241/241 locally (both sizes, 30 pages and states); every earlier
suite.
**Not checked by tools:** a tablet size, comparing screenshots with an approved version, and
whether the wording makes sense read aloud.
**How to roll back:** remove `node tests/e2e/look.mjs` from `npm run test:e2e`.
**Approved by:** Product owner (13 October 2026: chose "Automatic look checks").

### 2026-10-13 — Nightly backups, each one proven to restore

**Stage:** 1 (before launch)
**What changed (plain English):** every night GitHub takes a full copy of the test
database (every business, account, plan and record), locks it with a passphrase only the
product owner chose, and keeps it for 30 days, outside Supabase. The same job then restores
that copy into an empty scratch database and checks every table, every row count, every
link between tables, a sample of published businesses and that nothing from before the
backup is missing. A failure emails the product owner. Switched on by PO-18.
**Migrations applied:** none.
**Destructive?** No: the job only reads the database.
**Tests run:** on a copy of the local test database (77 tables, about 30,000 rows): backup
taken (1.5 MB locked), restored and checked in 7.5 seconds; the check fails as it should when
rows are missing, when a business comes back different and with the wrong passphrase; the
locked file holds no readable business names or email addresses. An independent review's
findings were fixed: exact row counts from the backup file itself; each of 10 businesses
compared detail by detail; no row data in error messages; a missing secret fails loudly once
switched on; failure emails reach the product owner (PO-18 step 6); the database address is
hidden in the logs.
**Restore drill:** automatic, nightly (runbook F §6). The first run on GitHub is recorded here.
**How to roll back:** delete `.github/workflows/backup.yml` (backups stop; existing ones
expire after 30 days).
**Approved by:** Product owner (13 October 2026: chose "Nightly backups").

### 2026-10-13 — A square profile photo, and every page photo shown whole

**Stage:** 1 (photos)
**What changed (plain English):** replaces the one-shape (4:3) frames and "Choose what stays
in view" from earlier the same day, at the product owner's request. Each business now has a
**profile photo**: its logo or a photo it likes, always a square, beside its name in search
results and at the top of its page. Owners frame it on a full-screen **Frame your profile
photo** screen (opens by itself after choosing one): drag to move, pinch or the slider to zoom,
**Fill the square** or **Show whole photo** in one tap, what's left out dimmed rather than
hidden, and a live preview of the search result; **Start again** goes back to the automatic
framing. Nothing is cut away for good: only the framing is saved. Until a business picks one,
lists use its first page photo, framed automatically (a nearly square photo fills the square;
any other shape shows whole on a soft, blurred copy of itself). The up to 8 **page photos**
are never cut: the first leads the page in a calm band (whole, on a blurred copy of itself),
the profile photo sits over the band's edge beside the name, and all the photos follow in
tidy rows where each keeps its own shape. Tapping any opens a full-screen viewer (swipe,
arrows or keyboard; Escape or × closes). On computers, contact details sit in a column beside
the rest. Small text buttons across the site now look like links instead of grey boxes.
**Migrations applied:** `0019_profile_photo.sql` (four columns for the framing; the 8-photo
limit counts page photos only). Adds only; the spot columns from 0018 stay but are unused.
**Destructive?** No.
**Tests run:** database 0019 11/11 (new; each refusal checked for its exact reason) and every
earlier file; unit 155 (photo framing 8, new); end-to-end business photos 67/67 (the 7 "what
stays in view" checks replaced by 23 profile-photo checks) plus every earlier suite; checked in
a real browser at phone and computer sizes with wide, tall, square and very wide photos, a wide
logo, a small (120-pixel) logo and a 6:1 banner: framing screen (drag, Fill, Show whole, Save,
focus back afterwards), the business page, the viewer (swipe, arrows, Escape, focus back to the
photo), search results and the edit page. An independent review's findings were checked and
fixed (small logos framed wrongly, banners off-centre, a replaced profile photo and the previous
framing missing from the audit log, a rare clash with a team removal, a stale error message,
focus on closing).
**Security tests:** staff, another business's owner (through either page) and strangers can't
add, replace or frame the profile photo; a page photo can't be framed as one; framings out of
range, missing a side or not numbers are refused, in the page and again in the database.
**How to roll back:** Cloudflare → Deployments → previous version (profile photos then show
nowhere; nothing is lost).
**Approved by:** Product owner, D-45 (13 October 2026: "I want the business to have almost a logo
photo ... square ... additional photos ... landscape/portrait ... clean and inviting").

### 2026-10-13 — The test site goes live only after tests and the database update

**Stage:** operations
**What changed (plain English):** GitHub now puts the test site live itself, as the very
last step, after every check, every end-to-end test and the test database update have
passed, then checks the live site answers. A page can no longer fail because the database
change hasn't arrived yet, and an update that fails a test never goes live. Switched on by
PO-17 (a Cloudflare deploy key in GitHub, then Cloudflare's own builds turned off); until
then the step does nothing and says so.
**Migrations applied:** none.
**Tests run:** the deploy command checked locally without deploying (dry run: the build,
bindings and settings are as expected).
**How to roll back:** Cloudflare → Deployments → previous version; reconnect Cloudflare's
Git builds if GitHub deploys must stop.
**Approved by:** Product owner (13 October 2026: "set up the deploy wait for database changes").

### 2026-10-13 — Photos: one frame shape, and the owner chooses what stays in view

**Stage:** 1 (photos)
**What changed (plain English):** every photo frame on Localites now has the same shape, 4:3
(a little wider than tall), so pages look uniform whatever photos businesses add. A photo
fills its frame, centred. On **Your account → Photos**, under each photo, **Choose what stays
in view**: the owner taps the most important part of the photo once, and every frame keeps
it in view (a small preview shows how it looks). **Keep the middle in view** undoes it. Just
after adding a photo, this opens by itself. Tapping a photo on the business page opens the
whole photo. Works without JavaScript too (the browser's own image button sends the tap).
**Migrations applied:** `0018_photo_focus.sql` (two columns, the spot to keep in view; the
middle by default). Adds only.
**Destructive?** No.
**Tests run:** database 0018 4/4 (new); end-to-end business photos 51/51 (7 new) plus every
earlier suite; checked in a real browser at phone size: a wide photo added, its right edge
tapped, the business page keeps that edge in view; nothing wider than the screen.
**Security tests:** staff and another business's owner can't change what stays in view; a
tap outside the photo is refused.
**How to roll back:** Cloudflare → Deployments → previous version (frames go back to showing
the whole photo; the chosen spots stay stored).
**Approved by:** Product owner (13 October 2026: "keep things uniform but make sure the
approach for users is easy and seamless").

### 2026-10-13 — Fixes from the hosting review of planning and sign-in

**Stage:** 2 (not public)
**What changed (plain English):** a review of "Plan an event" and sign-in against the real
hosting's limits found 9 problems; all are fixed.
- Emails when an event is cancelled or moved now go one after another, paced for Resend,
  with one more try if Resend says "slow down", and at most 15 from one change (the rest are
  recorded for the team to follow up). Before, several businesses could miss the email.
- An email cut off mid-send no longer blocks later emails about that booking, and the nightly
  run records it honestly. A business is told "no longer booked" even when the "booked" email
  is still on its way.
- Sign in: when a code couldn't be sent, trying again is no longer told "we sent a code a
  moment ago". The countdown isn't read aloud every second by screen readers (only "You can
  ask for a new code now"); after a code is sent the cursor goes to the code box, which reads
  out the message; without JavaScript, "Send a new code" stays usable; a "too many tries" or
  server problem no longer marks the email box as wrong. On the team's two-step page a wrong
  code is linked to the box and the cursor goes back to it.
**Migrations applied:** none.
**Tests run:** unit 147/147; end-to-end 497/497; database tests unchanged; the countdown,
focus and announcements checked in a real browser.
**How to roll back:** Cloudflare → Deployments → previous version.
**Approved by:** Product owner's standing request for this review (check-in of 13 October 2026).

### 2026-10-13 — Categories and towns for the team (Stage 1 leftover; screens X6, X8)

**Stage:** 1
**What changed (plain English):** the team pages have **Categories and towns**. The team can
add, rename, describe, reorder and hide kinds of business (two levels: a main kind such as
Sweets and kinds within it such as Custom cakes) and towns, instead of asking for a database
change. Hidden ones stay on the businesses and events that use them but aren't offered for new
ones; a hidden main kind isn't shown when people browse. Web addresses never change, so links
keep working. A new town starts hidden until ticked. Every change is in the audit log.
**Migrations applied:** `0017_categories_and_places.sql` (web addresses fixed once made; two
levels only; no duplicate names under one main kind or in one region). Adds rules only.
**Destructive?** No. (If duplicates already existed, the migration would stop and change
nothing.)
**Tests run:** database 0017 13/13 (new) and every earlier file; unit 147/147; end-to-end
categories and towns 30/30 (new) plus every earlier suite (497 in all).
**Security tests:** someone not on the team can't open the page or change anything (403);
forms from another website are refused.
**Existing functionality affected:** a listing or event that uses a hidden kind or town keeps
it: the team's listing page and a person's Edit event page still offer it, marked "(hidden)",
so saving never drops it or forces a new town. Kinds within a hidden main kind are no longer
suggested on plans. The team's Activity page shows a kind within as "Main kind: Kind". A search
link to a kind within, or a hidden kind, now shows its name as the heading. An independent
review found 7 problems; all are fixed in this release.
**How to roll back:** Cloudflare → Deployments → previous version (the page disappears;
changes already made stay).
**Approved by:** Product owner (13 October 2026: "Admin: categories and towns").

### 2026-10-13 — Business photos (Stage 1 leftover; screens V2, P4)

**Stage:** 1 (E §9; ADR-003 file storage)
**What changed (plain English):** a business's owner or manager can add up to 8 photos at
**Your account → Photos**, each with a short description, and choose the main one. The main
photo shows at the top of the business's page and small beside it in search results; the
rest show under **Photos**. The owner's browser makes each photo smaller before sending it;
the website checks every file again, accepts only real JPEG or WebP photos, and removes
where and when the photo was taken. The team sees every new photo at **Admin → Photos** and
can remove any, with a reason. Removing deletes the files; if storage is down, the nightly
run finishes the job. Switched on by PO-16 (a storage folder in Supabase and three
Cloudflare secrets); until then the page says it isn't on yet.
**Migrations applied:** `0016_business_photos.sql` (rules on the photo tables made in 0001:
at most 8 per business, only the business's own described images, file details fixed after
upload, removed stays removed; one new column recording when a removed photo's files were
deleted).
**Destructive?** No.
**Tests run:** database 0016 18/18 (new) and every earlier file; unit 147/147 (11 new, the
file checks); end-to-end business photos 44/44 (new) plus every earlier suite (467 in all); one
real-browser check (a 4000 × 3000 photo with a fake location became a 1600 × 1200 WebP with
no location).
**Security tests:** strangers, staff and another business's owner can't open the page, add,
describe or remove (all "not found"); another owner can't remove a photo through their own
page; files are judged by their contents (a PNG named .jpg, an SVG with a script and a
3000-pixel photo are refused); location details are gone from the stored file, including any
hidden between parts of the picture or after its end; a photo stored on its side is refused
with what to do; forms from another website are refused; Admin → Photos refuses anyone not on
the team. An independent review (security, free-plan limits, correctness) found 12 problems,
all fixed before release (caches keep a removed photo an hour, not a year; the whole file is
checked; uploads without a stated size are refused; no long retries when storage is down).
**Existing functionality affected:** the business page, search results and the owner's edit
page now show photos when there are any (otherwise as before).
**How to roll back:** Cloudflare → Deployments → previous version (photos stop showing and
the Photos page disappears; stored photos and their records stay).
**Approved by:** Product owner (13 October 2026: "Business photos").

### 2026-10-13 — Owners add their own team (Stage 1 leftover, screen V4)

**Stage:** 1 (E §3 roles; supersedes D-29's "no teammates yet", on the product owner's
choice of 13 October 2026)
**What changed (plain English):** a business's owner can now invite a **manager** or
**staff** by email from **Your account → Team**. The invited person signs in with that
email address and accepts. Managers can edit the listing, see bookings marked and see
Analytics (when it's switched on); staff see the business on **My business** with a note
that they'll answer messages when messaging arrives. Only the owner can invite, cancel an
invitation or remove someone; removing someone ends their access at once. If a business's
last owner leaves, everyone else on its team leaves too.
**Migrations applied:** `0015_business_teams.sql` (one new table for invitations; one
automatic rule that ends a team when its last owner leaves). Adds only; nothing existing
changes.
**Destructive?** No.
**Tests run:** database 0015 9/9 (new) and every earlier file; unit 136/136; end-to-end
business teams 38/38 (new) plus every earlier suite (423 in all).
**Security tests:** another business's owner, a manager, staff and someone not on the team
can't open or change the team (all "not found"); an invitation can't be accepted by another
address, twice, after cancelling or after 7 days; it can't make someone an owner; forms
from another website are refused; a removed manager loses access at once; staff can't edit,
see bookings or see the team.
**Existing functionality affected:** managers can now open Edit, Bookings and Analytics for
their business (before, only owners existed).
**How to roll back:** Cloudflare → Deployments → previous version (the Team page
disappears; anyone already on a team stays on it until removed by the team).
**Approved by:** Product owner (13 October 2026: "Owners add their own staff").

### 2026-10-13 — Delete your account (Stage 1, before launch; E §8)

**Stage:** 1 (a launch requirement; D-10)
**What changed (plain English):** **Your account → Delete your account.** The page says
plainly what goes and what stays, and asks the person to type their email address. Then,
at once: their events, plans and saved businesses are deleted; their name, email and
personal details are erased; they leave any business's team (a business with no owner left
goes back to unclaimed); open claims are withdrawn; they're unlinked from activity and
suggestions; they're signed out and shown "Your account is deleted". Team members can't
delete their account here. One step stays manual: the team removes the person's Supabase
sign-in record within 30 days, from **Admin → Deleted accounts** (runbook).
**Migrations applied:** `0014_account_deletion.sql` (one table for the team's list; one
function that does the deletion, run as the person themselves).
**Destructive?** Only for the person who asks, by design; nobody else's data changes.
**Tests run:** database 0014 20/20 (new) and every earlier file; unit 136/136; end-to-end
account deletion 22/22 (new) plus every earlier suite.
**How to roll back:** Cloudflare → Deployments → previous version (the page disappears;
deleted accounts stay deleted).
**Approved by:** Product owner (13 October 2026: "Delete my account").

### 2026-10-13 — Bookings marked before a business joined (Stage 2, not public)

**Stage:** 2 (D-44, ADR-031)
**What changed (plain English):** if someone marks a business booked before it is on
Localites, and the business joins later, it sees that booking only if the event is still to
come. Bookings for events already past stay hidden from it (and can't be flagged), so a
new business can't see how popular it has been. The Mark as booked page says: "If … joins
Localites before your event, they'll see that you marked them booked …".
**Migrations applied:** `0013_bookings_before_joining.sql` (replaces two functions from 0012
with the same columns and rights; adds one small helper).
**Destructive?** No: no table or row changes. To undo, a later migration puts back the 0012
versions.
**Tests run:** database 0013 6/6 (new), 0012 164/164 and every earlier file; unit 136/136;
end-to-end 363/363.
**How to roll back:** Cloudflare → Deployments → previous version; the database change is
undone by a new migration.
**Approved by:** Product owner (D-44, 13 October 2026).

### 2026-10-13 — Sign-in: a 60-second countdown, honest replies, header always right (Stage 1, not public)

**Stage:** 1 (ADR-028; reported by the product owner: a code that didn't arrive, and the
site looking signed out and then signed in)
**What changed (plain English):**
- **"Send a new code" is greyed out and counts down from 60 seconds** after a code is
  sent, the same wait Supabase keeps between codes to one address. Asking sooner is refused
  with how long to wait, and isn't counted against the 3 codes an hour.
- **No more "we've emailed a code" when nothing was sent.** If Supabase refuses a code
  because one was sent moments before, the page now says to use that one.
- **The header is checked on every page**, so it never shows "Sign in" to someone signed in,
  or "My events" and "Account" after a session has ended (it could before, until a full page
  reload; that is the likely cause of "logged out, then not").
- **Team two-step page:** a renewed sign-in is now always saved in the browser, even when the
  code typed is wrong (before, the browser could keep an old key, which could later end the
  session).
- **Welcome:** "Localites" without the full stop.
**Not found:** why the first code didn't arrive. Nothing in this week's changes touched how
codes are sent; the runbook now lists where to look (spam, then Resend's Emails log, then
Supabase's Authentication logs).
**Migrations applied:** none.
**Destructive?** No.
**Tests run:** checks passed; unit 136/136; end-to-end 363/363 (sign-in and claiming now
74, with the countdown and the honest "wait" reply); in a real browser at phone width the
button reads "Send a new code (60)", greyed out, then counts down.
**How to roll back:** Cloudflare → localites → Deployments → previous version → Deploy.
**Approved by:** Product owner (13 October 2026: "make the supabase and our timers match").

### 2026-10-13 — Plan an event (Stage 2, slice 2A; not public)

**Stage:** 2 (D-13, D-18, D-39 to D-43; ADR-031)
**Status:** built and tested on our computers; not yet committed or deployed. It reaches the
test site with the next update, then PO-15.
**What changed (plain English):**
- **People plan events.** **My events** in the header (when signed in) and **Plan an event**
  on Welcome. An event needs a name (private), a date and a town; the kind of event is one
  optional tap. More details (times, guests, where, ages, budget, notes) are optional. The
  box on the form says exactly what a booked business will see (D-40).
- **The event's plan.** Businesses **Booked** and **Considering**, removed ones, "What's
  next", and **Ideas for your …**: up to 3 businesses labelled **Featured** with "Featured
  businesses are promoted by the Localites team.", and "Businesses people often need"
  linking to category lists (D-43). With no kind of event, one quiet line linking to Edit
  details. Edit, cancel (final), mark booked, un-mark, remove and put back, each asking first
  in plain words and working without JavaScript.
- **From a business's page:** **Add to event** (two taps, or a quick new event) and **Save**;
  **Saved businesses** lists them. Nobody is told.
- **Businesses:** **My business** lists a person's businesses with bookings coming up; the
  switch between **My events** and **My business** for people on a business's team.
  **Bookings marked** shows only the person's name, the date, the town and about how many
  guests (D-40), with **This isn't right** (once). Emails when marked booked, no longer
  booked, the event cancelled or its date or town changed, with repeats held back.
- **Flags (D-41):** the team is emailed (no note, no name) and sees **Booking flags (n)**
  (read-only, every look recorded); the person is emailed politely and their plan says so.
- **The team:** **Event types** (add, rename, order, hide; suggested kinds of business;
  featured businesses with first and last day, a team note and End early; all recorded) and
  "Planning (team only)" counts on **Activity** and each listing's Activity page (D-42).
- **Your account** has a "Planning" section and, for owners, a **Bookings marked** link.
- **Local tests only:** a pretend email service now also receives the site's own emails
  (`EMAIL_API_URL`, used only when it points at this computer), so tests can check what
  each email says.

**Migrations applied:** `0012_event_plans.sql` (to the local test database only so far):
who is acting; `event_type` (11 starting kinds, D-39), `event`, `event_private`,
`event_vendor`, `saved_vendor`, `event_type_category` (77 starting suggestions, only from
existing categories), `featured_placement` (no money columns); the rules and history
triggers; `featured_for_type()`, `plan_counts_for_team()`, `plan_type_counts_for_team()`;
three notification kinds; row-level security on all seven tables with minimal rights.
The proposed Stage 2–3 schema and its checks were trimmed to match (the event part moved
into 0012).
**Destructive?** No: new tables, functions, rules and rights; one list of notification kinds
widened; starting kinds and suggestions added; no existing row changed. To undo, a later
migration drops the new tables and functions.
**Tests run (13 October 2026):**
- `npm run check` (lint, types, tokens, words): passed. The words check now also covers
  "secure booking", "list a business", "fee" and "fees", and scans `src/lib/*-terms.ts`.
- Unit tests: **136 / 136** (25 new for planning: inputs and dates, wording, refusal codes,
  emails never carrying private values, the one-statement "who is acting" setting).
- Database checks: 0001 51/51, 0003 12/12, 0004 19/19, 0005 13/13, 0006 5/5, 0007 22/22,
  0008 4/4, 0009 51/51, 0010 9/9, 0011 5/5, **0012 164/164 (new)**; proposed Stage 2–3 schema
  **49/49** (was 56: its 7 event-plan checks moved into 0012).
- End-to-end: admin access 43/43, sign-in and claiming 73/73, are-you-human 20/20, owner
  editing 55/55, activity and analytics 51/51, **event planning 120/120 (new)**.
- Build: Worker 255 KiB compressed, 8% of the free plan's 3 MiB.
- Real browser by hand at 360 px (phone) and 1280 px (computer), as a person, an owner and
  the team: 91/91 checks, 56 screenshots, no sideways scrolling; four small display problems
  found and fixed (missing open/close arrows, "12 October" date order, radio colour, the
  team menu on a phone).
**Independent review (13 October 2026), fixed before release:** a business now reaches its
bookings only through two database functions that give exactly the D-40 summary (before, the
database would have let its side read the event's kind and times); the business's note is
in a team-only table (before, the person's side could have read it); plan row ids are
random; a flag belongs to one marking; "marked booked" and date or town changes are no
longer held back when they are news; events older than 60 days can still be edited; "Put
back" respects the 40-business limit and a listing that's gone; email dates give the year;
My events always lists upcoming events first; the edit and cancel pages promise to tell
only businesses that can be told; the Mark as booked page says exactly what the business
will see, and what happens if a business not on Localites joins later. (One review area,
platform and deploy risks, was cut short by a usage limit and is to be re-run.)
**Security tests:** another person, another business's owner, staff, and someone not on the
business all get "not found" on events, plans, bookings and flags that aren't theirs, and
nothing changes; a business never sees a "considering" plan, the event's name or kind, start
time, where, ages, budget, notes, other businesses or the person's email, on any page or in
any email; the flag note never reaches the person; non-team accounts are refused Event types,
Booking flags and the planning counts; no page or email suggests paying or a confirmed
booking.
**Existing functionality affected:** the header (My events, Account), Welcome (Plan an event
button), Your account, the public business page (Planning an event? section), the team's
Activity pages and menu. The other suites' emails are now recorded as `sent` in local tests
and CI (the pretend email service accepts them); their checks accept either. The owner-editing
suite now puts back in waiting any saves from an earlier run's note on the same day before
running the daily note again, so the suite can be rerun on one database the same day.
**Not tested here (stated plainly):** the "who is acting" settings through Hyperdrive and
Supabase's pooler (PO-15 and the runbook's after-deploy check); whether Supabase's `postgres`
role can apply 0012 (it stops cleanly if not); the CI changes have run only locally so far;
real email delivery through Resend for the new emails.
**How to roll back:** Cloudflare → localites → Deployments → previous version → Deploy. The
new tables can stay; nothing else reads them.
**Approved by:** Product owner (D-39 revised, D-40, D-41, D-42, D-43; 12 October 2026).

### 2026-10-12 — "Are you human" check on signing in (Stage 1, not public)

**Stage:** 1 (ADR-028 update)
**What changed (plain English):** "Email me a code", "Send a new code" and checking a code
now need Cloudflare's free "are you human" check (Turnstile). Usually it passes by itself in
a second; now and then it asks for a tick. Our server confirms each pass with Cloudflare
before sending a code or trying a guess, and each pass works once, so a script can no
longer use up the day's sign-in codes, or someone's codes and guesses. If Cloudflare can't
be asked, sign-in says "try again in a minute" rather than skipping the check. **Parked
the same day (D-38):** the product owner prefers the emailed code alone, so the check is
switched off (no keys in Cloudflare) and the team's Claims page doesn't mention it.
**Migrations applied:** none.
**Destructive?** No.
**Tests run:** unit 111/111 (6 new); end-to-end 43/43, 73/73, 20/20 (new: no code sent and
no guess counted without a fresh pass for this form on this site; a pass can't be reused;
a checker that can't be reached refuses), 55/55, 51/51; in a real browser 10/10 with a
stand-in for Cloudflare's script (the button waits for the check, both forms carry the
answer, a fresh check after every reply, a plain message if the check can't load). Not
tested here: Cloudflare's own widget, which this workspace can't reach; check it on the
test site if it is ever switched on.
**Security tests:** passes made for another form or another site are refused; the secret
key never appears in pages.
**Existing functionality affected:** none while parked. Team
sign-in (/sign-in) is unchanged.
**How to roll back:** Cloudflare → localites → Deployments → previous version → Deploy; or
delete `TURNSTILE_SITE_KEY` to switch the check off.
**Approved by:** Product owner (12 October 2026: "add are you human check").

### 2026-10-12 — Activity counting and the Analytics page (Stage 1, not public)

**Stage:** 1 (D-22, D-30, D-37; ADR-030)
**What changed (plain English):**
- **Counting.** Localites now counts, for each business: how often it's seen in search
  results and category lists (and at what place), page opens, Visit website and Call taps,
  time on the page and whether the services were seen. It also records where visitors came
  from (Localites, Google, social media, another site), phone or computer, an approximate
  town, the time of day, and what people searched for (including searches that found
  nothing).
- **Only real visits count.** Only what a real browser confirms is counted, against a note
  the page's server signed for that browser. Search engines, link previews and made-up
  reports are refused.
- **Limits.** New browsers per internet address are limited, and so is what's kept each day.
- **Left out.** Visits by a business's own people and by the team are left out of the totals.
- **Each morning** the day before is added into the totals.
- **Owners** see their own **Analytics** page once the team switches it on for their
  business. It shows totals, never who; small groups are combined. The team has
  **Activity** (all businesses, search demand, the nightly count, database space) and an
  Activity page per listing with the on/off switch. Each look at the detail is recorded.
- **Counting stays off until the activity key is added (PO-14).**

**Migrations applied:**
- `0009_activity_tracking.sql`: more detail per action; list pages; nightly totals; which
  browser is whose; the per-business switch; the nightly count's record; the recording
  and counting functions.
- `0010_activity_limits.sql`: daily limits; list places only from real lists; every town
  kept per day.
- `0011_activity_fair_limits.sql`: per-browser daily caps (300 actions, 100 searches), and a
  record of days the site-wide limit was reached.

**Destructive?** No (new tables, columns, indexes and functions; three check lists widened;
one grant narrowed; the activity tables were empty).
**Tests run:**
- Unit tests: 105/105 (new: where visitors came from, phone or computer, browser reports,
  signed notes and visitor cookies, bots, periods, the owner's wording).
- Database checks: 51, 12, 19, 13, 5, 22, 4, 51 (new), 9 (new) and 5 (new), and 56/56.
- End-to-end: 43/43, 73/73, 55/55 and 51/51 (new: signed notes tied to one browser; signed
  visitor cookies; other
  sites, forms, changed or passed-around notes and bots refused; the new-browser limit; the
  owner's and team's visits marked; the nightly count; the owner's page only for its owner
  with the switch on; owners can't switch it on; team pages refused to everyone else; each
  look at the detail recorded once).
- Real-browser check at phone size: seen in a list, opened from it, Back to the results
  (not counted again), a tap, time on the page.

Two independent reviews found 8 confirmed and 26 smaller problems; all were fixed, or are
stated plainly under ADR-030's known limits.

**How to roll back:** Cloudflare → localites → Deployments → previous version → Deploy.
Remove the activity key to stop counting at once; the new tables can stay.
**Approved by:** Product owner (D-22, D-30, D-37).

### 2026-10-12 — Owner editing: fixes from the independent review (Stage 1, not public)

**Stage:** 1 (D-34, ADR-029 review)
**What changed (plain English):** An independent review of owner editing found 14 confirmed
problems and 26 smaller ones. All are fixed:
- A box the owner left alone keeps exactly what was stored. Text the team wrote (even with
  a web address in it, or extra spaces) no longer blocks a save or shows up as an owner's
  change, and "Nothing to save" now appears when nothing changed.
- Details added to an existing service can be undone, and are no longer called a "new
  service".
- A new owner no longer sees what the team told the previous owner.
- A partly undone save says which lines were put back and which kept. A website a past
  owner typed in is still flagged on Claims, and the server refuses it as email evidence.
- The team's Details and Services forms only write the boxes the team member changed, and
  say so if the owner changed the same box meanwhile.
- Undo problems ("someone already undid this") now show.
- On the owner's page:
  - the phone's Back gesture from **View as a visitor** returns to editing;
  - leaving with unsaved changes asks first;
  - focus follows the preview;
  - "Nothing to save" shows by the button;
  - a hidden listing is described honestly;
  - a team change to a service shows what it now says.
- The "web address" check no longer trips on a missed space after a full stop ("area.To"),
  and names the words it objects to. A website with an "@" in it is refused.
- A save made while the owner is being removed waits and is then refused.
- A web address renamed by the team while the owner's page was open still saves.
- Quick saves can't each send a "check now" email.
- The daily note uses one connection, records a run that stopped part way, and says when a
  save was only partly undone.
- Your account no longer offers to edit an archived listing.
- Older documents now match D-37 (an Analytics page, switched on per business; no reports
  emailed to owners).

**Migrations applied:** `0008_owner_alert_sending.sql`: one more state ('sending') for a
"check now" email.
**Destructive?** No (one constraint widened).
**Tests run:**
- Unit tests: 92/92.
- Database checks: 51, 12, 19, 13, 5, 22 and 4 (new), and 56/56. The "unknown flag" check
  now tests the constraint itself.
- End-to-end: 43/43, 73/73 and 55/55. The 10 new checks cover:
  - team text with addresses doesn't block a save;
  - a team save keeps the owner's newer phone;
  - a team clash is explained;
  - a renamed web address still saves;
  - a partial undo is described;
  - the undo error shows;
  - the past-owner website is refused as evidence;
  - a new owner doesn't see old notices;
  - archived listings are left out of Your account;
  - another business's service is stopped by the database rule itself.
- Browser checks (phone size): 13/13 (Back from the preview, leave warnings, focus, no extra
  rows after a refused save, "Nothing to save" by the button, saving doesn't warn).

**How to roll back:** Cloudflare → localites → Deployments → previous version → Deploy. The
widened constraint can stay.
**Approved by:** Product owner (D-34).

### 2026-10-11 — Owners edit their own listing (Stage 1, not public)

**Stage:** 1 (D-34, ADR-029; D-37 recorded)
**What changed (plain English):** An approved owner sees **Edit your listing** on Your account
(and on their business page). The edit page looks like their business page, with dashed
boxes for what they can change: short description, About, services and prices (add, change,
hide), website and phone. **View as a visitor** shows exactly what visitors will see, before
saving. **Save changes** makes it live at once. The business name, town and categories stay
with the team ("Email us to change them"). The team gets: a daily note of every owner change
(and nothing when nothing changed), a "check now" email when a website moves to another site
or a phone number changes, **Undo** for any save (the owner is told why), and **Remove
owner**. The Claims page warns when a past owner set the website. The "claim approved" email
now links straight to the edit page. The business page now shows a service's details and
keeps paragraph breaks.
**Migrations applied:** `0007_owner_editing.sql`: `owner_change` (the team's review state for
each save) and `team_digest` (one daily note a day); two more kinds of email to a person.
**Destructive?** No.
**Tests run:** unit tests 82/82 (new: what owners can type, what a save changed, clashes,
"check now" flags, undo plans, the plain words); database checks 51, 12, 19, 13, 5 and 22
(new) of the same, and 56/56; end-to-end 43/43, 73/73 and 45/45 (new: only the owner, never
another business's owner, someone without a business or a team admin; archived refused,
hidden allowed; another business's service in the form stops the save; refused websites and
addresses in text; nothing-to-save; live at once; name, web address and email can't be
changed; recorded and flagged; a team change while the owner's page is open is kept, and a
clash is explained; the team page; undo needs a reason, hides an added service, shows a
hidden one, can't run twice, and the owner is told; owners can't use undo; the daily note
records its outcome and runs once a day; Remove owner ends access and is recorded); phone-
size screenshots of the edit page and the visitor preview.
**How to roll back:** Cloudflare → localites → Deployments → previous version → Deploy. The
new tables can stay.
**Approved by:** Product owner (D-34).

### 2026-10-11 — First and last name, in two boxes (Stage 1, not public)

**Stage:** 1 (D-36, as amended)
**What changed (plain English):** "Your name" is now two boxes, **First name** and **Last
name**, on sign-up and on Your account. Neither is labelled as required, but if either is
empty, *Continue* shows "Please enter your first and last name to continue.", marks the
empty box and puts the cursor in it. The name shown elsewhere is still "First Last". Team
accounts made before this start with their whole name in the first box.
**Migrations applied:** `0006_person_names.sql`: two new columns on `app_user` (both or
neither).
**Destructive?** No.
**Tests run:** unit tests 69/69; database checks 51/51, 12/12, 19/19, 13/13, 5/5 (new),
56/56; end-to-end 43/43 and 73/73 (new: a missing last name stops sign-up with that
message and saves nothing; first and last names saved separately); phone-size
screenshot.
**How to roll back:** Cloudflare → localites → Deployments → previous version → Deploy. The
new columns can stay.
**Approved by:** Product owner (D-36).

### 2026-10-11 — Sign-up asks about the person; a clear "check your spam" reminder (Stage 1, not public)

**Stage:** 1 (D-36)
**What changed (plain English):** After the emailed code, new people now see "Tell us a
little about yourself": their name (required), then gender (including "I'll describe it
myself" and "Prefer not to say"), date of birth, and street address (unit, town, province,
postal code). Only the name is needed to continue; nothing is labelled required or
optional, and postal codes are tidied ("l3v1a1" becomes "L3V 1A1"). The same details can
be filled in or changed later on **Your account**. Businesses never see them. The code
screen now has a boxed reminder to check the spam or junk folder (and Outlook's "Other"
or Gmail's "Promotions" tab).
**Migrations applied:** `0005_person_profile.sql`: one new table for these details.
**Destructive?** No.
**Privacy change:** E §7 no longer says "name and email only" or "no children's accounts":
anyone may join, with a date of birth, so the lawyer (PO-07) now reviews this, including a
parent's consent for children under 13.
**Tests run:** unit tests 69/69 (new: blank details keep nothing, tidying, impossible dates,
postal codes, choices not on the list); database checks 51/51, 12/12, 19/19, 13/13 (new),
56/56; end-to-end 43/43 and 72/72 (new: the details screen doesn't demand anything, a bad
postal code saves nothing, details saved and tidied, none kept for a name-only sign-up,
added later and cleared on Your account, another person's details never shown and a form
naming someone else changes only your own); phone-size screenshots.
**How to roll back:** Cloudflare → localites → Deployments → previous version → Deploy. The
new table can stay; the previous version ignores it.
**Approved by:** Product owner (D-36).

### 2026-10-11 — Sign-in and claiming: fixes from an independent review (Stage 1, not public)

**Stage:** 1 (ADR-028, update of 11 October)
**What changed (plain English):** An independent review of yesterday's sign-in and claiming
work found real problems, now fixed:
- A sign-in link could hide another website's address (with an invisible tab character)
  and send people there after they signed in. Now any such address goes to the account
  page.
- Many guesses at a code sent at the same moment could get past the limit of 5. Guesses
  are now counted one by one before they're checked.
- While new accounts are closed (until PO-13), a fourth request in an hour, or Supabase's
  replies, could show whether an address has an account. Now every reply is the same.
- Two team members acting on the same business at the same moment could get an error
  page. Now they simply take turns.
- The approval reason could be set to junk by editing the form. Now only the three listed
  reasons are accepted.
- Names can't contain bare web addresses (e.g. "evil-site.com"), which email apps would
  turn into links.
- Wording: the approval email and claim page no longer suggest owners can edit their
  listing yet (they reply to the email with changes until D-34 is built); the account page
  names the right button; sign-in errors are tied to their boxes for screen readers.
- PO-13 step 9 now says to *decline* the test claim, since an approval can't be undone from
  the admin page yet.
**Migrations applied:** none.
**Destructive?** No.
**Tests run:** unit tests 63/63 (new: hidden-character addresses, IPv6 limit keys, bare web
addresses in names); database checks 51/51, 12/12, 19/19, 56/56; end-to-end 43/43 and
65/65 (new: hidden-character "next" addresses; 12 guesses sent at once, of which only 5 are
tried). Checked by hand against the local sign-in server with new accounts closed: an
address with an account and one without get identical replies on all 4 requests.
**Known limits (written into ADR-028):** anyone can use up the site's 60 codes a day, or one
person's 3 codes an hour; the remedy is Cloudflare's free "are you human" check
(Turnstile), recommended before the public launch.
**How to roll back:** Cloudflare → localites → Deployments → previous version → Deploy.
**Approved by:** Product owner (D-32, D-33, D-35).

### 2026-10-10 — Sign in with an emailed code; claiming a business (Stage 1, not public)

**Stage:** 1 (D-27, D-29, D-32, D-33, D-35; ADR-028)
**What changed (plain English):** A **Sign in** link in the header opens *"Sign in or
create an account"*: type your email, enter the 6-digit code we email you, and (first time
only) your name. No passwords. Every unclaimed business page now asks *"Is this your
business?"* with **Claim this business** and a way to ask us to remove it. A claim says how
the person is connected to the business, with an optional note, and needs them to confirm
they're allowed to manage the listing. **Your account** shows your name and email, the
businesses you manage and your claims (waiting, approved, or not approved with the
reason). The team's new **Claims** page shows each claim's evidence (whether the email is
at the business's own website) and the business's own published phone and email; the team
approves (saying how it was confirmed) or declines with a reason. The first approved claim
wins: the person becomes the owner and any other claims are declined automatically. The
claimant and the team are emailed at each step (once PO-12 and PO-13 are done), and every
email is recorded as sent or failed. The team's own sign-in is now labelled **Team
sign-in**; an emailed-code sign-in never opens the team pages.
**Migrations applied:** `0004_claims_and_sign_in.sql`: how a claimant is connected to the
business; a declined claim must have a reason; one active owner per business; the
`notification` table (moved forward from the Stage 2 proposal); `sign_in_code_event` for our
code limits. Applied to the test database by GitHub after the checks pass.
**Destructive?** No: new columns, constraints on rows that don't exist yet, new tables.
**Tests run:** unit tests 60/60 (new: Supabase error codes, the inputs for joining and
claiming, claim emails, email-to-website matching); database checks 51/51, 12/12, 19/19
(new: migration 0004) and 56/56; end-to-end 43/43 admin access and 63/63 sign-in and
claiming (new, against a local copy of Supabase's sign-in server and a pretend email
service); phone-size screenshots of every new screen and the code email; Worker size 194
KiB (6% of the free limit).
**Security tests:** replies never say whether an address has an account; 5 wrong guesses per
code; per-address, daily and per-internet-address limits; code sign-ins refused by the
admin gate even for an admin; claims need an account; unpublished listings can't be
claimed; people see only their own claims; non-team and claimants can't decide claims; a
team member can't approve their own claim; "email matches" refused when it doesn't; first
approved wins with one owner; cross-site forms refused. All passed.
**Found by the tests and fixed before release:** an email address at the domain a website
sits under (e.g. anyone@someisp.ca for bakery.someisp.ca) counted as matching; now only the
website's own domain or its subdomains count.
**Not yet live:** codes reach any address only after PO-13 (Supabase's own email service
sends only to the team); emails from Localites wait for PO-12. Owners editing their own
listing comes next (D-34).
**How to roll back:** Cloudflare → localites → Deployments → previous version → Deploy. The
migration can stay: the previous version ignores the new tables and column.
**Approved by:** Product owner (D-32, D-33, D-35; D-23).

### 2026-10-10 — Suggest a business (Stage 1, not public)

**Stage:** 1 (D-25, ADR-027)
**What changed (plain English):** Under every search and category page: *"Don't see who
you're looking for? Suggest a business."* Anyone can answer three questions (name;
website or social page; phone or email), no account needed, and sees *"Thanks. Our team
will look into this business and add it if it's a fit."* The team gets an email (once
PO-12 is done) and a **Suggestions** list in the admin page, with the count of new ones in
the menu: add it as a draft listing (linked to the suggestion), mark it as already listed,
or decline it with a reason. Everything is recorded. Spam protection: a hidden field
only bots fill in, 3 suggestions a minute per internet address (kept by Cloudflare,
never stored), 5 an hour per visitor, 100 a day in total. A visitor cookie
(`__Host-lc_vid`, Localites' own, random) is set when someone sends a suggestion.
**Migrations applied:** none.
**Destructive?** No.
**Tests run:** unit tests 35/35 (new: the three questions, the team email, sending and
its failures); admin access and suggestion tests 43/43 (16 new: limits, bot trap,
cross-site form, team-only list and actions, add-as-draft link, no deciding twice, audit
log); browser run-through at phone and desktop sizes.
**Not yet live:** the team email waits for PO-12; suggestions are saved and listed
meanwhile, honestly marked "waiting".
**How to roll back:** Cloudflare → localites → Deployments → previous version → Deploy.
**Approved by:** Product owner (D-25, D-23).

### 2026-10-10 — The 28 test businesses, as drafts (Stage 1, not public)

**Stage:** 1 (PO-08)
**What changed (plain English):** The 28 researched test businesses are loaded into the
test project as drafts: name, town, category and, only where the research found it, the
business's own website. Nothing about them is public until the team checks each one and
publishes it (PO-11). Each listing's history holds the research link and what to check.
Loaded once by GitHub (`scripts/import-test-businesses.mjs`); later runs do nothing, so
the team's edits are never overwritten.
**Migrations applied:** none (data only, test project only).
**Destructive?** No.
**Tests run:** loaded twice into a local database: 28 drafts, then nothing on the second
run; the public site still showed only published listings; the admin page listed the
drafts with their research notes. Unit tests 27/27 (new: record IDs and web addresses).
**How to roll back:** archive the drafts from the admin page.
**Approved by:** Product owner (PO-08 test set; D-23).

### 2026-10-10 — Team sign-in and the admin page (Stage 1, not public)

**Stage:** 1 (D-28)
**What changed (plain English):** The Localites team can sign in (email and password,
then a code from an authenticator app) and use the admin page: list every listing, add a
business as a draft, edit its details, categories and services with honest prices,
publish, hide or archive it, and see its history. Every change is recorded with who made
it. Renamed listings keep their old web address working. Nobody else can sign up yet.
**Migrations applied:** `0003_admin_access.sql` (lets the app untick categories and other
link rows; adds the one-time first-admin command). Not destructive. Applied to the test
project by GitHub after this push.
**Destructive?** No.
**Tests run:** database checks 51/51, 12/12 (new) and 56/56; unit tests 19/19; admin access
tests 27/27 against a local copy of Supabase's sign-in server (new, now on every push);
each was shown to fail when the gate was deliberately broken. Browser run-through at
phone and desktop sizes: sign-in, two-step set-up, add, edit, publish, hide, history.
**Security tests:** signed out, not on the team (with and without two-step), admin
without two-step, tampered token, form from another website, editing one listing's
service through another, forbidden status change, removed admin role, reused cookies
after sign-out, sign-in link to another website: all refused.
**Live:** 10 October 2026, after PO-10 (Supabase settings, first admin, two Cloudflare
secrets); the product owner signed in with a two-step code and reached the Listings page.
**How to roll back:** Cloudflare → localites → Deployments → previous version → Deploy.
The migration can stay (it only adds).
**Approved by:** Product owner (D-28, "go ahead"), 10 October 2026.

### 2026-10-10 — Speed improvements (Stage 1, not public)

**Stage:** 1
**What changed (plain English):** No visible change. With React Router the site used
8 ms of processing per request against the free plan's 10 ms, so three changes give it
headroom: the page code loads when the Worker starts instead of during a visitor's
request, the database library skips a step it repeated on every request, and the server
code is compressed tighter (144 KiB, 5% of the size limit, down from 223 KiB).
**Migrations applied:** none.
**Destructive?** No.
**Tests run:** lint, types, design tokens, wording; unit tests 12/12; every page checked
in Cloudflare's runtime locally against PostgreSQL through Hyperdrive's local stand-in
(welcome, Explore, category, search with a typo, profile, 404s, `/api/health`) and
clicked through in a browser at 390, 768 and 1440 wide: no errors.
**How to roll back:** Cloudflare → localites → Deployments → previous version → Deploy.
**Approved by:** Product owner ("can you run the speed improvements?"), 10 October 2026.

### 2026-10-10 — Switch to React Router (Stage 1, not public)

**Stage:** 1
**What changed (plain English):** The fit test showed Next.js used a median of 22.88 ms
of processing per page (P99 251 ms) against the free plan's 10 ms, so the website now
runs on React Router, the planned fallback (ADR-005, revision 4). Visitors see the same
pages and design; the database, its rules and the security model are unchanged. The
website is now about a fifth of the size, and moving between pages no longer reloads
the whole page. Cloudflare's build and deploy commands change to `npm run build` and
`npx wrangler deploy` (H, PO-03 step D).
**Migrations applied:** none.
**Destructive?** No.
**Tests run:** lint, types, design tokens, wording; unit tests 12/12 (new: security
headers are the same on pages and static files); migration checks 51/51 and Stage 2–3
proposal checks 56/56; every page checked in Cloudflare's runtime locally (welcome,
Explore, category, search with a typo, profile, 404s, `/api/health`) and in a browser at
390, 768 and 1440 wide: no errors, no sideways scrolling.
**Fit test:** size 223 KiB compressed (7% of 3 MiB). Live CPU time to be read from
Cloudflare after a day of use (ADR-005).
**Live:** deployed 10 October 2026 after the product owner changed Cloudflare's build
commands (PO-03 G); `/api/health`: database ok via Hyperdrive, 6 published test
listings, build `4df99e0`.
**How to roll back:** Cloudflare → localites → Deployments → previous version → Deploy
(the Next.js version stays there), then restore Cloudflare's old build commands.
**Approved by:** Product owner ("let's switch"), 10 October 2026.

### 2026-10-10 — First live test site (Stage 1, not public)

**Stage:** 1
**What changed (plain English):** The Stage 1 foundations went live on Cloudflare's free
plan at https://localites.supportlocalites.workers.dev, built automatically from GitHub
on every change. It reads the Supabase test project (`localites-test`, Canada) through
Cloudflare Hyperdrive, with only the six fake test businesses. Getting there found and
fixed three issues: the database library's Node build is rejected by Cloudflare's runtime
(now its Cloudflare build), direct encrypted connections to Supabase's pooler were cut
off (now Hyperdrive), and Cloudflare's publish step needs a placeholder local address for
Hyperdrive. `/api/health` reports the connection in plain words without revealing any
secret.
**Migrations applied:** none new (0001 and 0002 were already on `localites-test`).
**Destructive?** No.
**Tests run:** GitHub checks green on every change; `/api/health` live: database ok via
Hyperdrive, 6 published test listings.
**Fit test:** size 1,085 KiB (35% of 3 MiB). CPU time first reading 20 ms against a
10 ms limit; percentiles pending (ADR-005).
**How to roll back:** Cloudflare → localites → Deployments → previous version → Deploy.
**Approved by:** Product owner (PO-03), 10 October 2026.

### 2026-10-10 — Stage 1, week 1: foundations and local fit test (not deployed)

**Stage:** 1 (approved D-23)
**What changed (plain English):** The first application code. A Next.js website in
design G: Welcome, Explore (search and the six categories), search results with typo
tolerance, and a business profile with honest price wording, all reading from the
database as the restricted app role. One tokens file holds every colour, font and size,
with a check that rejects any outside it, and a check for banned wording. GitHub now
runs every check on every push. Nothing is deployed and no real business is loaded:
pages were tested with six obviously fake "Test Vendor" listings in a local database.
**Migrations applied:** `0001_stage1_foundation.sql` and
`0002_launch_places_and_categories.sql`, to local throwaway databases first. **Then
applied to the Supabase test project `localites-test`** (Canada) on 10 October 2026 by
GitHub's "Update the test database" job (CI run 38019493681), with the six fake test
businesses. Not applied to any production database (none exists yet).
**Destructive?** No.
**Tests run:** migration checks 51/51; Stage 2–3 proposal checks on top of the real
migrations 56/56; unit tests 3/3; token, wording, lint and type checks passed; pages
checked at 390, 768 and 1440 wide with no sideways scrolling.
**Security tests:** the browser-facing roles read nothing (including suggestions and
activity); the app role can't edit the audit log, delete rows or change the structure.
**Fit test:** 932 KiB compressed (30% of Cloudflare's free 3 MiB); runs in Cloudflare's
runtime locally. Time per request still to be measured on Cloudflare (ADR-005).
**Dependencies:** pinned exactly. No known vulnerabilities in anything that ships;
remaining advisories are in build and lint tools only (none critical), tracked for the
next update.
**How to roll back:** nothing is deployed.
**Approved by:** Product owner (D-23), 10 October 2026.

### 2026-10-10 — Stage 0 documentation, revision 9: Suggest a business

**Stage:** 0
**What changed (plain English):** The product owner added a feature (D-25): anyone who
doesn't see a business they want can suggest it with three questions (name, website,
phone or email). It's emailed to supportlocalites@gmail.com, and the team vets and adds
it. Planned for Stage 1 with spam protection; signed-in suggestions get a "now on
Localites" email from Stage 2 (ADR-027). Two new screens (P11, X19). Stage 1 gains about a
quarter of a week. The product owner also set the launch test set (PO-08): the 28
suggested businesses, up to 5 per category, used to test the app before launch; the
vendor list will be refreshed later. Five isn't a limit in the app. Approving Stage 1 is
now the open decision (D-23).
**Documents:** H, A, B, C, D, E, roadmap, screen inventory, testing strategy, design
system, launch research.
**Migrations applied:** None.
**Destructive?** No.
**Tests run:** None needed; no schema change.
**Approved by:** Product owner (D-25, PO-08 clarification), 10 October 2026.

### 2026-10-10 — Stage 0 documentation, revision 8: no payments of any kind; pilot size

**Stage:** 0
**What changed (plain English):** The product owner decided:
- **D-24:** no payment of any kind goes through Localites. Vendors paying Localites for a
  paid plan or a featured spot pay outside the site, like everything else. ADR-018 is
  extended to say so; ADR-025 is accepted (Localites stores only a vendor's plan and its
  dates).
- **D-12:** the business is named Localites in the privacy policy and terms; the mailing
  address is left blank and must be added before launch.
- **PO-08:** the launch is a pilot with at most 5 businesses per category. 28 suggestions
  are marked in the research record and on the shortlist page for the product owner to
  confirm or swap.
**Documents:** H, A, B, C, roles and relationships, roadmap, launch research.
**Migrations applied:** None.
**Destructive?** No.
**Tests run:** None needed; no schema change.
**Approved by:** Product owner (D-12, D-24, PO-08 pilot size), 10 October 2026.

### 2026-10-10 — Stage 0 documentation, revision 7: remaining Stage 0 decisions

**Stage:** 0
**What changed (plain English):** The product owner answered the open questions:
- **PO-05:** launch categories are Venue, Food & Beverage, Sweets, Rentals & Decor,
  Activities (which includes entertainers) and Photography. Vendor research started.
- **D-13:** the consumer–vendor rules R1–R8 are approved; ADR-022 accepted.
- **D-06:** reviews use option B. Any real booking can be reviewed after the event, and
  an admin approves every review before it's published. The team is emailed each new
  review, with a link to the admin area rather than an approve button (ADR-026).
- **D-14:** reviews before guest RSVPs.
- **D-22 amended:** a vendor dashboard for vendors on a paid plan (anonymous counts only);
  admins see the full detail; detailed records are kept with no deletion date, for
  year-over-year numbers. How vendors pay is a new question, D-24 (ADR-025, proposed).
- **D-10:** data-keeping rules approved, with events kept for as long as the host's
  account exists.
- **D-08:** invitations shared from the host's phone by text, WhatsApp, social media,
  email or QR code, using personal links and a group link with name matching.
- **D-12 (part):** the privacy contact is supportlocalites@gmail.com.
**Documents:** H, A, B, C, D, E, roles and relationships, roadmap, screen inventory,
testing strategy.
**Migrations applied:** None. The proposed Stage 2–3 schema changes the review rule:
a Localites conversation is no longer required; instead the database records
`review.planned_on_localites` itself and refuses any change to it.
**Destructive?** No (proposal only; no database exists).
**Tests run:** Both proposed schemas applied to a scratch PostgreSQL 16.15 + PostGIS
database: Stage 1, 29 of 29 passed; consumer–vendor checks, 56 of 56 passed (three new
checks for the review rule). Scratch database discarded.
**Approved by:** Product owner (PO-05, D-06, D-08, D-10, D-12 in part, D-13, D-14, D-22
amendments), 10 October 2026.
**Repository:** the product owner moved the code from `igbarker/Tallo` to
`supportlocalites/localites` the same day. Links in the documents now point there.

### 2026-10-10 — Stage 0 documentation, revision 6: launch list, Inquire, activity tracking

**Stage:** 0
**What changed (plain English):** The product owner decided:
- **D-03:** Localites launches with a curated list. We research Orillia-area businesses
  in the chosen categories (PO-05); the product owner picks which to add. Public ratings
  of 4 stars or more are only our private filter and are never copied or shown.
- **D-04:** the stages stay as planned. Stage 1 profiles show the business's own website
  and phone. When messaging arrives in Stage 2, unclaimed or unverified businesses show
  **Inquire**, which is saved and emailed to the Localites team (ADR-024). This settles
  D-05.
- **D-09:** the launch area is Orillia, Severn, Oro-Medonte and Ramara.
- **D-11:** supportlocalites@gmail.com is the admin address for every service account,
  and all alerts and team emails go to it.
- **D-22 (new):** activity tracking so vendor reports can support sales and renewals
  (ADR-023). Stage 1 counts "seen in search", profile views and website and phone taps;
  Stage 2 adds saves, inquiries and messages. Detail is kept 90 days, daily totals after.

A draft that moved messaging into Stage 1 was withdrawn at the product owner's request
before it was saved; the stages and estimates are as before, with about half a week
added to Stage 1 for the fuller tracking.
**Documents:** H, A, B, C (ADR-015 extended; ADR-023 and ADR-024 new), D, E (new §7a,
activity tracking), F, roadmap, roles and relationships, screen inventory (X18 added),
testing strategy, design system.
**Migrations applied:** None. The proposed Stage 1 schema still shows the older
`analytics_event` table; it will be replaced by the two tracking tables, and checked,
before any Stage 1 code is written.
**Destructive?** No.
**Tests run:** None needed; no schema change.
**Approved by:** Product owner (D-03, D-04, D-09, D-11, D-22), 10 October 2026.

### 2026-10-10 — Architecture approved (D-00)

**Stage:** 0
**What changed (plain English):** The product owner approved the architecture: one
application, one PostgreSQL database, the consumer–vendor data model, the security model
and the staged roadmap. Stage 0 documents are marked approved and the technical decisions
in C are accepted, except ADR-022, which waits for the consumer–vendor rules (D-13).
Stage 1 still needs its own approval; nothing has been built or spent beyond the domain.
**Migrations applied:** None.
**Destructive?** No.
**Tests run:** None needed; no schema change.
**Approved by:** Product owner (D-00), 10 October 2026.

### 2026-10-10 — Stage 0 documentation, revision 5: design G chosen; localites.ca bought

**Stage:** 0
**What changed (plain English):** The product owner chose mockup G as the app's design
(D-21) and bought the web address `localites.ca` (D-01, D-07; PO-04 done). New
[Design System](./design-system.md): one website that adapts to phones, tablets and
computers, with G's colours, type, building blocks, navigation and screen-by-screen
phone and desktop arrangements, so every change reaches every screen size. Every design
explored (A to H, plus G's desktop pages) is saved in [design/](./design/README.md).
Testing strategy adds checks at phone, tablet and desktop sizes, and a check that the
look is only ever set in one place.
**Documents:** design-system (new), design archive (new), H, A, README, cost model,
testing strategy.
**Migrations applied:** None. Data model and schemas unchanged.
**Destructive?** No.
**Tests run:** None needed; no schema change.
**Approved by:** Product owner (design and domain), 10 October 2026.

### 2026-10-10 — Stage 0 documentation, revision 4: renamed to Localites

**Stage:** 0
**What changed (plain English):** The product owner renamed the product from its working
name, Tallo, to **Localites** (D-01, name part). Every document now says Localites, as do
the proposed schemas (comments and two error messages), the blueprint page and the design
mockups. Example web addresses now read `localites.ca`; the web address itself is still
to be chosen (D-01), after checking the domain is free and the name is clear to use. The
GitHub repository keeps its current name, `Tallo`; that name isn't shown to anyone using
the product.
**Documents:** README, A–H, roles and relationships, roadmap, screen inventory, cost
model, API and testing strategies, both proposed schemas and their checks.
**Migrations applied:** None. Text only; no tables, columns or rules changed.
**Destructive?** No.
**Tests run:** Both proposed schemas re-applied to a scratch database and checked:
Stage 1, 29 of 29 passed; Stage 2–3, 53 of 53 passed.
**Approved by:** Product owner (the name), 10 October 2026.

### 2026-10-09 — Stage 0 documentation, revision 3: no running costs

**Stage:** 0
**What changed (plain English):** The product owner directed that Localites should have no
running costs (D-20). Every service moves to a free plan: Supabase (database, sign-in,
files), Resend (email), Sentry (error alerts), free storage for nightly backups.
Hosting moves from Vercel to Cloudflare's free plan, because Vercel's free plan doesn't
allow business use. The only recommended cost is the web address (~CA$15–25/year), which
email requires (D-07). A one-day fit test in Stage 1 confirms the app fits Cloudflare's
free limits (ADR-005). The on-call recommendation changes to alerts by email to the
product owner (D-11).
**Documents:** cost-model rewritten; C (ADR-003, 005, 007, 013, 014), F, H, A, E,
roadmap, API strategy updated.
**Migrations applied:** None. Data model and schemas unchanged.
**Destructive?** No.
**Tests run:** None needed; no schema change.
**Approved by:** Product owner (D-00), 10 October 2026.

### 2026-10-09 — Stage 0 documentation, revision 2: consumer–vendor handshake

**Stage:** 0
**What changed (plain English):** Reworked the plan around the product owner's
clarification. Two users (consumer and vendor) and the relationship between them are
now the centre. Localites is the digital handshake: direct messaging with file sharing.
No payments of any kind. "Add to event" and "Booked" are the consumer's own records,
and post-event feedback becomes reviews. Removed quotes, vendor-confirmed bookings,
agreements, inquiries and the concierge relay. New stage order proposed: handshake
(2), reviews (3), RSVPs (4).
**Documents:** new [roles-and-relationships.md](./roles-and-relationships.md); A, B, C,
D, E, H, roadmap, screens, costs, API, testing rewritten or updated.
**Migrations applied:** None. New proposal
[schema/stage2-3-proposed.sql](./schema/stage2-3-proposed.sql); Stage 1 proposal
adjusted (removed inquiry preference and concierge role). Neither applied anywhere.
**Destructive?** No.
**Tests run:** Both proposed schemas applied to a scratch PostgreSQL 16.15 + PostGIS
database. Stage 1 checks: 29/29 passed. Consumer–vendor relationship checks
([schema/stage2-3-proposed.test.sql](./schema/stage2-3-proposed.test.sql)): 53/53
passed, each rejection confirmed to fail for the intended reason. Scratch database
discarded.
**Existing functionality affected:** None (no application code exists).
**Approved by:** Product owner (D-00), 10 October 2026.

### 2026-10-09 — Stage 0 documentation

**Stage:** 0
**What changed:** Initial architecture and product documentation proposed for review.
**Migrations applied:** None. The Stage 1 schema in
[schema/stage1-proposed.sql](./schema/stage1-proposed.sql) is a proposal and has not
been applied to any database.
**Destructive?** No.
**Tests run:** Proposed schema applied to a scratch PostgreSQL 16.15 + PostGIS
database and checked with
[schema/stage1-proposed.test.sql](./schema/stage1-proposed.test.sql): 29/29 checks
passed (honest pricing, honest statuses, typed attributes, audit log append-only,
browser-facing roles read nothing). Scratch database discarded. No application code
exists yet.
**Existing functionality affected:** None.
**Approved by:** Product owner (D-00), 10 October 2026.
