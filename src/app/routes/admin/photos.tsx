import { data, Form, Link, useNavigation } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { framePosition } from '@/lib/photo-terms';
import { afterwards } from '@/server/plan-pages.server';
import { deleteRemoved, recentPhotos, removePhotoAsTeam } from '@/server/photos.server';
import type { Route } from './+types/photos';
import styles from './admin.module.css';

/**
 * Business photos, newest first (E §9): owners' photos go live at once, so the team looks
 * here and removes any that isn't right (not the business's own, not suitable). Each
 * removal is recorded in the audit log with the reason. `?vendor=<id>` shows one business.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Photos · Team'), { name: 'robots', content: 'noindex' }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const vendor = new URL(request.url).searchParams.get('vendor');
  const one = vendor && isUuid(vendor) ? vendor : null;
  return { photos: await recentPhotos(env, one), one };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const form = await request.formData();
  const id = String(form.get('id') ?? '');
  if (form.get('intent') !== 'remove' || !isUuid(id)) throw data(null, { status: 400 });
  const reason =
    String(form.get('reason') ?? '')
      .trim()
      .slice(0, 500) || null;
  const removed = await removePhotoAsTeam(env, context.get(adminContext), id, reason);
  if (!removed) return data({ removed: false }, { status: 409 });
  afterwards(ctx, deleteRemoved(env, removed), 'removed photo files');
  return { removed: true };
}

const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' });

export default function TeamPhotos({ loaderData: { photos, one }, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== 'idle';
  return (
    <>
      <h1 className="title-1">Photos</h1>
      <div className="title-rule" aria-hidden="true" />
      <p className="notice">
        Photos businesses added, newest first. They’re live as soon as they’re added. Remove any that isn’t the business’s own or isn’t
        suitable, and tell the business why by email. Removing is recorded in the audit log.
      </p>
      {one && (
        <p>
          <Link to="/admin/photos" className="text-link">
            Show every business’s photos
          </Link>
        </p>
      )}
      {actionData?.removed === true && (
        <p className="notice" role="status">
          Photo removed.
        </p>
      )}
      {actionData?.removed === false && (
        <p className="notice" role="alert">
          That photo was already removed.
        </p>
      )}
      {photos.length === 0 ? (
        <p className="muted">No photos yet.</p>
      ) : (
        <ul className={styles.rows}>
          {photos.map((p) => (
            <li key={p.id} className={styles.row}>
              <a href={p.url} target="_blank" rel="noopener">
                <img src={p.url} alt={p.alt} className={styles.photoThumb} style={{ objectPosition: framePosition(p) }} />
              </a>{' '}
              <a href={p.smallUrl} target="_blank" rel="noopener">
                <img
                  src={p.smallUrl}
                  alt={`${p.alt} (small version, used in lists)`}
                  className={styles.photoThumb}
                  style={{ objectPosition: framePosition(p) }}
                />
              </a>
              <span className={styles.rowName}>
                <Link to={`/admin/listings/${p.vendorId}`}>{p.vendorName}</Link>
              </span>
              <span>“{p.alt}”</span>
              <span className="muted">
                Added {when.format(new Date(p.addedAt))}
                {p.addedBy ? ` by ${p.addedBy}` : ''}
                {!one && (
                  <>
                    {' · '}
                    <Link to={`/admin/photos?vendor=${p.vendorId}`} className="text-link">
                      This business’s photos
                    </Link>
                  </>
                )}
              </span>
              <Form method="post" className={styles.inlineForm}>
                <input type="hidden" name="intent" value="remove" />
                <input type="hidden" name="id" value={p.id} />
                <label htmlFor={`reason-${p.id}`} className="field-label">
                  Why (for the record)
                </label>
                <input id={`reason-${p.id}`} name="reason" className="input" maxLength={500} />
                <button type="submit" className="button button-secondary" disabled={busy}>
                  Remove photo
                </button>
              </Form>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
