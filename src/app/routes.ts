import { index, layout, route, type RouteConfig } from '@react-router/dev/routes';

// Any other address shows the "couldn't find that page" screen (root.tsx).
export default [
  index('routes/welcome.tsx'),
  route('explore', 'routes/explore.tsx'),
  route('search', 'routes/search.tsx'),
  route('vendors/:slug', 'routes/vendor.tsx'),
  route('api/health', 'routes/health.ts'),
  route('robots.txt', 'routes/robots.ts'),
  route('sitemap.xml', 'routes/sitemap.ts'),
  route('api/activity', 'routes/api-activity.ts'),
  route('suggest', 'routes/suggest.tsx'),
  route('how-it-works', 'routes/how-it-works.tsx'),
  route('for-businesses', 'routes/for-businesses.tsx'),
  route('help', 'routes/help.tsx'),
  route('join', 'routes/join.tsx'),
  route('sign-in', 'routes/sign-in.tsx'),
  route('two-step', 'routes/two-step.tsx'),
  route('sign-out', 'routes/sign-out.ts'),
  // The moon and sun: light or dark look (D-57).
  route('theme', 'routes/theme.ts'),
  route('goodbye', 'routes/goodbye.tsx'),
  route('suspended', 'routes/suspended.tsx'),
  // A guest's invitation (Stage 4): no account. /i/<token> swaps the link for a cookie.
  route('i/:token', 'routes/invite-link.ts'),
  route('invite', 'routes/invite.tsx'),
  route('invite/calendar.ics', 'routes/invite-calendar.ts'),
  // The group link (part 2): /g/<token> swaps the link for a cookie; the same page, without a name.
  route('g/:token', 'routes/group-link.ts'),
  route('group-invite', 'routes/invite.tsx', { id: 'group-invite' }),
  route('group-invite/calendar.ics', 'routes/invite-calendar.ts', { id: 'group-invite-calendar' }),
  // Needs an account: every request passes the gate in routes/member/layout.tsx (D-27).
  layout('routes/member/layout.tsx', [
    route('account', 'routes/member/account.tsx'),
    route('account/delete', 'routes/member/account-delete.tsx'),
    route('account/data', 'routes/member/account-data.tsx'),
    route('account/data/download', 'routes/member/account-data-download.ts'),
    route('vendors/:slug/claim', 'routes/member/claim.tsx'),
    route('vendors/:slug/edit', 'routes/member/listing-edit.tsx'),
    route('vendors/:slug/name', 'routes/member/business-name.tsx'),
    route('vendors/:slug/analytics', 'routes/member/analytics.tsx'),
    route('vendors/:slug/photos', 'routes/member/photos.tsx'),
    // Planning an event (slice 2A; D-13, D-39–D-43, ADR-022, ADR-031). The side comes from
    // the page: /events…, /saved and /vendors/:slug/add act as the person; /business and
    // /vendors/:slug/bookings act as the business.
    route('events', 'routes/member/events.tsx'),
    route('events/new', 'routes/member/event-new.tsx'),
    route('events/:id', 'routes/member/event-plan.tsx'),
    route('events/:id/edit', 'routes/member/event-edit.tsx'),
    route('events/:id/cancel', 'routes/member/event-cancel.tsx'),
    route('events/:id/tell-guests', 'routes/member/event-tell-guests.tsx'),
    route('events/:id/plan/:rowId/:change', 'routes/member/plan-change.tsx'),
    // Reviewing a business booked for the event (C11, Stage 3).
    route('events/:id/review/:rowId', 'routes/member/review.tsx'),
    // Guests (C13, C14, Stage 4): the host's own list, and sending one guest's link.
    route('events/:id/guests', 'routes/member/guests.tsx'),
    route('events/:id/guests/print', 'routes/member/guests-print.tsx'),
    route('events/:id/guests/:guestId', 'routes/member/guest-share.tsx'),
    // Report a published review (Stage 3, part 2): as the person, or as the business about its own.
    route('reviews/:id/report', 'routes/member/review-report.tsx', { id: 'person-review-report' }),
    route('saved', 'routes/member/saved.tsx'),
    route('vendors/:slug/add', 'routes/member/vendor-add.tsx'),
    // Inquire, for a business not on Localites yet (C10, ADR-024).
    route('vendors/:slug/inquire', 'routes/member/inquire.tsx'),
    // Messages (Stage 2B): /messages… act as the person; /vendors/:slug/messages… as the business.
    route('messages', 'routes/member/messages.tsx'),
    route('messages/:id', 'routes/member/conversation.tsx'),
    route('vendors/:slug/message', 'routes/member/message-start.tsx'),
    route('vendors/:slug/messages', 'routes/member/business-messages.tsx'),
    route('vendors/:slug/messages/:id', 'routes/member/business-conversation.tsx'),
    // Report a conversation or a message (part 2): one page, two addresses (person, business).
    route('messages/:id/report', 'routes/member/report.tsx', { id: 'person-report' }),
    route('vendors/:slug/messages/:id/report', 'routes/member/report.tsx', { id: 'business-report' }),
    // An open conversation's quick look for anything new (no page, just its answer).
    route('messages/:id/check', 'routes/member/message-check.tsx', { id: 'person-check' }),
    route('vendors/:slug/messages/:id/check', 'routes/member/message-check.tsx', { id: 'business-check' }),
    // A file sent in a conversation (part 3), handed over only to the two sides.
    route('messages/:id/files/:fileId', 'routes/member/message-file.tsx', { id: 'person-file' }),
    route('vendors/:slug/messages/:id/files/:fileId', 'routes/member/message-file.tsx', { id: 'business-file' }),
    route('business', 'routes/member/business.tsx'),
    route('vendors/:slug/bookings', 'routes/member/bookings.tsx'),
    // A business's reviews, and its one reply to each (V8, Stage 3).
    route('vendors/:slug/reviews', 'routes/member/business-reviews.tsx'),
    route('vendors/:slug/reviews/:id/report', 'routes/member/review-report.tsx', { id: 'business-review-report' }),
    // A business owner's team (V4, E §3).
    route('vendors/:slug/team', 'routes/member/team.tsx'),
    route('team-invite/:token', 'routes/member/team-invite.tsx'),
  ]),
  // Team only: every request under /admin passes the gate in routes/admin/layout.tsx.
  route('admin', 'routes/admin/layout.tsx', [
    index('routes/admin/listings.tsx'),
    route('listings/new', 'routes/admin/listing-new.tsx'),
    route('listings/:id', 'routes/admin/listing-edit.tsx'),
    route('listings/:id/activity', 'routes/admin/listing-activity.tsx'),
    route('listings/:id/activity/:day', 'routes/admin/listing-activity-day.tsx'),
    route('activity', 'routes/admin/activity.tsx'),
    route('activity/searches/:day', 'routes/admin/activity-searches.tsx'),
    route('claims', 'routes/admin/claims.tsx'),
    route('suggestions', 'routes/admin/suggestions.tsx'),
    route('event-types', 'routes/admin/event-types.tsx'),
    route('booking-flags', 'routes/admin/booking-flags.tsx'),
    route('bookings', 'routes/admin/bookings.tsx'),
    route('inquiries', 'routes/admin/inquiries.tsx'),
    route('reports', 'routes/admin/reports.tsx'),
    route('reports/:id', 'routes/admin/report.tsx'),
    route('reports/:id/files/:fileId', 'routes/admin/report-file.tsx'),
    route('reviews', 'routes/admin/reviews.tsx'),
    route('reviews/:id', 'routes/admin/review.tsx'),
    route('account-deletions', 'routes/admin/account-deletions.tsx'),
    route('photos', 'routes/admin/photos.tsx'),
    route('categories', 'routes/admin/categories.tsx'),
    // Users and roles (X10, migration 0035), and the audit log (X11).
    route('team', 'routes/admin/team.tsx'),
    route('accounts', 'routes/admin/accounts.tsx'),
    route('waiting', 'routes/admin/waiting.tsx'),
    route('audit', 'routes/admin/audit.tsx'),
    // Owners' changes the language check held (D-50, migration 0036).
    route('held-changes', 'routes/admin/held-changes.tsx'),
  ]),
] satisfies RouteConfig;
