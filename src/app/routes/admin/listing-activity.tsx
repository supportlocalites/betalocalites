import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { ActivityReport, PERIOD_WORDS } from '@/components/ActivityReport';
import { type Period, torontoDate } from '@/lib/activity';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { trackingOn } from '@/server/activity.server';
import { ActivityConflict, detailLooks, readSwitch, recentDays, setAnalytics } from '@/server/admin/activity.server';
import { readReport } from '@/server/analytics.server';
import { withDb } from '@/server/db.server';
import { sql } from 'drizzle-orm';
import type { Route } from './+types/listing-activity';
import styles from './admin.module.css';

/**
 * Screen X18 for one business: its numbers (as the owner would see them, without hiding
 * small figures), what was left out, unusual days, who on the team looked at the detail,
 * and the switch for the owner's Analytics page (D-37).
 */
export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta(loaderData ? `Activity: ${loaderData.listing.name} · Team` : 'Activity · Team'),
  { name: 'robots', content: 'noindex' },
];

const PERIODS: Period[] = ['week', 'month', 'year'];

export async function loader({ params, request, context }: Route.LoaderArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const { env } = context.get(cloudflareContext);
  const url = new URL(request.url);
  const asked = url.searchParams.get('period');
  const period: Period = PERIODS.includes(asked as Period) ? (asked as Period) : 'month';
  const today = torontoDate(new Date());
  const result = await withDb(env, async (db) => {
    const [listing] = await db.execute<{ name: string; slug: string; website: boolean; phone: boolean; services: boolean; owned: boolean }>(sql`
      select v.display_name as name, v.slug::text as slug, v.website_url is not null as website, v.public_phone is not null as phone,
             exists (select 1 from vendor_service s where s.vendor_id = v.id and s.is_active) as services,
             exists (select 1 from vendor_member m where m.vendor_id = v.id and m.role = 'owner' and m.ended_at is null) as owned
      from vendor v where v.id = ${params.id}`);
    if (!listing) return null;
    const [report, switched, days, looks] = await Promise.all([
      readReport(db, params.id, period, today),
      readSwitch(db, params.id),
      recentDays(db, params.id, today),
      detailLooks(db, params.id),
    ]);
    return { listing, report, switched, days, looks };
  });
  if (!result) throw data(null, { status: 404 });
  return { ...result, counting: trackingOn(env), saved: url.searchParams.get('saved') };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const { env } = context.get(cloudflareContext);
  const admin = context.get(adminContext);
  const form = await request.formData();
  if (form.get('intent') !== 'analytics') return data({ error: 'Unknown request.' }, { status: 400 });
  const enabled = form.get('enabled') === 'on';
  const note = String(form.get('note') ?? '').replace(/\s+/g, ' ').trim().slice(0, 500) || null;
  try {
    await setAnalytics(env, admin, params.id, enabled, note);
  } catch (err) {
    if (err instanceof ActivityConflict) return data({ error: err.message }, { status: 409 });
    throw err;
  }
  return redirect(`/admin/listings/${params.id}/activity?saved=${enabled ? 'analytics-on' : 'analytics-off'}`);
}

const SAVED: Record<string, string> = {
  'analytics-on': 'Analytics switched on. The owner can see their numbers now.',
  'analytics-off': 'Analytics switched off. The owner can no longer see any numbers.',
};

const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' });

export default function ListingActivity({ loaderData, actionData }: Route.ComponentProps) {
  const { listing, report, switched, days, looks, counting, saved } = loaderData;
  const busy = useNavigation().state === 'submitting';
  const on = switched?.enabled ?? false;
  return (
    <>
      <p>
        <Link to=".." relative="path" className="text-link">
          ← The listing
        </Link>{' '}
        ·{' '}
        <Link to="/admin/activity" className="text-link">
          All activity
        </Link>
      </p>
      <h1 className="title-1 section-gap">Activity: {listing.name}</h1>
      <div className="title-rule" aria-hidden="true" />
      {!counting && (
        <p className="notice">Counting is off: the activity key isn’t set in Cloudflare yet (runbook, “Activity counting”).</p>
      )}
      {saved && SAVED[saved] && (
        <p className="notice" role="status">
          {SAVED[saved]}
        </p>
      )}
      {actionData && 'error' in actionData && (
        <p className="notice" role="alert">
          {actionData.error}
        </p>
      )}

      <section className={styles.section} aria-labelledby="switch-heading">
        <h2 id="switch-heading">Analytics page for the owner</h2>
        <p>
          {on
            ? `On since ${when.format(new Date(switched!.changedAt))}, switched on by ${switched!.changedBy ?? 'the team'}. The owner sees it at /vendors/${listing.slug}/analytics.`
            : 'Off. The owner can’t see any numbers.'}
        </p>
        {!listing.owned && <p className="muted">No one owns this listing yet. It takes effect once a claim is approved.</p>}
        <p className="muted">
          When it’s on, the owner sees their own totals on an Analytics page in their business’s area. They never see who.
          They aren’t emailed.
        </p>
        <Form method="post" className={styles.buttons}>
          <input type="hidden" name="intent" value="analytics" />
          <input type="hidden" name="enabled" value={on ? 'off' : 'on'} />
          <label htmlFor="note" className="visually-hidden">
            Note (only the team sees this)
          </label>
          <input id="note" name="note" className="input" placeholder="Note (only the team sees this)" maxLength={500} />
          <button type="submit" className="button button-secondary" disabled={busy}>
            {on ? 'Switch off' : 'Switch on'}
          </button>
        </Form>
      </section>

      <section className={styles.section} aria-labelledby="numbers-heading">
        <h2 id="numbers-heading">What the owner sees</h2>
        <Form method="get" className={styles.buttons}>
          <label htmlFor="period" className="visually-hidden">
            Period
          </label>
          <select id="period" name="period" defaultValue={report.period} className="input">
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {PERIOD_WORDS[p].label}
              </option>
            ))}
          </select>
          <button type="submit" className="button button-secondary">
            Show
          </button>
        </Form>
        <ActivityReport report={report} hideSmall={false} has={listing} />
      </section>

      <section className={styles.section} aria-labelledby="days-heading">
        <h2 id="days-heading">The last 28 days</h2>
        <p className="muted">
          Each day’s detail (who did what, by browser) is for running the service. Every look is recorded below.
        </p>
        {days.length === 0 ? (
          <p className="muted">Nothing counted yet.</p>
        ) : (
          <ul className={styles.history}>
            {days.map((d) => (
              <li key={d.day}>
                <Link to={d.day} relative="path" prefetch="none" className="text-link">
                  {d.day}
                </Link>{' '}
                <span className="muted">
                  · seen {d.seen} · opened {d.views}
                  {d.unusual ? ' · Unusual: far above this business’s own average' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby="looks-heading">
        <h2 id="looks-heading">Who looked at the detail</h2>
        {looks.length === 0 ? (
          <p className="muted">Nobody yet.</p>
        ) : (
          <ul className={styles.history}>
            {looks.map((l, i) => (
              <li key={i}>
                {l.who ?? 'Someone'} <span className="muted">· {when.format(new Date(l.at))} · {l.day ?? ''}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
