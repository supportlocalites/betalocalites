# Cost Model

**Last updated:** 2026-10-09
**Currency:** USD unless stated. Multiply by roughly 1.4 for CAD; check the current rate.

**About these numbers.** Prices were checked on 2026-10-09 using third-party pricing
summaries, not the vendors' own pricing pages, and some of those sources disagree on
details. Treat them as planning estimates. Each will be confirmed on the vendor's own
pricing page at signup, and this document updated.

---

## Summary

| Period | Monthly | One-off / yearly |
|---|---|---|
| **Stage 0–1, building (before launch)** | $0 – $25 | Domain ~CA$15–25/yr |
| **After public launch (Stages 1–3)** | ~$45 – $70 | Domain; legal review (quoted separately) |
| **Stage 4, if point-in-time recovery is added** | Add the provider's add-on price — will be quoted for approval | — |

Recommended budget ceiling for approval: **US$75/month** through Stage 2 (decision D-07).

## Line items

| Service | What for | Plan | Expected cost | Notes | Source |
|---|---|---|---|---|---|
| **Vercel** | Hosting the application | Hobby (dev only) → **Pro** at launch | $0 → **$20/month** per developer seat; viewer seats free | Hobby plan is **non-commercial only**, so production must be on Pro. Usage beyond included allowance is billed; we'll set a spend cap. | [makerkit.dev](https://makerkit.dev/blog/saas/vercel-cost), [schematichq.com](https://schematichq.com/blog/vercel-pricing) |
| **Supabase** | Database, sign-in, file storage | Free (dev) → **Pro** at launch | $0 → **$25/month**, includes ~$10 compute credit | Free projects pause after a week idle and have limited backups, so production needs Pro. Most small apps stay near the base price. | [makerkit.dev](https://makerkit.dev/blog/saas/supabase-pricing), [focusreactive.com](https://focusreactive.com/blog/supabase-price/) |
| **Resend** | Sign-in and notification emails | Free → Pro if needed | $0 (3,000/month, **100/day cap**) → ~$20/month | The daily cap is the limit we'd hit first, e.g. on a busy launch day. | [automationatlas.io](https://automationatlas.io/answers/resend-pricing-explained-2026/), [usecarly.com](https://www.usecarly.com/blog/resend-pricing/) |
| **Sentry** | Error alerts | Free | $0 | Free tier is sufficient for expected volume. | To confirm at signup |
| **Independent backups** | Off-provider copy of the database | Object storage | Expected < $5/month | Specific provider proposed at Stage 1. | To be quoted |
| **Domain** | The web address | `.ca` | ~CA$15–25/year | Depends on registrar. | To be quoted with D-01 |
| **GitHub** | Code repository | Existing account | $0 | Already in place. | — |

## Costs we are deliberately **not** incurring

| Not using | Typical cost | Why not |
|---|---|---|
| Search service (Algolia, etc.) | $0–$100s/month | PostgreSQL search is sufficient at our size (ADR-008) |
| Maps API (Google Maps, etc.) | Usage-based | Town-level location is enough for Stage 1; no map needed |
| Third-party analytics | $0–$100s/month + privacy cost | First-party counting in our own database (ADR-015) |
| SMS | Per message | Invitations shared through the host's own phone (D-08) |
| Payments | % of transactions | Not approved; not in scope |
| AI services | Usage-based | No identified requirement |

## Rules

1. No new service with a recurring cost is added without your written approval.
2. Spending caps are set inside each provider where available.
3. You get a monthly one-line cost summary once anything is billed.
4. If actual costs approach 80% of the approved ceiling, we tell you before it's
   reached, with options.
