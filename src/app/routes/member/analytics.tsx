import { data, Form, isRouteErrorResponse, Link, redirect, useRouteError } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { ActivityReport, dateWords, PERIOD_WORDS } from '@/components/ActivityReport';
import { SiteHeader } from '@/components/SiteHeader';
import { TeamOnly, teamOnlyReason } from '@/components/TeamOnly';
import { refuseTeamMember } from '@/server/bookings.server';
import { addDays, type Period, torontoDate } from '@/lib/activity';
import { pageMeta } from '@/lib/meta';
import { readReport } from '@/server/analytics.server';
import { withDb } from '@/server/db.server';
import { ownedAnalytics } from '@/server/owner-listing.server';
import type { Route } from './+types/analytics';

/**
 * Screen V10: a business's own numbers (D-30, D-37), for its owner, when the Localites team
 * has switched the page on for that business. Totals only, never who. No emails.
 */
export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta(loaderData ? `Analytics for ${loaderData.listing.name}` : 'Analytics'),
  { name: 'robots', content: 'noindex' },
];

const PERIODS: Period[] = ['week', 'month', 'year'];

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const asked = new URL(request.url).searchParams.get('period');
  // This year so far by default: it always includes the latest counted days.
  const period: Period = PERIODS.includes(asked as Period) ? (asked as Period) : 'year';
  const result = await withDb(env, async (db) => {
    const listing = await ownedAnalytics(db, member.userId, params.slug);
    if (!listing || 'renamedTo' in listing) return listing;
    return { listing, report: await readReport(db, listing.id, period, torontoDate(new Date())) };
  });
  if (!result) {
    await refuseTeamMember(env, member.userId, params.slug);
    throw data({ reason: 'not_available' }, { status: 404 });
  }
  if ('renamedTo' in result) throw redirect(`/vendors/${result.renamedTo}/analytics?period=${period}`);
  return { listing: { slug: result.listing.slug, name: result.listing.name, has: result.listing.has }, report: result.report };
}

export default function Analytics({ loaderData: { listing, report } }: Route.ComponentProps) {
  const empty = report.range.from >= report.range.to;
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">Analytics for {listing.name}</h1>
        <div className="title-rule" aria-hidden="true" />
        <p className="muted">
          How people found and used your page on Localites. You see totals only, never who. Numbers run to the end of
          yesterday and are updated each morning; conversations and messages are counted up to now. Your own visits are left out on browsers where you’ve signed in to
          Localites, and so are the Localites team’s.
        </p>
        <Form method="get" className="section-gap">
          <label htmlFor="period" className="field-label">
            Period
          </label>{' '}
          <select id="period" name="period" defaultValue={report.period} className="input">
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {PERIOD_WORDS[p].label}
              </option>
            ))}
          </select>{' '}
          <button type="submit" className="button button-secondary">
            Show
          </button>
        </Form>
        {empty ? (
          <p className="notice section-gap">The year has just started: its numbers appear from tomorrow. Choose last month to see December.</p>
        ) : (
          <>
            <p className="label section-gap">{`${dateWords(report.range.from)} to ${dateWords(addDays(report.range.to, -1))}`}</p>
            <ActivityReport report={report} hideSmall has={listing.has} />
          </>
        )}
        <p className="section-gap">
          <Link to={`/vendors/${listing.slug}/edit`} className="text-link">
            Edit your listing
          </Link>{' '}
          ·{' '}
          <Link to="/account" className="text-link">
            Your account
          </Link>
        </p>
      </main>
    </>
  );
}

/** Not available here: said the same way whatever the reason. */
export function ErrorBoundary() {
  const error = useRouteError();
  const teamOnly = teamOnlyReason(error);
  if (teamOnly) return <TeamOnly reason={teamOnly} />;
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">{missing ? 'There’s no Analytics page here' : 'Something went wrong'}</h1>
        <div className="title-rule" aria-hidden="true" />
        <p className="muted">
          {missing
            ? 'If this is your business and you’d like to see its numbers, email supportlocalites@gmail.com.'
            : 'The page didn’t load. Please try again in a moment.'}
        </p>
        <Link to="/account" className="button button-primary">
          Your account
        </Link>
      </main>
    </>
  );
}
