import { Form, Link } from 'react-router';
import { cloudflareContext } from '@/app/context';
import { pageMeta } from '@/lib/meta';
import { STATUS_LABEL } from '@/lib/listing-status';
import { listListings } from '@/server/admin/listings.server';
import { latestNote, type NoteStatus } from '@/server/daily-note.server';
import type { Route } from './+types/listings';
import styles from './admin.module.css';

export const meta: Route.MetaFunction = () => [...pageMeta('Listings · Team'), { name: 'robots', content: 'noindex' }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams;
  const q = (params.get('q') ?? '').slice(0, 100);
  const status = params.get('status') ?? '';
  const { env } = context.get(cloudflareContext);
  const [listings, note] = await Promise.all([listListings(env, { q, status }), latestNote(env)]);
  return { q, status, listings, note };
}

const dateFormat = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeZone: 'America/Toronto' });

const noteWhen = new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });

/** The daily note of owners' changes (ADR-029): when it last ran, or a warning if it hasn't. */
function noteLine(note: NoteStatus): string {
  if (!note) return 'Daily note of owners’ changes: none yet (the first runs tomorrow morning).';
  const stale = note.stale ? ' Warning: it hasn’t run for over a day.' : '';
  if (note.status === 'sent') return `Daily note of owners’ changes: sent ${noteWhen.format(new Date(note.sentAt!))} (${note.changeCount} ${note.changeCount === 1 ? 'save' : 'saves'}).${stale}`;
  if (note.status === 'empty') return `Daily note of owners’ changes: ${note.day}, nothing to report.${stale}`;
  if (note.status === 'failed') return `Daily note of owners’ changes: failed on ${note.day} (${note.failureReason}). It tries again later.${stale}`;
  if (note.stuck) return `Daily note of owners’ changes: stopped part way on ${note.day}. It tries again later; if this stays, see the runbook.${stale}`;
  return `Daily note of owners’ changes: sending (${note.day}).${stale}`;
}

export default function Listings({ loaderData: { q, status, listings, note } }: Route.ComponentProps) {
  return (
    <>
      <div className={styles.titleRow}>
        <div>
          <h1 className="title-1">Listings</h1>
          <div className="title-rule" aria-hidden="true" />
        </div>
        <Link to="/admin/listings/new" className="button button-primary">
          Add a business
        </Link>
      </div>
      <p className={note?.stale || note?.stuck || note?.status === 'failed' ? 'notice' : 'muted'}>{noteLine(note)}</p>

      <Form method="get" className={styles.filters} role="search">
        <div className="field">
          <label htmlFor="q" className="field-label">
            Name or web address
          </label>
          <input id="q" name="q" type="search" defaultValue={q} className="input" maxLength={100} />
        </div>
        <div className="field">
          <label htmlFor="status" className="field-label">
            Status
          </label>
          <select id="status" name="status" defaultValue={status} className="input">
            <option value="">All</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="button button-secondary">
          Show
        </button>
      </Form>

      <p className="label">
        {listings.length} {listings.length === 1 ? 'listing' : 'listings'}
      </p>
      {listings.length === 0 ? (
        <p className="muted">No listings match. Try another name, or show all statuses.</p>
      ) : (
        <ul className={styles.rows}>
          {listings.map((l) => (
            <li key={l.id} className={styles.row}>
              <Link to={`/admin/listings/${l.id}`} className={styles.rowName}>
                {l.name}
              </Link>
              <span className="muted">
                <span className={`${styles.status} ${l.status === 'published' ? styles.statusLive : ''}`}>
                  {STATUS_LABEL[l.status]}
                </span>{' '}
                · {l.town} · {l.claimStatus === 'claimed' ? 'Claimed' : l.claimStatus === 'claim_pending' ? 'Claim waiting' : 'Not claimed'} ·
                changed {dateFormat.format(new Date(l.updatedAt))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
