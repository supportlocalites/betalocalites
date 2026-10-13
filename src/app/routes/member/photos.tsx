import { useRef, useState } from 'react';
import { data, Form, Link, redirect, useLocation, useNavigation, useSearchParams, useSubmit } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { preparePhoto } from '@/lib/photo-prepare';
import { DESCRIPTION_MAX, framePosition, PHOTO_LIMIT, PICKER_WIDTH } from '@/lib/photo-terms';
import { afterwards } from '@/server/plan-pages.server';
import {
  addPhoto,
  checkDescription,
  deleteRemoved,
  describePhoto,
  makeMainPhoto,
  MAX_UPLOAD_BYTES,
  NotOnTeam,
  PhotoRefused,
  photosFor,
  readUpload,
  removePhoto,
  setPhotoFocus,
} from '@/server/photos.server';
import type { Route } from './+types/photos';
import styles from './photos.module.css';

/**
 * A business's photos (screen V2, E §9; migration 0016): its owner or a manager adds up to
 * 8, describes each, picks the main one and removes them. Checked in the database on every
 * request; anyone else gets "not found". Photos go live at once.
 */
export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta(loaderData && 'vendor' in loaderData ? `Photos · ${loaderData.vendor.name}` : 'Photos'),
  { name: 'robots', content: 'noindex' },
];

export async function loader({ params, context }: Route.LoaderArgs) {
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const result = await photosFor(env, member.userId, params.slug);
  if (!result) throw data(null, { status: 404 });
  if ('renamedTo' in result) throw redirect(`/vendors/${result.renamedTo}/photos`);
  return result;
}

// Reload the photos after every change, refused ones too (another person may have changed them).
export const shouldRevalidate = () => true;

export async function action({ request, params, context }: Route.ActionArgs) {
  const member = context.get(memberContext);
  const { env, ctx } = context.get(cloudflareContext);
  // Browsers always say how big a form is; anything that doesn't, or is too big, isn't read.
  const size = request.headers.get('Content-Length');
  if (size === null || !/^\d{1,9}$/.test(size) || Number(size) > MAX_UPLOAD_BYTES) {
    await request.body?.cancel().catch(() => undefined);
    return data({ error: 'That photo is too large. Please choose a smaller one.' }, { status: 413 });
  }
  if (env.PHOTO_EDIT_LIMIT && !(await env.PHOTO_EDIT_LIMIT.limit({ key: member.userId })).success) {
    await request.body?.cancel().catch(() => undefined);
    return data({ error: 'That’s a lot of changes in a minute. Please wait a moment, then try again.' }, { status: 429 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return data({ error: 'That didn’t come through. Please try again.' }, { status: 400 });
  }
  const intent = String(form.get('intent') ?? '');
  const back = (notice: string) => redirect(`/vendors/${params.slug}/photos?${notice}=1`);
  try {
    if (intent === 'add') {
      const description = checkDescription(String(form.get('description') ?? ''));
      if (!description.ok) return data({ error: description.error }, { status: 400 });
      const upload = await readUpload(form);
      if (!upload.ok) return data({ error: upload.error }, { status: 400 });
      const id = await addPhoto(env, member.userId, params.slug, {
        large: upload.large,
        small: upload.small,
        description: description.text,
      });
      // The new photo's id in the address gives the next "Add a photo" form a fresh start.
      return redirect(`/vendors/${params.slug}/photos?added=${id}#photo-${id}`);
    }
    const id = String(form.get('id') ?? '');
    if (!isUuid(id)) throw data(null, { status: 400 });
    if (intent === 'describe') {
      const description = checkDescription(String(form.get('description') ?? ''));
      if (!description.ok) return data({ error: description.error, id }, { status: 400 });
      await describePhoto(env, member.userId, params.slug, id, description.text);
      return back('described');
    }
    if (intent === 'focus' || intent === 'middle') {
      // The browser sends where the photo was tapped as spot.x and spot.y (its own image button).
      const x = Number(form.get('spot.x'));
      const y = Number(form.get('spot.y'));
      if (intent === 'focus' && !(Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= 10000 && y <= 10000)) {
        throw data(null, { status: 400 });
      }
      await setPhotoFocus(env, member.userId, params.slug, id, intent === 'middle' ? 'middle' : { x, y });
      return redirect(`/vendors/${params.slug}/photos?focused=${id}#photo-${id}`);
    }
    if (intent === 'main') {
      await makeMainPhoto(env, member.userId, params.slug, id);
      return back('main');
    }
    if (intent === 'remove') {
      const removed = await removePhoto(env, member.userId, params.slug, id);
      afterwards(ctx, deleteRemoved(env, removed), 'removed photo files');
      return back('removed');
    }
  } catch (err) {
    if (err instanceof NotOnTeam) throw data(null, { status: 404 });
    if (err instanceof PhotoRefused) return data({ error: err.message }, { status: 409 });
    throw err;
  }
  throw data(null, { status: 400 });
}

const NOTICES: Record<string, string> = {
  added:
    'Photo added. It’s on your business page now. If something important is near its edge, tap that part of the photo below so it always stays in view.',
  focused: 'Saved. That part of the photo now stays in view.',
  described: 'Description saved.',
  main: 'That’s your main photo now. It shows first on your page and in search results.',
  removed: 'Photo removed.',
};

export default function Photos({ loaderData, actionData }: Route.ComponentProps) {
  const { vendor, photos, uploadsOn } = loaderData;
  const busy = useNavigation().state !== 'idle';
  const [params] = useSearchParams();
  const notice = Object.keys(NOTICES).find((k) => params.has(k));
  const submit = useSubmit();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preparing, setPreparing] = useState(false);
  const [problem, setProblem] = useState<{ after: string; text: string } | null>(null);
  // A problem preparing a photo shows until the page moves on (a new address or a new answer).
  const here = `${useLocation().key}:${JSON.stringify(actionData ?? null)}`;
  const error = problem && problem.after === here ? problem.text : actionData?.error;
  const room = PHOTO_LIMIT - photos.length;

  // With the page's script running, the photo is made smaller here first; without it, the
  // form sends the file as chosen and the server takes it only if it's already small enough.
  async function addWithScript(event: React.FormEvent<HTMLFormElement>) {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPreparing(true);
    const prepared = await preparePhoto(file);
    setPreparing(false);
    if (!prepared) {
      setProblem({ after: here, text: 'This browser couldn’t open that file as a photo. Please choose a JPEG, PNG or WebP photo.' });
      return;
    }
    setProblem(null);
    form.delete('file');
    form.set('large', prepared.large);
    form.set('small', prepared.small);
    await submit(form, { method: 'post', encType: 'multipart/form-data' });
  }

  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">Photos of {vendor.name}</h1>
        <div className="title-rule" aria-hidden="true" />
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        {notice && !error && (
          <p className="notice" role="status">
            {NOTICES[notice]}
          </p>
        )}
        <p className="muted">
          Up to {PHOTO_LIMIT} photos of your own work: your business, your products, events you’ve done. Only use photos you took or have
          permission to use. The first one is your main photo. Our team may remove a photo that isn’t right for Localites.
        </p>
        <p>
          <Link to={`/vendors/${vendor.slug}/edit`} className="text-link">
            Back to editing your listing
          </Link>
          {vendor.published && (
            <>
              {' · '}
              <Link to={`/vendors/${vendor.slug}`} className="text-link">
                See your page
              </Link>
            </>
          )}
        </p>

        {photos.length > 0 && (
          <ul className={styles.photos}>
            {photos.map((p, i) => (
              <li key={p.id} className={styles.photo} id={`photo-${p.id}`}>
                <figure className={styles.preview}>
                  <img src={p.smallUrl} alt={p.alt} className={styles.image} style={{ objectPosition: framePosition(p) }} />
                  <figcaption className="muted">How it shows</figcaption>
                </figure>
                <div className={styles.details}>
                  {i === 0 && <span className="label">Main photo</span>}
                  <details className={styles.focus} open={params.get('added') === p.id || params.get('focused') === p.id}>
                    <summary className="text-link">Choose what stays in view</summary>
                    <p className="muted">Tap the most important part of your photo. Every frame on Localites keeps it in view.</p>
                    <Form method="post" className={styles.picker}>
                      <input type="hidden" name="intent" value="focus" />
                      <input type="hidden" name="id" value={p.id} />
                      <span className={styles.pickerFrame}>
                        <input
                          type="image"
                          name="spot"
                          src={p.smallUrl}
                          alt={`${p.alt}: tap the most important part`}
                          width={PICKER_WIDTH}
                          className={styles.pickerImage}
                          disabled={busy}
                        />
                        <span
                          className={styles.spot}
                          aria-hidden="true"
                          style={{ left: `${p.focusX * 100}%`, top: `${p.focusY * 100}%` }}
                        />
                      </span>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="intent" value="middle" />
                      <input type="hidden" name="id" value={p.id} />
                      <button type="submit" className="text-link" disabled={busy}>
                        Keep the middle in view
                      </button>
                    </Form>
                  </details>
                  <Form method="post" className={styles.describe}>
                    <input type="hidden" name="intent" value="describe" />
                    <input type="hidden" name="id" value={p.id} />
                    <label htmlFor={`d-${p.id}`} className="field-label">
                      Description
                    </label>
                    <input
                      id={`d-${p.id}`}
                      name="description"
                      className="input"
                      defaultValue={p.alt}
                      maxLength={DESCRIPTION_MAX}
                      required
                    />
                    <button type="submit" className="text-link" disabled={busy}>
                      Save description
                    </button>
                  </Form>
                  <div className={styles.actions}>
                    {i > 0 && (
                      <Form method="post">
                        <input type="hidden" name="intent" value="main" />
                        <input type="hidden" name="id" value={p.id} />
                        <button type="submit" className="text-link" disabled={busy}>
                          Make this the main photo
                        </button>
                      </Form>
                    )}
                    <Form method="post">
                      <input type="hidden" name="intent" value="remove" />
                      <input type="hidden" name="id" value={p.id} />
                      <button type="submit" className="text-link" disabled={busy}>
                        Remove this photo
                      </button>
                    </Form>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <section className={styles.add} aria-labelledby="add">
          <h2 id="add" className="label">
            Add a photo
          </h2>
          {!uploadsOn ? (
            <p className="muted">Adding photos isn’t switched on yet. It will be soon.</p>
          ) : room <= 0 ? (
            <p className="muted">Your business shows {PHOTO_LIMIT} photos, the most it can. Remove one to add another.</p>
          ) : (
            <Form key={params.get('added') ?? ''} method="post" encType="multipart/form-data" onSubmit={addWithScript}>
              <input type="hidden" name="intent" value="add" />
              <div className="field">
                <label htmlFor="file" className="field-label">
                  Photo
                </label>
                <input ref={fileRef} id="file" name="file" type="file" accept="image/*" required />
              </div>
              <div className="field">
                <label htmlFor="description" className="field-label">
                  Describe it in a few words
                </label>
                <span id="description-hint" className="field-hint">
                  For people who can’t see the photo, for example “Three-tier birthday cake with fresh flowers”.
                </span>
                <input
                  id="description"
                  name="description"
                  className="input"
                  maxLength={DESCRIPTION_MAX}
                  aria-describedby="description-hint"
                  required
                />
              </div>
              <button type="submit" className="button button-primary" disabled={busy || preparing}>
                {preparing ? 'Preparing the photo…' : busy ? 'Adding…' : 'Add photo'}
              </button>
              <noscript>
                <p className="muted">Without JavaScript, photos must already be small: a JPEG or WebP under 1 MB.</p>
              </noscript>
            </Form>
          )}
        </section>
      </main>
    </>
  );
}
