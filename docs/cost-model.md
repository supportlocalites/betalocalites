# Cost Model

**Last updated:** 2026-10-09 (revision 2)
**Currency:** USD unless stated. Multiply by roughly 1.4 for CAD; check the current rate.

**About these numbers.** Prices were checked on 2026-10-09 using third-party pricing
summaries, not the providers' own pages, and some sources disagree on details. Treat
them as planning estimates. Each will be confirmed on the provider's pricing page at
signup, and this document updated.

**Revision 2:** messaging increases email volume, so the email line moves to its paid
plan from Stage 2. Recommended ceiling raised from $75 to $90 to keep headroom.

---

## Summary

| Period | Monthly | Notes |
|---|---|---|
| **Building, before launch** | $0 – $25 | Free tiers for development |
| **After Stage 1 launch (directory)** | ~$45 – $50 | Hosting + database |
| **From Stage 2 (messaging)** | ~$65 – $75 | + email plan |
| **One-off / yearly** | Domain ~CA$15–25/yr; legal review quoted separately | |

Recommended ceiling for approval: **US$90/month** through Stage 3 (D-07).

## Line items

| Service | What for | Plan | Expected | Notes | Source |
|---|---|---|---|---|---|
| **Vercel** | Hosting | Hobby (dev) → **Pro** at launch | $0 → **$20/month** per developer seat; viewers free | Hobby is **non-commercial only**. Spend cap will be set. | [makerkit.dev](https://makerkit.dev/blog/saas/vercel-cost), [schematichq.com](https://schematichq.com/blog/vercel-pricing) |
| **Supabase** | Database, sign-in, file storage (incl. conversation files) | Free (dev, staging) → **Pro** at launch | $0 → **$25/month** (includes ~$10 compute credit) | Staging stays on the free tier. Conversation files are small (≤10 MB each); storage included in Pro should last well beyond year one. | [makerkit.dev](https://makerkit.dev/blog/saas/supabase-pricing), [focusreactive.com](https://focusreactive.com/blog/supabase-price/) |
| **Resend** | Sign-in, message notices, booked notices, feedback requests | Free → **Pro from Stage 2** | $0 (3,000/month, **100/day cap**) → ~**$20/month** | Batched notices keep volume down, but the 100/day cap is likely to be hit once messaging is busy. | [automationatlas.io](https://automationatlas.io/answers/resend-pricing-explained-2026/), [usecarly.com](https://www.usecarly.com/blog/resend-pricing/) |
| **Sentry** | Error alerts | Free | $0 | | To confirm at signup |
| **Independent backups** | Off-provider database copy | Object storage | < $5/month | Provider proposed at Stage 1 | To be quoted |
| **Domain** | Web address | `.ca` | ~CA$15–25/year | | Quoted with D-01 |
| **GitHub** | Code | Existing | $0 | | — |

## Possible additions (each would come to you first)

| Item | When | Why | Rough cost |
|---|---|---|---|
| Point-in-time database recovery | Before Stage 2 launch | Daily backups could lose up to a day of messages | Supabase add-on; will be quoted |
| Virus scanning of shared files | If reports show a need | ADR-020 | Usage-based service; will be quoted |
| Text-message notices | Only if requested | Some vendors may prefer texts | Per message |
| Retained on-call developer | From Stage 2 (D-11) | Messaging outages matter | Retainer, quoted separately |

## Costs we deliberately don't incur

| Not using | Why not |
|---|---|
| Payment processing | Tallo never handles money (ADR-018) |
| Chat service (Stream, Sendbird…) | Our own messaging costs nothing extra and keeps messages in Canada (ADR-019) |
| Real-time connection service | Polling every ~15 s is enough for planning |
| Search service | PostgreSQL search suffices at our size |
| Maps API | Town-level location is enough |
| Third-party analytics | First-party counts in our own database |
| SMS | Not requested; email notices first |
| AI services | No identified requirement |

## Rules

1. No new recurring cost without your written approval.
2. Spending caps set inside each provider where available.
3. A monthly one-line cost summary once anything is billed.
4. At 80% of the approved ceiling, we tell you before it's reached, with options.
