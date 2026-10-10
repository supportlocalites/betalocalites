# Cost Model

**Last updated:** 2026-10-09 (revision 3)

**Revision 3, the product owner's direction: no running costs.** Every service now
runs on a free plan. The only recommended cost is the web address (domain), about
CA$15–25 a year, because it's needed to send email to anyone (see below). Everything
else is $0 per month.

---

## Summary

| Period | Monthly | Yearly |
|---|---|---|
| Building, before launch | **$0** | — |
| After launch, all stages | **$0** | Web address ~CA$15–25 |

**Rule:** nothing that costs money is added without your written approval. When a free
plan's limit is approaching, we tell you at 80%, with options, well before anything
stops working.

## What each service is for

| Service | What it does, in plain terms | Plan | Cost | Free-plan limits that matter | Source |
|---|---|---|---|---|---|
| **Supabase** | The filing cabinet: database, sign-in, vendor photos, files shared in conversations | Free | $0 | 500 MB database · 1 GB file storage · 2 projects (live + test copy) · pauses after a week of *no* activity (a live site with daily visitors won't pause; Supabase emails a week before) | [supabase.com/pricing](https://supabase.com/pricing), [pausing](https://supabase.com/docs/guides/platform/free-project-pausing), [database size](https://supabase.com/changelog/33121-relaxing-database-size-limit-on-free-plan-0-5-gb-database-size-per-project) |
| **Cloudflare** | The shopfront: runs the website and sends pages to visitors' phones | Free | $0 | Pre-built pages and images: unlimited · pages built on request (signed-in screens): 100,000/day · 10 ms of processing per request | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [static assets](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) |
| **Resend** | The post office: sign-in links, new-message notices, "How was it?" emails | Free | $0 | 100 emails/day · 3,000/month · requires a verified domain to email anyone | [quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits), [domain required](https://resend.com/docs/api-reference/errors) |
| **Sentry** | The smoke alarm: alerts when something breaks | Free (1 user) | $0 | Error volume cap; ample for us | To confirm at signup |
| **GitHub** | Where the code lives; runs automated tests | Free | $0 | Monthly allowance of test-running minutes for private repositories | Existing account |
| **Nightly backup** | A copy of the data kept outside Supabase | Free storage | $0 | Small while the database is small | Location chosen in Stage 1, week 1 |
| **Domain** | The web address, `localites.ca` | Registrar | **~CA$15–25/year** | — | Bought by you, 10 Oct 2026 (D-01, D-07) |

## Why the domain is the one cost worth keeping

1. **Email doesn't work without it.** The email service only sends to people other
   than yourself from a domain you own and have verified. Without one, nobody can
   receive a sign-in link or a message notice.
2. **Links last.** Vendor profile links get shared on Facebook and in group chats. A
   free address like `localites.pages.dev` works, but moving to a real domain later breaks
   every link already shared.
3. **Trust.** Parents and businesses are more comfortable with `localites.ca` than with a
   free subdomain.

If you'd rather not pay even this, we can launch on a free Cloudflare address, but
email (sign-in, message notices, feedback requests) won't work until a domain is added.

## Limits we'll watch, in the order we expect to reach them

| Limit | What happens if reached | Roughly when | What we'd do first (free) |
|---|---|---|---|
| **Email: 100/day** | Emails beyond the cap fail until the next day | A busy messaging day after Stage 2 | Sign-in emails always go first; message notices batched more tightly; a second free email service (Brevo: 300/day) as overflow |
| **File storage: 1 GB** | New uploads fail | As photos and shared files accumulate | Compress photos on upload (already planned); lower the per-file size limit |
| **Data transfer (photos served)** | Supabase's free monthly allowance runs out | With steady traffic | Serve photos through Cloudflare's cache so repeat views don't count |
| **Database: 500 MB** | Writes fail | Years away for a local directory and its messages | Archive old data |
| **Hosting: 100,000 requests/day** | Signed-in pages pause until midnight UTC | Thousands of active users a day | Pre-built public pages don't count toward it |

**The important difference from paid plans:** free plans *stop* rather than *bill* you
when a limit is reached. That's what you want for cost control, and it's why we warn
at 80%. If Localites outgrows a free plan, that's a sign it's working, and spending would
then be your decision with real numbers in front of you.

## Trade-offs of running entirely free

| Trade-off | What it means | Mitigation |
|---|---|---|
| No guaranteed support or uptime | If a provider has an outage, we wait like everyone else | Error alerts and a scheduled check tell us quickly |
| No provider-managed backups we can rely on | Supabase's free plan backups are limited | Our own nightly backup, tested by restoring it monthly. Worst case, up to a day of data lost. |
| Free plans can change | A provider could reduce limits | Each service is wrapped so it can be swapped; we monitor announcements |
| Hosting choice shapes the build | Cloudflare's free plan allows 10 ms of processing per request | A one-day fit test in Stage 1 week 1 confirms the app fits before real building starts (ADR-005) |

## Not running costs, but things you might choose to pay for

| Item | Status |
|---|---|
| Lawyer to review privacy policy, terms, and listing approach (PO-07) | **Recommended** before public launch, especially because we list businesses before they join and publish reviews. Your decision. |
| A developer on call for outages (D-11) | Optional. Free alternative: alerts go to you and you start a session. |
| Your own Claude plan used for development | Not part of Localites' running costs |

## Removed from earlier drafts

Vercel Pro ($20/month) → replaced by Cloudflare's free plan. Supabase Pro ($25/month)
→ free plan. Resend Pro (~$20/month) → free plan. Backup storage (<$5/month) → free.
Point-in-time database recovery, virus scanning of files, text messages → not planned;
each would come to you first if ever needed.
