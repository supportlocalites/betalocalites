# API & Integration Strategy

**Status:** Proposed (Stage 0, revision 2).
**Last updated:** 2026-10-09

## 1. Internal contracts

There is no separate backend API to maintain (ADR-001). Instead:

- **Screens never touch the database.** They call functions exported by a module's
  public interface, e.g. `messaging.sendMessage(actor, conversationId, body, files)`.
- **Every function takes the acting person and the side they're acting as**
  (consumer or vendor), checks permission through the `policy` module, validates input
  against a schema, and returns a typed result. No function trusts its caller.
- **Input validation** uses declared schemas (Zod) at every boundary: forms, URL
  parameters, uploaded files (checked by content, not just name).
- **Errors** are typed: `NotFound`, `Forbidden`, `InvalidInput`, `Conflict` (e.g. a
  disallowed status change). For private records, `Forbidden` and `NotFound` look the
  same to the user, so probing IDs reveals nothing.
- **Module boundaries** are enforced by an automated lint rule.

This is what lets us add a public API or native app later: an endpoint becomes a thin
wrapper around the same functions.

## 2. Messaging delivery

- While a conversation is open, the page asks our server for new messages about every
  15 seconds, through the same permission checks as everything else (ADR-019).
- When someone is away, a batched email tells them they have a new message. The email
  says who it's from and links to the conversation. **It doesn't include the message
  text**, so private conversations don't sit in inboxes or email-provider logs.
- No websockets, no browser-to-database connections, no third-party chat service.

## 3. External API

**None planned.** A public or partner API (e.g. for a native app) would be proposed
separately with a use case. It would be versioned, documented (OpenAPI), and
authenticated with scoped keys.

## 4. Third-party integrations

| Integration | Stage | Purpose | Data shared | If it fails | Approval |
|---|---|---|---|---|---|
| Supabase Auth | 1 | Sign-in | Email; password held by Supabase | Sign-in unavailable; public pages fine | ADR-003 |
| Supabase Storage | 1 | Vendor photos; **conversation files** (Stage 2) | Uploaded files (stored in Canada) | Uploads show retry; messages still send | ADR-003 |
| Resend | 1 | Sign-in; message notices; booked notices; feedback requests | Recipient email; notice text (never message content) | Queued and retried; status recorded honestly | ADR-013 |
| Sentry | 1 | Error alerts | Error details; personal data and message text scrubbed | None to users | ADR-016 |
| Cloudflare | 1 | Hosting (free plan); scheduled checks | Everything passes through | Roll back to previous version | ADR-007 |

All on free plans; Localites has no running costs (D-20).

**Rules for every integration:** wrapped behind our own interface so it can be replaced;
a failure degrades one feature, never public pages; minimum data shared; no cost of any
kind without approval.

## 5. Not planned

| Integration | Why not |
|---|---|
| **Payments of any kind** (Stripe, PayPal, Interac…) | Localites never handles money (ADR-018). Not "later": a new decision would be required. |
| Chat services (Stream, Sendbird) | Cost; messages would be held outside our database and outside Canada |
| Calendar / availability sync | No reliable integration among local vendors; we won't imply availability |
| Maps | Town-level location is enough |
| SMS | Not requested; email first |
| Social login | Adds data-sharing; add on request |
| AI services | No identified requirement |

## 6. Inbound webhooks

Possibly one, in Stage 2: email delivery and bounce notices from Resend, so a failed
notice is recorded as failed rather than assumed sent. It will verify the sender's
signature and be safe to receive twice.
