import { data, Form, redirect, useNavigation } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { kindInput, townInput } from '@/server/admin/places-input';
import {
  addKind,
  addTown,
  type KindRow,
  type MainKind,
  PlacesConflict,
  placesPage,
  type TownRow,
  updateKind,
  updateTown,
} from '@/server/admin/places.server';
import { formFields } from '@/server/plan-pages.server';
import type { Route } from './+types/categories';
import styles from './admin.module.css';

/**
 * Screens X6 and X8: the kinds of business (two levels: a main kind such as Sweets, and
 * kinds within it such as Custom cakes) and the towns Localites covers. The team adds,
 * renames, reorders and hides them; nothing is deleted, and web addresses never change
 * (migration 0017). Every change is written to the audit log.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Categories and towns · Team'), { name: 'robots', content: 'noindex' }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const url = new URL(request.url);
  return { ...(await placesPage(env)), saved: url.searchParams.get('saved'), open: url.searchParams.get('open') };
}

type Reply = { target: string; error: string; errors?: Record<string, string> };

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const admin = context.get(adminContext);
  const fields = formFields(await request.formData());
  const intent = fields.intent ?? '';
  const target = fields.id || (intent === 'add-town' ? 'new-town' : 'new-kind');
  const refuse = (error: string, status = 400, errors?: Record<string, string>) => data<Reply>({ target, error, errors }, { status });
  const issues = (list: { path: PropertyKey[]; message: string }[]) => {
    const errors: Record<string, string> = {};
    for (const issue of list) errors[String(issue.path[0])] ??= issue.message;
    return errors;
  };
  const back = (saved: string, open: string) => redirect(`/admin/categories?saved=${saved}&open=${open}#${open}`);
  const isKind = intent === 'add-kind' || intent === 'update-kind';
  const parsed = isKind ? kindInput.safeParse(fields) : townInput.safeParse(fields);
  if (!['add-kind', 'update-kind', 'add-town', 'update-town'].includes(intent)) return refuse('Unknown request.');
  if (!parsed.success) return refuse('Please check what’s marked.', 400, issues(parsed.error.issues));
  if (intent.startsWith('update') && !isUuid(target))
    return refuse('Something on the page was out of date. Please reload it and try again.');
  try {
    if (intent === 'add-kind') return back('added', await addKind(env, admin, kindInput.parse(fields)));
    if (intent === 'update-kind') return back(await updateKind(env, admin, target, kindInput.parse(fields)), target);
    if (intent === 'add-town') return back('added', await addTown(env, admin, townInput.parse(fields)));
    return back(await updateTown(env, admin, target, townInput.parse(fields)), target);
  } catch (err) {
    if (err instanceof PlacesConflict) return refuse(err.message, 409);
    throw err;
  }
}

const SAVED: Record<string, string> = {
  added: 'Added.',
  changed: 'Saved.',
  unchanged: 'Nothing had changed.',
};

export default function Categories({ loaderData, actionData }: Route.ComponentProps) {
  const { mains, towns, saved, open } = loaderData;
  const busy = useNavigation().state === 'submitting';
  const replyFor = (id: string) => (actionData && actionData.target === id ? actionData : null);
  return (
    <>
      <h1 className="title-1">Categories and towns</h1>
      <div className="title-rule" aria-hidden="true" />
      <p className="muted">
        The kinds of business people browse and the towns Localites covers. Hide one instead of deleting it: businesses and events that use
        it keep it, but it isn’t offered for new ones (and a hidden main kind isn’t shown when people browse). Web addresses are made from
        the first name and never change, so links keep working.
      </p>
      {saved && SAVED[saved] && !actionData && (
        <p className="notice" role="status">
          {SAVED[saved]}
        </p>
      )}

      <section className={styles.section} aria-labelledby="kinds-heading">
        <h2 id="kinds-heading">Kinds of business</h2>
        <ul className={styles.rows}>
          {mains.map((m) => (
            <li key={m.id} className={styles.row}>
              <KindForm kind={m} mains={mains} open={open === m.id || replyFor(m.id) !== null} reply={replyFor(m.id)} busy={busy} />
              {m.kinds.length > 0 && (
                <ul className={`${styles.rows} ${styles.nested}`} aria-label={`Kinds within ${m.name}`}>
                  {m.kinds.map((k) => (
                    <li key={k.id} className={styles.row}>
                      <KindForm kind={k} mains={mains} open={open === k.id || replyFor(k.id) !== null} reply={replyFor(k.id)} busy={busy} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        <h3 className="label section-gap">Add a kind of business</h3>
        <KindFields reply={replyFor('new-kind')} mains={mains} busy={busy} />
      </section>

      <section className={styles.section} aria-labelledby="towns-heading">
        <h2 id="towns-heading">Towns</h2>
        <ul className={styles.rows}>
          {towns.map((t) => (
            <li key={t.id} className={styles.row}>
              <details open={open === t.id || replyFor(t.id) !== null} id={t.id}>
                <summary>
                  <span className={styles.rowName}>{t.name}</span>{' '}
                  <span className="muted">
                    · {t.region} · {t.shown ? 'shown' : 'hidden'} · order {t.sortOrder} · {t.businesses}{' '}
                    {t.businesses === 1 ? 'business' : 'businesses'}
                  </span>
                </summary>
                <TownFields town={t} reply={replyFor(t.id)} busy={busy} />
              </details>
            </li>
          ))}
        </ul>
        <h3 className="label section-gap">Add a town</h3>
        <p className="muted">A new town starts hidden unless you tick “Shown”: check the name and region first.</p>
        <TownFields reply={replyFor('new-town')} busy={busy} />
      </section>
    </>
  );
}

function Problem({ reply }: { reply: Reply | null }) {
  return reply ? (
    <p className="notice" role="alert">
      {reply.error}
    </p>
  ) : null;
}

function KindForm({
  kind,
  mains,
  open,
  reply,
  busy,
}: {
  kind: KindRow | MainKind;
  mains: MainKind[];
  open: boolean;
  reply: Reply | null;
  busy: boolean;
}) {
  return (
    <details open={open} id={kind.id}>
      <summary>
        <span className={styles.rowName}>{kind.name}</span>{' '}
        <span className="muted">
          · {kind.shown ? 'shown' : 'hidden'} · order {kind.sortOrder} · {kind.businesses}{' '}
          {kind.businesses === 1 ? 'business' : 'businesses'}
          {' · '}web address: {kind.slug}
        </span>
      </summary>
      <KindFields kind={kind} mains={mains} reply={reply} busy={busy} />
    </details>
  );
}

function KindFields({ kind, mains, reply, busy }: { kind?: KindRow | MainKind; mains: MainKind[]; reply: Reply | null; busy: boolean }) {
  const key = kind?.id ?? 'new-kind';
  const err = (k: string) => reply?.errors?.[k];
  // A box with a problem says so to screen readers, and points at its message.
  const described = (field: string, id: string) => (err(field) ? { 'aria-invalid': true, 'aria-describedby': `${id}-error` } : {});
  const hasKinds = kind && 'kinds' in kind && kind.kinds.length > 0;
  return (
    <Form method="post" className={styles.form}>
      <Problem reply={reply} />
      <input type="hidden" name="intent" value={kind ? 'update-kind' : 'add-kind'} />
      {kind && <input type="hidden" name="id" value={kind.id} />}
      <div className={styles.twoColumns}>
        <div className="field">
          <label htmlFor={`name-${key}`} className="field-label">
            Name
          </label>
          <input
            id={`name-${key}`}
            {...described('name', `name-${key}`)}
            name="name"
            className="input"
            maxLength={80}
            defaultValue={kind?.name}
            required
          />
          {err('name') && (
            <p className="field-error" id={`name-${key}-error`}>
              {err('name')}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor={`order-${key}`} className="field-label">
            Order (lower comes first)
          </label>
          <input
            id={`order-${key}`}
            {...described('sortOrder', `order-${key}`)}
            name="sortOrder"
            className="input"
            inputMode="numeric"
            maxLength={4}
            defaultValue={kind?.sortOrder ?? 100}
          />
          {err('sortOrder') && (
            <p className="field-error" id={`order-${key}-error`}>
              {err('sortOrder')}
            </p>
          )}
        </div>
      </div>
      <div className="field">
        <label htmlFor={`desc-${key}`} className="field-label">
          Description (optional)
        </label>
        <input
          id={`desc-${key}`}
          {...described('description', `desc-${key}`)}
          name="description"
          className="input"
          maxLength={300}
          defaultValue={kind?.description ?? ''}
        />
        {err('description') && (
          <p className="field-error" id={`desc-${key}-error`}>
            {err('description')}
          </p>
        )}
      </div>
      {hasKinds ? (
        <input type="hidden" name="parentId" value="" />
      ) : (
        <div className="field">
          <label htmlFor={`parent-${key}`} className="field-label">
            Within
          </label>
          <select
            id={`parent-${key}`}
            {...described('parentId', `parent-${key}`)}
            name="parentId"
            className="input"
            defaultValue={kind?.parentId ?? ''}
          >
            <option value="">Nothing: it’s a main kind</option>
            {mains
              .filter((m) => m.id !== kind?.id)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
          {err('parentId') && (
            <p className="field-error" id={`parent-${key}-error`}>
              {err('parentId')}
            </p>
          )}
        </div>
      )}
      <label className={styles.check}>
        <input type="checkbox" name="shown" defaultChecked={kind?.shown ?? true} /> Shown
      </label>
      <p>
        <button type="submit" className={kind ? 'button button-secondary' : 'button button-primary'} disabled={busy}>
          {kind ? 'Save' : 'Add kind of business'}
        </button>
      </p>
    </Form>
  );
}

function TownFields({ town, reply, busy }: { town?: TownRow; reply: Reply | null; busy: boolean }) {
  const key = town?.id ?? 'new-town';
  const err = (k: string) => reply?.errors?.[k];
  // A box with a problem says so to screen readers, and points at its message.
  const described = (field: string, id: string) => (err(field) ? { 'aria-invalid': true, 'aria-describedby': `${id}-error` } : {});
  return (
    <Form method="post" className={styles.form}>
      <Problem reply={reply} />
      <input type="hidden" name="intent" value={town ? 'update-town' : 'add-town'} />
      {town && <input type="hidden" name="id" value={town.id} />}
      <div className={styles.twoColumns}>
        <div className="field">
          <label htmlFor={`tname-${key}`} className="field-label">
            Name
          </label>
          <input
            id={`tname-${key}`}
            {...described('name', `tname-${key}`)}
            name="name"
            className="input"
            maxLength={80}
            defaultValue={town?.name}
            required
          />
          {err('name') && (
            <p className="field-error" id={`tname-${key}-error`}>
              {err('name')}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor={`region-${key}`} className="field-label">
            Region
          </label>
          <input
            id={`region-${key}`}
            {...described('region', `region-${key}`)}
            name="region"
            className="input"
            maxLength={80}
            defaultValue={town?.region ?? 'Simcoe County'}
            required
          />
          {err('region') && (
            <p className="field-error" id={`region-${key}-error`}>
              {err('region')}
            </p>
          )}
        </div>
      </div>
      <div className="field">
        <label htmlFor={`torder-${key}`} className="field-label">
          Order (lower comes first)
        </label>
        <input
          id={`torder-${key}`}
          {...described('sortOrder', `torder-${key}`)}
          name="sortOrder"
          className="input"
          inputMode="numeric"
          maxLength={4}
          defaultValue={town?.sortOrder ?? 100}
        />
        {err('sortOrder') && (
          <p className="field-error" id={`torder-${key}-error`}>
            {err('sortOrder')}
          </p>
        )}
      </div>
      <label className={styles.check}>
        <input type="checkbox" name="shown" defaultChecked={town?.shown ?? false} /> Shown (offered for new businesses and events)
      </label>
      <p>
        <button type="submit" className={town ? 'button button-secondary' : 'button button-primary'} disabled={busy}>
          {town ? 'Save' : 'Add town'}
        </button>
      </p>
    </Form>
  );
}
