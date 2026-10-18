# F — Operational Runbook

**Status:** Proposed (Stage 0). No production environment exists yet.
**Last updated:** 2026-10-13 (planning an event: after-deploy check, event types, suggested kinds of business, featured businesses, booking flags, planning counts; earlier, the "are you human" check)

How the application is deployed, monitored, backed up, restored, and recovered — and
who is responsible for each part. Procedures marked *(to be verified)* will be tested
and confirmed before launch; this document will then record when.

---

## 1. Environments

| Environment | What it's for | Data | Who can see it |
|---|---|---|---|
| **Local / session** | Development and automated tests | Throwaway test data, created and destroyed by tests | Engineering |
| **Preview** | Every proposed change gets its own link, for review | The test copy of the database, with clearly fake data only | You and engineering. The links are hard to guess, and because previews only ever hold fake data, nothing real is exposed if one is shared. |
| **Production** | The real site | Real data | Public pages: everyone. Everything else: per [E](./E-security-and-privacy-model.md). |

Production and staging are **separate Supabase projects** with separate credentials,
both on Supabase's free plan (which allows two). A mistake in staging cannot touch
production data. Staging may pause when idle, which is fine for review.

**Running costs: none** (D-20). Hosting is Cloudflare's free plan, database Supabase's
free plan, email Resend's free plan. See [cost-model.md](./cost-model.md).

**Test data rule:** staging and test data is always obviously fake ("Test Vendor 14",
"example.com" addresses). Real business names are never used as test data, so a
screenshot of staging can't be mistaken for a real listing.

## 2. Responsibilities

| Area | Engineering | Product owner |
|---|---|---|
| Writing, testing, and reviewing code | ✅ | — |
| Database migrations | ✅ | — |
| Approving releases to production | Recommends | ✅ Approves (until you delegate this) |
| Owning root accounts (Cloudflare, Supabase, domain, email) | Invited member | ✅ Owner |
| Paying for services | — | ✅ Domain only (~CA$15–25/year) |
| Receiving alerts | ✅ | ✅ (plain-English summary) |
| Responding to incidents | Per D-11 | Per D-11 |
| Nightly backup and restore check (F §5–6) | ✅ | Emailed by GitHub if a night fails |
| Approving any destructive production change | Proposes, with recovery plan | ✅ Approves |

## 3. How a change reaches production

1. Work happens on a branch. Every push runs the automated checks: type checking,
   linting, unit tests, permission tests, and migration tests against a real
   PostgreSQL database.
2. Cloudflare builds a **preview** from the branch. You get a link.
3. A pull request is opened describing the change in plain English, the migrations it
   includes, and the test results.
4. You (or a delegate) review the preview and approve.
5. On merge to `main`:
   1. Database migrations run first, automatically, against production (via GitHub
      Actions, using a secret held in GitHub's encrypted settings).
   2. Only if migrations succeed does Cloudflare deploy the new application.
6. A post-deploy smoke test loads the home page, a vendor profile, and search. Failure
   alerts engineering and you.
7. The release is recorded in [G](./G-release-and-migration-history.md).

## 4. Database migration rules

Migrations are the main way a release can damage data. These rules exist to make that
very unlikely, and recoverable when it happens.

1. **Every schema change is a numbered SQL file in git.** No changes are made by hand
   in the database console. Ever.
2. **Expand, then contract.** Changes that remove or rename anything are done in two
   releases: first add the new thing and keep the old one working; later, once nothing
   uses the old thing, remove it. This means the previous version of the application
   can always run against the current database, so rolling back the application is
   always safe.
3. **Every migration is tested** against a copy of the current schema before it runs
   in production.
4. **Destructive migrations** (dropping a column or table, deleting rows) require: a
   fresh backup taken immediately before, a written recovery plan in the pull request,
   and your explicit approval.
5. **Large data changes** are done in batches, not one giant transaction that locks
   the site.
6. **Applied migrations are never edited.** `npm run db:migrate` records a checksum of
   each file it applies and refuses to run if an applied file has changed.

### How migrations are applied

- Files live in `db/migrations/` (`0001_stage1_foundation.sql`, `0002_…`). Each runs in
  its own transaction, in order.
- **Tested first, every time:** `npm run test:db` builds a throwaway database, applies
  every migration and runs every check in `db/tests/` (GitHub runs this on every push).
- **Applied to Supabase** with `npm run db:migrate`, using the database's admin
  connection string held in an encrypted secret (a GitHub or Cloudflare secret the
  product owner pastes in), never written in git or chat.
- **Test project:** after every push whose checks pass, GitHub's "Update the test
  database" job migrates `localites-test` and reloads the fake test businesses, using
  the secret `SUPABASE_TEST_ADMIN_URL`. The loader refuses to run on any database that
  holds a real listing.
- **The test site goes live last (PO-17):** GitHub's "Put the website live" job runs only
  after every check, every end-to-end test and the database update have passed. It builds,
  deploys with the secrets `CLOUDFLARE_API_TOKEN` (Workers only) and `CLOUDFLARE_ACCOUNT_ID`,
  then checks `/api/health` answers. Until those secrets exist it does nothing and says so.
  Once it works, Cloudflare's own Git builds are disconnected, so nothing goes live out of
  order. A red run means nothing new went live; fix and push again.
- **Production** will have its own manual step, with the product owner's approval and
  a fresh backup first (rule 4), set up before launch.
- Hosted databases are always reached over an encrypted (TLS) connection.

### Is the site connected to its database?

Open `/api/health` on the site (for example `https://<site>.workers.dev/api/health`). It
answers in plain words: `"database":"ok"` with the number of published listings, or the
kind of problem (not configured, address unreadable, login refused, encryption failed,
cannot reach) and what to do. It never shows the address or password. Uptime checks
(§8) use the same page.

**On Cloudflare**, the app connects through **Hyperdrive** (Cloudflare's free database
connector: it keeps the encrypted connection to Supabase and pools connections). Test
project: configuration `localites-test-db`, ID `4e3e6b64b1cb4015a679dd85ad7a8daa`
(bound as `HYPERDRIVE` in `wrangler.jsonc`), Supabase **Session pooler** (port 5432),
user `app_server`, SSL mode **Require**, caching **off**. The `DATABASE_URL` secret is
only a fallback. To change the database password: set it in Supabase (step C), then edit
the Hyperdrive configuration's password in Cloudflare.

**Why Hyperdrive (10 October 2026):** direct connections from Cloudflare to Supabase's
pooler were cut off right after the encrypted handshake (logs: `unhandledRejection … read`).
Hyperdrive is Cloudflare's supported route to external Postgres, included in the free
plan.

### The app's own database login (ADR-004)

Migration 0001 creates the restricted role `app_server` **without** a password. The
only console step, because passwords never go in git: once per database, the product
owner sets its password in Supabase's SQL editor with
`alter role app_server login password '<a new letters-and-numbers password>';`, then pastes
the matching connection string into Cloudflare's encrypted secret `DATABASE_URL`. We
guide this live (PO-03 part 3). Changing the password later is the same two steps.

### Team sign-in and admins (D-28)

- **How sign-in works.** The site calls Supabase Auth from the server only (the browser
  never talks to Supabase). The session lives in two cookies page scripts can't read.
  Admin pages pass a gate on every request: a valid Supabase session (checked with
  Supabase, so signing out works at once), a password sign-in within 12 hours, an
  active row in `platform_role`, and the two-step code for this session. Settings:
  Cloudflare secrets `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (PO-10).
- **First admin:** `select grant_first_admin('<email>');` in Supabase's SQL editor
  (migration 0003). It refuses once any admin exists.
- **Add another admin:** create their account as in PO-10 B (they type their own password),
  have them sign in once at `/sign-in` (the team pages turn them away; that creates their
  Localites account), then add them on the team's **Users and roles** page (`/admin/team`,
  migration 0035) with a reason. The page explains the same steps.
- **Remove an admin:** on **Users and roles**, with a reason. Nobody removes themselves:
  another admin does it. Takes effect on their next click. Both are recorded in `audit_log`
  (`platform_role.grant`, `platform_role.revoke`) by the database itself; the app can't
  write `platform_role` directly. If no admin can sign in at all, the console path is
  `grant_first_admin` after ending the old roles in the SQL editor
  (`update platform_role set revoked_at = now() where revoked_at is null;`).
- **The language check (D-50, ADR-033).** Held owner saves are on **Held changes**; held replies
  and reviews with a finding on **Reviews**. The word list is `src/server/moderation-words.ts`
  (add or remove a word with an ordinary update). If the AI checker stops answering (Cloudflare's
  log says "language check: AI checker unavailable"), the word list still works and nothing is
  blocked; it usually means the day's free allowance is used up and comes back at midnight UTC.
- **The audit log** is on the team's **Audit log** page (`/admin/audit`): newest first, by
  who, by kind of record, or one record's history. Each look is recorded too.
- **Lost phone (authenticator):** in the SQL editor, `delete from auth.mfa_factors where user_id = (select id from auth.users where email = '<email>');`
  Their next sign-in shows a new square code to scan.
- **Forgotten team password:** the public has no passwords (D-32); for a team account,
  set a new one in the SQL editor:
  `update auth.users set encrypted_password = extensions.crypt('<new password>', extensions.gen_salt('bf')) where email = '<email>';`
  then delete that query from the editor's list, as in PO-03 C.
- **Known limit:** Supabase limits sign-in attempts per internet address, and every
  request comes from Cloudflare's servers, so its limits apply to the whole site at once.
  Our own limits apply per visitor (ADR-028). Revisit if people report "Too many tries
  from here" when only a few are signing in.

### Email from localites.ca (ADR-013, PO-12)

- `localites.ca`'s DNS lives in Cloudflare (moved from GoDaddy on 11 October 2026). Resend
  needs three records there: TXT `resend._domainkey`, and CNAMEs `send` and `rsend`
  (pointing at `…forge.rmta.net`), both **DNS only** (grey cloud). A proxied (orange)
  CNAME hides it from Resend.
- If emails fail, the admin page shows Resend's own explanation (e.g. "domain is not
  verified"). Check Resend → **Domains** → `localites.ca`, then those three records.
- The two `A` records for `localites.ca` and the `_domainconnect` CNAME are GoDaddy
  leftovers (its "parked" page). They're replaced when `localites.ca` is pointed at the
  website before launch.

### Sign-in codes and claims (D-32 to D-35, ADR-028)

- **Settings:** Supabase sends the codes through Resend (PO-13): custom SMTP, both email
  templates from `emails/sign-in-code.html`, sign-ups on, "Confirm email" on, codes of 6
  digits lasting 900 seconds. If codes stop arriving, check Resend's **Emails** log first,
  then Supabase **Authentication** → **Emails** → **SMTP Settings**.
- **Deleted accounts (E §8):** when someone deletes their account, **Admin → Deleted accounts**
  shows its id with "to finish". Within 30 days: in Supabase open **Authentication → Users**,
  search for that id, delete the user, then click **Done** (recorded in the audit log). Until
  then, that email address signing in again only sees "This account has been closed".
- **"I never got my code":** (1) ask them to check spam, junk and the "Promotions" tab;
  (2) in **Resend → Emails**, look for an email to their address at that time: *delivered*
  means it reached their mail provider, *bounced* or *failed* gives the reason; (3) if there
  is no email in Resend at all, open Supabase → **Authentication → Logs** for that time.
  The site waits **60 seconds** between codes to one address (the "Send a new code" button
  counts down), the same as Supabase's own minimum interval; if Supabase still refuses one,
  the page says so rather than claiming a code was sent. If Supabase's interval is ever
  changed, change `RESEND_WAIT_SECONDS` in `src/lib/claim-terms.ts` to match.
- **"We've sent a lot of sign-in codes today":** our daily cap of 60 codes was reached. It
  clears itself within a day. If it happens often, the cap (`CODES_PER_DAY` in
  `src/server/auth/code-limits.server.ts`) can rise towards Resend's free 100 a day.
- **"Are you human" check (Turnstile): parked (D-38), off.** It would be on when both `TURNSTILE_SITE_KEY` and
  `TURNSTILE_SECRET_KEY` are set in Cloudflare (Variables and Secrets). If it's ever
  switched on and people report "We couldn't run the are you human check", look in
  the Worker's logs (Cloudflare → localites → Observability) for "are-you-human check":
  "refused our key" means the secret key was mistyped or replaced (copy it again from
  Cloudflare → Turnstile); otherwise Cloudflare's checker was briefly unreachable. If the
  check box never appears, the site's address may be missing from the Turnstile widget's
  **Hostnames** (add it there). To switch the check off in an emergency, delete
  `TURNSTILE_SITE_KEY` and deploy; sign-in then works without it.
- **Checking a claim (D-33):** on **Claims**, if it says the email matches the business's
  own website, you can approve. Otherwise contact the business at the phone number or
  email **it publishes itself** (shown on the claim), never the details the claimant gave,
  then approve or decline with a reason (the reason is emailed to them). You can't approve
  your own claim; another team member must.
- **Claim emails:** each one to a claimant is recorded in `notification` as `sent` or
  `failed` (with the reason); the Claims page shows the "received" email's status. A failed
  email can be followed up by hand from supportlocalites@gmail.com.
- **Wrong owner approved, or an owner breaks the rules:** on the listing's team page, under
  **Owner**, type why and click **Remove owner**. Their access ends at once, they're emailed
  the reason, and the listing can be claimed again. Recorded in the audit log.

### Owners' changes (D-34, ADR-029)

- **Daily note:** every morning (12:00 UTC: 8 am Toronto in summer, 7 am in winter) the team
  gets one email listing every owner save since the last note, flagged ones first. Nothing
  changed: no email. The **Listings** page says how the last note went; "failed", "stopped
  part way" or "hasn't run for over a day" means check Resend (**Emails**) and Cloudflare
  (**Workers & Pages → localites → Settings → Triggers**: two cron triggers; **Logs** for
  errors). A failed or stopped note is retried at 14:00 UTC and the next morning; its saves
  stay waiting, so nothing is lost.
- **"Check now" emails:** a new website on another site, or a new phone number, emails the
  team straight away (at most one per business an hour, 20 a day; more wait for the note).
- **Undo:** on the listing's team page, **Changes by the owner** lists each save in plain
  words. Tick what to put back, say why (the owner sees it), click **Undo the ticked
  changes**. A line the owner changed again since can't be ticked: undo the later save
  first. A service the owner added is hidden, not deleted. Each save can be undone once:
  lines you leave unticked stay as the owner set them (change them under **Details** or
  **Services** if needed), and the card then says which were put back and which kept.
- **Editing a listing that has an owner:** the team's **Details** and **Services** forms only
  write the boxes you changed. If the owner changed the same box while your page was open,
  the save is refused with what it says now: reload the page, then make your change again.
- **Hidden or archived listings:** a hidden listing can still be edited by its owner (they
  see it's hidden); an archived one can't.

### Planning an event (D-39 to D-43, ADR-031)

- **After each deploy that touches planning:** sign in on the site with an ordinary (not
  team) account, open **My events**, plan a test event and open its plan (PO-15 has the
  steps). This proves the "who is acting" settings reach the database through Hyperdrive
  and Supabase's pooler, which our automatic tests can't (they use a plain database). If
  **My events** is empty after creating an event, or the plan says "not found", stop:
  roll back (§7) and start a session with what you saw.
- **Hyperdrive caching must stay off** (see "Is the site connected to its database?"
  above). Planning pages read inside transactions, but a cached answer could show one
  person's list to another.
- **Migration 0012 needs Supabase's `postgres` role** (which can see past row-level
  security). If it is ever run by a role that can't, it stops with "migration 0012 must be
  run by a role that bypasses row-level security", changes nothing, and the update isn't
  deployed (§3).
- **No new secrets and no owner steps** were needed. `PLAN_LIMIT` (30 planning changes a
  minute per person) is Cloudflare's free limiter, set in `wrangler.jsonc`; when it's
  reached the page says "You’re going a bit fast. Please wait a minute and try again."
- **Planning emails are sent once.** A failed one (for example on a day Resend's free limit
  is used up) is recorded as `failed` and is not retried automatically in 2A; nothing yet
  gives sign-in codes priority. Follow up by hand if it matters.
- **Cancelling or re-dating an event** tells every business on it, one email after another
  (about two a second, as Resend allows; if Resend says "slow down", one more try after a
  pause). At most 15 emails go from one change; any more are recorded as `failed` with
  "Not sent: too many emails from one change. Tell them by hand."
- **Interrupted sends:** an email still marked `queued` an hour later (the run was cut short,
  so it isn't known whether it went) is marked `failed` by the nightly run, with that reason.
- **Emails to businesses and people** (marked booked, no longer booked, event cancelled,
  event changed, "a business says it isn't booked") count toward Resend's free 100 a day,
  shared with sign-in codes and team emails. Each is recorded in `notification`: `sent`,
  `failed` (with Resend's reason) or `suppressed` (with why: "they already know it’s marked
  booked", "they weren’t told it was booked", or "daily limit", which is 30 planning emails a day to any one
  person). If Resend's daily limit is near, tell the product owner before anything changes
  (D-20).
- **Event types (Admin → Event types):** the kinds of event people may choose. Open a type
  to change its **Name and order** (lower comes first) or untick **Shown to people planning**
  to hide it. Hide, never delete: events that use it keep it. **Add an event type** at the
  bottom; its key is made from the name and never changes. Every change is recorded.
- **Suggested kinds of business (same page, per type):** under **Kinds of business to
  suggest**, tick the categories people planning that kind of event usually need, give each
  an order, and save. They appear on the person's plan as "Businesses people often need",
  linking to each category's list. (Search has no town filter yet, so the links don't
  include the event's town.)
- **Featured businesses (same page, per type):**
  1. Use **Find a business to feature** to look up the business; note its web address (the
     part after `/vendors/`).
  2. In the type's **Feature a business** form, enter that web address, the **First day**
     and **Last day** (both included, Toronto dates), and an optional note only the team
     sees (for example who arranged it). Click **Feature this business**.
  3. Up to 3 show on the plans of events of that type, earliest start first, labelled
     **Featured** with "Featured businesses are promoted by the Localites team." If more than
     3 overlap, the page warns which days. Only published businesses are shown.
  4. To stop one early, click **End early**. A placement can't be edited: end it and add a
     new one. Lists show **Showing now**, **Coming up**, and **Earlier** (finished or ended
     early).
  Any arrangement with the business, including payment, happens outside Localites (D-24):
  never record prices or payment details in the note. Featuring never changes search
  results or reviews.
- **Booking flags (Admin → Booking flags (n)):** bookings a business said aren't right,
  with the business's note and who marked it booked (never the event's private details).
  Every look is recorded in the audit log. The team and the person were already emailed. In
  2A this list is for reading: if something looks wrong (for example a business flagging
  every booking), contact the business or the person directly from
  supportlocalites@gmail.com. Deciding on flags comes in Stage 3.
- **Messages (Stage 2B):** conversations are private to the person and the business's team.
  The team can open one only through a report: **Admin → Reports (n open)**. Each look is
  recorded with the report. Hide the reported message, or close the conversation, when it's a
  scam, harassment or spam; close the report with a short note either way. Never contact
  either side about what they wrote except to explain a decision.
  If someone asks for help with a conversation, ask them what happened; never ask for their
  password. Emails about new messages go once per unread stretch and never contain the
  message.
- **Inquiries (Admin → Inquiries (n waiting); ADR-024, D-04, D-05):** people interested in
  a business that isn't on Localites yet, each also emailed to supportlocalites@gmail.com
  ("Inquiry about …"; replying reaches the person). Use them to invite the business to claim
  its listing (claiming is free), for example "Three people asked about you on Localites
  this month". Don't pass messages back and forth: once the business joins, people contact
  it directly. When you approve its claim, everyone who asked is emailed once that it
  joined; the page shows whether each of those emails went, and if one says "failed: email
  them yourself", do that from supportlocalites@gmail.com. If an inquiry's email to the team
  failed, the inquiry is still here; the person was told and can send it again. Inquiry
  emails stop at 40 a day across the site (the free email plan's 100 a day also covers
  sign-in codes); past that they're only on this page. Every look is recorded.
- **Bookings (Admin → Bookings; D-46):** every business a person marked booked, listed or
  not, past events too, with the person's name and email, the date, the town and about how
  many guests (never the event's name or private details). Every look is recorded. When a
  business is taken down (a listing's **Hide from the public** or **Archive**), its bookings
  for events still to come appear first, under **Check in with these people**, and the menu
  shows "(n to check in)". Email each person from supportlocalites@gmail.com to see if they
  need help finding another business. The listing's own page says how many bookings are
  still to come before you take it down. Taking a business down deletes nothing; it stays
  on those people's plans by name, and they can't newly mark it booked until it's listed again.
- **Planning counts (D-42):** on **Activity** ("Planning (team only)": the top 20 businesses
  and totals by kind of event) and on each listing's **Activity** page. Whole Toronto days
  up to the end of yesterday. Never show them to a business (they aren't on its Analytics
  page), and quote only totals.
- **Support questions about someone's event:** the team can't open a person's event or
  plan (only a flagged booking). Ask the person to describe what they see, or to send a
  screenshot.

### Business teams (screen V4, migration 0015)

- **What owners can do on their own:** from **Your account → Team** (or
  `/vendors/<name>/team`), the business's owner invites a **manager** (edits the listing, sees
  bookings marked and Analytics) or **staff** (nothing yet; they'll answer messages when
  messaging arrives) by email, cancels an invitation, or removes someone. Only the owner sees
  this page. To change someone's role, the owner removes them and invites them again.
- **Invitations:** the email comes from Localites with the owner's name and the business's
  name, and replies go to supportlocalites@gmail.com. The link works once, for 7 days, and
  only when the person is signed in with the address it was sent to. These emails count
  toward Resend's free 100 a day. If one doesn't go, the team page tells the owner to cancel
  and invite again; nothing is retried automatically.
- **Limits:** 10 people besides the owner; 20 invitations a day per business. The page says
  so in plain words when either is reached.
- **Changing an owner is still the team's job** (Admin → Claims and Remove owner, D-35). When
  a business's last owner is removed or deletes their account, everyone else on its team
  leaves too and its open invitations are cancelled, so nobody keeps access to a business
  with no owner. A new owner invites their team again.
- **"Someone on my team can't get in":** check the invitation was sent to the address they
  sign in with, that it's under 7 days old and not cancelled. If in doubt, the owner cancels
  it and invites again.
- Joining, removing, inviting and cancelling are recorded in `audit_log`
  (`vendor_member.join`, `vendor_member.remove`, `vendor_invite.create`, `vendor_invite.revoke`).
- **No new secrets and no owner steps** were needed.

### Business photos (E §9, migration 0016)

- **Switched on by PO-16:** the `vendor-photos` bucket in Supabase Storage (public, 2 MB
  limit, JPEG and WebP only), two Cloudflare secrets: `PHOTO_KEY_ID` and `PHOTO_SECRET`
  (Supabase's S3 access key, which reaches file storage only), and `PHOTO_REGION`
  (`ca-central-1`, a public setting in `wrangler.jsonc`). Without
  all three, the Photos page says adding isn't switched on; photos already stored still show.
- **Who adds them:** the business's owner or a manager, at **Your account → Photos** (or
  `/vendors/<name>/photos`): up to 8 page photos, each with a short description (the first
  leads the page; all are shown whole), plus one square **profile photo** (migration 0019),
  shown beside the name in lists and framed by the owner. They go live at once. 20 photo
  changes a minute per person and 30 new photos a day per business. Team pages → Photos marks
  a profile photo as such.
- **"My logo looks cut off in search results":** the owner opens Photos → **Adjust the
  framing** and taps **Show whole photo**, then Save. Nothing was lost: only the framing is
  stored.
- **Reviewing (weekly, or when told of a problem):** team pages → **Photos** lists the newest
  60, with the business and who added it; **This business's photos** shows one business's.
  Remove anything that isn't the business's own work or isn't suitable: write why in the box
  (kept in the audit log) and click **Remove photo**, then email the business from
  supportlocalites@gmail.com to say why. The team doesn't upload photos for businesses
  (research rule: no copied photos).
- **Removed photos** disappear from the site at once and their files are deleted from
  storage straight after. Anyone who already had the photo's direct address may still see it
  for up to an hour, from caches (Supabase's free plan can't clear its cache on demand). If storage was down at that moment, the nightly run (12:00 and
  14:00 UTC) deletes them; the Worker's log says `removed photos: { deleted, left }`.
- **"I can't add a photo":** the page says why in plain words (too large, not a photo, no
  description, already 8). If it says "couldn't be saved just now", storage refused it:
  check Supabase's status page and that the three secrets are still set. A rotated key
  must be replaced in Cloudflare (PO-16, last paragraph).
- **Known gap:** if the website stops in the split second between storing a photo and
  recording it, the file stays in storage with nothing pointing to it (no one can find its
  random name). Rare and harmless; if storage use ever looks much higher than the photos on
  the site, compare the two before deleting anything.
- **Storage use:** Supabase → **Storage** shows the bucket's size (free plan: 1 GB). Each
  photo is usually 150–400 KB for both sizes together. Tell the product owner at 80% (§8).
- **Backups:** the photos are not in the database backup. They're replaceable by the
  businesses, so there's no separate copy yet (the weekly file copy in §5 is still to be
  set up).

### Categories and towns (screens X6 and X8, migration 0017)

- **Team pages → Categories and towns.** Kinds of business have two levels: a main kind
  (Sweets) and kinds within it (Custom cakes). Open one to change its **Name**, **Description**,
  **Order** (lower comes first), **Within** (which main kind) or untick **Shown**. Add new ones
  at the bottom of each section. Every change is recorded in the audit log.
- **Hide, never delete.** Businesses and events that use a hidden kind or town keep it; it
  just isn't offered for new ones, and a hidden main kind isn't shown when people browse.
- **Web addresses never change.** They're made from the first name (accents and "&" become
  plain letters and "and"), so links such as `/search?category=…` keep working after a
  rename. If a name was wrong from the start, rename it; don't add a duplicate.
- **Towns start hidden** unless **Shown** is ticked, so the name and region can be checked
  first. Adding a town widens where Localites says it serves: check with the product owner
  first.
- A main kind with kinds within it can't be put inside another; move its kinds out first.
- No two kinds with the same name under one main kind, and no two towns with the same name in
  one region (the page says so plainly).

## 5. Backups

| Layer | What | Frequency | Retention | Source |
|---|---|---|---|---|
| **Our own backup (the one we rely on)** | Full database export (`pg_dump`), encrypted | Nightly, automatic | 30 days | Stored outside Supabase on free storage, so a provider problem or account issue doesn't take the backups with it |
| Files | Vendor photos, conversation files | Weekly | 30 days | Copied to separate free storage |
| Provider backups | Full database | Whatever Supabase's free plan provides | — | Not relied on (sources disagree on what the free plan includes) |

**What this means in practice:** if the database were damaged, we could restore it to
last night's state. Anything written since (messages, edits) could be lost. Continuous
"restore to any second" recovery is a paid add-on and is not planned (D-20).

**Where the backups live (built 13 October 2026, switched on by PO-18):** GitHub, outside
Supabase. The **Nightly backup** job (`.github/workflows/backup.yml`, 07:17 UTC, about 3 am in
Toronto; also **Run workflow** for one on demand) runs `scripts/backup/take.sh`: `pg_dump` of
the `public` and `auth` schemas (custom format, with grants, without owners) plus a
`manifest.json` (rows per table, extensions, roles, the newest audit entry from before the
export), locked together with `gpg` AES-256 and the passphrase `BACKUP_PASSPHRASE` (a GitHub
secret; the product owner keeps the only other copy). The locked file is kept as the run's
artifact for 30 days (`localites-backup-<time>`). The repository is private as well, but the
lock is what we rely on. The same job then runs the restore drill (§6). A failed run emails
the product owner (GitHub's own notice, to whoever last switched the job on: PO-18 has them
switch it off and on). With the variable `BACKUPS_ON=true`, a missing secret fails the run
rather than skipping it. The database address's password, user and host are hidden in the
logs, and the drill never prints row data. It backs up the **test** database
(`SUPABASE_TEST_ADMIN_URL`); production gets the same job, with its own secrets, before launch.
At today's size a backup is about 1.5 MB; GitHub's free artifact storage is 500 MB, so 30
nights fit with room to spare. If they ever don't, we tell you before anything changes.
**Not in it:** photo files (Supabase Storage; see Business photos above) and Supabase's own
internal schemas.

### Activity counting and the Analytics page (D-22, D-30, D-37, ADR-030)

- **On or off:** counting is on exactly when the `ACTIVITY_KEY` secret is set in Cloudflare
  (PO-14). Without it the team's **Activity** pages say "Counting is off" and nothing is
  written. Replacing the key is safe: open pages simply stop being counted until reloaded.
- **The nightly count** runs with the daily note (12:00 and 14:00 UTC) and adds each
  finished Toronto day into the totals. **Activity** lists the last 7 days: "failed" days
  are retried by the next run; for any older day, pick it in **Count this day again**
  (recorded).
- **An owner's Analytics page:** on the listing's **Activity** page, **Switch on** or
  **Switch off** (with an optional note; recorded). It takes effect at once. The owner
  sees totals only, never who.
- **Looking at the detail** (each action by browser, or the words people searched) is
  recorded in the audit log every time; the listing's **Activity** page shows who looked.
  Use it to run the service and check unusual days, not out of curiosity.
- **Daily limits:** at most 300 actions and 100 searches per browser, and 10,000 actions
  and 5,000 searches for the whole site, are kept each day (Toronto time); **Activity**
  shows today's use, and owners' pages name any day the site-wide limit was reached. Reaching them means a script, almost certainly:
  look at the day's detail for one browser or business repeating itself.
- **Unusual days** (over 5 times the business's usual day, once it has a week of history)
  are marked on its Activity page:
  check the day's detail for one browser repeating itself, then tell the owner if their
  numbers were inflated.
- **Database space:** shown on **Activity**. At 400 MB of the free 500 MB, move older
  detail to archive storage (ADR-023) before anything else.
- **Never put public pages behind a shared cache** (Cloudflare cache rules, "cache
  everything"): each page carries its own signed note, and shared copies would stop
  counting.

## 6. Restore procedure *(to be verified before launch)*

**Restore drill: every night, automatically** (`scripts/backup/check-restore.sh`, in the
backup job): the new backup is unlocked and restored into an empty Postgres of the same
version on the job's own machine (never the live database), then checked. The result is
on the run's summary page; a failure fails the run, and GitHub emails the product owner.
Record the first one, and any failure, in [G](./G-release-and-migration-history.md).
**A backup that has never been restored is not a backup.**

Integrity checks after any restore (all automatic in the drill):
- Every table is there, with exactly the rows in the backup file (counted in the file
  itself), and the file holds about what the database had (within 1% or 5 rows: that count
  is taken just after the export, while the site keeps running).
- Every link between tables (foreign key) holds: the database checks each one while
  loading, and none may be left unchecked.
- The 10 most recently changed published businesses come back exactly: every detail of
  each matches a fingerprint taken with the backup (one changed during the export is
  reported as such).
- Nothing written before the backup began is missing (the newest `audit_log` entry from
  then is there).
Not checked automatically: pages rendering against the restored copy. After a real
restore, open a few business pages by hand (step 5 below).

**To restore by hand** (engineering): download the artifact from the run (Actions →
Nightly backup → the run → Artifacts), then
`gpg --decrypt localites-backup-<time>.tar.gpg | tar -xf -` (asks for the passphrase) gives
`database.dump` and `manifest.json`; the drill script shows the exact steps: create the
roles and extensions the manifest lists, drop the new database's empty `public` schema,
then `pg_restore --no-owner --dbname=<new database> database.dump`.

**Production restore** (only after an incident, with your approval):
1. Put the site in maintenance mode (a static "we'll be right back" page).
2. Restore into a **new** database, never over the existing one, so the damaged copy
   is still available for investigation.
3. Run integrity checks.
4. Point the application at the restored database.
5. Leave maintenance mode. Verify with the smoke test.
6. Write the incident up in [G](./G-release-and-migration-history.md), including what
   data, if any, was lost between the backup and the incident.

## 7. Rolling back a bad release

| Situation | Action | Time |
|---|---|---|
| Application bug, no data harm | Cloudflare → roll back to the previous version. Safe because of the expand-then-contract rule. | Minutes |
| Migration failed partway | Migrations run in a transaction; a failure rolls back automatically and the application is not deployed. | Automatic |
| Migration succeeded but damaged data | Restore procedure above, after your approval | Hours |

## 8. Monitoring

**Every alert and every email meant for the Localites team goes to
supportlocalites@gmail.com** (D-11), including inquiries (D-04). It's also the admin
address on every service account (Supabase, Cloudflare, Resend, Sentry, backups).

| What | How | Who's told |
|---|---|---|
| Application errors | Sentry (free tier). Personal data scrubbed before sending. | Engineering; daily digest to you if anything new |
| Site down | **Built (13 October 2026):** the site watch, its own Worker (`localites-watch`: `workers/watch.ts`, rules in `src/lib/watch-rules.ts`, settings `wrangler.watch.jsonc`), every 5 minutes loads `/api/health` (website and database), the home page and Explore (which reads the database); a failure is looked at again 20 seconds later before it counts | supportlocalites@gmail.com, by email: when it goes down (what's wrong, and what to paste into a new session), every 6 hours while down, and when it's back. Needs its own email key (PO-19) |
| Slow pages | Cloudflare's free built-in analytics (no cookies, no tracking) | Weekly review by engineering |
| Free-plan limits | Database size, file storage, data transfer, emails per day, requests per day | Engineering weekly; **you at 80% of any limit**, with options |
| Database health | Supabase dashboard: storage used, connections, slow queries | Weekly review by engineering |
| Email delivery | Failed and queued counts in the `notification` log; provider's daily-limit warnings | Engineering daily; you if consumers or vendors are missing message notices |
| Reports | New items in the reports queue (messages, conversations, listings, reviews) | Platform team (you, initially), daily |
| Costs | Confirm every account is still on its free plan with no payment method needed | Monthly one-line confirmation to you |
| Unusual admin activity | Weekly `audit_log` review | Engineering, flagged to you |

### The site watch

- **Where:** Cloudflare → Workers & Pages → **localites-watch**. Put live by GitHub after the
  site (CI step **Put the site watch live**). No web address of its own; it only runs on its
  schedule (every 5 minutes, one of the free plan's 5 scheduled triggers).
- **What it remembers:** whether there's an outage, since when, and when it last emailed (a
  small Durable Object, free). So it emails once at the start, every 6 hours while down, and
  once at the end, never every 5 minutes.
- **No emails at all?** Cloudflare → localites-watch → **Logs**: "alert not sent" says why (for
  example the key is missing or was replaced; PO-19 steps 3 to 4). Without a key the watch
  still runs and logs, and tries the email again on every look.
- **What it can't see:** a problem inside one page that still loads (a broken button), and a
  Cloudflare-wide outage (the watch runs on Cloudflare too). The nightly backup run (F §5) is
  a second, separate signal.
- **Pausing it** (planned work): Cloudflare → localites-watch → Settings → **Triggers** →
  delete the schedule; the next update puts it back.

## 9. Dependency management

- Dependencies (third-party code libraries) are pinned to exact versions, so a build
  today and a build in six months produce the same result.
- Automated tooling proposes updates weekly. Security updates are applied within a
  week; others are batched monthly.
- Adding any new dependency requires a reason in the pull request.

## 10. Incident communication

If something affects users, you get a message within an hour of engineering knowing,
covering: what is affected, whether any data is at risk, what's being done, and when
the next update will come. Afterwards, a short written review: what happened, why,
what we changed so it doesn't recur.
