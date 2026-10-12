import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { data, Form, isRouteErrorResponse, Link, redirect, useBlocker, useNavigation, useRouteError, useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { VendorPage, type VendorView } from '@/components/VendorPage';
import page from '@/components/VendorPage.module.css';
import { pageMeta } from '@/lib/meta';
import { tidyLine, tidyParagraphs } from '@/lib/owner-text';
import { describePrice, type PricingModel } from '@/lib/price';
import { alertTeam, NotOwner, OwnerRefused, ownedListing, readBase, saveOwnerEdits } from '@/server/owner-listing.server';
import { parseOwnerForm } from '@/server/owner-input';
import type { Route } from './+types/listing-edit';
import styles from './listing-edit.module.css';

/**
 * Screen V2: an owner edits their own listing (D-34, ADR-029). The page is laid out like
 * the public business page, with the parts the owner may change as boxes in place; "View
 * as a visitor" shows the real public page with what they've typed. Saves go live at once.
 */
export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta(loaderData ? `Edit ${loaderData.view.name}` : 'Edit your listing'),
  { name: 'robots', content: 'noindex' },
];

export async function loader({ params, context }: Route.LoaderArgs) {
  const member = context.get(memberContext);
  const result = await ownedListing(context.get(cloudflareContext).env, member.userId, params.slug);
  if (!result) throw data({ reason: 'not_owner' }, { status: 404 });
  if ('archived' in result) throw data({ reason: 'archived' }, { status: 404 });
  if ('renamedTo' in result) throw redirect(`/vendors/${result.renamedTo}/edit`);
  return { ...result, base: JSON.stringify(result.values) };
}

type Fields = Record<string, string>;
type Problem =
  | { kind: 'invalid'; errors: Record<string, string>; fields: Fields; nextBase: string }
  | { kind: 'refused'; message: string; fields: Fields; nextBase: string }
  | { kind: 'nothing'; fields: Fields; nextBase: string }
  | { kind: 'clash'; current: Record<string, unknown>; fields: Fields; nextBase: string };

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const member = context.get(memberContext);
  const form = await request.formData();
  const fields: Fields = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const base = readBase(fields.base ?? '');
  const reply = (p: Problem, status: number) => data(p, { status });
  const refused = (message: string, status = 409) => reply({ kind: 'refused', message, fields, nextBase: fields.base ?? '' }, status);

  if (env.OWNER_EDIT_LIMIT && !(await env.OWNER_EDIT_LIMIT.limit({ key: member.userId })).success) {
    return refused('That’s a lot of saves in a minute. Please wait a moment, then save again.', 429);
  }
  if (!base) return refused('Something on the page was out of date. Please reload it and try again.');
  const parsed = parseOwnerForm(fields, base);
  if (!parsed.ok) return reply({ kind: 'invalid', errors: parsed.errors, fields, nextBase: fields.base ?? '' }, 400);

  try {
    const result = await saveOwnerEdits(env, member, params.slug, base, parsed.values);
    if (result.status === 'nothing') return reply({ kind: 'nothing', fields, nextBase: fields.base ?? '' }, 200);
    if (result.status === 'clash') {
      return reply({ kind: 'clash', current: result.current, fields, nextBase: JSON.stringify(result.nextBase) }, 409);
    }
    if (result.flags.length > 0) {
      ctx.waitUntil(
        alertTeam(env, result.auditId, new URL(request.url).origin).catch((err) =>
          console.error('owner change alert not recorded', err instanceof Error ? err.message : err),
        ),
      );
    }
    return redirect(`/vendors/${result.slug}/edit?saved=${result.auditId}`);
  } catch (err) {
    if (err instanceof NotOwner) throw data({ reason: 'not_owner' }, { status: 404 });
    if (err instanceof OwnerRefused) return refused(err.message);
    throw err;
  }
}

// ------------------------------------------------------------------ the page

const PRICE_CHOICES: [PricingModel, string][] = [
  ['fixed', 'Price: $'],
  ['starting_at', 'From $'],
  ['hourly', '$ an hour'],
  ['on_request', 'Price on request'],
  ['not_listed', 'No price shown'],
];
const PRICED = new Set<string>(['fixed', 'starting_at', 'hourly']);

type Row = { id: string; name: string; description: string; pricingModel: string; price: string; shown: boolean };

const dollars = (cents: number | null) => (cents == null ? '' : (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2));

function rowsFromFields(fields: Fields): Row[] {
  const rows = new Map<number, Row>();
  for (const [key, value] of Object.entries(fields)) {
    const m = /^service\.(\d+)\.(\w+)$/.exec(key);
    if (!m) continue;
    const row = rows.get(Number(m[1])) ?? { id: '', name: '', description: '', pricingModel: 'not_listed', price: '', shown: false };
    if (m[2] === 'shown') row.shown = value === 'yes';
    else if (m[2]! in row) (row as unknown as Record<string, string>)[m[2]!] = value;
    rows.set(Number(m[1]), row);
  }
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r);
}

const blankRow = (): Row => ({ id: '', name: '', description: '', pricingModel: 'not_listed', price: '', shown: true });

/** What a visitor would see, from what's typed in the form right now, tidied as the save will. */
function previewOf(form: HTMLFormElement, view: { name: string; town: string; categories: string[] }): VendorView {
  const f = Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, String(v)]));
  const line = (s: string | undefined) => tidyLine(s ?? '') || null;
  const paragraphs = (s: string | undefined) => tidyParagraphs(s ?? '') || null;
  const website = (f.websiteUrl ?? '').trim() || null;
  return {
    ...view,
    claimed: true,
    tagline: line(f.tagline),
    description: paragraphs(f.description),
    websiteUrl: website && !/^https?:\/\//i.test(website) ? `https://${website}` : website,
    publicPhone: (f.publicPhone ?? '').trim() || null,
    services: rowsFromFields(f)
      .filter((r) => r.shown && tidyLine(r.name))
      .map((r) => {
        const cents = /^\d{1,7}(\.\d{1,2})?$/.test(r.price.replace(/[$,\s]/g, '')) ? Math.round(Number(r.price.replace(/[$,\s]/g, '')) * 100) : null;
        const price = PRICED.has(r.pricingModel) && cents === null ? null : describePrice(r.pricingModel as PricingModel, cents);
        return { name: tidyLine(r.name), description: paragraphs(r.description), price };
      }),
  };
}

const SERVICE_FIELD: Record<string, (v: unknown) => string> = {
  name: (v) => `name “${clashText(v)}”`,
  description: (v) => `details “${clashText(v)}”`,
  price: (v) => `price: ${clashText(v)}`,
  shown: (v) => (v ? 'shown on your page' : 'hidden from visitors'),
};

const keyFor = (field: string) => {
  const m = /^service\.(\d+)\.(\w+)$/.exec(field);
  return m ? `service-${m[1]}-${m[2]}` : field;
};

export default function EditListing({ loaderData, actionData }: Route.ComponentProps) {
  // A fresh form after each save (the address changes); typed values kept after a problem.
  const [params] = useSearchParams();
  return <Editor key={params.get('saved') ?? 'start'} loaderData={loaderData} actionData={actionData} saved={params.has('saved')} />;
}

function Editor({
  loaderData,
  actionData,
  saved,
}: {
  loaderData: Route.ComponentProps['loaderData'];
  actionData: Route.ComponentProps['actionData'];
  saved: boolean;
}) {
  const { slug, view, values, hidden, undone } = loaderData;
  const problem = actionData as Problem | undefined;
  const fields = problem?.fields;
  const base = problem?.nextBase || loaderData.base;
  const errors = problem?.kind === 'invalid' ? problem.errors : {};
  const clash = problem?.kind === 'clash' ? problem.current : {};
  const busy = useNavigation().state !== 'idle';

  // True once the page's script is running (the server's copy has no "add" button).
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  // Extra "Add a service" rows, counted afresh after each save attempt (its rows come back in `fields`).
  const [extraRows, setExtraRows] = useState<{ after: unknown; n: number }>({ after: problem, n: 0 });
  const extra = extraRows.after === problem ? extraRows.n : 0;
  const [preview, setPreview] = useState<{ vendor: VendorView; unsaved: boolean } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const previewBarRef = useRef<HTMLDivElement>(null);
  const viewLinkRef = useRef<HTMLAnchorElement>(null);
  const wasPreview = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    // Not saved after all: the typed changes are still only on this page.
    if (problem && problem.kind !== 'nothing') {
      dirty.current = true;
      summaryRef.current?.focus();
    }
  }, [problem]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  useEffect(() => {
    // Keyboard and screen-reader users land on the preview's bar, and back on the link after.
    if (preview) previewBarRef.current?.focus();
    else if (wasPreview.current) viewLinkRef.current?.focus();
    wasPreview.current = Boolean(preview);
  }, [preview]);

  // Moving within the site (a link, the phone's Back gesture) doesn't unload the page, so
  // it's caught here: Back from the preview returns to editing, and leaving with unsaved
  // changes asks first.
  const backToEditing = useRef(false);
  const blocker = useBlocker(({ currentLocation, nextLocation, historyAction }) => {
    backToEditing.current = Boolean(preview) && historyAction === 'POP';
    return backToEditing.current || (dirty.current && currentLocation.pathname !== nextLocation.pathname);
  });
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (backToEditing.current) {
      setPreview(null);
      blocker.reset();
    } else if (window.confirm('You have changes that aren’t saved. Leave this page anyway?')) {
      dirty.current = false;
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker]);

  const rows: Row[] = fields
    ? rowsFromFields(fields)
    : [
        ...values.services.map((s) => ({
          id: s.id ?? '',
          name: s.name,
          description: s.description ?? '',
          pricingModel: s.price.pricingModel,
          price: dollars(s.price.priceCents),
          shown: s.shown,
        })),
        blankRow(),
      ];
  for (let i = 0; i < extra; i++) rows.push(blankRow());

  const value = (name: 'tagline' | 'description' | 'websiteUrl' | 'publicPhone') => fields?.[name] ?? values[name] ?? '';
  const problems = Object.entries(errors);
  const clashNote = (key: string) =>
    key in clash ? (
      <p className={styles.clash}>
        Our team changed this while you were editing. It now says “{clashText(clash[key])}”. Save again to use yours instead.
      </p>
    ) : null;
  const errorFor = (name: string) =>
    errors[name] ? (
      <p className="field-error" id={`${keyFor(name)}-error`}>
        {errors[name]}
      </p>
    ) : null;
  const described = (name: string) => (errors[name] ? `${keyFor(name)}-error` : undefined);

  return (
    <>
      <SiteHeader />
      <main className="page">
        {preview && (
          <>
            <div ref={previewBarRef} tabIndex={-1} className={`notice ${styles.previewBar}`}>
              <span>
                {hidden ? 'This is how your listing will look to visitors.' : 'This is how visitors see your listing.'}
                {preview.unsaved ? ' Not saved yet.' : ''}
              </span>
              <button type="button" className="button button-secondary" onClick={() => setPreview(null)}>
                Back to editing
              </button>
            </div>
            <VendorPage vendor={preview.vendor} />
          </>
        )}

        <div hidden={Boolean(preview)}>
          <p className={`notice ${styles.topNote}`}>
            You’re editing your listing.{' '}
            {hidden ? 'Your changes are kept as soon as you save.' : 'Changes show to visitors as soon as you save.'} Our team
            reads every change and may change back anything that breaks our rules.
          </p>
          {saved && !problem && (
            <p className="notice" role="status">
              {hidden ? 'Saved. Visitors will see your changes once your listing is shown again.' : 'Saved. Visitors see your changes now.'}{' '}
              {!hidden && (
                <Link to={`/vendors/${slug}`} className="text-link">
                  See your listing
                </Link>
              )}
            </p>
          )}
          {hidden && (
            <p className="notice">
              Your listing is hidden from visitors right now. Email supportlocalites@gmail.com to find out why.
            </p>
          )}
          {undone.map((u) => (
            <div key={u.at} className="notice">
              <p>
                On {new Date(u.at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'America/Toronto' })} our
                team changed back: {u.lines.join('; ')}.
              </p>
              {u.reason && <p>Why: {u.reason}</p>}
            </div>
          ))}
          {problem && problem.kind !== 'nothing' && (
            <div ref={summaryRef} tabIndex={-1} className="notice" role="alert">
              {problem.kind === 'refused' && <p>{problem.message}</p>}
              {problem.kind === 'clash' && <p>Our team changed part of your listing while you were editing. Check the marked boxes, then save again.</p>}
              {problem.kind === 'invalid' && (
                <>
                  <p>
                    {problems.length === 1 ? '1 thing' : `${problems.length} things`} to fix before saving:
                  </p>
                  <ul>
                    {problems.map(([name, message]) => (
                      <li key={name}>{name === 'form' ? message : <a href={`#${keyFor(name)}`}>{message}</a>}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          <Form
            method="post"
            ref={formRef}
            noValidate
            onChange={() => {
              dirty.current = true;
            }}
            onSubmit={() => {
              dirty.current = false;
            }}
          >
            <input type="hidden" name="base" value={base} />
            <div className={page.layout}>
              <div className={`${page.photo} ${styles.photo}`}>
                <span className={styles.photoNote}>Photos are coming later.</span>
              </div>
              <div className={page.details}>
                <span className="label">{[...view.categories, view.town].filter(Boolean).join(' · ')}</span>
                <h1 className="title-1">{view.name}</h1>
                <div className="title-rule" aria-hidden="true" />
                <p className={`muted ${styles.teamOnly}`}>
                  Your business name, town and type of business are set by our team.{' '}
                  <a href={`mailto:supportlocalites@gmail.com?subject=${encodeURIComponent(`Change to ${view.name}`)}`}>
                    Email us to change them
                  </a>
                  .
                </p>

                <div className={styles.spot}>
                  <label htmlFor="tagline" className={styles.spotLabel}>
                    Short description
                  </label>
                  <input
                    id="tagline"
                    name="tagline"
                    className={styles.box}
                    defaultValue={value('tagline')}
                    maxLength={160}
                    placeholder="One line about what you do, like “Custom cakes for birthdays and weddings”"
                    aria-invalid={errors.tagline ? true : undefined}
                    aria-describedby={described('tagline')}
                  />
                  {errorFor('tagline')}
                  {clashNote('tagline')}
                </div>

                <div className={styles.spot}>
                  <label htmlFor="description" className={styles.spotLabel}>
                    About your business
                  </label>
                  <textarea
                    id="description"
                    name="description"
                    className={`${styles.box} ${styles.about} muted`}
                    defaultValue={value('description')}
                    maxLength={5000}
                    rows={6}
                    placeholder="Tell people what you offer, how long you’ve done it and where you go"
                    aria-invalid={errors.description ? true : undefined}
                    aria-describedby={described('description')}
                  />
                  {errorFor('description')}
                  {clashNote('description')}
                </div>

                <section aria-labelledby="services">
                  <h2 id="services" className="label">
                    Services
                  </h2>
                  <ul className={page.services}>
                    {rows.map((r, i) => {
                      const k = (f: string) => `service.${i}.${f}`;
                      const id = (f: string) => `service-${i}-${f}`;
                      const rowClashes = r.id ? Object.keys(clash).filter((c) => c.startsWith(`service:${r.id}:`)) : [];
                      return (
                        <li key={i} className={`${styles.serviceRow} ${r.shown || !r.id ? '' : styles.hiddenRow}`}>
                          <input type="hidden" name={k('id')} value={r.id} />
                          <div className={styles.serviceTop}>
                            <div className={styles.spot}>
                              <label htmlFor={id('name')} className={styles.spotLabel}>
                                {r.id ? 'Service name' : 'Add a service'}
                              </label>
                              <input
                                id={id('name')}
                                name={k('name')}
                                className={styles.box}
                                defaultValue={r.name}
                                maxLength={120}
                                placeholder="Service name, like Wedding cake"
                                aria-invalid={errors[k('name')] ? true : undefined}
                                aria-describedby={described(k('name'))}
                              />
                              {errorFor(k('name'))}
                            </div>
                            <div className={`${styles.spot} ${styles.price}`}>
                              <label htmlFor={id('pricingModel')} className={styles.spotLabel}>
                                Price
                              </label>
                              <select id={id('pricingModel')} name={k('pricingModel')} className={styles.box} defaultValue={r.pricingModel}>
                                {PRICE_CHOICES.map(([model, words]) => (
                                  <option key={model} value={model}>
                                    {words}
                                  </option>
                                ))}
                              </select>
                              <label htmlFor={id('price')} className={`${styles.spotLabel} ${styles.amount}`}>
                                Price in dollars
                              </label>
                              <input
                                id={id('price')}
                                name={k('price')}
                                className={`${styles.box} ${styles.amount}`}
                                defaultValue={r.price}
                                inputMode="decimal"
                                placeholder="150"
                                maxLength={12}
                                aria-invalid={errors[k('price')] ? true : undefined}
                                aria-describedby={described(k('price'))}
                              />
                              {errorFor(k('price'))}
                            </div>
                          </div>
                          <div className={styles.spot}>
                            <label htmlFor={id('description')} className={styles.spotLabel}>
                              Details (optional)
                            </label>
                            <textarea
                              id={id('description')}
                              name={k('description')}
                              className={`${styles.box} muted`}
                              defaultValue={r.description}
                              maxLength={2000}
                              rows={2}
                              placeholder="Like Serves up to 100"
                              aria-invalid={errors[k('description')] ? true : undefined}
                              aria-describedby={described(k('description'))}
                            />
                            {errorFor(k('description'))}
                          </div>
                          <label className={styles.check}>
                            <input type="checkbox" name={k('shown')} value="yes" defaultChecked={r.shown} />
                            Show on my page
                          </label>
                          {r.id && !r.shown && <p className="muted">Hidden from visitors.</p>}
                          {rowClashes.length > 0 && (
                            <p className={styles.clash}>
                              Our team changed this service while you were editing. It now has{' '}
                              {rowClashes.map((c) => SERVICE_FIELD[c.split(':')[2]!]?.(clash[c]) ?? '').join(', ')}. Save again to use
                              yours instead.
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {hydrated && (
                    <button type="button" className={`text-link ${styles.linkButton}`} onClick={() => setExtraRows({ after: problem, n: extra + 1 })}>
                      + Add another service
                    </button>
                  )}
                </section>

                <section aria-labelledby="contact">
                  <h2 id="contact" className="label">
                    Contact
                  </h2>
                  <div className={styles.spot}>
                    <label htmlFor="websiteUrl" className={styles.spotLabel}>
                      Website (your Visit website button)
                    </label>
                    <input
                      id="websiteUrl"
                      name="websiteUrl"
                      className={styles.box}
                      defaultValue={value('websiteUrl')}
                      inputMode="url"
                      autoComplete="url"
                      maxLength={500}
                      placeholder="yourbusiness.ca"
                      aria-invalid={errors.websiteUrl ? true : undefined}
                      aria-describedby={described('websiteUrl')}
                    />
                    {errorFor('websiteUrl')}
                    {clashNote('websiteUrl')}
                  </div>
                  <div className={styles.spot}>
                    <label htmlFor="publicPhone" className={styles.spotLabel}>
                      Phone (your Call button)
                    </label>
                    <input
                      id="publicPhone"
                      name="publicPhone"
                      className={styles.box}
                      defaultValue={value('publicPhone')}
                      inputMode="tel"
                      autoComplete="tel"
                      maxLength={20}
                      placeholder="705-555-0123"
                      aria-invalid={errors.publicPhone ? true : undefined}
                      aria-describedby={described('publicPhone')}
                    />
                    {errorFor('publicPhone')}
                    {clashNote('publicPhone')}
                  </div>
                </section>
              </div>
            </div>

            <div className={styles.saveBar}>
              {/* Next to the button just tapped; always there, so screen readers announce the words. */}
              <span className="muted" role="status">
                {problem?.kind === 'nothing' ? 'Nothing to save: you haven’t changed anything.' : ''}
              </span>
              <a
                ref={viewLinkRef}
                href={`/vendors/${slug}`}
                className="text-link"
                onClick={(e) => {
                  if (!formRef.current) return;
                  e.preventDefault();
                  setPreview({ vendor: previewOf(formRef.current, view), unsaved: dirty.current });
                  window.scrollTo({ top: 0 });
                }}
              >
                View as a visitor
              </a>
              <button type="submit" className="button button-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </Form>
        </div>
      </main>
    </>
  );
}

function clashText(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(empty)';
  if (typeof v === 'object' && 'pricingModel' in (v as object)) {
    const p = v as { pricingModel: PricingModel; priceCents: number | null };
    return describePrice(p.pricingModel, p.priceCents) ?? 'No price shown';
  }
  if (typeof v === 'boolean') return v ? 'shown' : 'hidden';
  return String(v).length > 80 ? `${String(v).slice(0, 79)}…` : String(v);
}

/** Not this person's listing (or no longer): said plainly, with a way back. */
export function ErrorBoundary() {
  const error = useRouteError();
  const notOwner = isRouteErrorResponse(error) && error.status === 404;
  const archived = notOwner && (error.data as { reason?: string } | null)?.reason === 'archived';
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">{notOwner ? 'You can’t edit this listing' : 'Something went wrong'}</h1>
        <div className="title-rule" aria-hidden="true" />
        <p className="muted">
          {archived
            ? 'This listing is no longer on Localites, so it can’t be edited. If you think that’s a mistake, email supportlocalites@gmail.com.'
            : notOwner
              ? 'Only the business’s owner on Localites can edit it. If you’ve claimed it, we’ll email you once your claim is approved. If you think this should be yours, email supportlocalites@gmail.com.'
              : 'The page didn’t load. Please try again in a moment.'}
        </p>
        <Link to="/account" className="button button-primary">
          Your account
        </Link>
      </main>
    </>
  );
}
