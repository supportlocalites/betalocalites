import '@fontsource/playfair-display/600.css';
import '@fontsource/playfair-display/700.css';
import '@fontsource/playfair-display/500-italic.css';
import '@fontsource/jost/400.css';
import '@fontsource/jost/500.css';
import '@fontsource/jost/600.css';
import './globals.css';
import { isRouteErrorResponse, Link, Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import { SiteHeader } from '@/components/SiteHeader';
import { pageMeta } from '@/lib/meta';
import type { Route } from './+types/root';

const isNotFound = (error: unknown) => isRouteErrorResponse(error) && error.status === 404;

export const meta: Route.MetaFunction = ({ error }) =>
  pageMeta(error ? (isNotFound(error) ? 'Not found' : 'Something went wrong') : undefined);

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-CA">
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
  return <Outlet />;
}

/** Shown for unknown addresses, unlisted businesses and unexpected errors. */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const notFound = isNotFound(error);
  return (
    <>
      <SiteHeader />
      <main className="page">
        <h1 className="title-1">{notFound ? 'We couldn’t find that page' : 'Something went wrong'}</h1>
        <div className="title-rule" aria-hidden="true" />
        <p className="muted">
          {notFound
            ? 'It may have moved, or the business may no longer be listed.'
            : 'The page didn’t load. Please try again in a moment.'}
        </p>
        <Link to="/explore" className="button button-primary">
          Back to Explore
        </Link>
      </main>
    </>
  );
}
