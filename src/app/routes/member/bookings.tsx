import { data, Form, Link, redirect, useNavigation, useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { isUuid, SLUG } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { NO_PAYMENTS_BUSINESS, PLAN_LIMITS, shortDate, TOO_FAST, vendorSummary } from '@/lib/plan-terms';
import { type BookingMarked, bookingsMarked, flagBooking } from '@/server/bookings.server';
import { flagInput } from '@/server/event-input';
import { emailBookingFlagged } from '@/server/plan-emails.server';
import { afterwards, refusal, siteUrl, todayIso, tooFast } from '@/server/plan-pages.server';
import type { Route } from './+types/bookings';
import styles from './plan.module.css';

/**
 * Screen V8: Bookings marked (D-13 R3–R5, D-40, D-41). Customers who marked this business
 * as booked: their name, the date, the town and about how many guests, nothing else. For
 * the business's active owners and managers only (checked in the database on every
 * request); anyone else gets "not found". A business can say a booking isn't right.
 */
export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta(loaderData ? `Bookings marked · ${loaderData.vendor.name}` : 'Bookings marked'),
  { name: 'robots', content: 'noindex' },
];

export async function loader({ params, context }: Route.LoaderArgs) {
  if (!SLUG.test(params.slug)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const result = await bookingsMarked(context.get(cloudflareContext).env, member.userId, params.slug);
  if (!result) throw data(null, { status: 404 });
  if ('renamedTo' in result) throw redirect(`/vendors/${result.renamedTo}/bookings`);
  return { ...result, today: todayIso() };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  if (!SLUG.test(params.slug)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env, ctx } = context.get(cloudflareContext);
  const form = await request.formData();
  const rowId = String(form.get('rowId') ?? '');
  if (form.get('intent') !== 'flag' || !isUuid(rowId)) throw data(null, { status: 400 });
  if (await tooFast(env, member.userId)) return data({ rowId, error: TOO_FAST }, { status: 429 });
  const parsed = flagInput.safeParse({ note: String(form.get('note') ?? '') });
  if (!parsed.success) return data({ rowId, error: parsed.error.issues[0]?.message ?? 'Please check the note.' }, { status: 400 });
  try {
    const flagged = await flagBooking(env, member.userId, params.slug, rowId, parsed.data.note);
    afterwards(ctx, emailBookingFlagged(env, siteUrl(env, request), flagged), 'booking flag emails');
  } catch (err) {
    const { error, status } = refusal(err);
    return data({ rowId, error }, { status });
  }
  return redirect(`/vendors/${params.slug}/bookings?flagged=${rowId}`);
}

/** "12 October" (Toronto time). */
const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'America/Toronto' });

function Booking({
  b,
  business,
  today,
  error,
  busy,
}: {
  b: BookingMarked;
  business: string;
  today: string;
  error: string | null;
  busy: boolean;
}) {
  return (
    <li>
      <span>
        <strong>{b.person}</strong> marked you as booked for <strong>{shortDate(b.date, today)}</strong>
      </span>
      <span className={styles.meta}>{vendorSummary({ town: b.town, guests: b.guests })}</span>
      <span className={styles.meta}>Marked on {dayMonth.format(new Date(b.bookedAt))}</span>
      {b.cancelled && <span>{b.person} cancelled this event.</span>}
      {b.flaggedAt ? (
        <span className={styles.flagged}>
          You told us this isn’t right on {dayMonth.format(new Date(b.flaggedAt))}. We’ve passed it to the Localites team and let {b.person}{' '}
          know.
        </span>
      ) : b.cancelled ? null : (
        <details className={styles.change} open={Boolean(error)}>
          <summary>This isn’t right</summary>
          <Form method="post">
            <input type="hidden" name="intent" value="flag" />
            <input type="hidden" name="rowId" value={b.rowId} />
            <p className={styles.small}>
              Tell us if {b.person} didn’t book {business} for this, for example if you’ve never heard from them. We’ll pass it to the
              Localites team and let {b.person} know.
            </p>
            {error && (
              <p className="notice" role="alert">
                {error}
              </p>
            )}
            <div className="field">
              <label htmlFor={`note-${b.rowId}`} className="field-label">
                Anything we should know? (optional, only the Localites team sees this)
              </label>
              <textarea id={`note-${b.rowId}`} name="note" className="input" maxLength={PLAN_LIMITS.flagNote} />
            </div>
            <button type="submit" className={`button button-secondary ${styles.wide}`} disabled={busy}>
              Send to the Localites team
            </button>
          </Form>
        </details>
      )}
    </li>
  );
}

export default function Bookings({ loaderData, actionData }: Route.ComponentProps) {
  const { vendor, comingUp, earlier, today } = loaderData;
  const busy = useNavigation().state !== 'idle';
  const flaggedId = useSearchParams()[0].get('flagged');
  const flagged = flaggedId ? [...comingUp, ...earlier].find((b) => b.rowId === flaggedId) : undefined;
  const errorFor = (rowId: string) => (actionData && actionData.rowId === rowId ? actionData.error : null);
  const list = (rows: BookingMarked[]) => (
    <ul className={styles.list}>
      {rows.map((b) => (
        <Booking key={b.rowId} b={b} business={vendor.name} today={today} error={errorFor(b.rowId)} busy={busy} />
      ))}
    </ul>
  );
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <p className="label">{vendor.name}</p>
        <h1 className="title-1">Bookings marked</h1>
        <div className="title-rule" aria-hidden="true" />
        {flagged && !actionData && (
          <p className="notice" role="status">
            Thanks. We’ve passed it to the Localites team and let {flagged.person} know.
          </p>
        )}
        <p className="muted">
          Customers who marked {vendor.name} as booked on Localites. It’s their own record, to help them keep track; Localites hasn’t
          checked it.
        </p>
        {comingUp.length + earlier.length === 0 ? (
          <p>No one has marked {vendor.name} as booked yet. When a customer does, it will show here and we’ll email you.</p>
        ) : (
          <>
            <section aria-labelledby="coming-up" className={styles.section}>
              <h2 id="coming-up" className="label">
                Coming up
              </h2>
              {comingUp.length === 0 ? <p className="muted">Nothing coming up.</p> : list(comingUp)}
            </section>
            {earlier.length > 0 && (
              <section aria-labelledby="earlier" className={styles.section}>
                <h2 id="earlier" className="label">
                  Earlier
                </h2>
                {list(earlier)}
              </section>
            )}
          </>
        )}
        <p className={styles.footer}>{NO_PAYMENTS_BUSINESS}</p>
        <p>
          <Link to="/business" className="text-link">
            My business
          </Link>
        </p>
      </main>
    </>
  );
}
