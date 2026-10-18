import { Form, Link } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { AUDIT_KINDS } from '@/lib/audit-kinds';
import { pageMeta } from '@/lib/meta';
import { auditFilters, auditPage, type AuditRow } from '@/server/admin/audit-log.server';
import type { Route } from './+types/audit';
import styles from './admin.module.css';

/**
 * Screen X11, the audit log: every team action and permission-sensitive change, newest
 * first, filtered by who, by kind of record, or one record (E §11). Read-only; each look is
 * recorded too.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Audit log · Team'), { name: 'robots', content: 'noindex' }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const params = new URL(request.url).searchParams;
  const filters = auditFilters(params);
  return { ...(await auditPage(env, context.get(adminContext), filters)), filters };
}

const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' });

/** Team pages that show one record, by kind. */
const RECORD_PAGE: Record<string, (id: string) => string> = {
  vendor: (id) => `/admin/listings/${id}`,
  review: (id) => `/admin/reviews/${id}`,
  moderation_report: (id) => `/admin/reports/${id}`,
};

const shown = (v: unknown) => {
  const text = v === null || v === undefined ? '(empty)' : typeof v === 'string' ? v : JSON.stringify(v);
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
};

/** "field: before → after" for each change; anything else as it was written. */
function Changes({ changes }: { changes: unknown }) {
  if (!changes || typeof changes !== 'object') return null;
  const entries = Object.entries(changes as Record<string, unknown>);
  if (entries.length === 0) return null;
  return (
    <ul className={styles.history}>
      {entries.map(([field, v]) => {
        const pair = v && typeof v === 'object' && 'from' in v && 'to' in v ? (v as { from: unknown; to: unknown }) : null;
        return (
          <li key={field}>
            <span className="label">{field}</span>: {pair ? `${shown(pair.from)} → ${shown(pair.to)}` : shown(v)}
          </li>
        );
      })}
    </ul>
  );
}

function Entry({ row }: { row: AuditRow }) {
  const page = row.subjectId ? RECORD_PAGE[row.subjectType] : undefined;
  return (
    <li className={styles.row}>
      <span className={styles.rowName}>{row.action}</span>
      <span className="muted">
        {when.format(new Date(row.at))} · {row.actor ? `${row.actor} (${row.actorEmail})` : 'Localites itself, or a removed account'}
      </span>
      <span className="muted">
        {AUDIT_KINDS[row.subjectType] ?? row.subjectType}
        {row.subjectId && (
          <>
            {' · '}
            {page ? <Link to={page(row.subjectId)}>open it</Link> : null}
            {page ? ' · ' : null}
            <Link to={`/admin/audit?record=${row.subjectId}`}>everything about this record</Link>
          </>
        )}
      </span>
      {row.reason && <span>{`Why: ${row.reason}`}</span>}
      <Changes changes={row.changes} />
    </li>
  );
}

export default function Audit({ loaderData }: Route.ComponentProps) {
  const { rows, more, people, filters } = loaderData;
  const last = rows.at(-1);
  const older = new URLSearchParams();
  if (filters.actor) older.set('who', filters.actor);
  if (filters.kind) older.set('kind', filters.kind);
  if (filters.subject) older.set('record', filters.subject);
  if (last) older.set('before', `${last.at}~${last.id}`);
  return (
    <>
      <h1 className="title-1">Audit log</h1>
      <div className="title-rule" aria-hidden="true" />
      <p className="muted">
        The permanent record of what the team does, and of every change to who can see or do what: newest first. Nothing here can be
        edited or deleted. Looking at it is recorded too.
      </p>
      <Form method="get" className={styles.filters}>
        <div className="field">
          <label htmlFor="who" className="field-label">
            Who
          </label>
          <select id="who" name="who" className="input" defaultValue={filters.actor ?? ''}>
            <option value="">Anyone</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="kind" className="field-label">
            About
          </label>
          <select id="kind" name="kind" className="input" defaultValue={filters.kind ?? ''}>
            <option value="">Anything</option>
            {Object.entries(AUDIT_KINDS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {filters.subject && <input type="hidden" name="record" value={filters.subject} />}
        <button type="submit" className="button button-secondary">
          Show
        </button>
      </Form>
      {filters.subject && (
        <p className="notice">
          Showing one record only. <Link to="/admin/audit">Show everything</Link>
        </p>
      )}
      {rows.length === 0 ? (
        <p className="muted">{`Nothing recorded${filters.before ? ' before that' : ''}.`}</p>
      ) : (
        <ul className={styles.rows}>
          {rows.map((r) => (
            <Entry key={r.id} row={r} />
          ))}
        </ul>
      )}
      {more && (
        <p>
          <Link to={`/admin/audit?${older.toString()}`} className="text-link">
            Older entries
          </Link>
        </p>
      )}
    </>
  );
}
