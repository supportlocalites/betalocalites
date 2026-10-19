import { cleanText } from '@/lib/clean-text';
import { data, Form, Link, redirect, useNavigation, useSearchParams } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { FEATURED_LINE, PLAN_LIMITS } from '@/lib/plan-terms';
import {
  addEventType,
  addPlacement,
  endPlacement,
  EventTypeConflict,
  type EventTypeRow,
  eventTypesPage,
  listedBusinesses,
  type Placement,
  setSuggestions,
  updateEventType,
} from '@/server/admin/event-types.server';
import { eventTypeInput, featuredInput, parseSuggestions } from '@/server/event-input';
import { formFields, todayIso } from '@/server/plan-pages.server';
import type { Route } from './+types/event-types';
import styles from './admin.module.css';

/**
 * Screen X12 (D-39, D-43): the kinds of event people can choose when they plan one; for
 * each, the kinds of business suggested and the businesses featured between two dates.
 * Featured businesses are promoted by the team and clearly labelled; they never change
 * search results or anything else. No money is recorded here (D-16, D-24). Every change
 * is written to the audit log.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Event types · Team'), { name: 'robots', content: 'noindex' }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const url = new URL(request.url);
  const find = cleanText(url.searchParams.get('find') ?? '').slice(0, 100);
  const [page, found] = await Promise.all([eventTypesPage(env, context.get(adminContext)), listedBusinesses(env, find)]);
  return {
    ...page,
    find,
    found,
    today: todayIso(),
    saved: url.searchParams.get('saved'),
    open: url.searchParams.get('open'),
  };
}

type Reply = { target: string; error: string; errors?: Record<string, string> };

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const admin = context.get(adminContext);
  const fields = formFields(await request.formData());
  const intent = fields.intent ?? '';
  const target = fields.typeId ?? fields.id ?? 'new';
  const refuse = (error: string, status = 400, errors?: Record<string, string>) => data<Reply>({ target, error, errors }, { status });
  const issues = (list: { path: PropertyKey[]; message: string }[]) => {
    const errors: Record<string, string> = {};
    for (const issue of list) errors[String(issue.path[0])] ??= issue.message;
    return errors;
  };
  const back = (saved: string, open?: string) => redirect(`/admin/event-types?saved=${saved}${open ? `&open=${open}` : ''}`);

  try {
    if (intent === 'add') {
      const parsed = eventTypeInput.safeParse(fields);
      if (!parsed.success) return refuse('Please check what’s marked.', 400, issues(parsed.error.issues));
      const id = await addEventType(env, admin, parsed.data);
      return back('added', id);
    }
    if (!isUuid(target)) return refuse('Something on the page was out of date. Please reload it and try again.');
    if (intent === 'update') {
      const parsed = eventTypeInput.safeParse(fields);
      if (!parsed.success) return refuse('Please check what’s marked.', 400, issues(parsed.error.issues));
      const result = await updateEventType(env, admin, target, parsed.data);
      return back(result === 'changed' ? 'updated' : 'unchanged', target);
    }
    if (intent === 'suggestions') {
      const wanted = parseSuggestions(fields);
      if (!wanted) return refuse(`Choose up to ${PLAN_LIMITS.suggestedMax} kinds of business, each with an order from 0 to 9999.`);
      const result = await setSuggestions(env, admin, target, wanted);
      return back(result === 'changed' ? 'suggestions' : 'unchanged', target);
    }
    if (intent === 'feature') {
      const parsed = featuredInput.safeParse(fields);
      if (!parsed.success) return refuse('Please check what’s marked.', 400, issues(parsed.error.issues));
      const { mostAtOnce } = await addPlacement(env, admin, target, parsed.data);
      return back(mostAtOnce > PLAN_LIMITS.featuredShown ? 'featured-crowded' : 'featured', target);
    }
    if (intent === 'end') {
      const placementId = fields.placementId ?? '';
      if (!isUuid(placementId)) return refuse('Something on the page was out of date. Please reload it and try again.');
      await endPlacement(env, admin, placementId);
      return back('ended', target);
    }
  } catch (err) {
    if (err instanceof EventTypeConflict) return refuse(err.message, 409);
    throw err;
  }
  return refuse('Unknown request.');
}

const SAVED: Record<string, string> = {
  added: 'Event type added. People planning can choose it now if it’s shown.',
  updated: 'Saved.',
  unchanged: 'Nothing had changed.',
  suggestions: 'Suggestions saved.',
  featured: 'Featured business added.',
  'featured-crowded': `Featured business added. On some days more than ${PLAN_LIMITS.featuredShown} overlap: only the first ${PLAN_LIMITS.featuredShown} by start date are shown.`,
  ended: 'Placement ended.',
};

const STATE: Record<Placement['state'], string> = { current: 'Showing now', upcoming: 'Coming up', past: 'Finished', ended: 'Ended early' };
const day = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeZone: 'UTC' });
const dateText = (iso: string) => day.format(new Date(`${iso}T00:00:00Z`));

export default function EventTypes({ loaderData, actionData }: Route.ComponentProps) {
  const { types, categories, find, found, today, saved, open } = loaderData;
  const busy = useNavigation().state === 'submitting';
  const [params] = useSearchParams();
  const replyFor = (id: string) => (actionData && actionData.target === id ? actionData : null);
  const newReply = replyFor('new');
  return (
    <>
      <h1 className="title-1">Event types</h1>
      <div className="title-rule" aria-hidden="true" />
      <p className="muted">
        The kinds of event people choose when they plan one (it’s optional for them). Hide a type instead of deleting it; events that
        already use it keep it. For each type, choose the kinds of business to suggest and the businesses to feature. Businesses never see
        what kind of event a customer is planning.
      </p>
      {saved && SAVED[saved] && !actionData && (
        <p className="notice" role="status">
          {SAVED[saved]}
        </p>
      )}

      <section className={styles.section} aria-labelledby="types-heading">
        <h2 id="types-heading">The types</h2>
        <ul className={styles.rows}>
          {types.map((t) => (
            <TypeRow
              key={t.id}
              type={t}
              categories={categories}
              found={found}
              today={today}
              open={open === t.id || replyFor(t.id) !== null}
              reply={replyFor(t.id)}
              busy={busy}
            />
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="add-heading">
        <h2 id="add-heading">Add an event type</h2>
        {newReply && (
          <p className="notice" role="alert">
            {newReply.error}
          </p>
        )}
        <Form method="post" className={styles.form}>
          <input type="hidden" name="intent" value="add" />
          <div className={styles.twoColumns}>
            <div className="field">
              <label htmlFor="new-name" className="field-label">
                Name
              </label>
              <input id="new-name" name="name" className="input" maxLength={60} required aria-describedby="new-name-hint" />
              <p className="field-hint" id="new-name-hint">
                The key is made from the name and can’t be changed later.
              </p>
              {newReply?.errors?.name && <p className="field-error">{newReply.errors.name}</p>}
            </div>
            <div className="field">
              <label htmlFor="new-order" className="field-label">
                Order (lower comes first)
              </label>
              <input id="new-order" name="sortOrder" className="input" inputMode="numeric" defaultValue="100" maxLength={4} />
              {newReply?.errors?.sortOrder && <p className="field-error">{newReply.errors.sortOrder}</p>}
            </div>
          </div>
          <label className={styles.check}>
            <input type="checkbox" name="shown" defaultChecked /> Shown to people planning
          </label>
          <p>
            <button type="submit" className="button button-primary" disabled={busy}>
              Add event type
            </button>
          </p>
        </Form>
      </section>

      <section className={styles.section} aria-labelledby="find-heading" id="find">
        <h2 id="find-heading">Find a business to feature</h2>
        <p className="muted">Search listed businesses by name or web address, then choose one in a type’s “Feature a business” form.</p>
        <Form method="get" className={styles.buttons}>
          {params.get('open') && <input type="hidden" name="open" value={params.get('open') ?? ''} />}
          <label htmlFor="find-words" className="visually-hidden">
            Business name or web address
          </label>
          <input id="find-words" name="find" className="input" defaultValue={find} maxLength={100} placeholder="Business name" />
          <button type="submit" className="button button-secondary">
            Find
          </button>
        </Form>
        {found.length > 0 && (
          <datalist id="found-businesses">
            {found.map((b) => (
              <option key={b.slug} value={b.slug}>
                {b.name}
              </option>
            ))}
          </datalist>
        )}
        {find && (
          <ul className={styles.history}>
            {found.length === 0 ? (
              <li className="muted">No listed business matches “{find}”.</li>
            ) : (
              found.map((b) => (
                <li key={b.slug}>
                  {b.name}{' '}
                  <span className="muted">
                    · {b.town} · web address: {b.slug}
                  </span>
                </li>
              ))
            )}
          </ul>
        )}
      </section>
    </>
  );
}

function TypeRow({
  type: t,
  categories,
  found,
  today,
  open,
  reply,
  busy,
}: {
  type: EventTypeRow;
  categories: { id: string; name: string; parent: string | null }[];
  found: { slug: string; name: string; town: string }[];
  today: string;
  open: boolean;
  reply: Reply | null;
  busy: boolean;
}) {
  const chosen = new Map(t.suggestions.map((s) => [s.categoryId, s.sortOrder]));
  const now = t.placements.filter((p) => p.state === 'current').length;
  const shownPlacements = t.placements.filter((p) => p.state === 'current' || p.state === 'upcoming');
  const earlier = t.placements.filter((p) => p.state === 'past' || p.state === 'ended');
  const err = (k: string) => reply?.errors?.[k];
  const placementRow = (p: Placement) => (
    <li key={p.id}>
      <span className={styles.status}>{STATE[p.state]}</span> <Link to={`/admin/listings/${p.vendorId}`}>{p.vendorName}</Link>
      {!p.listed && <span className="muted"> (not listed now, so not shown)</span>}
      <span className="muted">
        {' '}
        · {dateText(p.startsOn)} to {dateText(p.endsOn)} · added by {p.createdBy ?? 'the team'}
        {p.endedAt ? ` · ended by ${p.endedBy ?? 'the team'}` : ''}
        {p.note ? ` · note: ${p.note}` : ''}
      </span>
      {(p.state === 'current' || p.state === 'upcoming') && (
        <Form method="post" className={styles.buttons}>
          <input type="hidden" name="intent" value="end" />
          <input type="hidden" name="typeId" value={t.id} />
          <input type="hidden" name="placementId" value={p.id} />
          <button type="submit" className={`text-link ${styles.linkButton}`} disabled={busy}>
            End early
          </button>
        </Form>
      )}
    </li>
  );

  return (
    <li className={styles.row} id={`type-${t.id}`}>
      <details open={open}>
        <summary>
          <span className={styles.rowName}>{t.name}</span>{' '}
          <span className="muted">
            · {t.shown ? 'shown' : 'hidden'} · order {t.sortOrder} · {t.suggestions.length} suggested · {now} featured now
          </span>
        </summary>
        {reply && (
          <p className="notice" role="alert">
            {reply.error}
          </p>
        )}

        <h3 className="label section-gap">Name and order</h3>
        <Form method="post" className={styles.form}>
          <input type="hidden" name="intent" value="update" />
          <input type="hidden" name="id" value={t.id} />
          <p className="muted">Key: {t.key}</p>
          <div className={styles.twoColumns}>
            <div className="field">
              <label htmlFor={`name-${t.id}`} className="field-label">
                Name
              </label>
              <input id={`name-${t.id}`} name="name" className="input" defaultValue={t.name} maxLength={60} required />
              {err('name') && <p className="field-error">{err('name')}</p>}
            </div>
            <div className="field">
              <label htmlFor={`order-${t.id}`} className="field-label">
                Order (lower comes first)
              </label>
              <input id={`order-${t.id}`} name="sortOrder" className="input" inputMode="numeric" defaultValue={t.sortOrder} maxLength={4} />
              {err('sortOrder') && <p className="field-error">{err('sortOrder')}</p>}
            </div>
          </div>
          <label className={styles.check}>
            <input type="checkbox" name="shown" defaultChecked={t.shown} /> Shown to people planning
          </label>
          <p>
            <button type="submit" className="button button-secondary" disabled={busy}>
              Save name and order
            </button>
          </p>
        </Form>

        <h3 className="label section-gap">Kinds of business to suggest</h3>
        <p className="muted">
          Shown on the plan of an event of this type as “Businesses people often need”, linking to each category’s list. Ticked ones show in
          order (lower first).
        </p>
        <Form method="post" className={styles.form}>
          <input type="hidden" name="intent" value="suggestions" />
          <input type="hidden" name="typeId" value={t.id} />
          <fieldset className={styles.checks}>
            <legend className="visually-hidden">Kinds of business to suggest for {t.name}</legend>
            {categories.map((c) => (
              <span key={c.id} className={styles.buttons}>
                <label className={styles.check}>
                  <input type="checkbox" name={`cat.${c.id}`} defaultChecked={chosen.has(c.id)} />
                  {c.parent ? `${c.parent}: ${c.name}` : c.name}
                </label>
                {chosen.has(c.id) && (
                  <>
                    <label htmlFor={`o-${t.id}-${c.id}`} className="visually-hidden">
                      Order for {c.name}
                    </label>
                    <input
                      id={`o-${t.id}-${c.id}`}
                      name={`order.${c.id}`}
                      className={`input ${styles.orderBox}`}
                      inputMode="numeric"
                      defaultValue={chosen.get(c.id)}
                      maxLength={4}
                    />
                  </>
                )}
              </span>
            ))}
          </fieldset>
          <button type="submit" className="button button-secondary" disabled={busy}>
            Save suggestions
          </button>
        </Form>

        <h3 className="label section-gap">Featured businesses</h3>
        <p className="muted">
          Up to {PLAN_LIMITS.featuredShown} are shown on the plans of events of this type, labelled “Featured” with the line “
          {FEATURED_LINE}” They never change search results or reviews. Arranging a placement with a business happens outside Localites.
        </p>
        {t.mostAtOnce > PLAN_LIMITS.featuredShown && (
          <p className="notice" role="status">
            On some days {t.mostAtOnce} placements overlap. Only the first {PLAN_LIMITS.featuredShown} by start date are shown.
          </p>
        )}
        {shownPlacements.length === 0 ? (
          <p className="muted">None now or coming up.</p>
        ) : (
          <ul className={styles.history}>{shownPlacements.map(placementRow)}</ul>
        )}
        {earlier.length > 0 && (
          <details>
            <summary className="muted">Earlier ({earlier.length})</summary>
            <ul className={styles.history}>{earlier.map(placementRow)}</ul>
          </details>
        )}
        <Form method="post" className={`${styles.form} section-gap`}>
          <input type="hidden" name="intent" value="feature" />
          <input type="hidden" name="typeId" value={t.id} />
          <p className="field-label">Feature a business</p>
          <div className="field">
            <label htmlFor={`slug-${t.id}`} className="field-label">
              Business’s web address (the part after /vendors/)
            </label>
            <input
              id={`slug-${t.id}`}
              name="vendorSlug"
              className="input"
              list={found.length > 0 ? 'found-businesses' : undefined}
              autoComplete="off"
              aria-describedby={`slug-hint-${t.id}`}
            />
            <p className="field-hint" id={`slug-hint-${t.id}`}>
              Use “Find a business to feature” below to look one up.
            </p>
            {err('vendorSlug') && <p className="field-error">{err('vendorSlug')}</p>}
          </div>
          <div className={styles.twoColumns}>
            <div className="field">
              <label htmlFor={`from-${t.id}`} className="field-label">
                First day
              </label>
              <input id={`from-${t.id}`} name="startsOn" type="date" className="input" defaultValue={today} />
              {err('startsOn') && <p className="field-error">{err('startsOn')}</p>}
            </div>
            <div className="field">
              <label htmlFor={`to-${t.id}`} className="field-label">
                Last day
              </label>
              <input id={`to-${t.id}`} name="endsOn" type="date" className="input" min={today} />
              {err('endsOn') && <p className="field-error">{err('endsOn')}</p>}
            </div>
          </div>
          <div className="field">
            <label htmlFor={`note-${t.id}`} className="field-label">
              Note (optional, only the team sees this)
            </label>
            <input id={`note-${t.id}`} name="note" className="input" maxLength={PLAN_LIMITS.featuredNote} />
            {err('note') && <p className="field-error">{err('note')}</p>}
          </div>
          <button type="submit" className="button button-secondary" disabled={busy}>
            Feature this business
          </button>
        </Form>
      </details>
    </li>
  );
}
