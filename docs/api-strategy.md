# API & Integration Strategy

**Status:** Proposed (Stage 0).
**Last updated:** 2026-10-09

## 1. Internal contracts

There is no separate backend API to maintain in Stage 1 (ADR-001). Instead:

- **Screens never touch the database.** They call functions exported by a module's
  public interface (e.g. `vendors.publishListing(actor, vendorId)`).
- **Every public module function** takes the acting user as its first argument, checks
  permission through the `policy` module, validates its input against a schema, and
  returns a typed result. No function trusts its caller to have checked anything.
- **Input validation** uses declared schemas (Zod) at every boundary: form submissions,
  URL parameters, uploaded files. The same schema produces the error messages users see.
- **Errors** are typed: `NotFound`, `Forbidden`, `InvalidInput`, `Conflict` (e.g. a
  disallowed status change). `Forbidden` and `NotFound` look identical to the user for
  private records, so probing IDs reveals nothing.
- **Module boundaries** are enforced by an automated lint rule: a module may import
  another module's public interface, never its internals or tables.

This is the contract that lets us add a public API later without rewriting anything:
an API endpoint becomes a thin wrapper around the same module functions.

## 2. External API

**None in Stages 1–3.** A public or partner API (e.g. for a native app, or for vendors'
own websites) would be proposed separately with a use case. When it comes, it will be
versioned (`/api/v1/`), documented with an OpenAPI specification, and authenticated
with scoped keys.

## 3. Third-party integrations

| Integration | Stage | Purpose | Data shared | Failure behaviour | Approval |
|---|---|---|---|---|---|
| Supabase Auth | 1 | Sign-in | Email, hashed password (held by Supabase) | Sign-in unavailable; public pages unaffected | ADR-003 |
| Supabase Storage | 1 | Images, documents | Uploaded files | Images fall back to placeholders; uploads show a retry | ADR-003 |
| Resend | 1 | Sign-in emails; later notifications | Recipient email, message | Retry with backoff; user sees "email may be delayed" | ADR-013 |
| Sentry | 1 | Error alerts | Error details, personal data scrubbed | None to users | ADR-016 |
| Vercel | 1 | Hosting | Everything passes through | Instant rollback | ADR-007 |

**Rules for every integration:**
1. Wrapped behind our own interface, so it can be replaced without touching features.
2. A failure in an integration degrades one feature; it never takes down public pages.
3. Data sent is the minimum needed; documented in the table above.
4. No integration with a recurring cost is added without approval.

## 4. Integrations explicitly not planned

| Integration | Why not (yet) |
|---|---|
| Calendar / availability sync | No reliable, widely used integration among local vendors; would imply availability we can't guarantee |
| Payments (Stripe, etc.) | Not approved |
| Maps (Google, Mapbox) | Town-level location is sufficient; cost |
| SMS | Hosts share links through their own phones (D-08) |
| Social login | Adds data-sharing relationships; add on request |
| AI services | No identified requirement |

## 5. Inbound webhooks

None in Stages 1–3. When needed (e.g. email bounce notices), each webhook verifies the
sender's signature before acting, and is idempotent so a repeated delivery does no harm.
