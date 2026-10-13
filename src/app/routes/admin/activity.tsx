import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { addDays, torontoDate } from '@/lib/activity';
import { pageMeta } from '@/lib/meta';
import { KeyNotice } from '@/components/admin/KeyNotice';
import { keyState } from '@/server/activity.server';
import { overview, recountDay } from '@/server/admin/activity.server';
import { planTotals } from '@/server/admin/plan-counts.server';
import { withDb } from '@/server/db.server';
import type { Route } from './+types/activity';
import styles from './admin.module.css';

/**
 * Screen X18, all businesses: category figures (what D-22 allows when talking to other
 * businesses), search demand, the nightly count and how much database space activity uses.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Activity · Team'), { name: 'robots', content: 'noindex' }];

const FREE_MB = 500;
// The day's limits on what's kept (migration 0010).
const DAILY_EVENTS = 10000;
const DAILY_SEARCHES = 5000;

const ARCHIVE_AT_MB = 400;

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const today = torontoDate(new Date());
  const from = addDays(today, -30);
  const [result, planning] = await Promise.all([
    withDb(env, (db) => overview(db, from, today)),
    planTotals(env, context.get(adminContext), from, today),
  ]);
  return {
    ...result,
    planning,
    from,
    days: Array.from({ length: 7 }, (_, i) => addDays(today, -(i + 1))),
    key: keyState(env),
    saved: new URL(request.url).searchParams.get('saved'),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const day = String(form.get('day') ?? '');
  // A real date (2026-02-30 isn't), and a finished day.
  const real = /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day)) && addDays(day, 0) === day;
  if (form.get('intent') !== 'recount' || !real || day >= torontoDate(new Date())) {
    return data({ error: 'Choose a finished day to count again.' }, { status: 400 });
  }
  await recountDay(env, context.get(adminContext), day);
  return redirect(`/admin/activity?saved=recount`);
}

const mb = (bytes: number) => Math.round(bytes / 1_000_000);

export default function Activity({ loaderData, actionData }: Route.ComponentProps) {
  const { categories, demand, typed, rollups, space, days, key, saved, from, today, planning } = loaderData;
  const busy = useNavigation().state === 'submitting';
  return (
    <>
      <h1 className="title-1">Activity</h1>
      <div className="title-rule" aria-hidden="true" />
      <KeyNotice state={key} />
      {saved === 'recount' && (
        <p className="notice" role="status">
          Counted again.
        </p>
      )}
      {actionData && 'error' in actionData && (
        <p className="notice" role="alert">
          {actionData.error}
        </p>
      )}
      <p className="muted">
        The last 30 days (from {from}), up to the end of yesterday. Each business’s own numbers are on its listing’s Activity
        page.
      </p>

      <section className={styles.section} aria-labelledby="categories-heading">
        <h2 id="categories-heading">By main category</h2>
        <p className="muted">Category figures can be shared with other businesses; one business’s own numbers only with its permission.</p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Businesses</th>
                <th scope="col">Page opens</th>
                <th scope="col">Average per business</th>
                <th scope="col">Seen in lists</th>
                <th scope="col">Website taps</th>
                <th scope="col">Phone taps</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.category}>
                  <th scope="row">{c.category}</th>
                  <td>{c.businesses}</td>
                  <td>{c.views}</td>
                  <td>{c.businesses ? Math.round(c.views / c.businesses) : 0}</td>
                  <td>{c.seen}</td>
                  <td>{c.websiteTaps}</td>
                  <td>{c.phoneTaps}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="planning-heading">
        <h2 id="planning-heading">Planning (team only)</h2>
        <p className="muted">
          Only the Localites team sees these. The business doesn’t (D-42). Totals only, never who or which event. Saves are
          the ones still saved; a save taken back isn’t counted.
        </p>
        {planning.businesses.length === 0 ? (
          <p className="muted">No business was saved, added to an event plan or marked booked in these 30 days.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className="visually-hidden">The 20 businesses most marked booked, then most added</caption>
              <thead>
                <tr>
                  <th scope="col">Business</th>
                  <th scope="col">Marked booked</th>
                  <th scope="col">Added to an event plan</th>
                  <th scope="col">Saved</th>
                </tr>
              </thead>
              <tbody>
                {planning.businesses.map((b) => (
                  <tr key={b.vendorId}>
                    <th scope="row">
                      <Link to={`/admin/listings/${b.vendorId}/activity`}>{b.name}</Link>
                    </th>
                    <td>{b.markedBooked}</td>
                    <td>{b.added}</td>
                    <td>{b.saved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <h3 className="label section-gap">By kind of event</h3>
        {planning.types.length === 0 ? (
          <p className="muted">No events planned in these 30 days.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Kind of event</th>
                  <th scope="col">Events planned</th>
                  <th scope="col">Businesses marked booked</th>
                </tr>
              </thead>
              <tbody>
                {planning.types.map((t) => (
                  <tr key={t.typeName ?? ''}>
                    <th scope="row">{t.typeName ?? 'No type given'}</th>
                    <td>{t.eventsPlanned}</td>
                    <td>{t.markedBooked}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="demand-heading">
        <h2 id="demand-heading">What people looked for</h2>
        <p>
          Typed searches: {typed.searches}, of which {typed.foundNothing} found nothing.
        </p>
        <ul className={styles.history}>
          {demand.map((d) => (
            <li key={d.category}>
              {d.category}: browsed {d.searches} times{d.foundNothing ? `, ${d.foundNothing} with nothing listed` : ''}
            </li>
          ))}
        </ul>
        <p className="muted">The words people typed, by day (each look is recorded):</p>
        <p>
          {days.map((d, i) => (
            <span key={d}>
              {i > 0 && ' · '}
              <Link to={`/admin/activity/searches/${d}`} prefetch="none" className="text-link">
                {d}
              </Link>
            </span>
          ))}
        </p>
      </section>

      <section className={styles.section} aria-labelledby="count-heading">
        <h2 id="count-heading">The nightly count</h2>
        <p className="muted">Each morning the day before is added into the totals. A failed day is tried again by the next run.</p>
        {rollups.length === 0 ? (
          <p className="muted">It hasn’t run yet.</p>
        ) : (
          <ul className={styles.history}>
            {rollups.map((r) => (
              <li key={r.day}>
                {r.day}: {r.status === 'done' ? `counted (${r.events} actions)` : r.status === 'running' ? 'counting' : `failed (${r.failureReason})`}
              </li>
            ))}
          </ul>
        )}
        <Form method="post" className={styles.buttons}>
          <input type="hidden" name="intent" value="recount" />
          <label htmlFor="day" className="visually-hidden">
            Day to count again
          </label>
          <input id="day" name="day" type="date" className="input" defaultValue={days[0]} max={days[0]} required />
          <button type="submit" className="button button-secondary" disabled={busy}>
            Count this day again
          </button>
        </Form>
      </section>

      <section className={styles.section} aria-labelledby="space-heading">
        <h2 id="space-heading">Database space</h2>
        <p>{`Kept today: ${today.events} of ${DAILY_EVENTS} actions and ${today.searches} of ${DAILY_SEARCHES} searches. Past those, more aren’t kept until tomorrow, so nothing can fill the database.`}</p>
        <p>
          {`${mb(space.database)} MB of the free ${FREE_MB} MB in use, ${mb(space.activity)} MB of it activity. At ${ARCHIVE_AT_MB} MB, older detail moves to archive storage (ADR-023).`}
        </p>
      </section>
    </>
  );
}
