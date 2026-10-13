import { index, layout, route, type RouteConfig } from '@react-router/dev/routes';

// Any other address shows the "couldn't find that page" screen (root.tsx).
export default [
  index('routes/welcome.tsx'),
  route('explore', 'routes/explore.tsx'),
  route('search', 'routes/search.tsx'),
  route('vendors/:slug', 'routes/vendor.tsx'),
  route('api/health', 'routes/health.ts'),
  route('api/activity', 'routes/api-activity.ts'),
  route('suggest', 'routes/suggest.tsx'),
  route('join', 'routes/join.tsx'),
  route('sign-in', 'routes/sign-in.tsx'),
  route('two-step', 'routes/two-step.tsx'),
  route('sign-out', 'routes/sign-out.ts'),
  route('goodbye', 'routes/goodbye.tsx'),
  // Needs an account: every request passes the gate in routes/member/layout.tsx (D-27).
  layout('routes/member/layout.tsx', [
    route('account', 'routes/member/account.tsx'),
    route('account/delete', 'routes/member/account-delete.tsx'),
    route('vendors/:slug/claim', 'routes/member/claim.tsx'),
    route('vendors/:slug/edit', 'routes/member/listing-edit.tsx'),
    route('vendors/:slug/analytics', 'routes/member/analytics.tsx'),
    // Planning an event (slice 2A; D-13, D-39–D-43, ADR-022, ADR-031). The side comes from
    // the page: /events…, /saved and /vendors/:slug/add act as the person; /business and
    // /vendors/:slug/bookings act as the business.
    route('events', 'routes/member/events.tsx'),
    route('events/new', 'routes/member/event-new.tsx'),
    route('events/:id', 'routes/member/event-plan.tsx'),
    route('events/:id/edit', 'routes/member/event-edit.tsx'),
    route('events/:id/cancel', 'routes/member/event-cancel.tsx'),
    route('events/:id/plan/:rowId/:change', 'routes/member/plan-change.tsx'),
    route('saved', 'routes/member/saved.tsx'),
    route('vendors/:slug/add', 'routes/member/vendor-add.tsx'),
    route('business', 'routes/member/business.tsx'),
    route('vendors/:slug/bookings', 'routes/member/bookings.tsx'),
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
    route('account-deletions', 'routes/admin/account-deletions.tsx'),
  ]),
] satisfies RouteConfig;
