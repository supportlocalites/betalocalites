import { useState, useSyncExternalStore } from 'react';
import { data, Form, Link, redirect, useFetcher, useLocation, useNavigation, useSearchParams, useSubmit } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { FramingEditor } from '@/components/FramingEditor';
import { SiteHeader } from '@/components/SiteHeader';
import { SquarePhoto } from '@/components/SquarePhoto';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { readFrame } from '@/lib/photo-frame';
import { preparePhoto } from '@/lib/photo-prepare';
import { DESCRIPTION_MAX, PHOTO_LIMIT } from '@/lib/photo-terms';
import { discardBody } from '@/server/discard-body';
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
  setProfileFrame,
} from '@/server/photos.server';
import type { Route } from './+types/photos';
import styles from './photos.module.css';

/**
 * A business's photos (screen V2, E §9; migrations 0016 and 0019): its owner or a manager
 * chooses its square profile photo (shown beside its name in lists and on its page) and frames
 * it, and adds up to 8 photos for its page, shown whole in their own shape. Checked in the
 * database on every request; anyone else gets "not found". Photos go live at once.
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
    await discardBody(request);
    return data({ error: 'That photo is too large. Please choose a smaller one.' }, { status: 413 });
  }
  if (env.PHOTO_EDIT_LIMIT && !(await env.PHOTO_EDIT_LIMIT.limit({ key: member.userId })).success) {
    await discardBody(request);
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
      const role = form.get('role') === 'logo' ? 'logo' : 'gallery';
      const description = checkDescription(String(form.get('description') ?? ''));
      if (!description.ok) return data({ error: description.error, role }, { status: 400 });
      const upload = await readUpload(form);
      if (!upload.ok) return data({ error: upload.error, role }, { status: 400 });
      const { id, replaced } = await addPhoto(env, member.userId, params.slug, {
        large: upload.large,
        small: upload.small,
        description: description.text,
        role,
      });
      if (replaced) afterwards(ctx, deleteRemoved(env, replaced), 'replaced profile photo files');
      // The new photo's id in the address gives the next "Add" form a fresh start, and opens
      // the framing screen for a new profile photo.
      return role === 'logo'
        ? redirect(`/vendors/${params.slug}/photos?profile=${id}#profile`)
        : redirect(`/vendors/${params.slug}/photos?added=${id}#photo-${id}`);
    }
    const id = String(form.get('id') ?? '');
    if (!isUuid(id)) throw data(null, { status: 400 });
    if (intent === 'frame') {
      const frame = readFrame({ x: form.get('x'), y: form.get('y'), w: form.get('w'), h: form.get('h') });
      if (!frame) return data({ error: 'That framing didn’t come through. Please try again.' }, { status: 400 });
      await setProfileFrame(env, member.userId, params.slug, id, frame);
      return { framed: true };
    }
    if (intent === 'describe') {
      const description = checkDescription(String(form.get('description') ?? ''));
      if (!description.ok) return data({ error: description.error, id }, { status: 400 });
      await describePhoto(env, member.userId, params.slug, id, description.text);
      return back('described');
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
  profile: 'Profile photo added. It shows beside your business’s name now.',
  added: 'Photo added. It’s on your business page now.',
  described: 'Description saved.',
  main: 'That photo leads your page now.',
  removed: 'Photo removed.',
};

export default function Photos({ loaderData, actionData }: Route.ComponentProps) {
  const { vendor, photos, profile, uploadsOn } = loaderData;
  const busy = useNavigation().state !== 'idle';
  const [params] = useSearchParams();
  const notice = Object.keys(NOTICES).find((k) => params.has(k));
  const submit = useSubmit();
  // Each opening of the framing screen saves through a fresh fetcher, so an answer from an
  // earlier attempt (say, "too many changes") never shows on a new one.
  const [opening, setOpening] = useState(0);
  const framer = useFetcher<typeof action>({ key: `framing-${opening}` });
  const [opened, setOpened] = useState(false);
  const [preparing, setPreparing] = useState<'logo' | 'gallery' | null>(null);
  const [problem, setProblem] = useState<{ after: string; text: string } | null>(null);
  // True once the page's script is running (the framing screen needs it).
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  // A problem preparing a photo shows until the page moves on (a new address or a new answer).
  const here = `${useLocation().key}:${JSON.stringify(actionData ?? null)}`;
  const error = problem && problem.after === here ? problem.text : actionData && 'error' in actionData ? actionData.error : undefined;
  const errorFor = actionData && 'role' in actionData ? actionData.role : null;
  const room = PHOTO_LIMIT - photos.length;
  const frameError = framer.state === 'idle' && framer.data && 'error' in framer.data ? framer.data.error : null;

  // The framing screen: opened with its button, or straight after adding a new profile photo
  // (until the owner closes it).
  const added = params.get('profile');
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const editing = opened || (added !== null && profile?.id === added && closedFor !== added);
  const closeEditor = () => {
    setOpened(false);
    setClosedFor(added);
  };
  // Saved: the screen closes and the page says so, until it moves on.
  const at = useLocation().key;
  const [framedAt, setFramedAt] = useState<string | null>(null);
  const [answered, setAnswered] = useState(framer.data);
  if (framer.state === 'idle' && framer.data !== answered) {
    setAnswered(framer.data);
    if (framer.data && 'framed' in framer.data) {
      closeEditor();
      setFramedAt(at);
    }
  }
  const savedFrame = framedAt === at;

  // With the page's script running, the photo is made smaller here first; without it, the
  // form sends the file as chosen and the server takes it only if it's already small enough.
  async function addWithScript(event: React.FormEvent<HTMLFormElement>) {
    const input = event.currentTarget.elements.namedItem('file');
    const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
    if (!file) return;
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const role = form.get('role') === 'logo' ? 'logo' : 'gallery';
    setPreparing(role);
    const prepared = await preparePhoto(file);
    setPreparing(null);
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

  // A plain function, not a component: the form keeps what's typed when the page redraws.
  function addForm(role: 'logo' | 'gallery') {
    const p = role === 'logo' ? 'profile-' : '';
    return (
      <Form
        key={params.get(role === 'logo' ? 'profile' : 'added') ?? ''}
        method="post"
        encType="multipart/form-data"
        onSubmit={addWithScript}
        className={styles.addForm}
      >
        <input type="hidden" name="intent" value="add" />
        <input type="hidden" name="role" value={role} />
        <div className="field">
          <label htmlFor={`${p}file`} className="field-label">
            {role === 'logo' ? 'Your logo or a photo' : 'Photo'}
          </label>
          <input id={`${p}file`} name="file" type="file" accept="image/*" required />
        </div>
        <div className="field">
          <label htmlFor={`${p}description`} className="field-label">
            Describe it in a few words
          </label>
          <span id={`${p}description-hint`} className="field-hint">
            {role === 'logo'
              ? `For people who can’t see it, for example “${vendor.name} logo”.`
              : 'For people who can’t see the photo, for example “Three-tier birthday cake with fresh flowers”.'}
          </span>
          <input
            id={`${p}description`}
            name="description"
            className="input"
            maxLength={DESCRIPTION_MAX}
            aria-describedby={`${p}description-hint`}
            required
          />
        </div>
        <button type="submit" className="button button-primary" disabled={busy || preparing !== null}>
          {preparing === role ? 'Preparing the photo…' : busy ? 'Adding…' : role === 'logo' ? 'Use this photo' : 'Add photo'}
        </button>
        <noscript>
          <p className="muted">Without JavaScript, photos must already be small: a JPEG or WebP under 1 MB.</p>
        </noscript>
      </Form>
    );
  }

  // Until the business chooses one, lists show its first page photo, framed by the smart default.
  const listPhoto = profile ?? photos[0] ?? null;

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
        {savedFrame && !error && (
          <p className="notice" role="status">
            Saved. Your profile photo shows like this everywhere now.
          </p>
        )}
        {notice && !error && !savedFrame && (
          <p className="notice" role="status">
            {NOTICES[notice]}
          </p>
        )}
        <p className="muted">
          Only use photos you took or have permission to use. Our team may remove a photo that isn’t right for Localites.
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

        <section id="profile" className={styles.section} aria-labelledby="profile-title">
          <h2 id="profile-title" className={styles.heading} tabIndex={-1}>
            Profile photo
          </h2>
          <p className="muted">
            Your logo, or a photo you like. It sits in a square beside your business’s name: in search results and at the top of your page.
          </p>
          <div className={styles.profile}>
            <SquarePhoto photo={listPhoto} alt={listPhoto?.alt ?? ''} size="large" />
            <div className={styles.profileSide}>
              <div>
                <span className="label">In search results</span>
                <div className={styles.listRow}>
                  <SquarePhoto photo={listPhoto} alt="" />
                  <span>
                    <span className={styles.listName}>{vendor.name}</span>
                    <br />
                    <span className="muted">
                      {vendor.town}
                      {vendor.tagline ? ` · ${vendor.tagline}` : ''}
                    </span>
                  </span>
                </div>
              </div>
              {profile ? (
                <div className={styles.actions}>
                  {hydrated && (
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => {
                        setOpening((n) => n + 1);
                        setOpened(true);
                      }}
                      disabled={busy}
                    >
                      Adjust the framing
                    </button>
                  )}
                  <Form method="post">
                    <input type="hidden" name="intent" value="remove" />
                    <input type="hidden" name="id" value={profile.id} />
                    <button type="submit" className="text-link" disabled={busy}>
                      Remove profile photo
                    </button>
                  </Form>
                </div>
              ) : (
                <p className="muted">
                  {photos[0]
                    ? 'You haven’t chosen one yet, so your first page photo is used. Choose one to make your business easy to spot.'
                    : 'You haven’t chosen one yet. Choose one to make your business easy to spot.'}
                </p>
              )}
            </div>
          </div>
          {uploadsOn &&
            (profile ? (
              <details className={styles.replace} open={errorFor === 'logo'}>
                <summary className="text-link">Use a different photo</summary>
                {addForm('logo')}
              </details>
            ) : (
              addForm('logo')
            ))}
        </section>

        <section className={styles.section} aria-labelledby="page-title">
          <h2 id="page-title" className={styles.heading}>
            Photos on your page
          </h2>
          <p className="muted">
            Up to {PHOTO_LIMIT} photos of your own work: your business, your products, events you’ve done. Wide or tall, each shows whole,
            nothing cut off. The first leads your page.
          </p>
          {photos.length > 0 && (
            <ul className={styles.photos}>
              {photos.map((p, i) => (
                <li key={p.id} className={styles.photo} id={`photo-${p.id}`}>
                  <a href={p.url} target="_blank" rel="noopener" className={styles.preview}>
                    <img
                      src={p.smallUrl}
                      alt={p.alt}
                      width={p.width ?? undefined}
                      height={p.height ?? undefined}
                      className={styles.image}
                    />
                  </a>
                  <div className={styles.details}>
                    {i === 0 && <span className="label">Leads your page</span>}
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
                            Show this one first
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

          <h3 className="label">Add a photo to your page</h3>
          {!uploadsOn ? (
            <p className="muted">Adding photos isn’t switched on yet. It will be soon.</p>
          ) : room <= 0 ? (
            <p className="muted">Your page shows {PHOTO_LIMIT} photos, the most it can. Remove one to add another.</p>
          ) : (
            addForm('gallery')
          )}
        </section>
      </main>

      {editing && profile && (
        <FramingEditor
          src={profile.url}
          width={profile.width}
          height={profile.height}
          frame={profile.frame}
          alt={profile.alt}
          name={vendor.name}
          town={vendor.town}
          busy={framer.state !== 'idle'}
          error={frameError}
          onSave={(f) =>
            framer.submit(
              { intent: 'frame', id: profile.id, x: String(f.x), y: String(f.y), w: String(f.w), h: String(f.h) },
              { method: 'post' },
            )
          }
          onClose={closeEditor}
        />
      )}
    </>
  );
}
