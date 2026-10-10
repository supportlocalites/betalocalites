import { index, layout, route, type RouteConfig } from '@react-router/dev/routes';

// Any other address shows the "couldn't find that page" screen (root.tsx).
export default [
  index('routes/welcome.tsx'),
  route('explore', 'routes/explore.tsx'),
  route('search', 'routes/search.tsx'),
  route('vendors/:slug', 'routes/vendor.tsx'),
  route('api/health', 'routes/health.ts'),
  route('suggest', 'routes/suggest.tsx'),
  route('join', 'routes/join.tsx'),
  route('sign-in', 'routes/sign-in.tsx'),
  route('two-step', 'routes/two-step.tsx'),
  route('sign-out', 'routes/sign-out.ts'),
  // Needs an account: every request passes the gate in routes/member/layout.tsx (D-27).
  layout('routes/member/layout.tsx', [
    route('account', 'routes/member/account.tsx'),
    route('vendors/:slug/claim', 'routes/member/claim.tsx'),
  ]),
  // Team only: every request under /admin passes the gate in routes/admin/layout.tsx.
  route('admin', 'routes/admin/layout.tsx', [
    index('routes/admin/listings.tsx'),
    route('listings/new', 'routes/admin/listing-new.tsx'),
    route('listings/:id', 'routes/admin/listing-edit.tsx'),
    route('claims', 'routes/admin/claims.tsx'),
    route('suggestions', 'routes/admin/suggestions.tsx'),
  ]),
] satisfies RouteConfig;
