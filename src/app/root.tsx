import '@fontsource/playfair-display/600.css';
import '@fontsource/playfair-display/700.css';
import '@fontsource/playfair-display/500-italic.css';
import '@fontsource/jost/400.css';
import '@fontsource/jost/500.css';
import '@fontsource/jost/600.css';
import './globals.css';
import { Form, isRouteErrorResponse, Link, Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteLoaderData } from 'react-router';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { TeamOnly, teamOnlyReason } from '@/components/TeamOnly';
import { pageMeta } from '@/lib/meta';
import { themeFrom } from '@/lib/theme';
import { hasSessionCookie } from '@/server/auth/session.server';
import type { Route } from './+types/root';

const isNotFound = (error: unknown) => isRouteErrorResponse(error) && error.status === 404;
const isForbidden = (error: unknown) => isRouteErrorResponse(error) && error.status === 403;

// The black map pin from the wordmark (D-31). The file repeats the ink colour from
// tokens.css, because a browser-tab icon can't read the site's styles.
export const links: Route.LinksFunction = () => [{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }];

export const meta: Route.MetaFunction = ({ error }) =>
  pageMeta(error ? (isNotFound(error) ? 'Not found' : isForbidden(error) ? 'Team only' : 'Something went wrong') : undefined);

/** Only what the header needs; reading a cookie costs no network request. */
export function loader({ request }: Route.LoaderArgs) {
  // The site's own address, for link previews (lib/meta.ts shareMeta).
  // The light or dark look the visitor chose (D-57); none: the device's own setting.
  return { signedIn: hasSessionCookie(request), origin: new URL(request.url).origin, theme: themeFrom(request.headers.get('Cookie')) };
}

/**
 * Read again on every page change, so the header never shows "Sign in" to someone signed
 * in, or "My events" and "Account" to someone whose session has ended. It only reads a
 * cookie, so it costs nothing.
 */
export const shouldRevalidate = () => true;

export function Layout({ children }: { children: React.ReactNode }) {
  const theme = useRouteLoaderData<typeof loader>('root')?.theme ?? undefined;
  return (
    <html lang="en-CA" data-theme={theme}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <>
      <Outlet />
      <SiteFooter />
    </>
  );
}

/** Shown for unknown addresses, unlisted businesses and unexpected errors. */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const teamOnly = teamOnlyReason(error);
  if (teamOnly) return <TeamOnly reason={teamOnly} />;
  if (isForbidden(error)) {
    return (
      <>
        <SiteHeader />
        <main className="page narrow">
          <h1 className="title-1">This page is for the Localites team</h1>
          <div className="title-rule" aria-hidden="true" />
          <p className="muted">You’re signed in, but this account isn’t on the team.</p>
          <Form method="post" action="/sign-out">
            <button type="submit" className="button button-secondary">
              Sign out
            </button>
          </Form>
        </main>
      </>
    );
  }
  const notFound = isNotFound(error);
  return (
    <>
      <SiteHeader />
      <main className="page">
        <h1 className="title-1">{notFound ? 'We couldn’t find that page' : 'Something went wrong'}</h1>
        <div className="title-rule" aria-hidden="true" />
        <p className="muted">
          {notFound ? 'It may have moved, or the business may no longer be listed.' : 'The page didn’t load. Please try again in a moment.'}
        </p>
        <Link to="/explore" className="button button-primary">
          Back to Explore
        </Link>
      </main>
    </>
  );
}
