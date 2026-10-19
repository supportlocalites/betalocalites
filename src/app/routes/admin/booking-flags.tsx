import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { guestsWords, longDate } from '@/lib/plan-terms';
import { PlanRefused } from '@/server/acting.server';
import { bookingFlags, decideBookingFlag, emailAboutFlagDecision } from '@/server/admin/booking-flags.server';
import { afterwards, found, siteUrl } from '@/server/plan-pages.server';
import type { Route } from './+types/booking-flags';
import styles from './admin.module.css';

/**
 * Screen X16 (D-41): businesses that said a booking marked by a customer isn't right. The team
 * decides each (M8, D-54): the booking stands (it can be reviewed), or it wasn't real (it can't,
 * and its review is removed); the person and the business are emailed. Every look and every
 * decision is recorded (E §4.2).
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Booking flags · Team'), { name: 'robots', content: 'noindex' }];

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  return { flags: await bookingFlags(env, context.get(adminContext)) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const admin = context.get(adminContext);
  const form = await request.formData();
  const rowId = String(form.get('rowId') ?? '');
  const intent = String(form.get('intent') ?? '');
  if (!isUuid(rowId) || (intent !== 'stands' && intent !== 'not_real')) throw data(null, { status: 400 });
  try {
    const decided = await found(decideBookingFlag(env, admin, rowId, intent));
    afterwards(ctx, emailAboutFlagDecision(env, rowId, intent, decided, siteUrl(env, request)), 'flag decision email');
  } catch (err) {
    if (err instanceof PlanRefused) return data({ error: err.message }, { status: 409 });
    throw err;
  }
  return redirect('/admin/booking-flags');
}

const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' });

export default function BookingFlags({ loaderData: { flags }, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state === 'submitting';
  return (
    <>
      <h1 className="title-1">Booking flags</h1>
      <div className="title-rule" aria-hidden="true" />
      <p className="muted">
        Businesses that said a booking isn’t right. Look into each one (contact the business or the person by email if you need to),
        then decide. <strong>The booking stands:</strong> it can be reviewed. <strong>Not a real booking:</strong> it can’t be
        reviewed, and any review of it is removed. Both the person and the business are emailed, without the business’s note. A
        decision can’t be changed.
      </p>
      {actionData?.error && (
        <p className="notice" role="alert">
          {actionData.error}
        </p>
      )}
      <p className="muted">Each time this page is opened, it’s recorded in the audit log.</p>
      {flags.length === 0 ? (
        <p className="muted">No flags yet.</p>
      ) : (
        <ul className={styles.rows}>
          {flags.map((f) => (
            <li key={f.rowId} className={styles.row}>
              <span className={styles.rowName}>
                <Link to={`/admin/listings/${f.vendorId}`}>{f.business}</Link>
              </span>
              <span className="muted">Flagged {when.format(new Date(f.flaggedAt))}</span>
              <span>Note (team only): {f.note ?? <span className="muted">none</span>}</span>
              <span>
                Marked booked by {f.person} ({f.personEmail})
              </span>
              <span className="muted">
                {[f.type ?? 'No type given', longDate(f.date), f.town, guestsWords(f.guests)].filter(Boolean).join(' · ')}
              </span>
              <span>
                <span className={styles.status}>{f.stillBooked ? 'Still marked booked' : 'No longer marked'}</span>
                {f.eventCancelled && (
                  <>
                    {' · '}
                    <span className={styles.status}>Event cancelled</span>
                  </>
                )}
              </span>
              {f.outcome ? (
                <span>
                  Decided {f.decidedAt ? when.format(new Date(f.decidedAt)) : ''}:{' '}
                  <span className={styles.status}>{f.outcome === 'booking_stands' ? 'The booking stands' : 'Not a real booking'}</span>
                </span>
              ) : (
                <Form method="post" className={styles.buttons}>
                  <input type="hidden" name="rowId" value={f.rowId} />
                  <button type="submit" name="intent" value="stands" className="button button-secondary" disabled={busy}>
                    The booking stands
                  </button>
                  <button type="submit" name="intent" value="not_real" className="button button-secondary" disabled={busy}>
                    Not a real booking
                  </button>
                </Form>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
