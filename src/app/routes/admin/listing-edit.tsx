import { APPROXIMATE, readAddressForm, streetLine } from '@/lib/address';
import { AddressRefused, setTeamAddress } from '@/server/address.server';
import { data, Form, Link, redirect, type ShouldRevalidateFunctionArgs, useNavigation } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { ListingFields, type ListingValues } from '@/components/admin/ListingFields';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { ADMIN_TRANSITIONS, type ListingStatus, STATUS_LABEL } from '@/lib/listing-status';
import { fieldErrors, formValues, listingInput, readLoadedListing, readLoadedService, serviceInput } from '@/server/admin/listing-input';
import {
  changeListingStatus,
  ListingConflict,
  readFormOptions,
  readListing,
  saveService,
  setCostLevel,
  setServiceActive,
  updateListing,
} from '@/server/admin/listings.server';
import { readSwitch } from '@/server/admin/activity.server';
import { listOwnerChanges, OwnerChangeConflict, removeOwner, undoOwnerChange } from '@/server/admin/owner-changes.server';
import { upcomingBookingCount } from '@/server/admin/team-bookings.server';
import { withDb } from '@/server/db.server';
import { emailPerson, renderEmail } from '@/server/email-templates.server';
import { siteUrl } from '@/server/plan-pages.server';
import { emailSuggesters } from '@/server/suggestions.server';
import type { Route } from './+types/listing-edit';
import styles from './admin.module.css';

export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta(loaderData ? `${loaderData.listing.name} · Team` : 'Listing · Team'),
  { name: 'robots', content: 'noindex' },
];

export async function loader({ params, request, context }: Route.LoaderArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const { env } = context.get(cloudflareContext);
  // One connection for the page (each one costs time from the request's small CPU budget).
  // The bookings count acts as the team (D-46: only the team may count them), after the rest.
  const [listing, options, owned, analytics, upcomingBookings] = await withDb(env, async (db) => {
    const found = await readListing(db, params.id);
    const keep = found ? { municipalityId: found.municipalityId, categoryIds: found.categoryIds } : null;
    const rest = await Promise.all([readFormOptions(db, keep), listOwnerChanges(db, params.id), readSwitch(db, params.id)]);
    return [found, ...rest, found ? await upcomingBookingCount(db, context.get(adminContext), params.id) : 0] as const;
  });
  if (!listing) throw data(null, { status: 404 });
  return {
    listing,
    upcomingBookings,
    options,
    owner: owned.owner,
    ownerChanges: owned.cards,
    analyticsOn: analytics?.enabled ?? false,
    saved: new URL(request.url).searchParams.get('saved'),
  };
}

// After an undo the cards are read again even when it was refused (someone else may
// have undone that save first), so the page shows what's true now.
export function shouldRevalidate({ formData, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  return formData?.get('intent') === 'owner-undo' || defaultShouldRevalidate;
}

const OUT_OF_DATE = 'This page was out of date. Reload it and try again.';

const ACTION_WORDS: Record<ListingStatus, string> = {
  published: 'Publish',
  unpublished: 'Hide from the public',
  archived: 'Archive',
  draft: 'Back to draft',
  pending_review: 'Send for review',
};

export async function action({ params, request, context }: Route.ActionArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const { env, ctx } = context.get(cloudflareContext);
  const admin = context.get(adminContext);
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  const back = (saved: string) => redirect(`/admin/listings/${params.id}?saved=${saved}`);
  const later = (work: Promise<void>) =>
    ctx.waitUntil(work.catch((err) => console.error('owner email not recorded', err instanceof Error ? err.message : err)));
  try {
    if (intent === 'owner-undo') {
      const auditId = String(form.get('auditId') ?? '');
      if (!isUuid(auditId)) throw data(null, { status: 400 });
      const reason = String(form.get('reason') ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500);
      if (!reason) return data({ intent, auditId, errors: { form: 'Say why. The owner is emailed the reason.' } }, { status: 400 });
      const keys = form.getAll('key').map(String).slice(0, 200);
      const result = await undoOwnerChange(env, admin, params.id, auditId, keys, reason).catch((err: unknown) => {
        if (err instanceof OwnerChangeConflict) return err;
        throw err;
      });
      if (result instanceof OwnerChangeConflict) return data({ intent, auditId, errors: { form: result.message } }, { status: 409 });
      if (!result.owner) return back('undone-no-email');
      const owner = result.owner;
      later(
        emailPerson(
          env,
          owner,
          'listing_change_undone',
          { type: 'owner_change', id: auditId },
          renderEmail('undone', { name: owner.name, business: result.business, lines: result.lines, reason }),
        ),
      );
      return back('undone');
    }
    if (intent === 'owner-remove') {
      const reason = String(form.get('reason') ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500);
      if (!reason) return data({ intent, errors: { form: 'Say why. The owner is emailed the reason.' } }, { status: 400 });
      const result = await removeOwner(env, admin, params.id, reason);
      later(
        emailPerson(
          env,
          result.owner,
          'owner_removed',
          { type: 'vendor', id: params.id },
          renderEmail('ownerRemoved', { name: result.owner.name, business: result.business, reason }),
        ),
      );
      return back('owner-removed');
    }
    if (intent === 'details') {
      const raw = formValues(form, ['categoryIds']);
      const parsed = listingInput.safeParse(raw);
      if (!parsed.success) return data({ intent, errors: fieldErrors(parsed.error), values: raw }, { status: 400 });
      const loaded = readLoadedListing(String(form.get('loaded') ?? ''));
      if (!loaded) return data({ intent, errors: { form: OUT_OF_DATE }, values: raw }, { status: 400 });
      const renamed = await updateListing(env, admin, params.id, parsed.data, loaded);
      if (renamed?.owner) {
        const owner = renamed.owner;
        later(
          emailPerson(
            env,
            owner,
            'business_renamed',
            { type: 'vendor', id: params.id },
            renderEmail('businessRenamed', {
              name: owner.name,
              business: renamed.to,
              from: renamed.from,
              link: `${siteUrl(env, request)}/vendors/${renamed.slug}`,
            }),
          ),
        );
      }
      return back('details');
    }
    if (intent === 'cost') {
      const raw = String(form.get('cost') ?? '');
      const level = raw === '1' || raw === '2' || raw === '3' ? (Number(raw) as 1 | 2 | 3) : raw === '' ? null : undefined;
      if (level === undefined) throw data(null, { status: 400 });
      await setCostLevel(env, admin, params.id, level);
      return back('cost');
    }
    if (intent === 'address') {
      const read = readAddressForm(form);
      if ('error' in read) return data({ intent, errors: { address: read.error } }, { status: 400 });
      try {
        await setTeamAddress(env, admin, params.id, read.value);
      } catch (err) {
        if (err instanceof AddressRefused && err.message !== 'not found') return data({ intent, errors: { address: err.message } }, { status: 409 });
        if (err instanceof AddressRefused) throw data(null, { status: 404 });
        throw err;
      }
      return back('address');
    }
    if (intent === 'status') {
      const to = String(form.get('to') ?? '') as ListingStatus;
      if (!(to in STATUS_LABEL)) return data({ intent, errors: { form: 'Choose what to do with the listing.' } }, { status: 400 });
      const reason =
        String(form.get('reason') ?? '')
          .trim()
          .slice(0, 500) || null;
      await changeListingStatus(env, admin, params.id, to, reason);
      // D-25: anyone who suggested this business while signed in is told it's listed.
      if (to === 'published') later(emailSuggesters(env, params.id, siteUrl(env, request)));
      return back(to);
    }
    if (intent === 'service') {
      const serviceId = String(form.get('serviceId') ?? '');
      if (serviceId && !isUuid(serviceId)) throw data(null, { status: 400 });
      const raw = formValues(form);
      const parsed = serviceInput.safeParse(raw);
      if (!parsed.success) {
        return data({ intent, serviceId, errors: fieldErrors(parsed.error), values: raw }, { status: 400 });
      }
      await saveService(env, admin, params.id, serviceId || null, parsed.data, readLoadedService(String(form.get('loaded') ?? '')));
      return back('service');
    }
    if (intent === 'service-visibility') {
      const serviceId = String(form.get('serviceId') ?? '');
      if (!isUuid(serviceId)) throw data(null, { status: 400 });
      await setServiceActive(env, admin, params.id, serviceId, form.get('active') === 'true');
      return back('service');
    }
    return data({ intent, errors: { form: 'Unknown request.' } }, { status: 400 });
  } catch (err) {
    if (err instanceof OwnerChangeConflict) return data({ intent, errors: { form: err.message } }, { status: 409 });
    if (err instanceof ListingConflict) {
      const serviceId = String(form.get('serviceId') ?? '');
      return data({ intent, serviceId, errors: { [err.field]: err.message }, values: formValues(form, ['categoryIds']) }, { status: 409 });
    }
    throw err;
  }
}

const SAVED: Record<string, string> = {
  created: 'Draft saved. Nobody sees it until you publish it.',
  details: 'Details saved.',
  cost: 'Cost guide saved.',
  address: 'Address saved.',
  service: 'Services saved.',
  published: 'Published: it’s now on Localites.',
  unpublished: 'Hidden: it no longer shows on Localites.',
  archived: 'Archived.',
  draft: 'Moved back to draft.',
  undone: 'Undone. We’re emailing the owner what changed back, and why.',
  'undone-no-email': 'Undone. The owner’s account no longer exists, so no email was sent.',
  'owner-removed': 'Owner removed, and the listing is unclaimed again. We’re emailing them the reason.',
};

type ServiceValues = { name: string; description: string | null; pricingModel: string; price: string; priceNote: string | null };

function ServiceFields({ prefix, values, errors = {} }: { prefix: string; values: ServiceValues; errors?: Record<string, string> }) {
  const err = (k: string) =>
    errors[k] ? (
      <p className="field-error" id={`${prefix}-${k}-error`}>
        {errors[k]}
      </p>
    ) : null;
  return (
    <>
      <div className={styles.twoColumns}>
        <div className="field">
          <label htmlFor={`${prefix}-name`} className="field-label">
            Service
          </label>
          <input
            id={`${prefix}-name`}
            name="name"
            defaultValue={values.name}
            className="input"
            maxLength={120}
            aria-invalid={errors.name ? true : undefined}
          />
          {err('name')}
        </div>
        {/* No prices, anywhere (D-58): what was set stays as it was, unseen. */}
        <input type="hidden" name="pricingModel" value={values.pricingModel} />
        <input type="hidden" name="price" value={values.price} />
        <input type="hidden" name="priceNote" value={values.priceNote ?? ''} />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-description`} className="field-label">
          Description (optional)
        </label>
        <input id={`${prefix}-description`} name="description" defaultValue={values.description ?? ''} className="input" maxLength={2000} />
        {err('description')}
      </div>
    </>
  );
}

const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' });

const HISTORY_WORDS: Record<string, string> = {
  'vendor.create': 'Created',
  'vendor.update': 'Details changed',
  'vendor.service.add': 'Service added',
  'vendor.service.update': 'Service changed',
  'vendor.service.hide': 'Service hidden',
  'vendor.service.show': 'Service shown again',
  'vendor.owner_edit': 'Changed by the owner',
  'vendor.owner_edit.undo': 'Owner’s change undone',
  'vendor_member.end': 'Owner removed',
};

const FIELD_WORDS: Record<string, string> = {
  name: 'name',
  slug: 'web address',
  tagline: 'short description',
  description: 'about',
  municipalityId: 'town',
  websiteUrl: 'website',
  publicEmail: 'email',
  publicPhone: 'phone',
  primaryCategoryId: 'main category',
  categoryIds: 'categories',
};

type ActionResult = {
  intent: string;
  serviceId?: string;
  auditId?: string;
  errors: Record<string, string>;
  values?: Record<string, unknown>;
};

export default function EditListing({ loaderData, actionData: rawResult }: Route.ComponentProps) {
  const actionData = rawResult as ActionResult | undefined;
  const { listing, options, owner, ownerChanges, analyticsOn, saved, upcomingBookings } = loaderData;
  const busy = useNavigation().state === 'submitting';
  const archived = listing.status === 'archived';
  const errorsFor = (intent: string, serviceId = '') =>
    actionData?.intent === intent && (intent !== 'service' || actionData.serviceId === serviceId) ? actionData.errors : undefined;
  const detailValues: ListingValues =
    actionData?.intent === 'details' && actionData.values ? (actionData.values as unknown as ListingValues) : listing;
  // An undo's problem shows on its save's card while that card can still be undone, else at the top.
  const undoCard =
    actionData?.intent === 'owner-undo' ? ownerChanges.find((c) => c.auditId === actionData.auditId && !c.undone) : undefined;
  const newServiceErrors = errorsFor('service', '');
  const newServiceValues =
    newServiceErrors && actionData?.values
      ? (actionData.values as unknown as ServiceValues)
      : { name: '', description: '', pricingModel: 'on_request', price: '', priceNote: '' };

  return (
    <>
      <Link to="/admin" className="text-link">
        ← All listings
      </Link>
      <h1 className="title-1 section-gap">{listing.name}</h1>
      <div className="title-rule" aria-hidden="true" />
      <p className="muted">
        <span className={`${styles.status} ${listing.status === 'published' ? styles.statusLive : ''}`}>
          {STATUS_LABEL[listing.status]}
        </span>{' '}
        · {listing.claimStatus === 'claimed' ? 'Claimed by the business' : 'Not claimed'}
        {listing.status === 'published' && (
          <>
            {' '}
            ·{' '}
            <a href={`/vendors/${listing.slug}`} target="_blank" rel="noopener" className="text-link">
              View public page
            </a>
          </>
        )}
      </p>
      <p className="muted">
        {`Analytics page for the owner: ${analyticsOn ? 'On' : 'Off'} · `}
        <Link to={`/admin/listings/${listing.id}/activity`} className="text-link">
          See activity
        </Link>
      </p>
      <p className="muted">
        {`Bookings for events still to come: ${upcomingBookings} · `}
        <Link to={`/admin/bookings?business=${listing.id}`} className="text-link">
          See who booked them
        </Link>
      </p>
      {saved && SAVED[saved] && (
        <p className="notice" role="status">
          {SAVED[saved]}
        </p>
      )}
      {actionData?.errors?.form && !undoCard && (
        <p className="notice" role="alert">
          {actionData.errors.form}
        </p>
      )}

      {ADMIN_TRANSITIONS[listing.status].length > 0 && (
        <Form method="post" className={styles.statusPanel}>
          <input type="hidden" name="intent" value="status" />
          {listing.status === 'published' && upcomingBookings > 0 && (
            <p className={styles.reasonField}>
              {upcomingBookings === 1 ? 'There’s 1 booking' : `There are ${upcomingBookings} bookings`} of this business for events still to
              come. If you take it down, it stays on those people’s plans and they’re listed under Bookings, to check in with.
            </p>
          )}
          {ADMIN_TRANSITIONS[listing.status].some((s) => s !== 'published') && (
            <div className={`field ${styles.reasonField}`}>
              <label htmlFor="reason" className="field-label">
                Reason (optional; kept in the history)
              </label>
              <input id="reason" name="reason" className="input" maxLength={500} />
            </div>
          )}
          {ADMIN_TRANSITIONS[listing.status].map((to) => (
            <button
              key={to}
              type="submit"
              name="to"
              value={to}
              className={to === 'published' ? 'button button-primary' : 'button button-secondary'}
              disabled={busy}
            >
              {ACTION_WORDS[to]}
            </button>
          ))}
        </Form>
      )}

      <section className={styles.section} aria-labelledby="cost-heading">
        <h2 id="cost-heading">Cost guide</h2>
        <p className="muted">
          Shown on Browse local as $ (low cost), $$ or $$$ (high cost), and used by its Cost filter. Set by our team only, from what people
          tell us their events cost. Never a price.
        </p>
        <Form method="post" className={styles.buttons}>
          <input type="hidden" name="intent" value="cost" />
          <label htmlFor="cost" className="field-label">
            Cost
          </label>
          <select id="cost" name="cost" className="input" defaultValue={listing.costLevel ? String(listing.costLevel) : ''}>
            <option value="">Not set yet</option>
            <option value="1">$ (low cost)</option>
            <option value="2">$$ (medium cost)</option>
            <option value="3">$$$ (high cost)</option>
          </select>
          <button type="submit" className="button button-secondary" disabled={busy}>
            Save cost
          </button>
        </Form>
      </section>

      <section className={styles.section} aria-labelledby="address-heading">
        <h2 id="address-heading">Address and map</h2>
        <p className="muted">
          {streetLine(listing.address)
            ? `Shows as ${streetLine(listing.address)}${listing.address.hidden ? ' (number hidden by the business)' : ''}. `
            : 'Only the town shows, and it isn’t on the map. '}
          {listing.address.lat === null
            ? listing.address.street
              ? 'Not found on the map: listed by its town.'
              : ''
            : listing.address.approximate
              ? `Pin near the street (“${APPROXIMATE}”).`
              : 'Pin at the address.'}{' '}
          The owner or a manager can change it too.
        </p>
        <Form method="post" className={styles.buttons}>
          <input type="hidden" name="intent" value="address" />
          <label htmlFor="team-street" className="field-label">
            Street
          </label>
          <input id="team-street" name="street" className="input" maxLength={120} defaultValue={listing.address.street ?? ''} />
          <label htmlFor="team-number" className="field-label">
            Number
          </label>
          <input id="team-number" name="number" className="input" maxLength={13} defaultValue={listing.address.number ?? ''} />
          <label className="field-hint">
            <input type="checkbox" name="hideNumber" value="yes" defaultChecked={listing.address.hidden} /> Hide the number (never shown or
            kept; the pin is near the street)
          </label>
          {actionData?.intent === 'address' && actionData.errors && 'address' in actionData.errors && (
            <p className="field-error" role="alert">
              {String(actionData.errors.address)}
            </p>
          )}
          <button type="submit" className="button button-secondary" disabled={busy}>
            Save address
          </button>
        </Form>
      </section>

      <section className={styles.section} aria-labelledby="owner-heading">
        <h2 id="owner-heading">Owner</h2>
        {owner ? (
          <>
            <p>
              {owner.name} <span className="muted">({owner.email})</span> manages this listing and can change its descriptions, services,
              prices, website and phone. Their changes are live at once and listed below.
            </p>
            <Form method="post" className={styles.buttons}>
              <input type="hidden" name="intent" value="owner-remove" />
              <label htmlFor="remove-reason" className="visually-hidden">
                Why (emailed to them)
              </label>
              <input id="remove-reason" name="reason" className="input" placeholder="Why (emailed to them)" maxLength={500} />
              <button type="submit" className="button button-secondary" disabled={busy}>
                Remove owner
              </button>
            </Form>
          </>
        ) : (
          <p className="muted">No owner on Localites. The business can claim this listing.</p>
        )}
      </section>

      <section className={styles.section} aria-labelledby="owner-changes-heading" id="owner-changes">
        <h2 id="owner-changes-heading">Changes by the owner</h2>
        {ownerChanges.length === 0 ? (
          <p className="muted">None in the last 60 days.</p>
        ) : (
          <ul className={styles.rows}>
            {ownerChanges.map((c) => (
              <li key={c.auditId} className={styles.row}>
                <span>
                  <strong>{c.owner ?? 'The owner'}</strong> <span className="muted">· {when.format(new Date(c.at))}</span>
                  {c.flags.length > 0 && <span className={styles.status}> · Check: new {c.flags.join(' and ')}</span>}
                </span>
                {c.undone ? (
                  <>
                    <ul className={styles.history}>
                      {c.lines.map((l) => (
                        <li key={l.key}>
                          {l.text} <span className="muted">· {l.putBack ? 'put back' : 'kept as the owner set it'}</span>
                        </li>
                      ))}
                    </ul>
                    <span className="muted">
                      Undone by {c.undone.by ?? 'the team'} · {when.format(new Date(c.undone.at))}
                      {c.undone.reason ? ` · “${c.undone.reason}”` : ''}
                    </span>
                  </>
                ) : (
                  <Form method="post">
                    <input type="hidden" name="intent" value="owner-undo" />
                    <input type="hidden" name="auditId" value={c.auditId} />
                    <fieldset className={styles.plainFieldset}>
                      <legend className="visually-hidden">Changes in this save</legend>
                      {c.lines.map((l) => (
                        <label key={l.key} className={styles.check}>
                          <input type="checkbox" name="key" value={l.key} defaultChecked={l.possible} disabled={!l.possible} />
                          <span>
                            {l.text}
                            {!l.possible && (
                              <span className="muted"> · Changed again since (now: {l.now}). Undo the later change first.</span>
                            )}
                          </span>
                        </label>
                      ))}
                    </fieldset>
                    {undoCard === c && actionData?.errors.form && (
                      <p className="notice" role="alert">
                        {actionData.errors.form}
                      </p>
                    )}
                    {c.lines.some((l) => l.possible) && (
                      <p className="muted">
                        Each save can be undone once. Anything you leave unticked stays as the owner set it (you can still change it under
                        Details or Services).
                      </p>
                    )}
                    {c.lines.some((l) => l.possible) && (
                      <div className={styles.buttons}>
                        <label htmlFor={`why-${c.auditId}`} className="visually-hidden">
                          Why (the owner sees this)
                        </label>
                        <input
                          id={`why-${c.auditId}`}
                          name="reason"
                          className="input"
                          placeholder="Why (the owner sees this)"
                          maxLength={500}
                        />
                        <button type="submit" className="button button-secondary" disabled={busy}>
                          Undo the ticked changes
                        </button>
                      </div>
                    )}
                  </Form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby="details-heading">
        <h2 id="details-heading">Details</h2>
        {errorsFor('details') && !actionData?.errors?.form && (
          <p className="notice" role="alert">
            Some details need another look. They’re marked below.
          </p>
        )}
        <Form method="post" noValidate key={saved ?? 'details'}>
          <input type="hidden" name="intent" value="details" />
          <input
            type="hidden"
            name="loaded"
            value={
              actionData?.intent === 'details' && typeof actionData.values?.loaded === 'string'
                ? actionData.values.loaded
                : JSON.stringify({
                    tagline: listing.tagline,
                    description: listing.description,
                    websiteUrl: listing.websiteUrl,
                    publicPhone: listing.publicPhone,
                  })
            }
          />
          <fieldset disabled={archived} className={styles.plainFieldset}>
            <ListingFields values={detailValues} options={options} errors={errorsFor('details')} />
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save details'}
            </button>
          </fieldset>
        </Form>
      </section>

      <section className={styles.section} aria-labelledby="services-heading">
        <h2 id="services-heading">Services</h2>
        <p className="muted">No prices are shown anywhere on Localites (D-58). Hidden services stay in the history.</p>
        {listing.services.map((s) => {
          const errors = errorsFor('service', s.id);
          const values =
            errors && actionData?.values
              ? (actionData.values as unknown as ServiceValues)
              : { ...s, price: s.priceCents === null ? '' : String(s.priceCents / 100) };
          return (
            <div key={s.id} className={`${styles.service} ${s.isActive ? '' : styles.serviceHidden}`}>
              <p className="label">
                {s.isActive ? 'Shown' : 'Hidden'}
              </p>
              <Form method="post" noValidate key={`${s.id}-${saved ?? ''}`}>
                <input type="hidden" name="intent" value="service" />
                <input type="hidden" name="serviceId" value={s.id} />
                <input
                  type="hidden"
                  name="loaded"
                  value={
                    errors && typeof actionData?.values?.loaded === 'string'
                      ? actionData.values.loaded
                      : JSON.stringify({ name: s.name, description: s.description, pricingModel: s.pricingModel, priceCents: s.priceCents })
                  }
                />
                <fieldset disabled={archived} className={styles.plainFieldset}>
                  <ServiceFields prefix={`s-${s.id}`} values={values} errors={errors} />
                  <div className={styles.buttons}>
                    <button type="submit" className="button button-secondary" disabled={busy}>
                      Save service
                    </button>
                  </div>
                </fieldset>
              </Form>
              <Form method="post" className={styles.buttons}>
                <input type="hidden" name="intent" value="service-visibility" />
                <input type="hidden" name="serviceId" value={s.id} />
                <input type="hidden" name="active" value={s.isActive ? 'false' : 'true'} />
                <button type="submit" className={`text-link ${styles.linkButton}`} disabled={busy || archived}>
                  {s.isActive ? 'Hide this service' : 'Show this service again'}
                </button>
              </Form>
            </div>
          );
        })}
        {!archived && (
          <div className={styles.service}>
            <p className="label">Add a service</p>
            <Form method="post" noValidate key={`new-${saved ?? ''}`}>
              <input type="hidden" name="intent" value="service" />
              <input type="hidden" name="serviceId" value="" />
              <ServiceFields prefix="new" values={newServiceValues} errors={newServiceErrors} />
              <button type="submit" className="button button-secondary" disabled={busy}>
                Add service
              </button>
            </Form>
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="history-heading">
        <h2 id="history-heading">History</h2>
        {listing.history.length === 0 ? (
          <p className="muted">No changes recorded yet.</p>
        ) : (
          <ul className={styles.history}>
            {listing.history.map((h, i) => (
              <li key={i}>
                <strong>
                  {HISTORY_WORDS[h.action] ??
                    (h.action.startsWith('vendor.status.')
                      ? `Status: ${STATUS_LABEL[h.action.slice(14) as ListingStatus] ?? h.action.slice(14)}`
                      : h.action)}
                </strong>{' '}
                <span className="muted">
                  · {h.actor ?? 'System'} · {when.format(new Date(h.at))}
                  {h.reason ? ` · “${h.reason}”` : ''}
                  {h.changes && typeof h.changes === 'object' && h.action === 'vendor.update'
                    ? ` · ${Object.keys(h.changes as object)
                        .map((k) => FIELD_WORDS[k] ?? k)
                        .join(', ')}`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
